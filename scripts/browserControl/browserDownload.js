// browserDownload.js - declared click download를 broker-owned artifact store로 회수한다.
import { mkdir, readFile, unlink } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { BrowserControlError } from "./browserControlPort.js";
import { redactBrowserUrl } from "./browserObservation.js";

function sessionKey(ref) {
  return `${ref?.protocolVersion || ""}:${ref?.brokerId || ""}:${ref?.brokerEpoch || ""}:${ref?.sessionId || ""}:${ref?.targetRef || ""}`;
}

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export class BrowserDownload {
  constructor({ lifecycle, command, downloadDir, artifactStore } = {}) {
    if (!lifecycle || typeof lifecycle.watch !== "function") throw new TypeError("browser download lifecycle is required");
    if (typeof command !== "function") throw new TypeError("browser download command callback is required");
    if (!downloadDir || !isAbsolute(downloadDir)) throw new TypeError("browser download directory must be absolute");
    if (!artifactStore || typeof artifactStore.put !== "function") throw new TypeError("browser download artifact store is required");
    this._lifecycle = lifecycle;
    this._command = command;
    this._downloadDir = resolve(downloadDir);
    this._artifactStore = artifactStore;
    this._enabledSessions = new Set();
  }

  async run({ sessionRef, timeoutMs, commandResults, signal, click }) {
    if (typeof click !== "function") throw new TypeError("browser download click callback is required");
    await this._enable(sessionRef, commandResults, signal);
    const began = this._lifecycle.watch(sessionRef, "Page.downloadWillBegin", {
      timeoutMs, signal, timeoutOutcome: "applied",
    });
    const clickPromise = click();
    clickPromise.catch(() => {});
    const clickFailure = clickPromise.then(() => new Promise(() => {}), (error) => Promise.reject(error));
    try {
      const beginEvent = await Promise.race([began.promise, clickFailure]);
      const guid = String(beginEvent.params?.guid || "");
      if (!guid || /[\\/]/.test(guid)) {
        throw new BrowserControlError("BROWSER_AUTOMATION_DOWNLOAD_INVALID",
          "browser download returned an invalid identifier", { outcome: "applied" });
      }
      const completed = this._lifecycle.watch(sessionRef, "Page.downloadProgress", {
        timeoutMs,
        signal,
        timeoutOutcome: "applied",
        predicate: (event) => event.params?.guid === guid && ["completed", "canceled"].includes(event.params?.state),
      });
      const progress = await completed.promise;
      if (progress.params?.state !== "completed") {
        throw new BrowserControlError("BROWSER_AUTOMATION_DOWNLOAD_CANCELLED",
          "browser download was cancelled", { outcome: "applied" });
      }
      const clickResult = await clickPromise;
      const filePath = resolve(join(this._downloadDir, guid));
      if (!inside(this._downloadDir, filePath)) {
        throw new BrowserControlError("BROWSER_AUTOMATION_DOWNLOAD_INVALID",
          "browser download escaped the controlled directory", { outcome: "applied" });
      }
      const bytes = await readFile(filePath);
      try {
        try {
          return Object.freeze({
            click: clickResult,
            artifact: await this._artifactStore.put(bytes, {
              kind: "download",
              suggestedFilename: basename(String(beginEvent.params?.suggestedFilename || "download")),
              sourceUrl: redactBrowserUrl(beginEvent.params?.url),
              mimeType: "application/octet-stream",
            }, { inline: true }),
          });
        } catch (error) {
          if (error instanceof BrowserControlError) {
            throw new BrowserControlError(error.code, error.message,
              { outcome: "applied", retryable: error.retryable, cause: error });
          }
          throw error;
        }
      } finally {
        try { await unlink(filePath); }
        catch (error) { if (error?.code !== "ENOENT") throw error; }
      }
    } finally {
      began.cancel();
    }
  }

  dropSession(sessionRef) {
    this._enabledSessions.delete(sessionKey(sessionRef));
  }

  close() {
    this._enabledSessions.clear();
  }

  inspect() {
    return Object.freeze({ enabledSessions: this._enabledSessions.size });
  }

  async _enable(sessionRef, commandResults, signal) {
    const key = sessionKey(sessionRef);
    if (this._enabledSessions.has(key)) return;
    await mkdir(this._downloadDir, { recursive: true });
    await this._command(sessionRef, "Page.setDownloadBehavior", {
      behavior: "allowAndName",
      downloadPath: this._downloadDir,
      eventsEnabled: true,
    }, commandResults, signal);
    this._enabledSessions.add(key);
  }
}
