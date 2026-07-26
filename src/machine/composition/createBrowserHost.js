// createBrowserHost.js - Layer 5/composition: browser crypto를 core의 ID 공급 계약으로 변환한다.
import { WebMachineHost } from "../host/webMachineHost.js";

export function createBrowserHost({ devices = {}, cryptoProvider } = {}) {
  if (!cryptoProvider || typeof cryptoProvider.randomUUID !== "function") {
    throw new TypeError("cryptoProvider.randomUUID is required");
  }
  return new WebMachineHost({
    devices,
    idFactory: () => cryptoProvider.randomUUID(),
  });
}
