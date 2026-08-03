// v86WasmHostBridge.js - Layer 5/guests: v86의 공식 wasm_fn import 경계에 공통 host device를 주입한다.
export function createV86WasmHostFunction({ instantiateWasm, clockPort = null, entropyPort = null }) {
  if (typeof instantiateWasm !== "function") throw new TypeError("an instantiateWasm function is required");
  if (!clockPort && !entropyPort) throw new TypeError("a clockPort or an entropyPort is required");
  if (clockPort && typeof clockPort.microtick !== "function") throw new TypeError("a clockPort.microtick function is required");
  if (entropyPort && typeof entropyPort.getRandInt !== "function") throw new TypeError("an entropyPort.getRandInt function is required");

  return async (imports) => {
    if (!imports?.env || typeof imports.env !== "object") throw new TypeError("a v86 WASM env import is required");
    const env = { ...imports.env };
    if (clockPort) env.microtick = clockPort.microtick;
    if (entropyPort) env.get_rand_int = entropyPort.getRandInt;
    return instantiateWasm({ ...imports, env });
  };
}
