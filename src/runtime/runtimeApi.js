// runtimeApi.js - public Runtime 표면: core Runtime에 opt-in capability registry를 설치한다.
// runtime.js는 엔진 core만 담당하고, capability class 목록은 capabilities 레이어가 담당한다.
import { boot, Runtime, DEFAULT_INDEX, ensureEngineScript } from "./runtime.js";
import { MemoryCapability, PAGE_SIZE } from "./memoryCapability.js";
import { FileSystem } from "./fileSystem.js";
import { installRuntimeCapabilityBindings } from "../capabilities/runtimeBindings.js";

export function installRuntimeCapabilities(RuntimeClass = Runtime) {
  return installRuntimeCapabilityBindings(RuntimeClass);
}

installRuntimeCapabilities();

export { boot, Runtime, DEFAULT_INDEX, ensureEngineScript, MemoryCapability, PAGE_SIZE, FileSystem };
export { checkEnvironment } from "./preflight.js";
