// createBrowserHost.js - browser crypto를 core의 ID 공급 계약으로 변환한다.
import { WebMachineHost } from "@web-machine/core";

export function createBrowserHost({ devices = {}, cryptoProvider } = {}) {
  if (!cryptoProvider || typeof cryptoProvider.randomUUID !== "function") {
    throw new TypeError("cryptoProvider.randomUUID가 필요하다");
  }
  return new WebMachineHost({
    devices,
    idFactory: () => cryptoProvider.randomUUID(),
  });
}
