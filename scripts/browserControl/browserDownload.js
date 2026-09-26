// browserDownload.js - declared click download를 broker-owned artifact store로 회수하고, manifest가 준 export root로 내보낸다.
//
// A browser pyproc launched saves into pyproc's staging folder (Page.setDownloadBehavior). While a declared download
// runs there, the session pauses each document response of its own page once (Fetch at the response stage) only to
// read the Content-Type the server declared, and lets it continue unchanged. The user's own browser saves a download
// itself: the transport is armed for the one download the click starts and says where the browser saved it and the
// type it recorded; the file is read there and left in place. Either way the receipt's type is decided from the bytes
// first (`downloadReceipt.js`), with the declared type beside it.
import { lstat, mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
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

const withoutFragment = (url) => String(url || "").split("#")[0];

// The Content-Type the server declared for the download's own response: the one answered at the download's URL
// (after any redirect, the fragment aside), or none. No other response speaks for it.
function declaredFor(responses, url) {
  const wanted = withoutFragment(url);
  const answered = responses.filter((response) => !(response.status >= 300 && response.status < 400)
    && withoutFragment(response.url) === wanted);
  return answered.at(-1)?.contentType || "";
}

// The bytes of the file a browser saved itself, which must be a regular file at an absolute path.
async function savedDownloadBytes(path) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new BrowserControlError("BROWSER_AUTOMATION_DOWNLOAD_INVALID", "browser download has no saved file",
      { outcome: "applied" });
  }
  let info;
  try { info = await lstat(path); }
  catch (error) {
    throw new BrowserControlError("BROWSER_AUTOMATION_DOWNLOAD_INVALID", "browser download file is gone",
      { outcome: "applied", cause: error });
  }
  if (!info.isFile()) {
    throw new BrowserControlError("BROWSER_AUTOMATION_DOWNLOAD_INVALID", "browser download is not a regular file",
      { outcome: "applied" });
  }
  return readFile(path);
}

// Windows' mark of a file from the internet (its Zone.Identifier stream), as a browser leaves on what it downloads:
// the internet zone and where the file came from, without its query. False where the file system keeps no streams.
async function markFromInternet(path, sourceUrl) {
  if (process.platform !== "win32") return false;
  const from = redactBrowserUrl(sourceUrl);
  const hostUrl = from === "[redacted-url]" ? "about:internet" : from;
  try {
    await writeFile(`${path}:Zone.Identifier`, `[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=${hostUrl}\r\n`, { flag: "w" });
    return true;
  } catch {
    return false;
  }
}

// Writes the bytes as a new file directly inside the export root and returns its path and name. The root is resolved
// through any links first. A name that anything already holds (a file, a folder, or a link, even one pointing nowhere)
// is taken, so nothing is replaced and no link is followed; the next free `name (n).ext` is used. The file written is
// checked to be a regular file in the root itself. On Windows it carries the mark of a file from the internet.
export async function exportDownload(root, name, bytes, { sourceUrl = "" } = {}) {
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
    const taken = await lstat(path).then(() => true, (error) => {
      if (error?.code === "ENOENT") return false;
      throw error;
    });
    if (taken) continue;
    try {
      await writeFile(path, bytes, { flag: "wx" });
    } catch (error) {
      if (error?.code === "EEXIST") continue;
      throw error;
    }
    const written = await lstat(path);
    if (!written.isFile() || dirname(await realpath(path)) !== folder) {
      throw new Error(`download file ${candidate} did not stay a file in the export root`);
    }
    return Object.freeze({ path, name: candidate, markOfTheWeb: await markFromInternet(path, sourceUrl) });
  }
  throw new Error(`download export root already holds ${UNIQUE_ATTEMPTS} files named like ${name}`);
}

export class BrowserDownload {
  constructor({ lifecycle, command, downloadDir, artifactStore, exportRoot = null, browserSaves = null } = {}) {
    if (!lifecycle || typeof lifecycle.watch !== "function" || typeof lifecycle.listen !== "function") {
      throw new TypeError("browser download lifecycle is required");
    }
    if (typeof command !== "function") throw new TypeError("browser download command callback is required");
    if (!downloadDir || !isAbsolute(downloadDir)) throw new TypeError("browser download directory must be absolute");
    if (!artifactStore || typeof artifactStore.put !== "function") throw new TypeError("browser download artifact store is required");
    if (exportRoot !== null && (typeof exportRoot !== "string" || !isAbsolute(exportRoot))) {
      throw new TypeError("browser download export root must be absolute");
    }
    if (browserSaves !== null && typeof browserSaves !== "function") {
      throw new TypeError("browser download browserSaves is invalid");
    }
    this._lifecycle = lifecycle;
    this._command = command;
    this._downloadDir = resolve(downloadDir);
    this._artifactStore = artifactStore;
    this._exportRoot = exportRoot === null ? null : resolve(exportRoot);
    // (sessionRef, { timeoutMs }) => { done, cancel } for a browser that saves downloads itself, else null.
    this._browserSaves = browserSaves;
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
    if (this._browserSaves) return this._captureSaved(sessionRef, { timeoutMs, signal, click, saveAs });
    await this._enable(sessionRef, commandResults, signal);
    const responses = [];
    const stopReading = await this._readResponses(sessionRef, responses, commandResults, signal);
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
        return await this._receipt({ clickResult, bytes, sourceUrl, saveAs,
          suggestedFilename: basename(String(beginEvent.params?.suggestedFilename || "download")),
          declared: dataUrlMimeType(sourceUrl) || declaredFor(responses, sourceUrl) });
      } finally {
        try { await unlink(filePath); }
        catch (error) { if (error?.code !== "ENOENT") throw error; }
      }
    } finally {
      began.cancel();
    }
  }

  // A browser that saves downloads itself: the transport is armed before the click and says where the browser saved
  // the one download the click started, and the file there is read (and left where the browser put it).
  async _captureSaved(sessionRef, { timeoutMs, signal, click, saveAs }) {
    const armed = await this._browserSaves(sessionRef, { timeoutMs });
    let timer = null;
    let abort = null;
    try {
      const clickPromise = click();
      clickPromise.catch(() => {});
      const clickFailure = clickPromise.then(() => new Promise(() => {}), (error) => Promise.reject(error));
      const ended = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new BrowserControlError("BROWSER_AUTOMATION_EVENT_TIMEOUT",
          "browser download did not finish in time", { outcome: "applied" })), timeoutMs);
        abort = () => reject(new BrowserControlError("BROWSER_CONTROL_COMMAND_CANCELLED",
          "browser download wait was cancelled", { outcome: "applied" }));
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
      ended.catch(() => {});
      const saved = await Promise.race([armed.done, clickFailure, ended]);
      if (saved?.state !== "complete") {
        throw new BrowserControlError("BROWSER_AUTOMATION_DOWNLOAD_CANCELLED",
          `browser download did not complete: ${saved?.error || saved?.state || "unknown"}`, { outcome: "applied" });
      }
      const clickResult = await clickPromise;
      const bytes = await savedDownloadBytes(saved.path);
      return await this._receipt({ clickResult, bytes, sourceUrl: String(saved.url || ""), saveAs,
        suggestedFilename: basename(saved.path), declared: String(saved.mimeType || "") });
    } finally {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener("abort", abort);
      await armed.cancel();
    }
  }

  // The receipt: the type decided from the bytes, the artifact that keeps them, and the file in the export root.
  async _receipt({ clickResult, bytes, sourceUrl, suggestedFilename, declared, saveAs }) {
    const receipt = downloadMimeType({ bytes, declared, fileName: saveAs || suggestedFilename });
    let artifact;
    try {
      artifact = await this._artifactStore.put(bytes, {
        kind: "download",
        suggestedFilename,
        sourceUrl: redactBrowserUrl(sourceUrl),
        mimeType: receipt.mimeType,
      }, { inline: true, allowEmpty: true });
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
        exportedFile = await exportDownload(this._exportRoot, saveAs || exportNameFrom(suggestedFilename), bytes,
          { sourceUrl });
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
  }

  // Reads the Content-Type of each document response the page gets while the download runs, letting every response
  // continue as it came; every command it sends joins the action's commands. Returns the function that ends it: the
  // responses let go are settled, interception is turned off (so none is left paused), and only then does the reader
  // stop. A response the page gets while its surface is not verified never reaches the reader; the port lets it go.
  async _readResponses(sessionRef, responses, commandResults, signal) {
    const releasing = new Set();
    const stopListening = this._lifecycle.listen(sessionRef, "Fetch.requestPaused", (event) => {
      const params = event.params || {};
      if (params.responseStatusCode !== undefined) {
        const header = (params.responseHeaders || [])
          .find((item) => String(item?.name || "").toLowerCase() === "content-type");
        responses.push(Object.freeze({ url: String(params.request?.url || ""), status: Number(params.responseStatusCode),
          contentType: String(header?.value || "") }));
        if (responses.length > RESPONSES_KEPT) responses.shift();
      }
      const released = this._command(sessionRef, "Fetch.continueRequest", { requestId: params.requestId },
        commandResults, undefined).catch(() => {});
      releasing.add(released);
      void released.finally(() => releasing.delete(released));
    });
    const stop = async () => {
      try {
        await Promise.allSettled([...releasing]);
        await this._command(sessionRef, "Fetch.disable", {}, commandResults, undefined);
      } catch { /* A session that went away took its interception with it. */ }
      finally { stopListening(); }
    };
    try {
      await this._command(sessionRef, "Fetch.enable", { patterns: DOWNLOAD_RESPONSE_PATTERNS }, commandResults, signal);
    } catch (error) {
      // A cancelled or timed-out enable may still have reached the browser: interception is turned off either way.
      await stop();
      throw error;
    }
    return stop;
  }

  dropSession(sessionRef) {
    this._enabledSessions.delete(sessionKey(sessionRef));
  }

  close() {
    this._enabledSessions.clear();
  }

  inspect() {
    return Object.freeze({ enabledSessions: this._enabledSessions.size, exports: this.exports, exported: this._exported,
      browserSaves: this._browserSaves !== null });
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
