// @web-machine/core 공개 표면.
export { WebMachineError } from "./src/contracts/webMachineError.js";
export { operationAbortError, throwIfOperationAborted } from "./src/contracts/operationControl.js";
export { WebMachineHost } from "./src/host/webMachineHost.js";
export { MachineHandle } from "./src/host/machineHandle.js";
export {
  asSnapshotBytes,
  createSnapshotEnvelope,
  isSnapshotScope,
  validateSnapshotEnvelope,
} from "./src/image/snapshotEnvelope.js";
export {
  WEB_MACHINE_FORMAT,
  WEB_MACHINE_SCHEMA_VERSION,
  createWebMachineManifest,
  createWebMachineManifestContent,
  getWebMachineManifestContent,
  validateWebMachineManifest,
} from "./src/image/machineManifest.js";
