// v86WasmHostBridge.js - v86의 공식 wasm_fn import 경계에 공통 host device를 주입한다.
export function createV86WasmHostFunction({ instantiateWasm, clockPort = null, entropyPort = null }) {
  if (typeof instantiateWasm !== "function") throw new TypeError("instantiateWasm 함수가 필요하다");
  if (!clockPort && !entropyPort) throw new TypeError("clockPort 또는 entropyPort가 필요하다");
  if (clockPort && typeof clockPort.microtick !== "function") throw new TypeError("clockPort.microtick 함수가 필요하다");
  if (entropyPort && typeof entropyPort.getRandInt !== "function") throw new TypeError("entropyPort.getRandInt 함수가 필요하다");

  return async (imports) => {
    if (!imports?.env || typeof imports.env !== "object") throw new TypeError("v86 WASM env import가 필요하다");
    const env = { ...imports.env };
    if (clockPort) env.microtick = clockPort.microtick;
    if (entropyPort) env.get_rand_int = entropyPort.getRandInt;
    return instantiateWasm({ ...imports, env });
  };
}
