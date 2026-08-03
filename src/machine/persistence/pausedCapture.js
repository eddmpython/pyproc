// pausedCapture.js - Layer 5/platform: 멈춘 컴퓨터의 상태를 바이트로 굳히는 공통 절차.
//
// 두 소비자가 같은 일을 목적지만 달리해서 한다: 내부 CAS 세대로 커밋하거나(commit coordinator)
// 이동 가능한 이미지로 내보내거나(envelope coordinator). 그 공통 절차가 두 벌로 복사돼 있었고
// 이미 갈라지기 시작했다(장치 스냅샷의 kind/byteLength를 한쪽은 meta에, 다른 쪽은 최상위에 실었다).
//
// 오류 코드는 호출자가 주입한다. 두 도메인의 어휘를 여기서 하나로 합치면 공개 코드가 조용히
// 바뀐다(WEB_MACHINE_IMAGE_EXPORT_STATE와 WEB_MACHINE_COMMIT_STATE는 다른 사실을 말한다).
import { throwIfOperationAborted } from "../contracts/operationControl.js";
import { WebMachineError } from "../contracts/webMachineError.js";
import { compareNames } from "../contracts/deterministicOrder.js";

export function sortedMachines(machines) {
  return [...machines].sort((left, right) => compareNames(left.machineId, right.machineId));
}

export function sortedDevices(devices) {
  return Object.entries(devices || {}).sort(([left], [right]) => compareNames(left, right));
}

// 정렬 -> 빈 목록 거부 -> 전원 paused 확인 -> 장치 정렬 -> block 계약 확인.
export function assertPausedComputer({ machines, devices, stateCode, stateVerb, deviceKindCode, deviceInvalidCode }) {
  const machineList = sortedMachines(machines || []);
  if (!machineList.length) throw new TypeError("machines are required");
  for (const machine of machineList) {
    if (machine.state !== "paused") {
      throw new WebMachineError(stateCode, `${machine.machineId}: only a paused machine can be ${stateVerb}`);
    }
  }
  const deviceEntries = sortedDevices(devices);
  for (const [name, device] of deviceEntries) assertBlockDevice(name, device, deviceKindCode, deviceInvalidCode);
  return { machineList, deviceEntries };
}

export function assertBlockDevice(name, device, kindCode, invalidCode) {
  if (!device || device.kind !== "block") throw new WebMachineError(kindCode, `${name}: a block device is required`);
  for (const method of ["flush", "snapshot", "restore"]) {
    if (typeof device[method] !== "function") throw new WebMachineError(invalidCode, `${name}: ${method}() is missing`);
  }
}

// flush 뒤 머신과 장치의 스냅샷을 병렬로 뜬다. 장치 스냅샷의 모양은 호출자가 정한다:
// 두 도메인이 실을 필드가 다르고, 그 차이를 여기서 합치면 공개 payload가 바뀐다.
export async function capturePaused({ machineList, deviceEntries, control, label, deviceShape }) {
  await Promise.all(deviceEntries.map(([, device]) => device.flush()));
  throwIfOperationAborted(control, label);
  const [machineSnapshots, deviceSnapshots] = await Promise.all([
    Promise.all(machineList.map((machine) => machine.snapshot(control))),
    Promise.all(deviceEntries.map(async ([name, device]) => deviceShape(name, device, await device.snapshot()))),
  ]);
  throwIfOperationAborted(control, label);
  return { machineSnapshots, deviceSnapshots };
}
