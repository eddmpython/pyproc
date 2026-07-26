// deviceRequirement.js - Layer 5/pure: guest가 요구하는 장치의 해석 법. 순수 함수, 의존은 오류 계약뿐.
//
// 왜 한 곳인가: 예전에는 같은 요구가 두 형태로 살았다. adapter는 `capabilities.requiredDevices`로
// 선언하고(host가 그걸 읽어 allowlist를 검사한다), 그 다음 같은 요구를 어댑터 안에서 명령형으로
// 다시 검사했다(어댑터 하나에 최대 8벌). 그리고 이미 갈라져 있었다: 선언은
// `{kind:"network", mode:"packet"}`인데 명령형 검사는 `connect` 함수까지 요구해서, host가 아는
// 요구와 실제 요구가 달랐다. 선언이 유일 진실이 되려면 메서드 요구도 선언에 실려야 한다.
import { WebMachineError } from "./webMachineError.js";

// requirement: { name, kind, mode?, methods? }. devices: host가 넘긴 frozen context의 장치 맵.
// 실패는 전부 WEB_MACHINE_DEVICE_MISSING이다(guest가 못 도는 이유는 하나로 읽힌다).
export function resolveRequiredDevice(devices, requirement, label = "guest") {
  if (!requirement || typeof requirement !== "object" || !requirement.name) {
    throw new WebMachineError("WEB_MACHINE_DEVICE_MISSING", `${label}: resolving a device with no declared requirement`);
  }
  const device = devices?.[requirement.name];
  const missing = (why) => {
    throw new WebMachineError("WEB_MACHINE_DEVICE_MISSING", `${label}: ${requirement.name} ${why}`);
  };
  if (!device) missing("장치가 없다");
  if (requirement.kind && device.kind !== requirement.kind) missing(`kind 불일치(${device.kind} != ${requirement.kind})`);
  if (requirement.mode && device.mode !== requirement.mode) missing(`mode 불일치(${device.mode} != ${requirement.mode})`);
  for (const method of requirement.methods || []) {
    if (typeof device[method] !== "function") missing(`${method}() 없음`);
  }
  return device;
}

// 선언 목록을 이름으로 색인한다. 어댑터는 이 색인으로만 장치를 해석한다(선언 밖 해석 0).
export function indexRequirements(requiredDevices) {
  const byName = new Map();
  for (const requirement of requiredDevices || []) {
    if (requirement && requirement.name) byName.set(String(requirement.name), requirement);
  }
  return byName;
}
