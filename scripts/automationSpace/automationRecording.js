// automationRecording.js - provider 기록 본문과 sidecar artifact의 완전성, 소유권, 원자 교체 계약.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const AUTOMATION_RECORDING_FORMAT = "pyproc.automationRecording";
export const AUTOMATION_RECORDING_VERSION = 1;
export const AUTOMATION_RECORDING_MAX_BYTES = 32 * 1024 * 1024;
export const AUTOMATION_RECORDING_MAX_ENTRIES = 10000;
export const AUTOMATION_RECORDING_MAX_ENTRY_BYTES = 1024 * 1024;
export const AUTOMATION_RECORDING_MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
export const AUTOMATION_RECORDING_MAX_TOTAL_ARTIFACT_BYTES = 64 * 1024 * 1024;
const ZERO_DIGEST = "0".repeat(64);
const DIGEST_RE = /^[0-9a-f]{64}$/;
const ARTIFACT_REF_RE = /^artifact:[A-Za-z0-9_-]+$/;
const RECORDING_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 1000000;
const recordingArtifacts = new WeakMap();

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonBounds(value) {
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH) {
      throw recordingError("AUTOMATION_RECORDING_TOO_COMPLEX", "automation recording JSON exceeds structural limits");
    }
    if (Array.isArray(current.value)) {
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
    } else if (plainObject(current.value)) {
      for (const child of Object.values(current.value)) stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

export function canonicalRecordingJson(value, depth = 0) {
  if (depth > MAX_JSON_DEPTH) throw new TypeError("automation recording value exceeds the depth limit");
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((child) => canonicalRecordingJson(child, depth + 1)).join(",")}]`;
  if (plainObject(value)) return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalRecordingJson(value[key], depth + 1)}`).join(",")}}`;
  throw new TypeError("automation recording value must be finite JSON");
}

export function automationRecordingDigest(value) {
  return createHash("sha256").update(canonicalRecordingJson(value)).digest("hex");
}

function recordingError(code, message, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  error.outcome = "notSent";
  error.retryable = false;
  return error;
}

function entryBody(entry, sequence, previousSha256) {
  return Object.freeze({
    sequence,
    previousSha256,
    operation: entry.operation,
    input: entry.input,
    terminal: entry.terminal,
    inlineArtifacts: Object.freeze([...(entry.inlineArtifacts || [])]),
    artifactRefs: Object.freeze([...(entry.artifactRefs || [])]),
  });
}

function artifactBody(artifact) {
  return Object.freeze({
    kind: artifact.kind,
    mimeType: artifact.mimeType,
    byteLength: artifact.byteLength,
    sha256: artifact.sha256,
    ...(artifact.dataBase64 === undefined ? {} : { dataBase64: artifact.dataBase64 }),
    ...(artifact.file === undefined ? {} : { file: artifact.file }),
  });
}

function globalBody(recording, entriesSha256) {
  return Object.freeze({
    format: AUTOMATION_RECORDING_FORMAT,
    version: AUTOMATION_RECORDING_VERSION,
    recordingId: recording.recordingId,
    artifactGeneration: recording.artifactGeneration,
    provider: recording.provider,
    entriesSha256,
    entries: recording.entries,
    artifacts: recording.artifacts,
  });
}

function descriptorArtifactBytes(artifactRef, artifact) {
  const body = artifactBody(artifact);
  if (!Number.isInteger(body.byteLength) || body.byteLength < 1
    || body.byteLength > AUTOMATION_RECORDING_MAX_ARTIFACT_BYTES
    || !DIGEST_RE.test(String(body.sha256 || ""))
    || typeof body.mimeType !== "string" || !body.mimeType.startsWith("image/")
    || typeof body.kind !== "string" || !body.kind) {
    throw recordingError("AUTOMATION_RECORDING_ARTIFACT_INVALID", `recording artifact is invalid: ${artifactRef}`);
  }
  const hasInline = typeof body.dataBase64 === "string";
  const hasFile = typeof body.file === "string";
  if (Number(hasInline) + Number(hasFile) !== 1) {
    throw recordingError("AUTOMATION_RECORDING_ARTIFACT_INVALID",
      `recording artifact requires exactly one byte source: ${artifactRef}`);
  }
  if (hasFile && body.file !== `${body.sha256}.bin`) {
    throw recordingError("AUTOMATION_RECORDING_ARTIFACT_INVALID", `recording artifact filename is invalid: ${artifactRef}`);
  }
  if (!hasInline) return { body, bytes: null };
  const bytes = Buffer.from(body.dataBase64, "base64");
  if (bytes.toString("base64") !== body.dataBase64 || body.byteLength !== bytes.byteLength
    || createHash("sha256").update(bytes).digest("hex") !== body.sha256) {
    throw recordingError("AUTOMATION_RECORDING_ARTIFACT_INVALID", `recording artifact bytes are invalid: ${artifactRef}`);
  }
  return { body, bytes };
}

function collectTerminalArtifactRefs(operation, terminal) {
  if (terminal.ok !== true) return new Set();
  const refs = new Set();
  const stack = [terminal.output];
  while (stack.length) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    if (!value || typeof value !== "object") continue;
    if (ARTIFACT_REF_RE.test(String(value.artifactRef || ""))
      && (value.kind === "screenshot" || (operation === "artifact.read" && Number.isInteger(value.offset)))) {
      refs.add(value.artifactRef);
    }
    stack.push(...Object.values(value));
  }
  return refs;
}

export function createAutomationRecording({ provider, recordingId = `recording:${randomUUID()}` } = {}) {
  if (!plainObject(provider)) throw new TypeError("automation recording provider is required");
  if (!RECORDING_ID_RE.test(recordingId)) throw new TypeError("automation recordingId is invalid");
  return {
    format: AUTOMATION_RECORDING_FORMAT,
    version: AUTOMATION_RECORDING_VERSION,
    recordingId,
    artifactGeneration: randomUUID(),
    provider: structuredClone(provider),
    entries: [],
    artifacts: {},
    entriesSha256: ZERO_DIGEST,
    finalSha256: "",
    complete: true,
  };
}

export function appendAutomationRecordingEntry(recording, entry) {
  if (!recording || recording.format !== AUTOMATION_RECORDING_FORMAT) throw new TypeError("automation recording is required");
  if (recording.entries.length >= AUTOMATION_RECORDING_MAX_ENTRIES) {
    throw recordingError("AUTOMATION_RECORDING_TOO_LARGE", "automation recording exceeds the entry limit");
  }
  if (!plainObject(entry) || typeof entry.operation !== "string" || !plainObject(entry.input)
    || !plainObject(entry.terminal)) throw new TypeError("automation recording entry is invalid");
  const sequence = recording.entries.length;
  const body = entryBody(entry, sequence, recording.entriesSha256 || ZERO_DIGEST);
  const canonical = canonicalRecordingJson(body);
  if (Buffer.byteLength(canonical) > AUTOMATION_RECORDING_MAX_ENTRY_BYTES) {
    throw recordingError("AUTOMATION_RECORDING_TOO_LARGE", `automation recording entry exceeds the byte limit: ${sequence}`);
  }
  const sealed = Object.freeze({ ...body, sha256: createHash("sha256").update(canonical).digest("hex") });
  recording.entries.push(sealed);
  recording.entriesSha256 = sealed.sha256;
  return sealed;
}

export function putAutomationRecordingArtifact(recording, artifactRef, artifact) {
  if (!ARTIFACT_REF_RE.test(String(artifactRef || ""))) throw new TypeError("recording artifactRef is invalid");
  const { body } = descriptorArtifactBytes(artifactRef, artifact);
  const prior = recording.artifacts[artifactRef];
  if (prior && (prior.sha256 !== body.sha256 || prior.byteLength !== body.byteLength
    || prior.mimeType !== body.mimeType || prior.kind !== body.kind)) {
    throw recordingError("AUTOMATION_RECORDING_ARTIFACT_INVALID", `recording artifact identity changed: ${artifactRef}`);
  }
  recording.artifacts[artifactRef] = body;
  return body;
}

export function sealAutomationRecording(recording) {
  const artifactRefs = new Set();
  for (const entry of recording.entries) for (const ref of entry.artifactRefs || []) artifactRefs.add(ref);
  const missing = [...artifactRefs].filter((ref) => !recording.artifacts[ref]);
  recording.complete = missing.length === 0;
  recording.finalSha256 = automationRecordingDigest(globalBody(recording, recording.entriesSha256));
  return recording;
}

export function verifyAutomationRecording(recording, { requireComplete = true } = {}) {
  assertJsonBounds(recording);
  if (!plainObject(recording) || recording.format !== AUTOMATION_RECORDING_FORMAT
    || recording.version !== AUTOMATION_RECORDING_VERSION || typeof recording.recordingId !== "string"
    || !RECORDING_ID_RE.test(recording.recordingId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(recording.artifactGeneration)
    || !plainObject(recording.provider) || !Array.isArray(recording.entries)
    || recording.entries.length > AUTOMATION_RECORDING_MAX_ENTRIES || !plainObject(recording.artifacts)) {
    throw recordingError("AUTOMATION_RECORDING_INVALID", "automation recording envelope is invalid");
  }
  if (typeof recording.provider.spaceId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(recording.provider.spaceId)
    || typeof recording.provider.providerKind !== "string" || !/^[a-z][A-Za-z0-9]{0,63}$/.test(recording.provider.providerKind)
    || !Array.isArray(recording.provider.operations) || recording.provider.operations.length < 1
    || recording.provider.operations.some((operation) => typeof operation !== "string" || !operation)
    || new Set(recording.provider.operations).size !== recording.provider.operations.length
    || !Array.isArray(recording.provider.capabilities)
    || recording.provider.capabilities.some((capability) => typeof capability !== "string" || !capability)
    || new Set(recording.provider.capabilities).size !== recording.provider.capabilities.length
    || !plainObject(recording.provider.policy)) {
    throw recordingError("AUTOMATION_RECORDING_INVALID", "automation recording provider descriptor is invalid");
  }
  const policy = recording.provider.policy;
  if (!Array.isArray(policy.targetOrigins) || !Array.isArray(policy.actions) || !Array.isArray(policy.rawMethods)
    || typeof policy.maxRisk !== "string") {
    throw recordingError("AUTOMATION_RECORDING_INVALID", "automation recording provider policy is invalid");
  }
  let previousSha256 = ZERO_DIGEST;
  const artifactRefs = new Set();
  for (let sequence = 0; sequence < recording.entries.length; sequence += 1) {
    const entry = recording.entries[sequence];
    if (!plainObject(entry) || typeof entry.operation !== "string" || !plainObject(entry.input)
      || !plainObject(entry.terminal) || typeof entry.terminal.ok !== "boolean"
      || (entry.terminal.ok === true && !Object.hasOwn(entry.terminal, "output"))
      || (entry.terminal.ok === false && (!plainObject(entry.terminal.error)
        || typeof entry.terminal.error.code !== "string" || typeof entry.terminal.error.message !== "string"
        || !["notSent", "rejected", "applied", "outcomeUnknown"].includes(entry.terminal.error.outcome)
        || typeof entry.terminal.error.retryable !== "boolean"
        || (["applied", "outcomeUnknown"].includes(entry.terminal.error.outcome) && entry.terminal.error.retryable)))
      || !Array.isArray(entry.inlineArtifacts) || !Array.isArray(entry.artifactRefs)
      || new Set(entry.inlineArtifacts).size !== entry.inlineArtifacts.length
      || new Set(entry.artifactRefs).size !== entry.artifactRefs.length
      || entry.inlineArtifacts.some((ref) => !entry.artifactRefs.includes(ref))) {
      throw recordingError("AUTOMATION_RECORDING_INVALID", `automation recording entry is invalid: ${sequence}`);
    }
    const discovered = collectTerminalArtifactRefs(entry.operation, entry.terminal);
    if (discovered.size !== entry.artifactRefs.length
      || entry.artifactRefs.some((ref) => !discovered.has(ref))) {
      throw recordingError("AUTOMATION_RECORDING_INVALID", `automation recording artifact references diverge: ${sequence}`);
    }
    const body = entryBody(entry, sequence, previousSha256);
    const canonical = canonicalRecordingJson(body);
    if (Buffer.byteLength(canonical) > AUTOMATION_RECORDING_MAX_ENTRY_BYTES
      || entry.sequence !== sequence || entry.previousSha256 !== previousSha256
      || !DIGEST_RE.test(String(entry.sha256 || ""))
      || entry.sha256 !== createHash("sha256").update(canonical).digest("hex")) {
      throw recordingError("AUTOMATION_RECORDING_MUTATED", `automation recording entry digest mismatch: ${sequence}`);
    }
    for (const ref of entry.artifactRefs) {
      if (!ARTIFACT_REF_RE.test(String(ref))) throw recordingError("AUTOMATION_RECORDING_INVALID", `invalid artifact ref: ${ref}`);
      artifactRefs.add(ref);
    }
    previousSha256 = entry.sha256;
  }
  if (recording.entriesSha256 !== previousSha256) {
    throw recordingError("AUTOMATION_RECORDING_MUTATED", "automation recording entry chain does not converge");
  }
  let totalArtifactBytes = 0;
  for (const [ref, artifact] of Object.entries(recording.artifacts)) {
    descriptorArtifactBytes(ref, artifact);
    totalArtifactBytes += artifact.byteLength;
  }
  if (totalArtifactBytes > AUTOMATION_RECORDING_MAX_TOTAL_ARTIFACT_BYTES) {
    throw recordingError("AUTOMATION_RECORDING_TOO_LARGE", "automation recording artifacts exceed the total byte limit");
  }
  const missing = [...artifactRefs].filter((ref) => !Object.hasOwn(recording.artifacts, ref));
  if (requireComplete && (recording.complete !== true || missing.length)) {
    throw recordingError("AUTOMATION_RECORDING_ARTIFACT_MISSING",
      `automation recording is missing artifact: ${missing[0] || "unknown"}`);
  }
  if (!DIGEST_RE.test(String(recording.finalSha256 || ""))
    || recording.finalSha256 !== automationRecordingDigest(globalBody(recording, recording.entriesSha256))) {
    throw recordingError("AUTOMATION_RECORDING_MUTATED", "automation recording final digest mismatch");
  }
  return recording;
}

function automationArtifactRoot(file) {
  return `${file}.artifacts`;
}

function automationArtifactDirectory(file, generation) {
  return join(automationArtifactRoot(file), generation);
}

async function openVerifiedRegularFile(path, errorCode, label) {
  let pathMetadata;
  try { pathMetadata = await lstat(path); }
  catch (error) { throw recordingError(errorCode, `${label} is unavailable`, error); }
  if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()) {
    throw recordingError(errorCode, `${label} must be a regular non-link file`);
  }
  let handle;
  try { handle = await open(path, "r"); }
  catch (error) { throw recordingError(errorCode, `${label} cannot be opened`, error); }
  const handleMetadata = await handle.stat();
  if (!handleMetadata.isFile() || handleMetadata.dev !== pathMetadata.dev || handleMetadata.ino !== pathMetadata.ino) {
    await handle.close();
    throw recordingError(errorCode, `${label} changed before opening`);
  }
  return Object.freeze({ handle, metadata: handleMetadata });
}

async function readExternalArtifact(file, artifactRef, artifact) {
  const directory = automationArtifactDirectory(file.file, file.artifactGeneration);
  for (const candidate of [automationArtifactRoot(file.file), directory]) {
    let metadata;
    try { metadata = await lstat(candidate); }
    catch (error) {
      throw recordingError("AUTOMATION_RECORDING_ARTIFACT_MISSING",
        `recording artifact directory is unavailable: ${artifactRef}`, error);
    }
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw recordingError("AUTOMATION_RECORDING_ARTIFACT_INVALID",
        `recording artifact directory is invalid: ${artifactRef}`);
    }
  }
  const path = join(directory, artifact.file);
  const opened = await openVerifiedRegularFile(path, "AUTOMATION_RECORDING_ARTIFACT_MISSING",
    `recording artifact ${artifactRef}`);
  const { handle, metadata } = opened;
  try {
    if (metadata.size !== artifact.byteLength) {
      throw recordingError("AUTOMATION_RECORDING_ARTIFACT_INVALID", `recording artifact file is invalid: ${artifactRef}`);
    }
    const bytes = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead === 0) throw recordingError("AUTOMATION_RECORDING_CHANGED",
        `recording artifact changed while reading: ${artifactRef}`);
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== metadata.size || after.mtimeMs !== metadata.mtimeMs) {
      throw recordingError("AUTOMATION_RECORDING_CHANGED", `recording artifact changed while reading: ${artifactRef}`);
    }
    if (createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
      throw recordingError("AUTOMATION_RECORDING_ARTIFACT_INVALID", `recording artifact digest mismatch: ${artifactRef}`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function verifyExistingArtifact(path, artifactRef, artifact) {
  const opened = await openVerifiedRegularFile(path, "AUTOMATION_RECORDING_ARTIFACT_INVALID",
    `existing recording artifact ${artifactRef}`);
  const { handle, metadata } = opened;
  try {
    if (metadata.size !== artifact.byteLength) {
      throw recordingError("AUTOMATION_RECORDING_ARTIFACT_INVALID",
        `existing recording artifact file is invalid: ${artifactRef}`);
    }
    const bytes = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead === 0) throw recordingError("AUTOMATION_RECORDING_CHANGED",
        `existing recording artifact changed while reading: ${artifactRef}`);
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== metadata.size || after.mtimeMs !== metadata.mtimeMs
      || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
      throw recordingError("AUTOMATION_RECORDING_ARTIFACT_INVALID",
        `existing recording artifact does not match: ${artifactRef}`);
    }
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
}

export async function loadAutomationRecording(file) {
  const mutex = await acquireRecordingMutex(file);
  let handle;
  let source;
  try {
    try { await lstat(`${file}.lock`); throw recordingError("AUTOMATION_RECORDING_LOCKED", "automation recording is still open for writing"); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    const opened = await openVerifiedRegularFile(file, "AUTOMATION_RECORDING_UNAVAILABLE", "automation recording");
    handle = opened.handle;
    const before = opened.metadata;
    if (before.size > AUTOMATION_RECORDING_MAX_BYTES) {
      throw recordingError("AUTOMATION_RECORDING_TOO_LARGE", "automation recording exceeds the byte limit");
    }
    source = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < source.byteLength) {
      const result = await handle.read(source, offset, source.byteLength - offset, offset);
      if (result.bytesRead === 0) throw recordingError("AUTOMATION_RECORDING_CHANGED", "automation recording changed while reading");
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw recordingError("AUTOMATION_RECORDING_CHANGED", "automation recording changed while reading");
    }
    await handle?.close();
    handle = null;
    let recording;
    try { recording = JSON.parse(source.toString("utf8")); }
    catch (error) { throw recordingError("AUTOMATION_RECORDING_INVALID", "automation recording JSON is invalid", error); }
    verifyAutomationRecording(recording);
    const artifacts = new Map();
    for (const [artifactRef, artifact] of Object.entries(recording.artifacts)) {
      const { bytes } = descriptorArtifactBytes(artifactRef, artifact);
      artifacts.set(artifactRef, bytes || await readExternalArtifact({ file,
        artifactGeneration: recording.artifactGeneration }, artifactRef, artifact));
    }
    recordingArtifacts.set(recording, artifacts);
    return recording;
  } catch (error) {
    if (error?.code?.startsWith?.("AUTOMATION_RECORDING_")) throw error;
    throw recordingError("AUTOMATION_RECORDING_UNAVAILABLE", `cannot read automation recording: ${file}`, error);
  } finally {
    await handle?.close();
    await mutex.close();
  }
}

export async function snapshotAutomationRecording(file, sourceRecording) {
  const recording = structuredClone(sourceRecording);
  verifyAutomationRecording(recording);
  const artifacts = new Map();
  for (const [artifactRef, artifact] of Object.entries(recording.artifacts)) {
    const { bytes } = descriptorArtifactBytes(artifactRef, artifact);
    artifacts.set(artifactRef, bytes || await readExternalArtifact({ file,
      artifactGeneration: recording.artifactGeneration }, artifactRef, artifact));
  }
  recordingArtifacts.set(recording, artifacts);
  return recording;
}

export async function readAutomationRecordingArtifact(recording, artifactRef, { offset = 0, length = null } = {}) {
  const artifact = recording?.artifacts?.[artifactRef];
  if (!artifact) throw recordingError("AUTOMATION_RECORDING_ARTIFACT_MISSING", `recording artifact is unavailable: ${artifactRef}`);
  let bytes = recordingArtifacts.get(recording)?.get(artifactRef) || null;
  if (!bytes) {
    const parsed = descriptorArtifactBytes(artifactRef, artifact);
    bytes = parsed.bytes;
  }
  if (!bytes) throw recordingError("AUTOMATION_RECORDING_ARTIFACT_MISSING", `recording artifact bytes are not loaded: ${artifactRef}`);
  const end = length === null ? bytes.byteLength : offset + length;
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(end) || end < offset || end > bytes.byteLength) {
    throw recordingError("AUTOMATION_RECORDING_ARTIFACT_INVALID", `recording artifact slice is invalid: ${artifactRef}`);
  }
  return bytes.subarray(offset, end);
}

async function syncWrite(path, source, { flag = "wx", mode = 0o600 } = {}) {
  const handle = await open(path, flag, mode);
  try {
    await handle.writeFile(source);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function acquireRecordingMutex(file) {
  const mutexFile = `${file}.mutex`;
  let handle;
  try { handle = await open(mutexFile, "wx", 0o600); }
  catch (error) {
    if (error?.code === "EEXIST") throw recordingError("AUTOMATION_RECORDING_LOCKED",
      `automation recording metadata is busy: ${file}`);
    throw error;
  }
  return Object.freeze({
    async close() {
      if (!handle) return;
      const owned = handle;
      handle = null;
      await owned.close();
      await unlink(mutexFile);
    },
  });
}

async function syncDirectory(path) {
  if (process.platform === "win32") return;
  const handle = await open(path, "r");
  try { await handle.sync(); }
  finally { await handle.close(); }
}

async function atomicWrite(path, source) {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await syncWrite(temporary, source, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    try { await rm(temporary, { force: true }); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
}

async function persistArtifact(directory, artifactRef, artifact) {
  const parsed = descriptorArtifactBytes(artifactRef, artifact);
  if (!parsed.bytes) return parsed.body;
  const file = `${parsed.body.sha256}.bin`;
  const path = join(directory, file);
  try {
    await syncWrite(path, parsed.bytes, { flag: "wx", mode: 0o600 });
    await syncDirectory(directory);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    await verifyExistingArtifact(path, artifactRef, parsed.body);
  }
  return artifactBody({ ...parsed.body, file, dataBase64: undefined });
}

export class AutomationRecordingWriter {
  static async open(file, recording, { overwrite = false } = {}) {
    if (typeof file !== "string" || !isAbsolute(file)) throw new TypeError("automation recording file must be absolute");
    const resolved = resolve(file);
    const parent = dirname(resolved);
    const parentMetadata = await lstat(parent);
    if (!parentMetadata.isDirectory() || parentMetadata.isSymbolicLink()) {
      throw new TypeError("automation recording parent must be a regular directory");
    }
    const mutex = await acquireRecordingMutex(resolved);
    const lockFile = `${resolved}.lock`;
    let lock;
    const token = randomBytes(32).toString("base64url");
    try {
      try { lock = await open(lockFile, "wx", 0o600); }
      catch (error) {
        if (error?.code === "EEXIST") throw recordingError("AUTOMATION_RECORDING_LOCKED",
          `automation recording is already owned: ${resolved}`);
        throw error;
      }
      await lock.writeFile(`${JSON.stringify({ token, pid: process.pid, file: basename(resolved) })}\n`);
      await lock.sync();
      let existing = null;
      try { existing = await lstat(resolved); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
      if (existing && !existing.isFile()) throw new TypeError("automation recording target must be a regular file");
      if (existing && !overwrite) throw recordingError("AUTOMATION_RECORDING_EXISTS",
        "automation recording exists and overwrite was not approved");
      const artifactRoot = automationArtifactRoot(resolved);
      let artifactRootMetadata = null;
      try { artifactRootMetadata = await lstat(artifactRoot); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
      if (artifactRootMetadata && (!artifactRootMetadata.isDirectory() || artifactRootMetadata.isSymbolicLink())) {
        throw new TypeError("automation recording artifact root must be a regular directory");
      }
      if (artifactRootMetadata && !overwrite) {
        throw recordingError("AUTOMATION_RECORDING_EXISTS",
          "automation recording artifacts exist and overwrite was not approved");
      }
      const writer = new AutomationRecordingWriter({ file: resolved, lockFile, lock, token });
      await writer.write(recording);
      if (artifactRootMetadata) await writer._cleanupStaleGenerations(recording.artifactGeneration);
      await mutex.close();
      return writer;
    } catch (error) {
      await lock?.close();
      if (lock) try { await unlink(lockFile); } catch (unlinkError) { if (unlinkError?.code !== "ENOENT") throw unlinkError; }
      await mutex.close();
      throw error;
    }
  }

  constructor({ file, lockFile, lock, token }) {
    this.file = file;
    this.lockFile = lockFile;
    this.lock = lock;
    this.token = token;
    this.closed = false;
  }

  async write(recording) {
    if (this.closed) throw recordingError("AUTOMATION_RECORDING_CLOSED", "automation recording writer is closed");
    const root = automationArtifactRoot(this.file);
    let createdRoot = false;
    try {
      await mkdir(root, { mode: 0o700 });
      createdRoot = true;
    }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const metadata = await lstat(root);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new TypeError("automation recording artifact root must be a regular directory");
      }
    }
    if (createdRoot) await syncDirectory(dirname(root));
    const directory = automationArtifactDirectory(this.file, recording.artifactGeneration);
    try {
      await mkdir(directory, { mode: 0o700 });
      await syncDirectory(root);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const metadata = await lstat(directory);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new TypeError("automation recording artifact generation must be a regular directory");
      }
    }
    for (const [artifactRef, artifact] of Object.entries(recording.artifacts)) {
      recording.artifacts[artifactRef] = await persistArtifact(directory, artifactRef, artifact);
    }
    sealAutomationRecording(recording);
    verifyAutomationRecording(recording, { requireComplete: false });
    const source = `${JSON.stringify(recording, null, 2)}\n`;
    if (Buffer.byteLength(source) > AUTOMATION_RECORDING_MAX_BYTES) {
      throw recordingError("AUTOMATION_RECORDING_TOO_LARGE", "automation recording exceeds the byte limit");
    }
    await atomicWrite(this.file, source);
    return Object.freeze({ recordingId: recording.recordingId, entries: recording.entries.length,
      artifacts: Object.keys(recording.artifacts).length, complete: recording.complete,
      finalSha256: recording.finalSha256 });
  }

  async _cleanupStaleGenerations(activeGeneration) {
    const root = automationArtifactRoot(this.file);
    const metadata = await lstat(root);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new TypeError("automation recording artifact root must be a regular directory");
    }
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === activeGeneration) continue;
      await rm(join(root, entry.name), { recursive: true, force: true });
    }
    await syncDirectory(root);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.lock.close();
    let owner;
    try { owner = JSON.parse(await readFile(this.lockFile, "utf8")); }
    catch (error) { throw recordingError("AUTOMATION_RECORDING_LOCK_LOST", "automation recording lock disappeared", error); }
    if (owner.token !== this.token) {
      throw recordingError("AUTOMATION_RECORDING_LOCK_LOST", "automation recording lock ownership changed");
    }
    await unlink(this.lockFile);
  }
}

export function assertAutomationRecordingSelection(recording, selection, policy) {
  if (!selection || recording.recordingId !== selection.recordingId
    || recording.finalSha256 !== selection.finalSha256) {
    throw recordingError("AUTOMATION_RECORDING_PIN_MISMATCH", "automation recording pins do not match");
  }
  const cursor = selection.startCursor || 0;
  const expectedPrefix = cursor === 0 ? ZERO_DIGEST : recording.entries[cursor - 1]?.sha256;
  if (!expectedPrefix || (cursor > 0 && selection.prefixSha256 !== expectedPrefix)
    || (selection.prefixSha256 !== undefined && selection.prefixSha256 !== expectedPrefix)) {
    throw recordingError("AUTOMATION_REPLAY_CURSOR_INVALID", "automation replay cursor pin does not match");
  }
  const expectedPolicy = Object.freeze({
    targetOrigins: Object.freeze([...(policy?.targetOrigins || [])]),
    actions: Object.freeze([...(policy?.actions || [])]),
    rawMethods: Object.freeze([...(policy?.rawMethods || [])]),
    maxRisk: String(policy?.maxRisk || ""),
  });
  if (automationRecordingDigest(recording.provider.policy) !== automationRecordingDigest(expectedPolicy)) {
    throw recordingError("AUTOMATION_RECORDING_POLICY_MISMATCH", "automation recording policy does not match the replay manifest");
  }
  return recording;
}

export function automationRecordingZeroDigest() {
  return ZERO_DIGEST;
}
