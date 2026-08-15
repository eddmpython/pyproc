// engineManifest.js - Layer 0: canonical CPython WASI engine identity and artifact cache.
import { PyProcError } from "../errors.js";
import { parseSha256Address, sha256Address } from "../contentDigest.js";

export const KERNEL_ENGINE_MANIFEST_PROTOCOL = "pyproc.kernel-engine-manifest";
export const KERNEL_ENGINE_MANIFEST_VERSION = 1;

function inputError(message) {
  return new PyProcError("PYPROC_INPUT_INVALID", message);
}

function integrityError(message, context = {}) {
  return new PyProcError("PYPROC_ASSET_INTEGRITY", message, { context });
}

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw inputError(`${label} has unknown field(s): ${unknown.join(", ")}`);
}

function artifact(value, role) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw inputError(`Kernel engine ${role} artifact is required`);
  }
  exactKeys(value, new Set(["url", "sha256", "byteLength"]), `Kernel engine ${role} artifact`);
  if (typeof value.url !== "string" || !value.url || !parseSha256Address(value.sha256)
    || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1) {
    throw inputError(`Kernel engine ${role} artifact metadata is invalid`);
  }
  return Object.freeze({ url: value.url, sha256: value.sha256, byteLength: value.byteLength });
}

function core(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw inputError("Kernel engine manifest must be an object");
  }
  exactKeys(value, new Set(["protocol", "version", "digest", "engineId", "environmentId", "runtimeKind",
    "target", "pythonVersion", "nativeProfile", "stdlibDir", "artifacts", "buildManifestSha256"]),
  "Kernel engine manifest");
  if (value.protocol !== KERNEL_ENGINE_MANIFEST_PROTOCOL || value.version !== KERNEL_ENGINE_MANIFEST_VERSION
    || typeof value.engineId !== "string" || !value.engineId
    || typeof value.environmentId !== "string" || !value.environmentId
    || value.runtimeKind !== "cpython-wasi" || value.target !== "wasm32-wasip1"
    || typeof value.pythonVersion !== "string" || !/^3\.[0-9]+\.[0-9]+$/u.test(value.pythonVersion)
    || typeof value.nativeProfile !== "string" || !/^[a-z][a-z0-9]*$/u.test(value.nativeProfile)
    || typeof value.stdlibDir !== "string" || !/^python[0-9]+\.[0-9]+$/u.test(value.stdlibDir)
    || !value.artifacts || typeof value.artifacts !== "object" || Array.isArray(value.artifacts)) {
    throw inputError("Kernel engine manifest identity is invalid");
  }
  exactKeys(value.artifacts, new Set(["wasm", "stdlib"]), "Kernel engine artifacts");
  if (value.buildManifestSha256 !== null && value.buildManifestSha256 !== undefined
    && !parseSha256Address(value.buildManifestSha256)) {
    throw inputError("Kernel engine build manifest digest is invalid");
  }
  return Object.freeze({
    protocol: KERNEL_ENGINE_MANIFEST_PROTOCOL,
    version: KERNEL_ENGINE_MANIFEST_VERSION,
    engineId: value.engineId,
    environmentId: value.environmentId,
    runtimeKind: "cpython-wasi",
    target: "wasm32-wasip1",
    pythonVersion: value.pythonVersion,
    nativeProfile: value.nativeProfile,
    stdlibDir: value.stdlibDir,
    artifacts: Object.freeze({ wasm: artifact(value.artifacts.wasm, "wasm"),
      stdlib: artifact(value.artifacts.stdlib, "stdlib") }),
    buildManifestSha256: value.buildManifestSha256 || null,
  });
}

export async function createKernelEngineManifest(input) {
  const normalized = core({ protocol: KERNEL_ENGINE_MANIFEST_PROTOCOL,
    version: KERNEL_ENGINE_MANIFEST_VERSION, ...input });
  return Object.freeze({ ...normalized, digest: await sha256Address(JSON.stringify(normalized)) });
}

export async function verifyKernelEngineManifest(value) {
  const normalized = core(value);
  const digest = await sha256Address(JSON.stringify(normalized));
  if (value.digest !== digest) throw integrityError("Kernel engine manifest digest does not match", {
    expected: digest, actual: value.digest || null,
  });
  return Object.freeze({ ...normalized, digest });
}

export class MemoryKernelAssetStore {
  #objects = new Map();

  async put(expectedDigest, bytes) {
    if (!parseSha256Address(expectedDigest)) throw inputError("Kernel asset digest is invalid");
    const copy = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
    const actual = await sha256Address(copy);
    if (actual !== expectedDigest) throw integrityError("Kernel asset bytes do not match their digest", {
      expected: expectedDigest, actual,
    });
    this.#objects.set(expectedDigest, copy);
    return Object.freeze({ sha256: expectedDigest, byteLength: copy.byteLength });
  }

  has(digest) { return this.#objects.has(digest); }

  get(digest) {
    const bytes = this.#objects.get(digest);
    if (!bytes) throw new PyProcError("PYPROC_ASSET_MISSING", `Kernel asset is unavailable: ${digest}`);
    return bytes.slice();
  }

  inspect() {
    return Object.freeze([...this.#objects.entries()].map(([sha256, bytes]) => Object.freeze({
      sha256, byteLength: bytes.byteLength,
    })).sort((left, right) => left.sha256 < right.sha256 ? -1 : left.sha256 > right.sha256 ? 1 : 0));
  }
}
