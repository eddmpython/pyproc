// browserDownload.js - declared click download를 broker-owned artifact store로 회수하고, manifest가 준 export root로 내보낸다.
//
// While a declared download runs, the session pauses each document response of its own page once (Fetch at the
// response stage) only to read the Content-Type the server declared, and lets it continue unchanged. The receipt's
// type is decided from the bytes first (`downloadReceipt.js`); the declared type rides beside it.
import { mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { BrowserControlError } from "./browserControlPort.js";
import { redactBrowserUrl } from "./browserObservation.js";
import { dataUrlMimeType, downloadMimeType, exportNameFrom, exportNameProblem } from "./downloadReceipt.js";

// The one interception a download sets: every document response of the session's page, paused only to be read.
export const DOWNLOAD_RESPONSE_PATTERNS = Object.freeze([
  Object.freeze({ urlPattern: "*", resourceType: "Document", requestStage: "Response" }),
]);
const RESPONSES_KEPT = 16;
const UNIQUE_ATTEMPTS = 100;

function sessionKey(ref) {
  return `${ref?.protocolVersion || ""}:${ref?.brokerId || ""}:${ref?.brokerEpoch || ""}:${ref?.sessionId || ""}:${ref?.targetRef || ""}`;
}

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

// The Content-Type the server declared for the download's own response: the one answered at the download's URL (after
// any redirect), else the only final response the page got while the download ran, else none.
function declaredFor(responses, url) {
  const answered = responses.filter((response) => !(response.status >= 300 && response.status < 400));
  const exact = answered.filter((response) => response.url === url);
  const chosen = exact.length ? exact[exact.length - 1] : (answered.length === 1 ? answered[0] : null);
  return chosen?.contentType || "";
}

// Writes the bytes as a new file directly inside the export root and returns its path and name. The root is resolved
// through any links first, the file is created only if nothing has that name (so nothing is replaced and no link is
// followed), and a taken name moves to `name (n).ext`.
export async function exportDownload(root, name, bytes) {
  const problem = exportNameProblem(name);
  if (problem) throw new TypeError(`download file name ${problem}`);
  await mkdir(root, { recursive: true });
  const folder = await realpath(resolve(root));
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length);
  for (let attempt = 0; attempt < UNIQUE_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 0 ? name : `${stem} (${attempt})${extension}`;
    const path = join(folder, candidate);
    if (dirname(path) !== folder || basename(path) !== candidate) throw new TypeError("download file name leaves the export root");
    try {
      await writeFile(path, bytes, { flag: "wx" });
      return Object.freeze({ path, name: candidate });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error(`download export root already holds ${UNIQUE_ATTEMPTS} files named like ${name}`);
}

export class BrowserDownload {
  constructor({ lifecycle, command, downloadDir, artifactStore, exportRoot = null } = {}) {
    if (!lifecycle || typeof lifecycle.watch !== "function" || typeof lifecycle.listen !== "function") {
      throw new TypeError("browser download lifecycle is required");
    }
    if (typeof command !== "function") throw new TypeError("browser download command callback is required");
    if (!downloadDir || !isAbsolute(downloadDir)) throw new TypeError("browser download directory must be absolute");
    if (!artifactStore || typeof artifactStore.put !== "function") throw new TypeError("browser download artifact store is required");
    if (exportRoot !== null && (typeof exportRoot !== "string" || !isAbsolute(exportRoot))) {
      throw new TypeError("browser download export root must be absolute");
    }
    this._lifecycle = lifecycle;
    this._command = command;
    this._downloadDir = resolve(downloadDir);
    this._artifactStore = artifactStore;
    this._exportRoot = exportRoot === null ? null : resolve(exportRoot);
    this._enabledSessions = new Set();
    this._exported = 0;
  }

  /** Whether a finished download is also written into the manifest's export root. */
  get exports() {
    return this._exportRoot !== null;
  }

  async run({ sessionRef, timeoutMs, commandResults, signal, click, saveAs = null }) {
    if (typeof click !== "function") throw new TypeError("browser download click callback is required");
    if (saveAs !== null && !this.exports) throw new TypeError("browser download saveAs needs an export root");
    await this._enable(sessionRef, commandResults, signal);
    const responses = [];
    const stopReading = await this._readResponses(sessionRef, responses, signal);
    try {
      return await this._capture(sessionRef, { timeoutMs, signal, click, saveAs, responses });
    } finally {
      await stopReading();
    }
  }

  async _capture(sessionRef, { timeoutMs, signal, click, saveAs, responses }) {
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
        const sourceUrl = String(beginEvent.params?.url || "");
        const suggestedFilename = basename(String(beginEvent.params?.suggestedFilename || "download"));
        const receipt = downloadMimeType({ bytes, declared: dataUrlMimeType(sourceUrl) || declaredFor(responses, sourceUrl),
          fileName: saveAs || suggestedFilename });
        let artifact;
        try {
          artifact = await this._artifactStore.put(bytes, {
            kind: "download",
            suggestedFilename,
            sourceUrl: redactBrowserUrl(sourceUrl),
            mimeType: receipt.mimeType,
          }, { inline: true });
        } catch (error) {
          if (error instanceof BrowserControlError) {
            throw new BrowserControlError(error.code, error.message,
              { outcome: "applied", retryable: error.retryable, cause: error });
          }
          throw error;
        }
        let exportedFile = null;
        if (this._exportRoot) {
          try {
            exportedFile = await exportDownload(this._exportRoot, saveAs || exportNameFrom(suggestedFilename), bytes);
          } catch (error) {
            // The bytes are still in the artifact store; the error names the artifact so they are not lost.
            throw new BrowserControlError("BROWSER_AUTOMATION_DOWNLOAD_EXPORT_FAILED",
              `browser download could not be written into the export root: ${error?.message || error}`,
              { outcome: "applied", cause: error, details: { artifactRef: artifact.artifactRef } });
          }
          this._exported += 1;
        }
        return Object.freeze({
          click: clickResult,
          download: Object.freeze({
            ...artifact,
            mimeEvidence: receipt.mimeEvidence,
            ...(receipt.declaredMimeType ? { declaredMimeType: receipt.declaredMimeType } : {}),
            ...(exportedFile ? { exportedFile } : {}),
          }),
        });
      } finally {
        try { await unlink(filePath); }
        catch (error) { if (error?.code !== "ENOENT") throw error; }
      }
    } finally {
      began.cancel();
    }
  }

  // Reads the Content-Type of each document response the page gets while the download runs, letting every response
  // continue as it came. Returns the function that ends it: interception is turned off first, so no response is left
  // paused, and only then does the reader stop.
  async _readResponses(sessionRef, responses, signal) {
    const stopListening = this._lifecycle.listen(sessionRef, "Fetch.requestPaused", (event) => {
      const params = event.params || {};
      if (params.responseStatusCode !== undefined) {
        const header = (params.responseHeaders || [])
          .find((item) => String(item?.name || "").toLowerCase() === "content-type");
        responses.push(Object.freeze({ url: String(params.request?.url || ""), status: Number(params.responseStatusCode),
          contentType: String(header?.value || "") }));
        if (responses.length > RESPONSES_KEPT) responses.shift();
      }
      this._command(sessionRef, "Fetch.continueRequest", { requestId: params.requestId }, [], undefined).catch(() => {});
    });
    try {
      await this._command(sessionRef, "Fetch.enable", { patterns: DOWNLOAD_RESPONSE_PATTERNS }, [], signal);
    } catch (error) {
      stopListening();
      throw error;
    }
    return async () => {
      try { await this._command(sessionRef, "Fetch.disable", {}, [], undefined); }
      catch { /* A session that went away took its interception with it. */ }
      finally { stopListening(); }
    };
  }

  dropSession(sessionRef) {
    this._enabledSessions.delete(sessionKey(sessionRef));
  }

  close() {
    this._enabledSessions.clear();
  }

  inspect() {
    return Object.freeze({ enabledSessions: this._enabledSessions.size, exports: this.exports, exported: this._exported });
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
