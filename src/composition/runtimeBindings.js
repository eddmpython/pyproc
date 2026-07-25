// runtimeBindings.js - Layer 2 조립: capability cluster registry 설치기.
// 중앙 파일은 capability class를 직접 알지 않는다. 각 cluster가 생성 규칙을 소유하고,
// 이 파일은 cluster 병합, 이름 충돌 차단, Runtime prototype 설치만 담당한다.
import { PyProcError } from "../runtime/errors.js";
import { ENVIRONMENT_RUNTIME_BINDINGS } from "./runtimeBindings/environmentBindings.js";
import { SERVICE_RUNTIME_BINDINGS } from "./runtimeBindings/serviceBindings.js";
import { STATE_RUNTIME_BINDINGS } from "./runtimeBindings/stateBindings.js";

const RUNTIME_CAPABILITY_BINDINGS = Symbol.for("pyproc.runtimeCapabilityBindings");

export const RUNTIME_CAPABILITY_CLUSTERS = Object.freeze([
  Object.freeze({ id: "state", bindings: STATE_RUNTIME_BINDINGS }),
  Object.freeze({ id: "service", bindings: SERVICE_RUNTIME_BINDINGS }),
  Object.freeze({ id: "environment", bindings: ENVIRONMENT_RUNTIME_BINDINGS }),
]);

function collectBindingDescriptors(clusters) {
  const descriptors = {};
  for (const cluster of clusters) {
    for (const [name, descriptor] of Object.entries(cluster.bindings)) {
      if (Object.prototype.hasOwnProperty.call(descriptors, name)) {
        throw new PyProcError(
          "PYPROC_INPUT_INVALID",
          `Runtime capability binding 중복: ${name} (${cluster.id})`,
        );
      }
      descriptors[name] = descriptor;
    }
  }
  return descriptors;
}

const RUNTIME_BINDING_DESCRIPTORS = Object.freeze(
  collectBindingDescriptors(RUNTIME_CAPABILITY_CLUSTERS),
);

export function installRuntimeCapabilityBindings(RuntimeClass) {
  const proto = RuntimeClass.prototype;
  if (proto[RUNTIME_CAPABILITY_BINDINGS]) return RuntimeClass;
  Object.defineProperties(proto, {
    [RUNTIME_CAPABILITY_BINDINGS]: { value: true },
    ...RUNTIME_BINDING_DESCRIPTORS,
  });
  return RuntimeClass;
}
