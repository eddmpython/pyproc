// adapterContract.js - adapter의 필수 동작과 보장 수준을 host 형식으로 정규화한다.
import { WebMachineError } from "./webMachineError.js";
import { isSnapshotScope } from "../image/snapshotEnvelope.js";

const requiredMethods = Object.freeze(["boot", "pause", "resume", "snapshot", "restore", "shutdown", "request", "inspect"]);

function copyRequirement(value) {
  if (!value || typeof value !== "object") return {};
  return { ...value };
}

export function instantiateAdapter(adapterId, factory) {
  const adapter = factory();
  if (!adapter || typeof adapter !== "object") {
    throw new WebMachineError("WEB_MACHINE_ADAPTER_INVALID", `${adapterId}: adapter object가 아니다`);
  }
  for (const method of requiredMethods) {
    if (typeof adapter[method] !== "function") {
      throw new WebMachineError("WEB_MACHINE_ADAPTER_INVALID", `${adapterId}: ${method}() 없음`);
    }
  }
  const snapshotScope = String(adapter.capabilities?.snapshotScope || "none");
  if (!isSnapshotScope(snapshotScope)) {
    throw new WebMachineError("WEB_MACHINE_ADAPTER_INVALID", `${adapterId}: snapshotScope ${snapshotScope} 미지원`);
  }
  const requiredDevices = Object.freeze(
    (Array.isArray(adapter.capabilities?.requiredDevices) ? adapter.capabilities.requiredDevices : []).map((entry) => Object.freeze(copyRequirement(entry))),
  );
  const capabilities = Object.freeze({
    adapterVersion: String(adapter.capabilities?.adapterVersion || "0"),
    snapshotScope,
    pauseMode: String(adapter.capabilities?.pauseMode || "cooperative"),
    shutdownMode: String(adapter.capabilities?.shutdownMode || "terminate"),
    requiredDevices,
  });
  return { adapter, capabilities };
}
