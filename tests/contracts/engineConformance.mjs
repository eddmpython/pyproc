import {
  ENGINE_CAPABILITIES,
  assertEngineContract,
  engineCapabilities,
} from "../../src/runtime/engineContract.js";

export async function assertEngineConformance(candidate, probes = {}) {
  const engine = assertEngineContract(candidate);
  const capabilities = engineCapabilities(engine);

  for (const required of [
    ENGINE_CAPABILITIES.execution,
    ENGINE_CAPABILITIES.hostValues,
    ENGINE_CAPABILITIES.memory,
  ]) {
    if (!capabilities.has(required)) throw new Error(`EngineContract 필수 capability 누락: ${required}`);
  }

  const fallback = Object.freeze({ contractFallback: true });
  if (engine.toHostValue(undefined, { fallback }) !== fallback) {
    throw new Error("EngineContract hostValues fallback 의미 불일치");
  }
  const heap = engine.heapU8();
  if (!(heap instanceof Uint8Array)) throw new Error("EngineContract heapU8()가 Uint8Array가 아니다");
  const sp = engine.stackSave();
  engine.stackRestore(sp);

  if (probes.sync) await probes.sync(engine);
  if (probes.async) await probes.async(engine);
  return engine;
}
