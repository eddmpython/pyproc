// controlClient.js - Node stream 위에서 Control Protocol을 검증하는 JS adapter.
import { createInterface } from "node:readline";
import {
  CONTROL_ATTACHMENT_CHUNK_BYTES,
  ControlClientConversation,
  controlBase,
  decodeControlFrame,
  encodeControlFrame,
} from "./controlProtocol.js";

export class ControlRemoteError extends Error {
  constructor(payload) {
    super(payload.message);
    this.name = "ControlRemoteError";
    this.code = payload.code;
    this.retryable = payload.retryable;
    this.outcome = payload.outcome;
    if (payload.details !== undefined) this.details = payload.details;
  }
}

export class ControlStdioClient {
  constructor({ readable, writable, peer = { name: "pyproc-js", version: "1" } } = {}) {
    if (!readable?.on || !writable?.write) throw new TypeError("control client requires readable and writable streams");
    this.readable = readable;
    this.writable = writable;
    this.operations = Object.freeze([]);
    this._conversation = new ControlClientConversation();
    this._pending = new Map();
    this._sequence = 0;
    this._closed = false;
    this._helloId = "hello:client";
    this._inputTail = Promise.resolve();
    this._writeTail = Promise.resolve();
    this.ready = new Promise((resolve, reject) => { this._readyResolve = resolve; this._readyReject = reject; });
    this._lines = createInterface({ input: readable, crlfDelay: Infinity });
    this._lines.on("line", (line) => {
      this._inputTail = this._inputTail.then(() => this._acceptLine(line)).catch((error) => this._fail(error));
    });
    this._lines.on("close", () => this._fail(new Error("control server closed stdout")));
    readable.on("error", (error) => this._fail(error));
    writable.on?.("error", (error) => this._fail(error));
    void this._write({
      ...controlBase("hello"), requestId: this._helloId, role: "client", peer,
      capabilities: { cancel: true, events: true,
        attachments: { encoding: "base64", maxChunkBytes: CONTROL_ATTACHMENT_CHUNK_BYTES } },
    }).catch((error) => this._fail(error));
  }

  async _write(frame) {
    if (this._closed) throw new Error("control client is closed");
    const text = encodeControlFrame(frame);
    this._writeTail = this._writeTail.then(() => new Promise((resolve, reject) => {
      this.writable.write(text, (error) => error ? reject(error) : resolve());
    }));
    return this._writeTail;
  }

  async _acceptLine(line) {
    const frame = decodeControlFrame(line);
    if (frame.type === "error" && frame.fatal === true) throw new ControlRemoteError(frame.error);
    if (!this._readySettled) {
      if (frame.type !== "hello" || frame.role !== "server" || frame.requestId !== this._helloId) {
        throw new Error("control server did not answer with the matching hello");
      }
      this._readySettled = true;
      this.operations = Object.freeze([...frame.operations]);
      this._readyResolve(this);
      return;
    }
    if (frame.type !== "attachment" && frame.type !== "event"
      && frame.type !== "response" && frame.type !== "error") {
      throw new Error(`control server sent an invalid frame direction: ${frame.type}`);
    }
    await this._conversation.accept(frame);
    if (frame.type !== "response" && frame.type !== "error") return;
    const pending = this._pending.get(frame.requestId);
    if (!pending) throw new Error(`control server completed an unknown request: ${frame.requestId}`);
    this._pending.delete(frame.requestId);
    const attachments = this._conversation.attachmentsFor(frame.requestId, frame.attachments || []);
    if (frame.type === "error") pending.reject(new ControlRemoteError(frame.error));
    else pending.resolve(Object.freeze({ output: frame.output, outcome: frame.outcome, attachments }));
  }

  _fail(error) {
    if (this._closed) return;
    this._closed = true;
    if (!this._readySettled) {
      this._readySettled = true;
      this._readyReject(error);
    }
    for (const pending of this._pending.values()) pending.reject(error);
    this._pending.clear();
  }

  async request(operation, input = {}, { requestId, spaceId } = {}) {
    await this.ready;
    const id = requestId || `request:${++this._sequence}`;
    const frame = { ...controlBase("request"), requestId: id, operation, input,
      ...(spaceId ? { spaceId } : {}) };
    this._conversation.begin(frame);
    const result = new Promise((resolve, reject) => this._pending.set(id, { resolve, reject }));
    try { await this._write(frame); }
    catch (error) { this._pending.delete(id); throw error; }
    return result;
  }

  async cancel(requestId, reason = "control client cancelled the request") {
    await this.ready;
    return this._write({ ...controlBase("cancel"), requestId, reason });
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._lines.close();
    this.writable.end?.();
    const error = new Error("control client closed");
    for (const pending of this._pending.values()) pending.reject(error);
    this._pending.clear();
  }
}
