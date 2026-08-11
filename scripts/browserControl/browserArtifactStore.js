// browserArtifactStore.js - broker-owned artifact의 opaque ref, quota, TTL, chunk와 삭제 계약.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rm, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { BrowserControlError } from "./browserControlPort.js";

export const BROWSER_ARTIFACT_DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
export const BROWSER_ARTIFACT_DEFAULT_TOTAL_BYTES = 64 * 1024 * 1024;
export const BROWSER_ARTIFACT_DEFAULT_MAX_COUNT = 64;
export const BROWSER_ARTIFACT_DEFAULT_INLINE_BYTES = 2 * 1024 * 1024;
export const BROWSER_ARTIFACT_DEFAULT_TTL_MS = 15 * 60 * 1000;
export const BROWSER_ARTIFACT_MAX_CHUNK_BYTES = 256 * 1024;

const notFound = () => new BrowserControlError("BROWSER_AUTOMATION_ARTIFACT_NOT_FOUND",
  "browser artifact is unavailable or expired", { outcome: "notSent" });

function positiveInteger(value, fallback, label, maximum = Number.MAX_SAFE_INTEGER) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new TypeError(`${label} must be an integer from 1 to ${maximum}`);
  }
  return resolved;
}

function clippedText(value, maximum) {
  const text = String(value || "");
  return text.length > maximum ? text.slice(0, maximum) : text;
}

export class BrowserArtifactStore {
  constructor({ root, maxArtifactBytes, maxTotalBytes, maxArtifacts, inlineMaxBytes, ttlMs,
    idFactory = () => randomUUID(), now = () => Date.now() } = {}) {
    if (!root || !isAbsolute(root)) throw new TypeError("browser artifact root must be absolute");
    if (typeof idFactory !== "function" || typeof now !== "function") {
      throw new TypeError("browser artifact idFactory and clock are required");
    }
    this._root = resolve(root);
    this._maxArtifactBytes = positiveInteger(maxArtifactBytes, BROWSER_ARTIFACT_DEFAULT_MAX_BYTES,
      "maxArtifactBytes");
    this._maxTotalBytes = positiveInteger(maxTotalBytes, BROWSER_ARTIFACT_DEFAULT_TOTAL_BYTES,
      "maxTotalBytes");
    this._maxArtifacts = positiveInteger(maxArtifacts, BROWSER_ARTIFACT_DEFAULT_MAX_COUNT,
      "maxArtifacts", 10000);
    this._inlineMaxBytes = positiveInteger(inlineMaxBytes, BROWSER_ARTIFACT_DEFAULT_INLINE_BYTES,
      "inlineMaxBytes");
    this._ttlMs = positiveInteger(ttlMs, BROWSER_ARTIFACT_DEFAULT_TTL_MS, "artifact ttlMs");
    if (this._maxArtifactBytes > this._maxTotalBytes) {
      throw new TypeError("maxArtifactBytes must not exceed maxTotalBytes");
    }
    if (this._inlineMaxBytes > this._maxArtifactBytes) {
      throw new TypeError("inlineMaxBytes must not exceed maxArtifactBytes");
    }
    this._idFactory = idFactory;
    this._now = now;
    this._records = new Map();
    this._totalBytes = 0;
    this._closed = false;
    this._ready = null;
  }

  async put(input, metadata = {}, { inline = false } = {}) {
    this._assertOpen();
    const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
    if (bytes.byteLength < 1) {
      throw new BrowserControlError("BROWSER_AUTOMATION_ARTIFACT_INVALID",
        "browser artifact bytes are empty", { outcome: "notSent" });
    }
    if (bytes.byteLength > this._maxArtifactBytes) {
      throw new BrowserControlError("BROWSER_AUTOMATION_ARTIFACT_TOO_LARGE",
        "browser artifact exceeds the per-artifact byte limit", { outcome: "notSent" });
    }
    await this.reap();
    if (this._records.size >= this._maxArtifacts || this._totalBytes + bytes.byteLength > this._maxTotalBytes) {
      throw new BrowserControlError("BROWSER_AUTOMATION_ARTIFACT_QUOTA",
        "browser artifact store quota is exhausted", { outcome: "notSent", retryable: true });
    }
    await this._initialize();
    const opaque = String(this._idFactory());
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(opaque)) throw new Error("browser artifact idFactory returned an invalid opaque id");
    const artifactRef = `artifact:${opaque}`;
    if (this._records.has(artifactRef)) throw new Error("browser artifact idFactory returned a duplicate");
    const filename = `${createHash("sha256").update(artifactRef).digest("hex")}.bin`;
    const path = join(this._root, filename);
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    const createdAt = this._now();
    const record = Object.freeze({
      artifactRef,
      path,
      kind: clippedText(metadata.kind || "binary", 40),
      mimeType: clippedText(metadata.mimeType || "application/octet-stream", 100),
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      createdAt,
      expiresAt: createdAt + this._ttlMs,
      ...(metadata.suggestedFilename ? { suggestedFilename: clippedText(metadata.suggestedFilename, 255) } : {}),
      ...(metadata.sourceUrl ? { sourceUrl: clippedText(metadata.sourceUrl, 2000) } : {}),
      ...(metadata.format ? { format: clippedText(metadata.format, 20) } : {}),
      ...(Number.isFinite(metadata.cssWidth) ? { cssWidth: metadata.cssWidth } : {}),
      ...(Number.isFinite(metadata.cssHeight) ? { cssHeight: metadata.cssHeight } : {}),
      ...(typeof metadata.fullPage === "boolean" ? { fullPage: metadata.fullPage } : {}),
    });
    this._records.set(artifactRef, record);
    this._totalBytes += bytes.byteLength;
    return this._descriptor(record, inline && bytes.byteLength <= this._inlineMaxBytes ? bytes : null);
  }

  async read(artifactRef, { offset = 0, maxBytes = BROWSER_ARTIFACT_MAX_CHUNK_BYTES } = {}) {
    this._assertOpen();
    await this.reap();
    const record = this._records.get(this._artifactRef(artifactRef));
    if (!record) throw notFound();
    if (!Number.isInteger(offset) || offset < 0 || offset > record.byteLength) {
      throw new TypeError("browser artifact offset is outside the artifact");
    }
    const limit = positiveInteger(maxBytes, BROWSER_ARTIFACT_MAX_CHUNK_BYTES, "artifact maxBytes",
      BROWSER_ARTIFACT_MAX_CHUNK_BYTES);
    const length = Math.min(limit, record.byteLength - offset);
    const bytes = Buffer.alloc(length);
    if (length) {
      const handle = await open(record.path, "r");
      try {
        const result = await handle.read(bytes, 0, length, offset);
        if (result.bytesRead !== length) throw new Error("browser artifact ended before its recorded byte length");
      } finally {
        await handle.close();
      }
    }
    const nextOffset = offset + length;
    return Object.freeze({
      ...this._descriptor(record),
      offset,
      nextOffset,
      eof: nextOffset === record.byteLength,
      dataBase64: bytes.toString("base64"),
    });
  }

  async delete(artifactRef) {
    this._assertOpen();
    await this.reap();
    const normalized = this._artifactRef(artifactRef);
    const record = this._records.get(normalized);
    if (!record) return Object.freeze({ artifactRef: normalized, deleted: false });
    await this._remove(record);
    return Object.freeze({ artifactRef: record.artifactRef, deleted: true });
  }

  async reap() {
    this._assertOpen();
    const now = this._now();
    const expired = [...this._records.values()].filter((record) => record.expiresAt <= now);
    await Promise.all(expired.map((record) => this._remove(record)));
    return expired.length;
  }

  inspect() {
    return Object.freeze({
      artifacts: this._records.size,
      totalBytes: this._totalBytes,
      maxArtifacts: this._maxArtifacts,
      maxArtifactBytes: this._maxArtifactBytes,
      maxTotalBytes: this._maxTotalBytes,
      inlineMaxBytes: this._inlineMaxBytes,
      maxChunkBytes: BROWSER_ARTIFACT_MAX_CHUNK_BYTES,
      ttlMs: this._ttlMs,
    });
  }

  async close() {
    if (this._closed) return;
    await Promise.all([...this._records.values()].map((record) => this._remove(record)));
    this._closed = true;
    await rm(this._root, { recursive: true, force: true });
  }

  _descriptor(record, inlineBytes = null) {
    return Object.freeze({
      artifactRef: record.artifactRef,
      kind: record.kind,
      mimeType: record.mimeType,
      byteLength: record.byteLength,
      sha256: record.sha256,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      ...(record.suggestedFilename ? { suggestedFilename: record.suggestedFilename } : {}),
      ...(record.sourceUrl ? { sourceUrl: record.sourceUrl } : {}),
      ...(record.format ? { format: record.format } : {}),
      ...(Number.isFinite(record.cssWidth) ? { cssWidth: record.cssWidth } : {}),
      ...(Number.isFinite(record.cssHeight) ? { cssHeight: record.cssHeight } : {}),
      ...(typeof record.fullPage === "boolean" ? { fullPage: record.fullPage } : {}),
      ...(inlineBytes ? { dataBase64: inlineBytes.toString("base64") } : {}),
    });
  }

  async _remove(record) {
    if (!this._records.delete(record.artifactRef)) return;
    this._totalBytes -= record.byteLength;
    try { await unlink(record.path); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }

  _assertOpen() {
    if (this._closed) throw new Error("browser artifact store is closed");
  }

  _artifactRef(value) {
    const ref = typeof value === "string" ? value : "";
    if (!/^artifact:[A-Za-z0-9_-]{1,96}$/.test(ref)) throw notFound();
    return ref;
  }

  _initialize() {
    if (!this._ready) this._ready = mkdir(this._root, { recursive: true });
    return this._ready;
  }
}
