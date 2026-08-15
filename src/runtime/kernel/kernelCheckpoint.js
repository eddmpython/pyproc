// kernelCheckpoint.js - Layer 0: memory delta checkpoint format and materialization.
import { PyProcError } from "../errors.js";
import { PAGE_SIZE } from "../memoryLayout.js";
import { parseSha256Address, sha256Address } from "../contentDigest.js";

export const KERNEL_CHECKPOINT_PROTOCOL = "pyproc.kernel-checkpoint";
export const KERNEL_CHECKPOINT_VERSION = 2;
const IMAGE_MAGIC = 0x50434b50;
const IMAGE_VERSION = 1;
const IMAGE_HEADER_BYTES = 32;

function checkpointError(message, kernelCode = "KERNEL_CHECKPOINT_CORRUPT", context = {}) {
  return new PyProcError("PYPROC_STATE_CORRUPT", message, { context: { ...context, kernelCode } });
}

function incompatible(message, context = {}) {
  return new PyProcError("PYPROC_STATE_FENCE_STALE", message, {
    context: { ...context, kernelCode: "KERNEL_CHECKPOINT_INCOMPATIBLE" },
  });
}

function safeUint32(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw checkpointError(`Kernel checkpoint ${label} is outside uint32`);
  }
  return value;
}

function normalizePages(snapshot) {
  if (!Array.isArray(snapshot.pages)) throw checkpointError("Kernel checkpoint pages are missing");
  const pages = snapshot.pages.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || !Number.isSafeInteger(entry[0]) || entry[0] < 0
      || !(entry[1] instanceof Uint8Array)) throw checkpointError("Kernel checkpoint page entry is invalid");
    const expectedLength = Math.min(PAGE_SIZE, snapshot.regionBytes - entry[0] * PAGE_SIZE);
    if (expectedLength <= 0 || entry[1].byteLength !== expectedLength) {
      throw checkpointError("Kernel checkpoint page length is invalid", "KERNEL_CHECKPOINT_CORRUPT", { pageIndex: entry[0] });
    }
    return [entry[0], entry[1]];
  }).sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < pages.length; index += 1) {
    if (pages[index - 1][0] === pages[index][0]) throw checkpointError("Kernel checkpoint contains a duplicate page");
  }
  if (snapshot.snapshotKind === "full") {
    const expectedCount = Math.ceil(snapshot.regionBytes / PAGE_SIZE);
    if (pages.length !== expectedCount || pages.some((entry, index) => entry[0] !== index)) {
      throw checkpointError("Kernel full checkpoint does not cover its memory region");
    }
  }
  return pages;
}

export function packKernelMemoryImage(snapshot) {
  if (!snapshot || !["full", "delta"].includes(snapshot.snapshotKind)) {
    throw checkpointError("Kernel checkpoint snapshot kind is invalid");
  }
  for (const key of ["stackBoundary", "memoryBytes", "regionBytes", "initialPages", "currentPages", "deltaDepth"]) {
    safeUint32(snapshot[key], key);
  }
  if (snapshot.memoryBytes - snapshot.stackBoundary !== snapshot.regionBytes
    || snapshot.currentPages * PAGE_SIZE !== snapshot.memoryBytes) {
    throw checkpointError("Kernel checkpoint memory layout is inconsistent");
  }
  const pages = normalizePages(snapshot);
  let byteLength = IMAGE_HEADER_BYTES;
  for (const [, bytes] of pages) byteLength += 8 + bytes.byteLength;
  const packed = new Uint8Array(byteLength);
  const view = new DataView(packed.buffer);
  view.setUint32(0, IMAGE_MAGIC, true);
  view.setUint32(4, IMAGE_VERSION, true);
  view.setUint32(8, snapshot.snapshotKind === "full" ? 0 : 1, true);
  view.setUint32(12, snapshot.stackBoundary, true);
  view.setUint32(16, snapshot.memoryBytes, true);
  view.setUint32(20, snapshot.regionBytes, true);
  view.setUint32(24, PAGE_SIZE, true);
  view.setUint32(28, pages.length, true);
  let offset = IMAGE_HEADER_BYTES;
  for (const [pageIndex, bytes] of pages) {
    view.setUint32(offset, pageIndex, true);
    view.setUint32(offset + 4, bytes.byteLength, true);
    packed.set(bytes, offset + 8);
    offset += 8 + bytes.byteLength;
  }
  return packed;
}

export function unpackKernelMemoryImage(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < IMAGE_HEADER_BYTES) throw checkpointError("Kernel checkpoint image is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== IMAGE_MAGIC || view.getUint32(4, true) !== IMAGE_VERSION
    || view.getUint32(24, true) !== PAGE_SIZE) throw checkpointError("Kernel checkpoint image header is invalid");
  const kindCode = view.getUint32(8, true);
  if (kindCode > 1) throw checkpointError("Kernel checkpoint image kind is invalid");
  const snapshot = {
    snapshotKind: kindCode === 0 ? "full" : "delta",
    stackBoundary: view.getUint32(12, true),
    memoryBytes: view.getUint32(16, true),
    regionBytes: view.getUint32(20, true),
    pages: [],
  };
  if (snapshot.memoryBytes - snapshot.stackBoundary !== snapshot.regionBytes) {
    throw checkpointError("Kernel checkpoint image layout is inconsistent");
  }
  const count = view.getUint32(28, true);
  let offset = IMAGE_HEADER_BYTES;
  for (let index = 0; index < count; index += 1) {
    if (offset + 8 > bytes.byteLength) throw checkpointError("Kernel checkpoint page header is truncated");
    const pageIndex = view.getUint32(offset, true);
    const length = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + length > bytes.byteLength) throw checkpointError("Kernel checkpoint page is truncated");
    snapshot.pages.push([pageIndex, bytes.slice(offset, offset + length)]);
    offset += length;
  }
  if (offset !== bytes.byteLength) throw checkpointError("Kernel checkpoint image has trailing bytes");
  normalizePages(snapshot);
  return Object.freeze(snapshot);
}

function descriptorCore(descriptor) {
  return {
    protocol: descriptor.protocol,
    version: descriptor.version,
    engineId: descriptor.engineId,
    environmentId: descriptor.environmentId,
    kernelProtocol: descriptor.kernelProtocol,
    hostcallAbi: descriptor.hostcallAbi,
    memoryLayout: descriptor.memoryLayout,
    memoryImageRef: descriptor.memoryImageRef,
    memoryImageSha256: descriptor.memoryImageSha256,
    snapshotKind: descriptor.snapshotKind,
    deltaDepth: descriptor.deltaDepth,
    changedPages: descriptor.changedPages,
    vfsRootDigest: descriptor.vfsRootDigest,
    openResources: descriptor.openResources,
    executionCursor: descriptor.executionCursor,
    parentCheckpointRef: descriptor.parentCheckpointRef,
    createdAt: descriptor.createdAt,
  };
}

export async function sealKernelCheckpoint(snapshot, context) {
  const packed = packKernelMemoryImage(snapshot);
  const memoryImageSha256 = await sha256Address(packed);
  if (!context?.artifactStore || typeof context.artifactStore.put !== "function") {
    throw checkpointError("Kernel checkpoint requires an artifact store");
  }
  const stored = await context.artifactStore.put(packed, {
    mediaType: "application/x-pyproc-kernel-memory",
    sha256: memoryImageSha256,
  });
  const memoryImageRef = typeof stored === "string" ? stored : stored?.artifactRef;
  if (typeof memoryImageRef !== "string" || !memoryImageRef) {
    throw checkpointError("Kernel checkpoint artifact store returned no reference");
  }
  const core = {
    protocol: KERNEL_CHECKPOINT_PROTOCOL,
    version: KERNEL_CHECKPOINT_VERSION,
    engineId: context.engineId,
    environmentId: context.environmentId,
    kernelProtocol: 2,
    hostcallAbi: 1,
    memoryLayout: Object.freeze({
      initialPages: snapshot.initialPages,
      currentPages: snapshot.currentPages,
      stackBoundary: snapshot.stackBoundary,
    }),
    memoryImageRef,
    memoryImageSha256,
    snapshotKind: snapshot.snapshotKind,
    deltaDepth: snapshot.deltaDepth,
    changedPages: snapshot.changedPages,
    vfsRootDigest: context.vfsRootDigest ?? null,
    openResources: Object.freeze([...(context.openResources || [])]),
    executionCursor: context.executionCursor,
    parentCheckpointRef: context.parentCheckpointRef || null,
    createdAt: context.createdAt || new Date().toISOString(),
  };
  if (typeof core.engineId !== "string" || !core.engineId || typeof core.environmentId !== "string" || !core.environmentId) {
    throw incompatible("Kernel checkpoint engine and environment identity are required");
  }
  const digest = await sha256Address(JSON.stringify(core));
  return Object.freeze({ ...core, checkpointRef: `checkpoint:${parseSha256Address(digest)}`, digest });
}

export async function verifyKernelCheckpointDescriptor(descriptor, context, seen = new Set()) {
  if (!descriptor || descriptor.protocol !== KERNEL_CHECKPOINT_PROTOCOL || descriptor.version !== KERNEL_CHECKPOINT_VERSION) {
    throw checkpointError("Kernel checkpoint descriptor identity is invalid");
  }
  if (descriptor.engineId !== context.engineId || descriptor.environmentId !== context.environmentId
    || descriptor.kernelProtocol !== 2 || descriptor.hostcallAbi !== 1) {
    throw incompatible("Kernel checkpoint engine, environment, protocol, or ABI does not match", {
      expectedEngineId: context.engineId,
      actualEngineId: descriptor.engineId,
      expectedEnvironmentId: context.environmentId,
      actualEnvironmentId: descriptor.environmentId,
    });
  }
  if (seen.has(descriptor.checkpointRef)) throw checkpointError("Kernel checkpoint parent chain contains a cycle");
  seen.add(descriptor.checkpointRef);
  const expectedDigest = await sha256Address(JSON.stringify(descriptorCore(descriptor)));
  if (descriptor.digest !== expectedDigest || descriptor.checkpointRef !== `checkpoint:${parseSha256Address(expectedDigest)}`) {
    throw checkpointError("Kernel checkpoint descriptor digest does not match");
  }
  if (!context.artifactStore || typeof context.artifactStore.get !== "function") {
    throw checkpointError("Kernel checkpoint artifact store is unavailable");
  }
  let image;
  try { image = await context.artifactStore.get(descriptor.memoryImageRef); }
  catch (error) { throw checkpointError("Kernel checkpoint memory image is unavailable", "KERNEL_CHECKPOINT_CORRUPT", { cause: String(error) }); }
  const bytes = image instanceof Uint8Array ? image : new Uint8Array(image);
  if (await sha256Address(bytes) !== descriptor.memoryImageSha256) {
    throw checkpointError("Kernel checkpoint memory image digest does not match");
  }
  const unpacked = unpackKernelMemoryImage(bytes);
  if (unpacked.snapshotKind !== descriptor.snapshotKind
    || unpacked.stackBoundary !== descriptor.memoryLayout.stackBoundary
    || unpacked.memoryBytes !== descriptor.memoryLayout.currentPages * PAGE_SIZE
    || unpacked.pages.length !== descriptor.changedPages) {
    throw checkpointError("Kernel checkpoint image metadata does not match its descriptor");
  }
  let parent = null;
  if (descriptor.snapshotKind === "delta") {
    if (typeof descriptor.parentCheckpointRef !== "string" || typeof context.resolveParent !== "function") {
      throw checkpointError("Kernel delta checkpoint has no resolvable parent");
    }
    parent = await context.resolveParent(descriptor.parentCheckpointRef);
    if (!parent) throw checkpointError("Kernel delta checkpoint parent is unavailable");
    await verifyKernelCheckpointDescriptor(parent, context, seen);
    if (parent.memoryLayout.stackBoundary !== descriptor.memoryLayout.stackBoundary
      || parent.memoryLayout.currentPages !== descriptor.memoryLayout.currentPages
      || descriptor.deltaDepth !== parent.deltaDepth + 1) {
      throw checkpointError("Kernel delta checkpoint parent layout or depth does not match");
    }
  } else if (descriptor.deltaDepth !== 0) {
    throw checkpointError("Kernel full checkpoint has a nonzero delta depth");
  }
  return Object.freeze({ descriptor, image: unpacked, parent });
}

export async function materializeKernelCheckpoint(descriptor, context) {
  const verified = await verifyKernelCheckpointDescriptor(descriptor, context);
  const output = verified.parent
    ? await materializeKernelCheckpoint(verified.parent, context)
    : new Uint8Array(verified.image.regionBytes);
  if (output.byteLength !== verified.image.regionBytes) {
    throw checkpointError("Kernel checkpoint materialized parent size does not match");
  }
  for (const [pageIndex, bytes] of verified.image.pages) output.set(bytes, pageIndex * PAGE_SIZE);
  return output;
}
