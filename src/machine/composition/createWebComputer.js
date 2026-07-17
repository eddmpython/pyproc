// createWebComputer.js - 컴퓨터 한 대의 배선. pyproc의 최상단 조립 지점이다.
//
// 여기 오기 전까지 이 조립은 제품 앱(apps/webComputer) 안에 살았고, npm으로 받은 소비자는
// 재현할 방법이 없었다. 이제 조립이 공개 표면이고 앱은 이 함수의 소비자다.
//
// 게스트 정책:
// - python: 기본 탑재. pyproc 자신이 엔진이므로 주입 없이 즉시 부팅한다.
// - linux: V86 constructor를 주입할 때만 등록한다. third-party binary를 package에 싣지
//   않는 provenance 정책(docs/operations/assetProvenance.md 결정 1)이 그대로 산다.
import { bootSession, openMachine } from "../../session/session.js";
import { WebMachineError } from "../contracts/webMachineError.js";
import { createBrowserHost } from "./createBrowserHost.js";
import { createPyprocGuestFactory } from "../guests/pyprocGuestAdapter.js";
import { createV86GuestFactory } from "../guests/v86GuestAdapter.js";
import { MemoryBlockDevice } from "../devices/memoryBlockDevice.js";
import { MemoryScanCodeInputDevice } from "../devices/memoryScanCodeInputDevice.js";
import { MemoryTextDisplayDevice } from "../devices/memoryTextDisplayDevice.js";

// 기본 디스크 크기. 출처: 제품 실측 상수(apps/webComputer/machineConfig.js의 2MiB)와 동일값.
const DEFAULT_DISK_BYTES = 2 * 1024 * 1024;

export const WEB_COMPUTER_MACHINE_IDS = Object.freeze(["pythonOs", "linuxOs"]);

// 컴퓨터 한 대를 조립한다. 반환값은 host/장치/머신과 수명주기 제어다.
// python은 항상 만들어지고, linux는 options.linux.V86이 주입될 때만 만들어진다.
export function createWebComputer({
  python = {},
  linux = null,
  devices: extraDevices = {},
  onConsole = null,
  cryptoProvider = globalThis.crypto,
  // false면 하드웨어(장치+host+어댑터)만 조립한다. .webmachine import 같은 복원 경로는
  // 머신을 image manifest가 만들므로 기본 머신을 미리 만들면 machineId가 충돌한다.
  createMachines = true,
} = {}) {
  const pythonDisk = new MemoryBlockDevice({ byteLength: python.diskBytes ?? DEFAULT_DISK_BYTES });
  const builtInDevices = { pythonDisk };
  if (linux) {
    builtInDevices.linuxDisk = new MemoryBlockDevice({ byteLength: linux.diskBytes ?? DEFAULT_DISK_BYTES });
    builtInDevices.display = new MemoryTextDisplayDevice();
    builtInDevices.input = new MemoryScanCodeInputDevice({ maxBatchBytes: 512, maxQueuedBatches: 32 });
  }
  const devices = {
    console: {
      kind: "console",
      write: (line) => { onConsole?.(String(line)); },
    },
    ...builtInDevices,
    ...extraDevices,
  };

  const host = createBrowserHost({ devices, cryptoProvider });
  host.registerAdapter("pyproc-block", createPyprocGuestFactory({
    bootSession: python.bootSession ?? bootSession,
    openMachine: python.openMachine ?? openMachine,
    blockDeviceName: "pythonDisk",
  }));
  if (linux) {
    if (typeof linux.V86 !== "function") throw new TypeError("linux.V86 constructor가 필요하다");
    host.registerAdapter("x86-linux", createV86GuestFactory({
      V86: linux.V86,
      ...(linux.adapterVersion ? { adapterVersion: linux.adapterVersion } : {}),
      blockDeviceName: "linuxDisk",
      blockMode: "filesystem",
      displayDeviceName: "display",
      inputDeviceName: "input",
      ...(linux.adapterOptions || {}),
    }));
  }

  const machines = new Map();
  if (createMachines) machines.set("pythonOs", host.createMachine({
    machineId: "pythonOs",
    adapterId: "pyproc-block",
    manifest: python.manifest ?? { session: { ...(python.session || {}) } },
    permissions: { devices: ["console", "pythonDisk"] },
  }));
  if (createMachines && linux) {
    if (!linux.manifest) throw new TypeError("linux.manifest가 필요하다(부팅 자산은 소비자가 provenance와 함께 가져온다)");
    machines.set("linuxOs", host.createMachine({
      machineId: "linuxOs",
      adapterId: "x86-linux",
      manifest: linux.manifest,
      permissions: { devices: ["console", "linuxDisk", "display", "input"] },
    }));
  }

  const machine = (machineId) => {
    const found = machines.get(machineId);
    if (!found) throw new WebMachineError("WEB_MACHINE_UNAVAILABLE", `Machine is not available: ${machineId}`);
    return found;
  };
  const runningMachineIds = () => [...machines.values()]
    .filter((m) => m.state === "running")
    .map((m) => m.machineId);

  return Object.freeze({
    host,
    devices,
    machines,
    machine,
    runningMachineIds,
    async bootAll(control) {
      await Promise.all([...machines.values()].map((m) => m.boot(control)));
    },
    // 실행 중인 머신만 순서대로 멈춘다. 중간 실패 시 이미 멈춘 것들을 되살리고 던진다
    // (절반만 멈춘 컴퓨터를 남기지 않는다).
    async pauseRunning(control) {
      const runningIds = runningMachineIds();
      const pausedIds = [];
      try {
        for (const machineId of runningIds) {
          await machine(machineId).pause(control);
          pausedIds.push(machineId);
        }
      } catch (error) {
        await this.resumeMachineIds(pausedIds).catch(() => undefined);
        throw error;
      }
      return runningIds;
    },
    async resumeMachineIds(machineIds, control) {
      await Promise.all(machineIds.map((machineId) => {
        const found = machine(machineId);
        return found.state === "paused" ? found.resume(control) : undefined;
      }));
    },
    async resumeAll(control) {
      await this.resumeMachineIds(
        [...machines.values()].filter((m) => m.state === "paused").map((m) => m.machineId),
        control,
      );
    },
    async shutdownAll(control) {
      await Promise.all([...machines.values()]
        .filter((m) => m.state !== "stopped")
        .map((m) => m.shutdown(control)));
    },
    adoptOwnership(token) {
      for (const m of machines.values()) m.adoptOwnership(token);
    },
    invalidateOwnership(reason) {
      for (const m of machines.values()) m.invalidateOwnership(reason);
    },
  });
}
