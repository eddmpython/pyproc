import {
  RUNTIME_CAPABILITY_CLUSTERS,
  installRuntimeCapabilityBindings,
} from "../../src/composition/runtimeBindings.js";

const EXPECTED_CLUSTERS = ["state", "service", "environment"];
const EXPECTED_BINDINGS = [
  "enableReactive",
  "enableJournal",
  "enableSyscallBridge",
  "enableAsgiServer",
  "enableVirtualOrigin",
  "enableTerminal",
  "enableWheelCache",
  "enableDeviceFs",
  "enableInit",
];

export function assertRuntimeCapabilityClusters() {
  const clusterIds = RUNTIME_CAPABILITY_CLUSTERS.map((cluster) => cluster.id);
  if (clusterIds.join(",") !== EXPECTED_CLUSTERS.join(",")) {
    throw new Error(`Runtime capability cluster 표류: ${clusterIds.join(",")}`);
  }

  const names = RUNTIME_CAPABILITY_CLUSTERS.flatMap((cluster) => Object.keys(cluster.bindings));
  if (new Set(names).size !== names.length) {
    throw new Error("Runtime capability binding 이름 충돌");
  }
  for (const name of EXPECTED_BINDINGS) {
    if (!names.includes(name)) throw new Error(`Runtime capability binding 누락: ${name}`);
  }

  class ContractRuntime {}
  installRuntimeCapabilityBindings(ContractRuntime);
  installRuntimeCapabilityBindings(ContractRuntime);
  for (const name of EXPECTED_BINDINGS) {
    if (typeof ContractRuntime.prototype[name] !== "function") {
      throw new Error(`Runtime prototype binding 설치 실패: ${name}`);
    }
  }
  return true;
}
