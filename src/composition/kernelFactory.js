// kernelFactory.js - Layer 3: verified engine assets, kernel boot, clone, and offline Machine wake.
import { PyProcError } from "../runtime/errors.js";
import { base64FromBytes, bytesFromBase64, parseSha256Address, sha256Address } from "../runtime/contentDigest.js";
import { bootCpythonWasiKernel } from "../runtime/kernel/cpythonWasiKernel.js";
import { materializeKernelCheckpoint, verifyKernelCheckpointDescriptor } from "../runtime/kernel/kernelCheckpoint.js";
import { MemoryKernelAssetStore, verifyKernelEngineManifest } from "../runtime/kernel/engineManifest.js";
import { MemoryValueArtifactStore } from "../runtime/kernel/valueEnvelope.js";

export const KERNEL_MACHINE_IMAGE_PROTOCOL = "pyproc.kernel-machine-image";
export const KERNEL_MACHINE_IMAGE_VERSION = 1;

function inputError(message) {
  return new PyProcError("PYPROC_INPUT_INVALID", message);
}

function unavailable(message, context = {}) {
  return new PyProcError("PYPROC_ASSET_MISSING", message, { context });
}

function canonicalDigest(value) {
  const hex = parseSha256Address(value);
  return hex && value === `sha256:${hex}`;
}

function imageCore(value) {
  return {
    protocol: value.protocol,
    version: value.version,
    engineManifest: value.engineManifest,
    packageEnvironment: value.packageEnvironment,
    checkpointRef: value.checkpointRef,
    checkpoints: value.checkpoints,
    checkpointObjects: value.checkpointObjects,
    createdAt: value.createdAt,
  };
}

function packageEnvironmentImage(environment) {
  if (!environment) return null;
  return Object.freeze({ protocol: "pyproc.package-environment-bootstrap", version: 1,
    environmentId: environment.environmentId, lockDigest: environment.lockDigest,
    policyDigest: environment.policyDigest, allowedTags: Object.freeze([...environment.allowedTags]),
    limits: environment.limits ? Object.freeze({ ...environment.limits }) : null,
    wheels: Object.freeze(environment.wheels.map((wheel) => Object.freeze({
      filename: wheel.filename, name: wheel.name, version: wheel.version, sha256: wheel.sha256,
      byteLength: wheel.bytes.byteLength, base64: base64FromBytes(wheel.bytes),
    }))),
  });
}

async function verifyPackageEnvironmentImage(value) {
  if (value === undefined || value === null) return null;
  const allowed = new Set(["protocol", "version", "environmentId", "lockDigest", "policyDigest",
    "allowedTags", "limits", "wheels"]);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.has(key))
    || value.protocol !== "pyproc.package-environment-bootstrap" || value.version !== 1
    || !canonicalDigest(value.environmentId)
    || value.lockDigest !== null && !canonicalDigest(value.lockDigest)
    || value.policyDigest !== null && !canonicalDigest(value.policyDigest)
    || !Array.isArray(value.allowedTags) || !value.allowedTags.length
    || value.allowedTags.some((tag) => typeof tag !== "string"
      || !/^[A-Za-z0-9_.]+-[A-Za-z0-9_.]+-[A-Za-z0-9_.]+$/u.test(tag))
    || new Set(value.allowedTags).size !== value.allowedTags.length
    || value.limits !== null && (!value.limits || typeof value.limits !== "object" || Array.isArray(value.limits))
    || !Array.isArray(value.wheels) || !value.wheels.length || value.wheels.length > 4096) {
    throw inputError("Kernel Machine package environment is invalid");
  }
  if (value.limits) {
    const limitKeys = ["maxArchiveBytes", "maxFiles", "maxFileBytes", "maxUnpackedBytes", "maxCompressionRatio"];
    if (Object.keys(value.limits).length !== limitKeys.length
      || limitKeys.some((key) => !Object.hasOwn(value.limits, key)
        || !Number.isFinite(value.limits[key]) || value.limits[key] < 1)
      || limitKeys.slice(0, 4).some((key) => !Number.isSafeInteger(value.limits[key]))) {
      throw inputError("Kernel Machine package limits are invalid");
    }
  }
  const wheels = [];
  const wheelNames = new Set();
  for (const wheel of value.wheels) {
    const wheelAllowed = new Set(["filename", "name", "version", "sha256", "byteLength", "base64"]);
    if (!wheel || typeof wheel !== "object" || Array.isArray(wheel)
      || Object.keys(wheel).some((key) => !wheelAllowed.has(key))
      || typeof wheel.filename !== "string" || !wheel.filename.endsWith(".whl")
      || typeof wheel.name !== "string" || !wheel.name || typeof wheel.version !== "string" || !wheel.version
      || !canonicalDigest(wheel.sha256) || !Number.isSafeInteger(wheel.byteLength) || wheel.byteLength < 1
      || value.limits && wheel.byteLength > value.limits.maxArchiveBytes || wheelNames.has(wheel.filename)
      || typeof wheel.base64 !== "string") {
      throw inputError("Kernel Machine package wheel descriptor is invalid");
    }
    const bytes = bytesFromBase64(wheel.base64);
    if (base64FromBytes(bytes) !== wheel.base64 || bytes.byteLength !== wheel.byteLength
      || await sha256Address(bytes) !== wheel.sha256) {
      throw new PyProcError("PYPROC_MACHINE_INTEGRITY", "Kernel Machine package wheel is corrupt");
    }
    wheels.push(Object.freeze({ filename: wheel.filename, name: wheel.name, version: wheel.version,
      sha256: wheel.sha256, bytes }));
    wheelNames.add(wheel.filename);
  }
  return Object.freeze({ descriptor: value, bootstrap: Object.freeze({
    protocol: "pyproc.package-environment-bootstrap", version: 1, environmentId: value.environmentId,
    lockDigest: value.lockDigest, policyDigest: value.policyDigest,
    allowedTags: Object.freeze([...value.allowedTags]),
    limits: value.limits ? Object.freeze({ ...value.limits }) : null,
    wheels: Object.freeze(wheels),
  }) });
}

export async function verifyKernelMachineImage(image) {
  if (!image || image.protocol !== KERNEL_MACHINE_IMAGE_PROTOCOL || image.version !== KERNEL_MACHINE_IMAGE_VERSION
    || !Array.isArray(image.checkpoints) || !image.checkpoints.length
    || !Array.isArray(image.checkpointObjects)) throw inputError("Kernel Machine image is invalid");
  const expected = await sha256Address(JSON.stringify(imageCore(image)));
  if (image.digest !== expected) {
    throw new PyProcError("PYPROC_MACHINE_INTEGRITY", "Kernel Machine image digest does not match");
  }
  const manifest = await verifyKernelEngineManifest(image.engineManifest);
  const packageEnvironment = await verifyPackageEnvironmentImage(image.packageEnvironment);
  const environmentId = packageEnvironment?.bootstrap.environmentId || manifest.environmentId;
  const objects = new Map();
  for (const object of image.checkpointObjects) {
    if (!object || typeof object.artifactRef !== "string" || !object.artifactRef
      || typeof object.base64 !== "string") {
      throw inputError("Kernel Machine checkpoint object is invalid");
    }
    const bytes = bytesFromBase64(object.base64);
    if (base64FromBytes(bytes) !== object.base64 || bytes.byteLength !== object.byteLength
      || await sha256Address(bytes) !== object.sha256) {
      throw new PyProcError("PYPROC_MACHINE_INTEGRITY", "Kernel Machine checkpoint object is corrupt");
    }
    const existing = objects.get(object.artifactRef);
    if (existing) {
      if (existing.descriptor.sha256 !== object.sha256
        || existing.descriptor.byteLength !== object.byteLength
        || existing.descriptor.base64 !== object.base64) {
        throw new PyProcError("PYPROC_MACHINE_INTEGRITY", "Kernel Machine checkpoint reference is ambiguous");
      }
      continue;
    }
    objects.set(object.artifactRef, Object.freeze({ descriptor: object, bytes }));
  }
  const checkpoints = new Map();
  for (const checkpoint of image.checkpoints) {
    if (!checkpoint || typeof checkpoint.checkpointRef !== "string" || !checkpoint.checkpointRef
      || checkpoints.has(checkpoint.checkpointRef)
      || checkpoint.engineId !== manifest.engineId || checkpoint.environmentId !== environmentId) {
      throw inputError("Kernel Machine checkpoint descriptor is invalid");
    }
    const object = objects.get(checkpoint.memoryImageRef);
    if (!object || object.descriptor.sha256 !== checkpoint.memoryImageSha256) {
      throw new PyProcError("PYPROC_MACHINE_INTEGRITY", "Kernel Machine checkpoint object is missing or mismatched");
    }
    checkpoints.set(checkpoint.checkpointRef, checkpoint);
  }
  if (!checkpoints.has(image.checkpointRef)) throw inputError("Kernel Machine image head checkpoint is missing");
  return Object.freeze({ image, manifest, packageEnvironment, objects, checkpoints });
}

export class KernelFactory {
  #assetStore;
  #checkpointStore;
  #fetch;
  #kernels = new WeakMap();
  #checkpoints = new Map();
  #kernelCounter = 0;

  constructor({ assetStore = new MemoryKernelAssetStore(),
    checkpointStore = new MemoryValueArtifactStore(), fetchImpl = globalThis.fetch } = {}) {
    const acceptedFetch = fetchImpl === globalThis.fetch && typeof globalThis.fetch === "function"
      ? globalThis.fetch.bind(globalThis)
      : fetchImpl;
    if (!assetStore || typeof assetStore.put !== "function" || typeof assetStore.get !== "function"
      || typeof assetStore.has !== "function" || typeof assetStore.inspect !== "function"
      || !checkpointStore || typeof checkpointStore.put !== "function" || typeof checkpointStore.get !== "function"
      || typeof acceptedFetch !== "function") {
      throw inputError("KernelFactory requires asset, checkpoint, and fetch providers");
    }
    this.#assetStore = assetStore;
    this.#checkpointStore = checkpointStore;
    this.#fetch = acceptedFetch;
  }

  get assetStore() { return this.#assetStore; }
  get checkpointStore() { return this.#checkpointStore; }

  async #artifact(descriptor, offline) {
    if (this.#assetStore.has(descriptor.sha256)) {
      const cached = this.#assetStore.get(descriptor.sha256);
      if (cached.byteLength !== descriptor.byteLength) {
        throw new PyProcError("PYPROC_ASSET_INTEGRITY", "Cached kernel asset length does not match the manifest");
      }
      return cached;
    }
    if (offline) throw unavailable(`Offline kernel asset is unavailable: ${descriptor.sha256}`, {
      sha256: descriptor.sha256,
    });
    const response = await this.#fetch(descriptor.url);
    if (!response?.ok) throw unavailable(`Kernel asset fetch failed: ${response?.status || "unknown"}`, {
      url: descriptor.url,
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== descriptor.byteLength) {
      throw new PyProcError("PYPROC_ASSET_INTEGRITY", "Fetched kernel asset length does not match the manifest", {
        context: { expected: descriptor.byteLength, actual: bytes.byteLength, url: descriptor.url },
      });
    }
    await this.#assetStore.put(descriptor.sha256, bytes);
    return this.#assetStore.get(descriptor.sha256);
  }

  #checkpointContext(manifest, environmentId = manifest.environmentId) {
    return {
      artifactStore: this.#checkpointStore,
      engineId: manifest.engineId,
      environmentId,
      resolveParent: async (checkpointRef) => this.#checkpoints.get(checkpointRef) || null,
    };
  }

  #registerCheckpoint(descriptor) {
    this.#checkpoints.set(descriptor.checkpointRef, descriptor);
    return descriptor;
  }

  async open(rawManifest, options = {}) {
    const manifest = await verifyKernelEngineManifest(rawManifest);
    const packageEnvironment = options.packageEnvironment || null;
    const environmentId = packageEnvironment?.environmentId || manifest.environmentId;
    const [wasmBytes, stdlibBytes] = await Promise.all([
      this.#artifact(manifest.artifacts.wasm, options.offline === true),
      this.#artifact(manifest.artifacts.stdlib, options.offline === true),
    ]);
    const restoredCheckpoint = options.restore?.checkpoint || options.restore || null;
    let bootstrapSnapshot = null;
    if (restoredCheckpoint) {
      if (!this.#checkpoints.has(restoredCheckpoint.checkpointRef)) this.#registerCheckpoint(restoredCheckpoint);
      await verifyKernelCheckpointDescriptor(restoredCheckpoint, this.#checkpointContext(manifest, environmentId));
      bootstrapSnapshot = {
        stackBoundary: restoredCheckpoint.memoryLayout.stackBoundary,
        memoryBytes: restoredCheckpoint.memoryLayout.currentPages * 65536,
        deltaDepth: restoredCheckpoint.deltaDepth,
        bytes: await materializeKernelCheckpoint(restoredCheckpoint, this.#checkpointContext(manifest, environmentId)),
      };
    }
    const kernelRef = options.kernelRef || `kernel:factory:${++this.#kernelCounter}`;
    const record = { manifest, restoredCheckpoint, packageEnvironment };
    const kernel = await bootCpythonWasiKernel({
      wasmBytes,
      stdlibBytes,
      stdlibDir: manifest.stdlibDir,
      deterministic: options.deterministic === true,
      engineId: manifest.engineId,
      nativeProfile: manifest.nativeProfile,
      environmentId,
      kernelRef,
      artifactStore: this.#checkpointStore,
      hostBroker: options.hostBroker,
      checkpointCoordinator: options.checkpointCoordinator,
      kernelVfs: options.kernelVfs,
      bootstrapSnapshot,
      packageEnvironment,
      onEnvironmentChanged: (nextEnvironment) => { record.packageEnvironment = nextEnvironment; },
      restoredCheckpoint,
      restoredCheckpoints: restoredCheckpoint ? this.#checkpointChain(restoredCheckpoint) : [],
    });
    const descriptor = await kernel.describe();
    if (descriptor.runtimeContractVersion !== 2 || descriptor.runtimeKind !== "cpython-wasi"
      || descriptor.engineId !== manifest.engineId || descriptor.nativeProfile !== manifest.nativeProfile
      || descriptor.environmentId !== environmentId
      || descriptor.workerOwned !== true || descriptor.directHeapAccess !== false) {
      await kernel.close();
      throw new PyProcError("PYPROC_BOOT_FAILED", "KernelFactory protocol negotiation failed");
    }
    const selfTest = await kernel.execute({ commandId: `${kernelRef}:self-test`,
      code: `import sys\nassert sys.version.split()[0] == ${JSON.stringify(manifest.pythonVersion)}` });
    if (selfTest.state !== "completed") {
      await kernel.close();
      throw new PyProcError("PYPROC_BOOT_FAILED", selfTest.error?.message || "KernelFactory self-test failed");
    }
    this.#kernels.set(kernel, record);
    return kernel;
  }

  manifestFor(kernel) {
    const record = this.#kernels.get(kernel);
    if (!record) throw inputError("KernelFactory does not own this kernel");
    return record.manifest;
  }

  #checkpointChain(checkpoint) {
    const chain = [];
    const seen = new Set();
    let cursor = checkpoint;
    while (cursor) {
      if (seen.has(cursor.checkpointRef)) {
        throw new PyProcError("PYPROC_STATE_CORRUPT", "Kernel checkpoint chain contains a cycle");
      }
      seen.add(cursor.checkpointRef);
      chain.push(cursor);
      if (cursor.parentCheckpointRef) {
        const parent = this.#checkpoints.get(cursor.parentCheckpointRef);
        if (!parent) throw new PyProcError("PYPROC_STATE_CORRUPT", "Kernel checkpoint parent is missing");
        cursor = parent;
      } else {
        cursor = null;
      }
      if (chain.length > 128) throw new PyProcError("PYPROC_STATE_CORRUPT", "Kernel checkpoint chain is too deep");
    }
    return chain.reverse();
  }

  async checkpoint(kernel, request = {}) {
    this.manifestFor(kernel);
    return this.#registerCheckpoint(await kernel.checkpoint(request));
  }

  async clone(kernel, options = {}) {
    const record = this.#kernels.get(kernel);
    if (!record) throw inputError("KernelFactory does not own this kernel");
    const manifest = record.manifest;
    const checkpoint = await this.checkpoint(kernel, options.checkpoint || {});
    const cloned = await this.open(manifest, { ...options, restore: checkpoint,
      kernelRef: options.kernelRef, packageEnvironment: record.packageEnvironment });
    return Object.freeze({ kernel: cloned, checkpoint });
  }

  async exportImage(kernel, options = {}) {
    const record = this.#kernels.get(kernel);
    if (!record) throw inputError("KernelFactory does not own this kernel");
    const manifest = record.manifest;
    for (const descriptor of Object.values(manifest.artifacts)) {
      if (!this.#assetStore.has(descriptor.sha256)) {
        throw unavailable("Kernel Machine export requires cached engine artifacts", { sha256: descriptor.sha256 });
      }
    }
    const checkpoint = options.checkpoint || await this.checkpoint(kernel);
    this.#registerCheckpoint(checkpoint);
    const checkpoints = this.#checkpointChain(checkpoint);
    const checkpointObjects = [];
    for (const descriptor of checkpoints) {
      const bytes = await this.#checkpointStore.get(descriptor.memoryImageRef);
      checkpointObjects.push(Object.freeze({ artifactRef: descriptor.memoryImageRef,
        sha256: descriptor.memoryImageSha256, byteLength: bytes.byteLength,
        base64: base64FromBytes(bytes) }));
    }
    const core = {
      protocol: KERNEL_MACHINE_IMAGE_PROTOCOL,
      version: KERNEL_MACHINE_IMAGE_VERSION,
      engineManifest: manifest,
      packageEnvironment: packageEnvironmentImage(record.packageEnvironment),
      checkpointRef: checkpoint.checkpointRef,
      checkpoints: Object.freeze(checkpoints),
      checkpointObjects: Object.freeze(checkpointObjects),
      createdAt: options.createdAt || new Date().toISOString(),
    };
    return Object.freeze({ ...core, digest: await sha256Address(JSON.stringify(core)) });
  }

  async openImage(image, options = {}) {
    const verified = await verifyKernelMachineImage(image);
    for (const { descriptor: object, bytes } of verified.objects.values()) {
      const stored = await this.#checkpointStore.put(bytes, { sha256: object.sha256 });
      if (stored.artifactRef !== object.artifactRef) {
        throw new PyProcError("PYPROC_MACHINE_INTEGRITY", "Kernel Machine checkpoint reference does not match");
      }
    }
    for (const checkpoint of verified.checkpoints.values()) this.#registerCheckpoint(checkpoint);
    const checkpoint = this.#checkpoints.get(image.checkpointRef);
    return this.open(verified.manifest, { ...options, offline: options.offline === true, restore: checkpoint,
      packageEnvironment: verified.packageEnvironment?.bootstrap || null });
  }

  inspect() {
    return Object.freeze({ protocol: "pyproc.kernel-factory-inspection", version: 1,
      cachedAssets: this.#assetStore.inspect(), checkpointRefs: Object.freeze([...this.#checkpoints.keys()].sort()) });
  }
}
