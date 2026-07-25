import { Runtime } from "../../src/runtime/runtime.js";
import {
  ENGINE_CAPABILITIES,
  ENGINE_CONTRACT_VERSION,
  assertEngineContract,
} from "../../src/runtime/engineContract.js";
import { assertRuntimeContract } from "../../src/runtime/runtimeContract.js";
import { WasiSession } from "../../src/runtime/engines/wasi/wasiSession.js";

function fakeEngine() {
  const heap = new Uint8Array(65536);
  return {
    engineContractVersion: ENGINE_CONTRACT_VERSION,
    engineKind: "fake",
    capabilities: () => [
      ENGINE_CAPABILITIES.execution,
      ENGINE_CAPABILITIES.hostValues,
      ENGINE_CAPABILITIES.memory,
    ],
    runSync: (code) => code,
    runAsync: async (code) => code,
    setGlobal() {},
    getGlobal: () => null,
    toHostValue: (value, opts = {}) => value === undefined && "fallback" in opts ? opts.fallback : value,
    destroyHostValue() {},
    heapU8: () => heap,
    stackSave: () => null,
    stackRestore() {},
  };
}

export async function assertRuntimeContracts() {
  const engine = assertEngineContract(fakeEngine());
  const runtime = new Runtime(engine);
  assertRuntimeContract(runtime);
  assertRuntimeContract(Object.create(WasiSession.prototype));
  let invalid = false;
  try { assertEngineContract({ ...fakeEngine(), capabilities: undefined }); }
  catch (error) { invalid = error?.code === "PYPROC_INPUT_INVALID"; }
  if (!invalid) throw new Error("불완전 EngineContract를 거부하지 않았다");
  let unsupported = false;
  try { await runtime.loadPackages(["numpy"]); }
  catch (error) { unsupported = error?.code === "PYPROC_ENV_UNSUPPORTED"; }
  if (!unsupported) throw new Error("미지원 capability가 명시 오류로 수렴하지 않았다");
  return true;
}
