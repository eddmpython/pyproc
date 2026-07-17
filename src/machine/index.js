// machine - 브라우저를 여러 guest OS가 올라가는 컴퓨터로 만드는 층. pyproc의 최상층이다.
//
// 옛 @web-machine/{core,browser,guest-pyproc,guest-v86} 4개 private package를 한 폴더로 들였다.
// 벽(패키지 경계)은 없어지고 불변식은 남는다: contracts/host는 엔진·브라우저를 모르고,
// devices/persistence만 브라우저 전역을 만지며, 게스트 주입은 composition 한 점에서만 한다.
// 소비자는 이 배럴(pyproc/machine) 또는 루트 표면의 createWebComputer만 쓴다.

// 계약과 호스트 (엔진·브라우저 모름)
export { WebMachineError } from "./contracts/webMachineError.js";
export { operationAbortError, throwIfOperationAborted } from "./contracts/operationControl.js";
export { WebMachineHost } from "./host/webMachineHost.js";
export { MachineHandle } from "./host/machineHandle.js";

// 이미지: 스냅샷 봉투, 매니페스트, .webmachine 파일, 서명
export {
  asSnapshotBytes,
  createSnapshotEnvelope,
  isSnapshotScope,
  validateSnapshotEnvelope,
} from "./image/snapshotEnvelope.js";
export {
  WEB_MACHINE_FORMAT,
  WEB_MACHINE_SCHEMA_VERSION,
  createWebMachineManifest,
  createWebMachineManifestContent,
  getWebMachineManifestContent,
  validateWebMachineManifest,
} from "./image/machineManifest.js";
export { assertWebMachineArchive, createWebMachineFile, readWebMachineFile } from "./image/webMachineFile.js";
export {
  createWebMachineKeyPair,
  exportWebMachinePublicKey,
  fingerprintWebMachinePublicKey,
} from "./image/webMachineTrust.js";
export { MachineEnvelopeCoordinator } from "./image/machineEnvelopeCoordinator.js";

// 장치
export { BrowserClockDevice } from "./devices/browserClockDevice.js";
export { BrowserEntropyDevice } from "./devices/browserEntropyDevice.js";
export { CanvasRgbaFrameSource } from "./devices/canvasRgbaFrameSource.js";
export { MemoryBlockDevice } from "./devices/memoryBlockDevice.js";
export { MemoryEthernetSwitch } from "./devices/memoryEthernetSwitch.js";
export { MemoryRelativePointerDevice } from "./devices/memoryRelativePointerDevice.js";
export { MemoryRgbaDisplayDevice } from "./devices/memoryRgbaDisplayDevice.js";
export { MemoryScanCodeInputDevice } from "./devices/memoryScanCodeInputDevice.js";
export { MemoryTextDisplayDevice } from "./devices/memoryTextDisplayDevice.js";

// 지속성과 소유권
export { IndexedDbMachineStore } from "./persistence/indexedDbMachineStore.js";
export { MemoryMachineStore } from "./persistence/memoryMachineStore.js";
export { MachineCommitCoordinator } from "./persistence/machineCommitCoordinator.js";
export { WebLockOwnerCoordinator, webMachineOwnerLockName } from "./coordination/webLockOwnerCoordinator.js";

// 게스트 어댑터와 조립
export { createPyprocGuestFactory } from "./guests/pyprocGuestAdapter.js";
export { createV86GuestFactory } from "./guests/v86GuestAdapter.js";
export { createBrowserHost } from "./composition/createBrowserHost.js";
export { createWebComputer, WEB_COMPUTER_MACHINE_IDS } from "./composition/createWebComputer.js";
