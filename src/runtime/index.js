// pyproc/runtime - 자체 부팅 Pyodide 채택과 엔진 계약을 위한 안정 subpath.
// root의 머신 porcelain과 분리해 Runtime 값을 실제로 import해야 하는 소비자만 사용한다.
// 루트의 boot는 머신 핸들을 준다. 같은 이름으로 Runtime을 주면 두 공개 boot가 반환형만 다른
// 채로 공존해서, IDE가 어느 문서를 보여주는지에 채택이 걸린다. 그래서 여기서는 이름을 나눈다.
export {
  boot as bootRuntime,
  Runtime,
  DEFAULT_INDEX,
  ensureEngineScript,
} from "./runtime.js";
export {
  MemoryCapability,
  PAGE_SIZE,
} from "./memoryCapability.js";
export {
  FileSystem,
} from "./fileSystem.js";
export { checkEnvironment } from "./preflight.js";
export {
  ENGINE_CONTRACT_VERSION,
  ENGINE_CAPABILITIES,
  assertEngineContract,
  engineCapabilities,
  hasEngineCapability,
  requireEngineCapability,
} from "./engineContract.js";
export {
  RUNTIME_CONTRACT_VERSION,
  RUNTIME_CAPABILITIES,
  assertRuntimeContract,
} from "./runtimeContract.js";
