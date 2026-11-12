// controlServer.mjs - Control Protocol 호스트의 클라이언트 연결. 한 번에 한 클라이언트를 받고, 세션을 쥔 채 클라이언트를 잃으면 돌아올 클라이언트를 기다린다.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { open, rename, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import {
  CONTROL_ATTACHMENT_CHUNK_BYTES,
  acceptControlHello,
  controlBase,
  decodeControlFrame,
  encodeControlFrame,
} from "./controlProtocol.js";

export const CONTROL_RECONNECT_SCHEMA_VERSION = 1;
export const CONTROL_RECONNECT_DEFAULT_MS = 60_000;
export const CONTROL_RECONNECT_MAX_MS = 30 * 60_000;
// The client a waiting host went to answers the host's first line with its own, within this time and this many bytes.
const TOKEN_TIMEOUT_MS = 5_000;
const TOKEN_MAX_BYTES = 64 * 1024;
// How often a waiting host looks for the announcement of a returning client, and the most it reads of one.
const ANNOUNCEMENT_POLL_MS = 100;
const ANNOUNCEMENT_MAX_BYTES = 4 * 1024;
const CLIENT_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const RECONNECT_FILE_ENV = "PYPROC_CONTROL_RECONNECT_FILE";
const RECONNECT_MS_ENV = "PYPROC_CONTROL_RECONNECT_MS";

/** The reconnect option of one host: `{ file, windowMs }`, or null when the host ends with its client (the default). */
export function controlReconnectOptions({ file = "", windowMs = "" } = {}) {
  if (!file) {
    if (windowMs !== "") throw new TypeError("--reconnect-ms requires --reconnect <file>");
    return null;
  }
  if (!isAbsolute(file)) throw new TypeError("--reconnect requires an absolute file path");
  const ms = windowMs === "" ? CONTROL_RECONNECT_DEFAULT_MS : Number(windowMs);
  if (!Number.isInteger(ms) || ms < 1 || ms > CONTROL_RECONNECT_MAX_MS) {
    throw new TypeError(`--reconnect-ms must be an integer from 1 to ${CONTROL_RECONNECT_MAX_MS}`);
  }
  return Object.freeze({ file, windowMs: ms });
}

/** Hand the option to the server module. An inherited variable never switches reconnect on: both are always reset. */
export function applyControlReconnectEnvironment(reconnect, env = process.env) {
  delete env[RECONNECT_FILE_ENV];
  delete env[RECONNECT_MS_ENV];
  if (!reconnect) return;
  env[RECONNECT_FILE_ENV] = reconnect.file;
  env[RECONNECT_MS_ENV] = String(reconnect.windowMs);
}

export function controlReconnectFromEnvironment(env = process.env) {
  return controlReconnectOptions({ file: env[RECONNECT_FILE_ENV] || "", windowMs: env[RECONNECT_MS_ENV] || "" });
}

/** Where a returning client announces itself to the host that waits with the endpoint file `file`. */
export const controlReconnectAnnouncement = (file) => `${file}.client`;

/**
 * The first line of a waiting host on the connection it makes to a returning client: HMAC-SHA256 of the announced
 * `clientToken`, keyed with the endpoint `token`, in lowercase hex. Only a process that read both files can make it,
 * and it is of no use toward any other announcement.
 */
export const controlReconnectProof = (token, clientToken) =>
  createHmac("sha256", token).update(clientToken).digest("hex");

function errorPayload(error, fallbackCode = "CONTROL_CONNECTION_FAILED") {
  const outcome = ["notSent", "rejected", "applied", "outcomeUnknown"].includes(error?.outcome)
    ? error.outcome : "notSent";
  return {
    code: String(error?.code || fallbackCode),
    message: String(error?.message || error || "control connection failed").slice(-2000),
    retryable: outcome !== "applied" && outcome !== "outcomeUnknown" && error?.retryable === true,
    outcome,
  };
}

function attachmentFrames(requestId, attachment, chunkBytes) {
  const bytes = Buffer.from(attachment.bytes);
  const frames = [];
  if (bytes.byteLength === 0) {
    frames.push({ ...controlBase("attachment"), requestId, attachmentId: attachment.attachmentId,
      mimeType: attachment.mimeType, offset: 0, dataBase64: "", eof: true,
      byteLength: attachment.byteLength, sha256: attachment.sha256 });
    return frames;
  }
  for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
    const chunk = bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkBytes));
    const eof = offset + chunk.byteLength === bytes.byteLength;
    frames.push({ ...controlBase("attachment"), requestId, attachmentId: attachment.attachmentId,
      mimeType: attachment.mimeType, offset, dataBase64: chunk.toString("base64"), eof,
      ...(eof ? { byteLength: attachment.byteLength, sha256: attachment.sha256 } : {}) });
  }
  return frames;
}

async function writeEndpoint(file, endpoint) {
  const draft = `${file}.${process.pid}.tmp`;
  await writeFile(draft, `${JSON.stringify(endpoint)}\n`, { mode: 0o600 });
  try { await rename(draft, file); }
  catch (error) {
    await rm(draft, { force: true });
    throw error;
  }
}

/** The announcement file as text, "" when it is too long to be one, or null when there is none to read. */
async function announcementText(path) {
  try {
    const handle = await open(path, "r");
    try {
      const size = ANNOUNCEMENT_MAX_BYTES + 1;
      const { bytesRead, buffer } = await handle.read(Buffer.alloc(size), 0, size, 0);
      return bytesRead < size ? buffer.toString("utf8", 0, bytesRead) : "";
    } finally {
      await handle.close();
    }
  } catch (error) {
    return null;
  }
}

/** `{ port, clientToken }` when `text` announces a client to the wait that offers `token`; otherwise null. */
function announcedClient(text, token) {
  let announced;
  try { announced = JSON.parse(text); }
  catch (error) { return null; }
  if (announced?.schemaVersion !== CONTROL_RECONNECT_SCHEMA_VERSION
    || !Number.isInteger(announced.port) || announced.port < 1 || announced.port > 65_535
    || typeof announced.token !== "string"
    || typeof announced.clientToken !== "string" || !CLIENT_TOKEN.test(announced.clientToken)) return null;
  const named = Buffer.from(announced.token);
  if (named.byteLength !== token.byteLength || !timingSafeEqual(named, token)) return null;
  return { port: announced.port, clientToken: Buffer.from(announced.clientToken) };
}

/**
 * One client's line stream in and frame stream out. `proven` is false until a returning client answers with its token
 * (`clientToken`, set by the host that goes to it).
 */
class Connection {
  constructor(server, input, output, { proven, release = () => {} }) {
    this.proven = proven;
    this.clientToken = null;
    this.gone = false;
    this.reading = true;
    this.writable = true;
    this.helloComplete = false;
    this.chunkBytes = CONTROL_ATTACHMENT_CHUNK_BYTES;
    this.requests = new Set();
    this.outputTail = Promise.resolve();
    this.inputTail = Promise.resolve();
    this._output = output;
    this._release = release;
    this._drain = new AbortController();
    // A frame is a line that ends with a newline. What readline hands over once the input has ended is the rest of a
    // write its client never finished: a lost client, not a protocol violation. Added before readline's listener so
    // that it runs first.
    let ended = false;
    input.once("end", () => { ended = true; });
    this._lines = createInterface({ input, crlfDelay: Infinity });
    this._lines.on("line", (line) => {
      if (ended) return;
      this.inputTail = this.inputTail.then(() => server._line(this, line)).catch((error) => server._fatal(this, error));
    });
    // readline repeats an input error on itself; either way the client is lost.
    const lost = () => void server._gone(this);
    this._lines.on("close", lost);
    this._lines.on("error", lost);
    input.on("error", lost);
    if (output !== input) output.on("error", () => { this.stopWriting(); lost(); });
  }

  /** Queue frames in order; a connection that can no longer be written to drops them. */
  send(frames) {
    if (!this.writable) return this.outputTail;
    const encoded = frames.map(encodeControlFrame).join("");
    this.outputTail = this.outputTail.then(async () => {
      if (!this.writable) return;
      if (!this._output.write(encoded)) await once(this._output, "drain", { signal: this._drain.signal });
    }).catch(() => { this.stopWriting(); });
    return this.outputTail;
  }

  stopReading() {
    this.reading = false;
    this._lines.close();
  }

  stopWriting() {
    this.writable = false;
    this._drain.abort();
  }

  /** Resolve when every request this connection made has its terminal written, or dropped. */
  async settled() {
    await Promise.allSettled([...this.requests]);
    await this.outputTail;
  }

  close() {
    this.stopReading();
    this.stopWriting();
    this._release();
  }
}

/**
 * Serves the Control Protocol to one client at a time. The first client is the process's stdio. With `reconnect`, a host
 * that still holds something when its client is lost (`holds()`) keeps itself for `windowMs`: it ends that client's
 * requests and writes `{ schemaVersion, pid, token, expiresAtMs }` to `reconnect.file`. The host never listens. A
 * returning client listens on loopback and announces `{ schemaVersion, port, token, clientToken }` in the file beside
 * it (`controlReconnectAnnouncement`). The host goes only to a port announced with its token, proves itself with its
 * first line (`controlReconnectProof`), and takes the connection as its client once the first line back is
 * `clientToken`. That client starts with its own hello and request IDs. Without one in time, or with nothing held, the
 * host ends (`onEnd(0)`), as it does without `reconnect`.
 */
export class ControlServer {
  constructor({ host, operations, reconnect = null, holds = () => false, onEnd }) {
    if (typeof onEnd !== "function") throw new TypeError("control server requires onEnd");
    this._host = host;
    this._operations = Object.freeze([...operations]);
    this._reconnect = reconnect;
    this._holds = holds;
    this._onEnd = onEnd;
    this._client = null;
    this._waiting = null;
    this._ended = false;
  }

  /** Serve the first client; `output` may be the same duplex stream as `input`. */
  serve(input, output) {
    if (this._client) throw new Error("control server already has a client");
    this._client = new Connection(this, input, output, { proven: true });
  }

  /** Stop taking frames and stop waiting for a client: the host is shutting down. */
  stop() {
    this._ended = true;
    return this._stopWaiting();
  }

  /** Resolve when everything already answered has been written to the client. */
  async flush() {
    await this._client?.settled();
  }

  async _line(connection, line) {
    if (this._ended || !connection.reading) return;
    if (!connection.proven) {
      this._prove(connection, line);
      return;
    }
    const frame = decodeControlFrame(line);
    if (!connection.helloComplete) {
      const accepted = acceptControlHello(frame, { operations: this._operations });
      connection.helloComplete = true;
      connection.chunkBytes = accepted.maxAttachmentChunkBytes;
      await connection.send([accepted.response]);
      return;
    }
    if (frame.type === "request") {
      const request = this._request(connection, frame).catch((error) => this._fatal(connection, error));
      connection.requests.add(request);
      void request.finally(() => connection.requests.delete(request));
      return;
    }
    if (frame.type === "cancel") {
      this._host.cancel(frame.requestId, frame.reason || "control client cancelled the request");
      return;
    }
    const error = new Error(`client cannot send control frame type after hello: ${frame.type}`);
    error.code = "CONTROL_FRAME_DIRECTION";
    throw error;
  }

  async _request(connection, frame) {
    const result = await this._host.request(frame);
    if (!result?.terminal) return;
    const frames = result.attachments.flatMap((attachment) =>
      attachmentFrames(frame.requestId, attachment, connection.chunkBytes));
    frames.push(result.terminal);
    await connection.send(frames);
  }

  /** A client that breaks the protocol ends the host after one fatal frame, whether or not it could come back. */
  async _fatal(connection, error) {
    if (this._ended || connection !== this._client) return;
    this._ended = true;
    try {
      await connection.send([{ ...controlBase("error"), fatal: true, error: errorPayload(error) }]);
    } finally {
      this._onEnd(1);
    }
  }

  _end(code) {
    if (this._ended) return;
    this._ended = true;
    this._onEnd(code);
  }

  async _gone(connection) {
    if (connection.gone) return;
    connection.gone = true;
    if (connection !== this._client) {
      // A connection the host went to that did not answer with its client's token. It learned neither token.
      connection.close();
      const waiting = this._waiting;
      if (waiting?.dialed !== connection) return;
      waiting.dialed = null;
      this._lookSoon(waiting);
      return;
    }
    // Every line read before the loss is taken first.
    await connection.inputTail;
    if (this._ended) return;
    if (!this._reconnect) {
      this._end(0);
      return;
    }
    // The lost client's requests end with it: their terminals go to that client or to nobody, never to the next.
    connection.stopReading();
    await this._host.endConnection("control client was lost");
    await connection.settled();
    connection.close();
    if (this._ended) return;
    this._client = null;
    let holds = false;
    try { holds = this._holds() === true; } catch {}
    if (!holds) {
      this._end(0);
      return;
    }
    await this._wait();
  }

  /** Start one wait: it ends when a client is taken or after `windowMs`, whichever is first. */
  async _wait() {
    const { file, windowMs } = this._reconnect;
    const token = randomBytes(32).toString("base64url");
    const waiting = { file, announcement: controlReconnectAnnouncement(file), token: Buffer.from(token),
      dialed: null, timer: null, poll: null };
    this._waiting = waiting;
    waiting.timer = setTimeout(() => this._end(0), windowMs);
    try {
      await writeEndpoint(file, { schemaVersion: CONTROL_RECONNECT_SCHEMA_VERSION, pid: process.pid, token,
        expiresAtMs: Date.now() + windowMs });
    } catch (error) {
      // Nobody can come back to a host that could not say how.
      this._end(0);
      return;
    }
    if (this._waiting === waiting) this._lookSoon(waiting);
    // The wait ended while the file was being written.
    else await rm(file, { force: true }).catch(() => {});
  }

  _lookSoon(waiting) {
    waiting.poll = setTimeout(() => void this._look(waiting), ANNOUNCEMENT_POLL_MS);
  }

  /** Read what a returning client announced. An announcement is read once: it is removed, taken or not. */
  async _look(waiting) {
    const text = await announcementText(waiting.announcement);
    if (this._waiting !== waiting) return;
    if (text !== null) {
      await rm(waiting.announcement, { force: true }).catch(() => {});
      if (this._waiting !== waiting) return;
      const client = announcedClient(text, waiting.token);
      if (client) {
        this._dial(waiting, client);
        return;
      }
    }
    this._lookSoon(waiting);
  }

  /**
   * Go to the announced client. The host's first line proves that it holds the wait's token and read the announcement
   * (`controlReconnectProof`) without putting either token on the connection; the client then answers with its own.
   */
  _dial(waiting, client) {
    const socket = connect({ host: "127.0.0.1", port: client.port });
    const connection = new Connection(this, socket, socket, { proven: false, release: () => socket.destroy() });
    connection.clientToken = client.clientToken;
    waiting.dialed = connection;
    let seen = 0;
    const refuseUnproven = () => {
      if (!connection.proven) void this._gone(connection);
    };
    const timer = setTimeout(refuseUnproven, TOKEN_TIMEOUT_MS);
    socket.once("connect", () => socket.write(`${controlReconnectProof(waiting.token, client.clientToken)}\n`));
    socket.on("data", (chunk) => {
      seen += chunk.byteLength;
      if (seen > TOKEN_MAX_BYTES) refuseUnproven();
    });
    socket.on("close", () => clearTimeout(timer));
  }

  _prove(connection, line) {
    const waiting = this._waiting;
    const answered = Buffer.from(line);
    if (waiting?.dialed !== connection || answered.byteLength !== connection.clientToken.byteLength
      || !timingSafeEqual(answered, connection.clientToken)) {
      void this._gone(connection);
      return;
    }
    waiting.dialed = null;
    connection.proven = true;
    this._client = connection;
    void this._stopWaiting();
  }

  async _stopWaiting() {
    const waiting = this._waiting;
    if (!waiting) return;
    this._waiting = null;
    clearTimeout(waiting.timer);
    clearTimeout(waiting.poll);
    if (waiting.dialed) void this._gone(waiting.dialed);
    await rm(waiting.file, { force: true }).catch(() => {});
  }
}
