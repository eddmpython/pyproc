// browserObservation.js - bounded screenshot, console, network artifact와 redaction.
//
// The console channel, asked for with `includeConsole`, carries the page's console calls, its uncaught exceptions, and
// the browser's own log (a resource that failed to load, a blocked request, a violation), each with `source`
// (`consoleApi`, `exception`, or the browser log's own source such as `network`). A session that never asked for it
// turns on neither the Runtime nor the Log domain. Text keeps secret-looking values out, and the URLs a text carries
// lose their query. An image address in a snapshot keeps its query (`redactImageAddress`).
import {
  BROWSER_OBSERVATION_ADDRESS_LIMIT,
  BROWSER_OBSERVATION_DEFAULT_EVENTS,
  BROWSER_OBSERVATION_MAX_EVENTS,
  BROWSER_OBSERVATION_TEXT_LIMIT,
} from "./browserObservationCatalog.js";

const SECRET_PATTERN = /\b(authorization|bearer|password|passwd|secret|token|api[_-]?key|session)\b\s*[:=]\s*([^\s,;]+)/gi;
// The query parameters (by lower-cased name) whose value an image address keeps as it is. Each says which image to show
// and how (a thumbnail proxy's src or url, a size, crop, format or quality, a cache version), and none grants access:
// Naver's src and type, Next.js url, w and q, imgix and Shopify width, height, fit, crop, auto, fm, dpr. Every other
// value becomes [redacted]. Signed and session addresses name their credential in words no list of secret names can
// finish (pass, hmac, md5, verify, hdnts, __gda__, st, hm, oh, nid_ses, NID_AUT, X-Amz-Signature), so a name not known
// to be harmless is treated as one. h and s stay out on purpose: a height and a size on some servers, a hash and a
// signature on others.
const IMAGE_PARAMETERS = new Set(["src", "url", "type", "w", "width", "height", "q", "quality", "fit", "crop", "auto",
  "fm", "format", "dpr", "v"]);
// A query value without a name is kept only as a cache stamp of digits; any other one could be a bare token.
const CACHE_STAMP = /^\d+$/;
// A JSON Web Token, whatever the parameter carrying it is called.
const TOKEN_VALUE = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./;
// A value that is an address of its own (absolute or protocol-relative), as opposed to a size or a path.
const NESTED_ADDRESS = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
// How many addresses deep a parameter value (a thumbnail proxy's original image address) is searched. A deeper address
// that still carries a query is not searched, so it is not known to be harmless.
const NESTED_ADDRESS_DEPTH = 2;
// How many times a value is percent-decoded before it is judged. An address encoded twice (a proxy's src carrying another
// proxy's url) shows its query only after the second decoding; a value still changing after this many is not judged
// harmless.
const DECODE_ROUNDS = 4;
// A path segment that names an image by a long id with its size after it (googleusercontent's `<id>=s96-c`). The id is
// the image's only name, so it stays.
const IMAGE_ID_SIZE = /^[A-Za-z0-9_-]{33,}=[A-Za-z0-9_.:+-]*$/;
// The value of a path option kept for an image parameter: a size, a format, a crop word.
const PLAIN_OPTION = /^[A-Za-z0-9_.:+-]*$/;

function sessionKey(ref) {
  return `${ref?.protocolVersion || ""}:${ref?.brokerId || ""}:${ref?.brokerEpoch || ""}:${ref?.sessionId || ""}:${ref?.targetRef || ""}`;
}

function clipped(value, limit = BROWSER_OBSERVATION_TEXT_LIMIT) {
  const text = String(value ?? "").replace(SECRET_PATTERN, "$1=[redacted]");
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

// Text with every URL in it cut before its query or fragment (an exception's stack or a log line can carry tokens there).
function withoutUrlQueries(text) {
  return String(text ?? "").replace(/(\b(?:https?|wss?):\/\/[^\s?#'"()<>]+)[?#][^\s'"()<>]*/gi, "$1");
}

export function redactBrowserUrl(value) {
  try {
    const parsed = new URL(String(value));
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) return "[redacted-url]";
    return `${parsed.origin}${parsed.pathname}`;
  } catch (error) {
    return "[redacted-url]";
  }
}

function decodedComponent(text) {
  try { return decodeURIComponent(text.replace(/\+/g, " ")); }
  catch (error) { return text; }
}

// Text percent-decoded until it stops changing, or null when it still changes after DECODE_ROUNDS decodings.
function fullyDecoded(text) {
  let current = text;
  for (let round = 0; round < DECODE_ROUNDS; round += 1) {
    const next = decodedComponent(current);
    if (next === current) return current;
    current = next;
  }
  return decodedComponent(current) === current ? current : null;
}

// A query split at `&` and `;` (both separate parameters on some servers), with the value of every parameter not known
// to be harmless replaced by [redacted]. The separators and every kept parameter keep their exact bytes.
function harmlessQuery(query, depth) {
  return query.replace(/[^&;]+/g, (pair) => {
    const split = pair.indexOf("=");
    if (split < 0) return CACHE_STAMP.test(decodedComponent(pair)) ? pair : "[redacted]";
    const name = pair.slice(0, split);
    return harmlessParameter(decodedComponent(name), decodedComponent(pair.slice(split + 1)), depth)
      ? pair : `${name}=[redacted]`;
  });
}

// A parameter is harmless when its name is an image parameter, its value (decoded until it stops changing) is no token,
// and a value with an address, query, fragment or parameter separator in it (a proxy's original image) is a harmless
// address; any other value is a plain name or path whose segments are harmless.
function harmlessParameter(name, value, depth) {
  if (!IMAGE_PARAMETERS.has(name.toLowerCase())) return false;
  const decoded = fullyDecoded(value);
  if (decoded === null || TOKEN_VALUE.test(decoded)) return false;
  const nested = decoded.replace(/^["']|["']$/g, "");
  if (NESTED_ADDRESS.test(nested) || /[?#&;=]/.test(nested)) return harmlessAddress(nested, depth);
  return redactedPath(nested, depth) === nested;
}

// An address inside a value or a path segment is harmless when it is within NESTED_ADDRESS_DEPTH addresses, carries no
// credentials, and its path, query and fragment are harmless all the way down.
function harmlessAddress(text, depth) {
  if (depth >= NESTED_ADDRESS_DEPTH) return false;
  let parsed;
  try { parsed = new URL(text, "https://nested.invalid/"); }
  catch (error) { return false; }
  if (parsed.username || parsed.password) return false;
  if (redactedPath(parsed.pathname, depth + 1) !== parsed.pathname) return false;
  const query = parsed.search.slice(1);
  const fragment = parsed.hash.slice(1);
  return (!query || harmlessQuery(query, depth + 1) === query)
    && (!fragment || harmlessQuery(fragment, depth + 1) === fragment);
}

// A path with every segment that could carry a credential redacted (redactedSegment). Any other segment keeps its
// bytes, because a path names the image itself.
function redactedPath(path, depth) {
  return path.split("/").map((segment) => (segment ? redactedSegment(segment, depth) : segment)).join("/");
}

// One path segment. Decoded until it stops changing, a JSON Web Token becomes [redacted]; a segment with an address,
// query or fragment in it stays only as a harmless address; one whose `;` or `=` was percent-encoded becomes [redacted].
// A `;name=value` matrix parameter keeps its value only for an image parameter with a plain value. The rest of a segment
// with `=` in it (a session or signature in the path, as Akamai's `hdnts=exp=...~hmac=...`) becomes [redacted] unless it
// is an image option list (`width=640,quality=75`, every option an image parameter with a plain value) or a long image
// id with its size (IMAGE_ID_SIZE). A segment that grants access only by being unguessable (an image id) is the image's
// only name, so it is kept: such an address shows that image to whoever reads it, as the page did.
function redactedSegment(segment, depth) {
  const decoded = fullyDecoded(segment);
  if (decoded === null || TOKEN_VALUE.test(decoded)) return "[redacted]";
  if (/[?#&]/.test(decoded) || decoded.includes("//")) return harmlessAddress(decoded, depth) ? segment : "[redacted]";
  if (!/[;=]/.test(decoded)) return segment;
  if (decoded !== segment) return "[redacted]";
  const [head, ...parameters] = segment.split(";");
  const options = head.split(",");
  const kept = !head.includes("=") || IMAGE_ID_SIZE.test(head)
    || options.every((option) => option.includes("=") && redactedOption(option) === option);
  return [kept ? head : "[redacted]", ...parameters.map(redactedOption)].join(";");
}

function redactedOption(option) {
  const split = option.indexOf("=");
  if (split < 0) return CACHE_STAMP.test(option) ? option : "[redacted]";
  const name = option.slice(0, split);
  return IMAGE_PARAMETERS.has(name.toLowerCase()) && PLAIN_OPTION.test(option.slice(split + 1))
    ? option : `${name}=[redacted]`;
}

// The address of an image as a snapshot names it, whole enough to load: http(s) only, never with embedded credentials,
// at most BROWSER_OBSERVATION_ADDRESS_LIMIT characters, without its fragment, and with its query kept, because a
// thumbnail proxy names the original image there (`?src=<encoded address>`). A parameter known to be harmless for an
// image (IMAGE_PARAMETERS, with an address it carries harmless too, however many times it was encoded) keeps its exact
// bytes; every other value becomes `[redacted]`, so an unfamiliar signature or session name never passes as harmless.
// `&` and `;` both separate parameters. The path keeps its bytes except a segment that carries a token, an address with
// a query, or a session option (redactedSegment). Anything else returns null.
export function redactImageAddress(value) {
  if (typeof value !== "string" || !value || value.length > BROWSER_OBSERVATION_ADDRESS_LIMIT) return null;
  let parsed;
  try { parsed = new URL(value); }
  catch (error) { return null; }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) return null;
  parsed.hash = "";
  const path = redactedPath(parsed.pathname, 0);
  if (path !== parsed.pathname) parsed.pathname = path;
  const query = parsed.search.slice(1);
  if (query) {
    const kept = harmlessQuery(query, 0);
    if (kept !== query) parsed.search = kept;
  }
  return parsed.href.length > BROWSER_OBSERVATION_ADDRESS_LIMIT ? null : parsed.href;
}

function consoleArgument(argument) {
  if (!argument || typeof argument !== "object") return null;
  if (Object.hasOwn(argument, "value")) {
    const value = argument.value;
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    return clipped(value);
  }
  return clipped(argument.description || argument.className || argument.type || "value");
}

export function normalizeBrowserObservationEvent(event, idFactory, requestRef = null) {
  const params = event.params || {};
  if (event.method === "Runtime.consoleAPICalled") {
    return Object.freeze({
      eventId: `event:${idFactory()}`,
      kind: "console",
      source: "consoleApi",
      level: clipped(params.type || "log", 20),
      timestamp: Number(params.timestamp) || null,
      args: Object.freeze((params.args || []).slice(0, 10).map(consoleArgument)),
    });
  }
  if (event.method === "Runtime.exceptionThrown") {
    const details = params.exceptionDetails || {};
    return Object.freeze({
      eventId: `event:${idFactory()}`,
      kind: "console",
      source: "exception",
      level: "error",
      timestamp: Number(params.timestamp) || null,
      text: clipped(withoutUrlQueries(details.exception?.description || details.text || "uncaught exception")),
      ...(details.url ? { url: redactBrowserUrl(details.url) } : {}),
      ...(Number.isInteger(details.lineNumber) ? { line: details.lineNumber + 1 } : {}),
      ...(Number.isInteger(details.columnNumber) ? { column: details.columnNumber + 1 } : {}),
    });
  }
  if (event.method === "Log.entryAdded") {
    const entry = params.entry || {};
    return Object.freeze({
      eventId: `event:${idFactory()}`,
      kind: "console",
      source: clipped(entry.source || "other", 40),
      level: clipped(entry.level || "info", 20),
      timestamp: Number(entry.timestamp) || null,
      text: clipped(withoutUrlQueries(entry.text || "")),
      ...(entry.url ? { url: redactBrowserUrl(entry.url) } : {}),
    });
  }
  if (event.method === "Network.requestWillBeSent") {
    return Object.freeze({
      eventId: `event:${idFactory()}`,
      kind: "network",
      phase: "request",
      method: clipped(params.request?.method || "GET", 20),
      url: redactBrowserUrl(params.request?.url),
      resourceType: clipped(params.type || "Other", 40),
      timestamp: Number(params.timestamp) || null,
      ...(requestRef ? { requestRef } : {}),
    });
  }
  if (event.method === "Network.responseReceived") {
    return Object.freeze({
      eventId: `event:${idFactory()}`,
      kind: "network",
      phase: "response",
      status: Number(params.response?.status) || 0,
      mimeType: clipped(params.response?.mimeType || "", 100),
      url: redactBrowserUrl(params.response?.url),
      resourceType: clipped(params.type || "Other", 40),
      timestamp: Number(params.timestamp) || null,
      ...(requestRef ? { requestRef } : {}),
    });
  }
  if (event.method === "Network.loadingFailed") {
    return Object.freeze({
      eventId: `event:${idFactory()}`,
      kind: "network",
      phase: "failed",
      error: clipped(params.errorText || "network request failed"),
      resourceType: clipped(params.type || "Other", 40),
      timestamp: Number(params.timestamp) || null,
      ...(requestRef ? { requestRef } : {}),
    });
  }
  return null;
}

export class BrowserObservation {
  constructor({ port, command, screenshot = null, idFactory = () => crypto.randomUUID() } = {}) {
    if (!port || typeof port.subscribe !== "function") throw new TypeError("browser observation port is required");
    if (typeof command !== "function") throw new TypeError("browser observation command callback is required");
    if (typeof idFactory !== "function") throw new TypeError("browser observation idFactory is required");
    this._port = port;
    this._command = command;
    this._screenshot = screenshot;
    this._idFactory = idFactory;
    this._sessions = new Map();
  }

  async capture(sessionRef, options, commandResults, signal) {
    const includeConsole = options.includeConsole === true;
    const includeNetwork = options.includeNetwork === true;
    const includeScreenshot = options.includeScreenshot === true;
    if (!includeConsole && !includeNetwork && !includeScreenshot) return Object.freeze({});
    const maxEvents = options.maxEvents || BROWSER_OBSERVATION_DEFAULT_EVENTS;
    const session = (includeConsole || includeNetwork) ? this._ensureSession(sessionRef) : null;
    if (includeConsole && !session.consoleEnabled) {
      // Runtime brings console calls and uncaught exceptions, Log the browser's own messages; both replay what the
      // page produced before they were turned on.
      await this._command(sessionRef, "Runtime.enable", {}, commandResults, signal);
      await this._command(sessionRef, "Log.enable", {}, commandResults, signal);
      session.consoleEnabled = true;
    }
    if (includeNetwork && !session.networkEnabled) {
      await this._command(sessionRef, "Network.enable", {}, commandResults, signal);
      session.networkEnabled = true;
    }
    const artifact = {};
    if (includeScreenshot) {
      if (!this._screenshot) throw new Error("browser screenshot artifact store is unavailable");
      artifact.screenshot = await this._screenshot.capture(sessionRef, {
        format: "png", inline: true,
      }, commandResults, signal);
    }
    const windows = [];
    if (includeConsole) {
      const captured = this._read(session.console, maxEvents, options.eventWatermarks?.console);
      artifact.console = captured.events;
      windows.push(captured.window);
    }
    if (includeNetwork) {
      const captured = this._read(session.network, maxEvents, options.eventWatermarks?.network);
      artifact.network = captured.events;
      windows.push(captured.window);
    }
    if (windows.length) artifact.eventWindows = Object.freeze(windows);
    return Object.freeze(artifact);
  }

  dropSession(sessionRef) {
    const key = sessionKey(sessionRef);
    this._sessions.get(key)?.unsubscribe();
    this._sessions.delete(key);
  }

  close() {
    for (const session of this._sessions.values()) session.unsubscribe();
    this._sessions.clear();
  }

  inspect() {
    let consoleEvents = 0;
    let networkEvents = 0;
    for (const session of this._sessions.values()) {
      consoleEvents += session.console.events.length;
      networkEvents += session.network.events.length;
    }
    return Object.freeze({ sessions: this._sessions.size, consoleEvents, networkEvents });
  }

  _ensureSession(sessionRef) {
    const key = sessionKey(sessionRef);
    const present = this._sessions.get(key);
    if (present) return present;
    const bucket = (channel) => ({ channel, events: [], nextSequence: 1, droppedThrough: 0 });
    const state = { console: bucket("console"), network: bucket("network"), requestRefs: new Map(),
      consoleEnabled: false, networkEnabled: false, unsubscribe: null };
    state.unsubscribe = this._port.subscribe(sessionRef, (event) => {
      const nativeRequestId = event.params?.requestId;
      if (event.method === "Network.loadingFinished" && nativeRequestId) {
        state.requestRefs.delete(nativeRequestId);
        return;
      }
      let requestRef = null;
      if (typeof event.method === "string" && event.method.startsWith("Network.") && nativeRequestId) {
        requestRef = state.requestRefs.get(nativeRequestId);
        if (!requestRef) {
          requestRef = `request:${this._idFactory()}`;
          state.requestRefs.set(nativeRequestId, requestRef);
          if (state.requestRefs.size > BROWSER_OBSERVATION_MAX_EVENTS) {
            state.requestRefs.delete(state.requestRefs.keys().next().value);
          }
        }
      }
      const normalized = normalizeBrowserObservationEvent(event, this._idFactory, requestRef);
      if (event.method === "Network.loadingFailed" && nativeRequestId) state.requestRefs.delete(nativeRequestId);
      if (!normalized) return;
      const target = normalized.kind === "console" ? state.console : state.network;
      target.events.push(Object.freeze({ ...normalized, sequence: target.nextSequence++ }));
      if (target.events.length > BROWSER_OBSERVATION_MAX_EVENTS) {
        const removed = target.events.splice(0, target.events.length - BROWSER_OBSERVATION_MAX_EVENTS);
        target.droppedThrough = removed.at(-1)?.sequence || target.droppedThrough;
      }
    });
    this._sessions.set(key, state);
    return state;
  }

  _read(bucket, maxEvents, watermark) {
    const startSequence = Number.isInteger(watermark) && watermark >= 0 ? watermark : 0;
    const endSequence = bucket.nextSequence - 1;
    const eligible = bucket.events.filter((event) => event.sequence > startSequence);
    const selected = eligible.slice(Math.max(0, eligible.length - maxEvents));
    const droppedByProjection = Math.max(0, eligible.length - selected.length);
    const droppedByRetention = Math.max(0, Math.min(endSequence, bucket.droppedThrough) - startSequence);
    const droppedWithinWindow = droppedByProjection + droppedByRetention;
    return Object.freeze({
      events: Object.freeze(selected),
      window: Object.freeze({
        channel: bucket.channel,
        startSequence,
        endSequence,
        returnedCount: selected.length,
        droppedBeforeStart: Math.min(startSequence, bucket.droppedThrough),
        droppedWithinWindow,
        complete: droppedWithinWindow === 0,
      }),
    });
  }
}
