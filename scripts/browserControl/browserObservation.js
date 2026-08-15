// browserObservation.js - bounded screenshot, console, network artifact와 redaction.
import {
  BROWSER_OBSERVATION_DEFAULT_EVENTS,
  BROWSER_OBSERVATION_MAX_EVENTS,
  BROWSER_OBSERVATION_TEXT_LIMIT,
} from "./browserObservationCatalog.js";

const SECRET_PATTERN = /\b(authorization|bearer|password|passwd|secret|token|api[_-]?key|session)\b\s*[:=]\s*([^\s,;]+)/gi;

function sessionKey(ref) {
  return `${ref?.protocolVersion || ""}:${ref?.brokerId || ""}:${ref?.brokerEpoch || ""}:${ref?.sessionId || ""}:${ref?.targetRef || ""}`;
}

function clipped(value, limit = BROWSER_OBSERVATION_TEXT_LIMIT) {
  const text = String(value ?? "").replace(SECRET_PATTERN, "$1=[redacted]");
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
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
      level: clipped(params.type || "log", 20),
      timestamp: Number(params.timestamp) || null,
      args: Object.freeze((params.args || []).slice(0, 10).map(consoleArgument)),
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
      await this._command(sessionRef, "Runtime.enable", {}, commandResults, signal);
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
