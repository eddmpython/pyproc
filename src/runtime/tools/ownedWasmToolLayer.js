// ownedWasmToolLayer.js - verified argv-only commands over bounded Machine snapshots.
import { verifyPyProcAssetIntegrity } from "../assets.js";
import { sha256Address } from "../contentDigest.js";
import { PyProcError } from "../errors.js";
import {
  OWNED_WASM_TOOL_LIMITS,
  OWNED_WASM_TOOLS,
  inspectOwnedWasmTools,
  ownedWasmToolURL,
} from "./ownedWasmTools.js";

const encoder = new TextEncoder();

function inputError(message, context) {
  return new PyProcError("PYPROC_INPUT_INVALID", message, context ? { context } : undefined);
}

function bytesOf(value, label) {
  if (typeof value === "string") return encoder.encode(value);
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw inputError(`${label} must be a string, Uint8Array, or ArrayBuffer`);
}

function normalizePath(value) {
  const raw = String(value || "");
  if (!raw.startsWith("/") || raw.includes("\0") || raw.includes("\\")) {
    throw inputError(`Tool file path must be an absolute POSIX path: ${raw}`);
  }
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    throw inputError(`Tool file path is invalid: ${raw}`);
  }
  return `/${parts.join("/")}`;
}

function normalizeArgs(args) {
  if (!Array.isArray(args) || args.length > OWNED_WASM_TOOL_LIMITS.maxArgs) {
    throw inputError(`Tool args must contain at most ${OWNED_WASM_TOOL_LIMITS.maxArgs} strings`);
  }
  let bytes = 0;
  const normalized = args.map((value) => {
    if (typeof value !== "string" || value.includes("\0")) throw inputError("Tool args must be NUL-free strings");
    bytes += encoder.encode(value).byteLength;
    return value;
  });
  if (bytes > OWNED_WASM_TOOL_LIMITS.maxArgBytes) {
    throw inputError(`Tool args exceed ${OWNED_WASM_TOOL_LIMITS.maxArgBytes} bytes`);
  }
  return normalized;
}

async function explicitFiles(value) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw inputError("Tool files must be an object keyed by absolute path");
  }
  const files = [];
  for (const [path, content] of Object.entries(value)) files.push({ path: normalizePath(path), bytes: bytesOf(content, path) });
  return files;
}

async function vfsFiles(vfs) {
  if (!vfs || typeof vfs.list !== "function" || typeof vfs.read !== "function") return [];
  const files = [];
  for (const path of vfs.list("/home")) files.push({ path: normalizePath(path), bytes: bytesOf(await vfs.read(path), path) });
  return files;
}

async function normalizeFiles(value, vfs) {
  const files = await explicitFiles(value) ?? await vfsFiles(vfs);
  return finalizeFiles(files, vfs?.rootDigest || null);
}

async function finalizeFiles(files, vfsRootDigest = null) {
  if (files.length > OWNED_WASM_TOOL_LIMITS.maxFiles) {
    throw inputError(`Tool snapshot exceeds ${OWNED_WASM_TOOL_LIMITS.maxFiles} files`);
  }
  const paths = new Set();
  let total = 0;
  for (const file of files) {
    if (paths.has(file.path)) throw inputError(`Duplicate tool file path: ${file.path}`);
    if ([...paths].some((path) => file.path.startsWith(`${path}/`) || path.startsWith(`${file.path}/`))) {
      throw inputError(`Tool file path collides with a file ancestor: ${file.path}`);
    }
    paths.add(file.path);
    if (file.bytes.byteLength > OWNED_WASM_TOOL_LIMITS.maxFileBytes) {
      throw inputError(`Tool file exceeds ${OWNED_WASM_TOOL_LIMITS.maxFileBytes} bytes: ${file.path}`);
    }
    total += file.bytes.byteLength;
  }
  if (total > OWNED_WASM_TOOL_LIMITS.maxSnapshotBytes) {
    throw inputError(`Tool snapshot exceeds ${OWNED_WASM_TOOL_LIMITS.maxSnapshotBytes} bytes`);
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const descriptors = [];
  for (const file of files) descriptors.push({ path: file.path, byteLength: file.bytes.byteLength,
    sha256: await sha256Address(file.bytes) });
  return { files, total, digest: await sha256Address(JSON.stringify(descriptors)), vfsRootDigest };
}

async function writeOutput(vfs, input, rawFiles) {
  if (!Array.isArray(rawFiles)) throw new PyProcError("PYPROC_WORKER_TASK_ERROR", "Machine tool output snapshot is missing");
  const output = await finalizeFiles(rawFiles.map((file) => ({ path: normalizePath(file.path),
    bytes: bytesOf(file.bytes, file.path) })));
  if (output.files.some((file) => !file.path.startsWith("/home/"))) {
    throw new PyProcError("PYPROC_WORKER_TASK_ERROR", "Machine tool attempted to persist outside /home");
  }
  if (vfs.rootDigest !== input.vfsRootDigest) {
    throw new PyProcError("PYPROC_STATE_FENCE_STALE", "KernelVfs changed while the Machine tool was running", {
      context: { expectedRootDigest: input.vfsRootDigest, actualRootDigest: vfs.rootDigest },
    });
  }
  const before = new Map(input.files.map((file) => [file.path, file]));
  const after = new Map(output.files.map((file) => [file.path, file]));
  const removed = [...before.keys()].filter((path) => !after.has(path));
  const written = output.files.filter((file) => {
    const previous = before.get(file.path);
    return !previous || previous.bytes.byteLength !== file.bytes.byteLength
      || previous.bytes.some((byte, index) => byte !== file.bytes[index]);
  });
  if (!removed.length && !written.length) return { output, commit: null, removed: 0, written: 0 };
  const transaction = vfs.beginTransaction();
  try {
    for (const path of removed) transaction.remove(path);
    for (const file of written) await transaction.write(file.path, file.bytes);
    const commit = await transaction.commit();
    return { output, commit, removed: removed.length, written: written.length };
  } catch (error) {
    if (transaction.state === "open") transaction.abort();
    throw error;
  }
}

function timeoutValue(value) {
  const timeout = value ?? OWNED_WASM_TOOL_LIMITS.defaultTimeoutMs;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > OWNED_WASM_TOOL_LIMITS.maxTimeoutMs) {
    throw inputError(`Tool timeoutMs must be between 1 and ${OWNED_WASM_TOOL_LIMITS.maxTimeoutMs}`);
  }
  return timeout;
}

function outputLimit(value) {
  const limit = value ?? OWNED_WASM_TOOL_LIMITS.maxOutputBytes;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > OWNED_WASM_TOOL_LIMITS.maxOutputBytes) {
    throw inputError(`Tool maxOutputBytes must be between 1 and ${OWNED_WASM_TOOL_LIMITS.maxOutputBytes}`);
  }
  return limit;
}

function reconstructedDirectories(tool, files) {
  if (tool.command !== "git") return [];
  const directories = new Set();
  for (const file of files) {
    if (!file.path.endsWith("/.git/HEAD")) continue;
    const gitDir = file.path.slice(0, -"/HEAD".length);
    for (const suffix of ["objects", "objects/info", "objects/pack", "refs", "refs/heads", "refs/tags"])
      directories.add(`${gitDir}/${suffix}`);
  }
  return [...directories].sort();
}

export class OwnedWasmToolLayer {
  #assetIntegrity;
  #fetch;
  #vfs;
  #wasmPromises = new Map();
  #active = new Map();
  #closed = false;
  #verified = false;
  #requestCounter = 0;

  constructor({ assetIntegrity = null, fetchImpl = globalThis.fetch, kernelVfs = null } = {}) {
    this.#assetIntegrity = assetIntegrity;
    this.#fetch = fetchImpl === globalThis.fetch && typeof globalThis.fetch === "function"
      ? globalThis.fetch.bind(globalThis) : fetchImpl;
    this.#vfs = kernelVfs;
  }

  inspect() {
    const contract = inspectOwnedWasmTools();
    return Object.freeze({ ...contract, state: this.#closed ? "closed" : this.#verified ? "verified" : "available" });
  }

  async #wasm(tool) {
    if (this.#wasmPromises.has(tool.command)) return this.#wasmPromises.get(tool.command);
    const promise = (async () => {
      if (typeof this.#fetch !== "function") throw new PyProcError("PYPROC_ENV_UNSUPPORTED", "Machine tools require fetch");
      if (this.#assetIntegrity) await verifyPyProcAssetIntegrity(this.#assetIntegrity, {
        roles: ["wasmToolWorker", "wasmToolBinary"], fetch: this.#fetch,
      });
      const url = ownedWasmToolURL(tool);
      const response = await this.#fetch(url, { cache: "no-store", credentials: "same-origin" });
      if (!response?.ok) throw new PyProcError("PYPROC_ASSET_MISSING", `Owned tool failed to load (${response?.status || "no response"})`, {
        context: { command: tool.command, url },
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== tool.byteLength || await sha256Address(bytes) !== tool.binarySha256) {
        throw new PyProcError("PYPROC_ASSET_INTEGRITY", `Owned tool integrity failed: ${tool.command}`, {
          context: { command: tool.command, expectedSha256: tool.binarySha256, actualByteLength: bytes.byteLength },
        });
      }
      this.#verified = true;
      return bytes;
    })();
    this.#wasmPromises.set(tool.command, promise);
    try { return await promise; }
    catch (error) { this.#wasmPromises.delete(tool.command); throw error; }
  }

  async run(command, args = [], options = {}) {
    if (this.#closed) throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "Machine tool layer is closed");
    if (!options || typeof options !== "object" || Array.isArray(options)) throw inputError("Tool options must be an object");
    const tool = OWNED_WASM_TOOLS.find((candidate) => candidate.command === command);
    if (!tool) throw inputError(`Unsupported owned tool: ${String(command)}`, { commands: OWNED_WASM_TOOLS.map((entry) => entry.command) });
    const normalizedArgs = normalizeArgs(args);
    const writesVfs = tool.filesystem === "transactional-kernel-vfs";
    if (writesVfs && options.files !== undefined) {
      throw inputError(`${tool.command} uses the attached KernelVfs and does not accept explicit files`);
    }
    if (writesVfs && !this.#vfs) throw inputError(`${tool.command} requires an attached KernelVfs`);
    const timeoutMs = timeoutValue(options.timeoutMs);
    const maxOutputBytes = outputLimit(options.maxOutputBytes);
    const stdin = bytesOf(options.stdin ?? "", "Tool stdin");
    if (stdin.byteLength > OWNED_WASM_TOOL_LIMITS.maxStdinBytes) {
      throw inputError(`Tool stdin exceeds ${OWNED_WASM_TOOL_LIMITS.maxStdinBytes} bytes`);
    }
    if (options.signal !== undefined && (!options.signal || typeof options.signal !== "object"
      || typeof options.signal.aborted !== "boolean" || typeof options.signal.addEventListener !== "function"
      || typeof options.signal.removeEventListener !== "function")) throw inputError("Tool signal must be an AbortSignal");
    if (options.signal?.aborted) throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "Machine tool run was cancelled before start");
    const snapshot = await normalizeFiles(options.files, this.#vfs);
    const wasm = await this.#wasm(tool);
    if (this.#closed) throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "Machine tool layer closed before execution", {
      context: { command },
    });
    if (options.signal?.aborted) throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "Machine tool run was cancelled before execution", {
      context: { command },
    });
    if (typeof Worker !== "function") throw new PyProcError("PYPROC_ENV_UNSUPPORTED", "Machine tools require module Worker support");
    const worker = new Worker(new URL("./wasmToolWorker.js", import.meta.url), { type: "module" });
    const requestId = `tool:${++this.#requestCounter}`;
    const startedAt = performance.now();
    let timer = null;
    let abort = null;
    try {
      const result = await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          this.#active.delete(worker);
          worker.terminate();
          if (error) reject(error); else resolve(value);
        };
        const stop = (error) => finish(error, null);
        this.#active.set(worker, () => stop(new PyProcError("PYPROC_PROCESS_UNAVAILABLE",
          "Machine tool layer closed during execution", { context: { command } })));
        timer = setTimeout(() => stop(new PyProcError("PYPROC_TASK_TIMEOUT", `Machine tool timed out after ${timeoutMs} ms`, {
          context: { command, timeoutMs },
        })), timeoutMs);
        abort = () => stop(new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "Machine tool run was cancelled", {
          context: { command },
        }));
        options.signal?.addEventListener("abort", abort, { once: true });
        worker.addEventListener("error", (event) => stop(new PyProcError("PYPROC_WORKER_CRASHED",
          `Machine tool worker crashed: ${event.message || "unknown error"}`, { context: { command } })), { once: true });
        worker.addEventListener("messageerror", () => stop(new PyProcError("PYPROC_WORKER_CRASHED",
          "Machine tool worker message could not be read", { context: { command } })), { once: true });
        worker.addEventListener("message", (event) => {
          if (event.data?.type === "result" && event.data.requestId === requestId) finish(null, event.data);
        });
        const fileCopies = snapshot.files.map((file) => ({ path: file.path, bytes: file.bytes.slice() }));
        const wasmBytes = wasm.slice();
        const stdinBytes = stdin.slice();
        worker.postMessage({ type: "run", requestId, command, args: normalizedArgs, files: fileCopies,
          stdin: stdinBytes, maxOutputBytes, wasmBytes, captureFiles: writesVfs,
          directories: reconstructedDirectories(tool, snapshot.files) },
        [wasmBytes.buffer, stdinBytes.buffer, ...fileCopies.map((file) => file.bytes.buffer)]);
      });
      if (!result.ok) {
        throw new PyProcError("PYPROC_WORKER_TASK_ERROR", result.error || "Machine tool execution failed", {
          context: { command, errorKind: result.errorKind, stdout: result.stdout, stderr: result.stderr },
        });
      }
      const writeback = writesVfs ? await writeOutput(this.#vfs, snapshot, result.files) : null;
      return Object.freeze({
        protocol: "pyproc.wasm-tool-receipt",
        version: 1,
        command,
        toolVersion: tool.version,
        toolRevision: tool.revision,
        args: Object.freeze([...normalizedArgs]),
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        input: Object.freeze({ source: options.files === undefined ? this.#vfs ? "kernel-vfs" : "empty" : "explicit",
          fileCount: snapshot.files.length, byteLength: snapshot.total, sha256: snapshot.digest }),
        output: writeback ? Object.freeze({ fileCount: writeback.output.files.length,
          byteLength: writeback.output.total, sha256: writeback.output.digest,
          rootDigest: this.#vfs.rootDigest, written: writeback.written, removed: writeback.removed,
          committed: writeback.commit !== null }) : null,
        durationMs: Math.round(performance.now() - startedAt),
        workerDurationMs: result.workerDurationMs,
      });
    } finally {
      if (timer !== null) clearTimeout(timer);
      if (abort) options.signal?.removeEventListener("abort", abort);
      worker.terminate();
      this.#active.delete(worker);
    }
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const cancel of [...this.#active.values()]) cancel();
    this.#active.clear();
  }
}
