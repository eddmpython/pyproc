// runtimeApi.js - Layer 2 합성 루트: core Runtime에 opt-in capability registry를 설치하고
// public Runtime 표면을 낸다. 아무도 이 파일을 import하지 않는다(index.js와 pyproc/runtime
// subpath가 진입점). 그래서 아래층이 위층을 부르는 edge가 생기지 않는다.
import { boot, Runtime, DEFAULT_INDEX, ensureEngineScript } from "../runtime/runtime.js";
import { MemoryCapability, PAGE_SIZE } from "../runtime/memoryCapability.js";
import { FileSystem } from "../runtime/fileSystem.js";
import { installRuntimeCapabilityBindings } from "./runtimeBindings.js";

export function installRuntimeCapabilities(RuntimeClass = Runtime) {
  return installRuntimeCapabilityBindings(RuntimeClass);
}

installRuntimeCapabilities();

export { boot, Runtime, DEFAULT_INDEX, ensureEngineScript, MemoryCapability, PAGE_SIZE, FileSystem };
export { checkEnvironment } from "../runtime/preflight.js";
