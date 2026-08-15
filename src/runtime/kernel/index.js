// index.js - Layer 0: CPython WASI kernel contract barrel.
export {
  KERNEL_ENGINE_MANIFEST_PROTOCOL,
  KERNEL_ENGINE_MANIFEST_VERSION,
  MemoryKernelAssetStore,
  createKernelEngineManifest,
  verifyKernelEngineManifest,
} from "./engineManifest.js";
export {
  CpythonWasiKernelRuntime,
  bootCpythonWasiKernel,
} from "./cpythonWasiKernel.js";
export {
  KERNEL_RUNTIME_CONTRACT_VERSION,
  KERNEL_RUNTIME_KIND,
  KERNEL_RUNTIME_METHODS,
  assertKernelRuntimeContract,
} from "./kernelRuntimeContract.js";
export {
  VALUE_ENVELOPE_PROTOCOL,
  VALUE_ENVELOPE_VERSION,
  DEFAULT_VALUE_LIMITS,
  MemoryValueArtifactStore,
  assertValueEnvelope,
  canonicalValueEnvelope,
  decodeValueEnvelope,
  digestValueEnvelope,
  encodeValueEnvelope,
} from "./valueEnvelope.js";
export {
  APPLICATION_REFERENCE_PROTOCOL,
  APPLICATION_REFERENCE_VERSION,
  ApplicationReferenceTable,
  assertApplicationReference,
  createApplicationReference,
} from "./applicationReference.js";
export {
  KERNEL_CHECKPOINT_PROTOCOL,
  KERNEL_CHECKPOINT_VERSION,
  materializeKernelCheckpoint,
  packKernelMemoryImage,
  sealKernelCheckpoint,
  unpackKernelMemoryImage,
  verifyKernelCheckpointDescriptor,
} from "./kernelCheckpoint.js";
export { KernelReactiveController } from "./kernelReactiveController.js";
export {
  KERNEL_VFS_ROOT_PROTOCOL,
  KERNEL_VFS_ROOT_VERSION,
  KernelDeviceRegistry,
  KernelVfs,
  MemoryKernelVfsStore,
  OpfsKernelVfsStore,
} from "./kernelVfs.js";
export {
  HOSTCALL_ABI_VERSION,
  HOSTCALL_CONTROL_WORDS,
  HOSTCALL_DATA_BYTES,
  HOSTCALL_ERROR,
  HOSTCALL_FLAG,
  HOSTCALL_MAGIC,
  HOSTCALL_OPCODE,
  HOSTCALL_PATH,
  HOSTCALL_REQUEST_HEADER_BYTES,
  HOSTCALL_RESPONSE_HEADER_BYTES,
  HOSTCALL_STREAM_MAX_CREDIT,
  HOSTCALL_STATE,
  HOSTCALL_WORD,
  assertHostcallControl,
  createHostcallSharedState,
  hostcallRequestId,
  hostcallTerminalState,
} from "./hostcallProtocol.js";
