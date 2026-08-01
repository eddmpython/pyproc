// pyprocGuestAdapter.js - Layer 5/guests: 주입된 공개 pyproc surface를 공통 guest 계약으로 변환한다.
import { WebMachineError } from "../contracts/webMachineError.js";
import { throwIfOperationAborted } from "../contracts/operationControl.js";
import { readPyprocHomeVolume, writePyprocHomeVolume } from "./pyprocHomeVolume.js";
import { indexRequirements, resolveRequiredDevice } from "../contracts/deviceRequirement.js";
import { PyprocPacketPort } from "./pyprocPacketPort.js";

function consoleWrite(context, message) {
  context.devices.console?.write?.(String(message));
}

export function createPyprocGuestFactory({ bootSession, openMachine, blockDeviceName = null, packetDeviceName = null } = {}) {
  if (typeof bootSession !== "function") throw new TypeError("a bootSession function is required");
  if (typeof openMachine !== "function") throw new TypeError("an openMachine function is required");
  return () => new PyprocGuestAdapter({ bootSession, openMachine, blockDeviceName, packetDeviceName });
}

class PyprocGuestAdapter {
  constructor({ bootSession, openMachine, blockDeviceName, packetDeviceName }) {
    this._bootSession = bootSession;
    this._openMachine = openMachine;
    this._blockDeviceName = blockDeviceName ? String(blockDeviceName) : null;
    this._packetDeviceName = packetDeviceName ? String(packetDeviceName) : null;
    // adapterVersion은 능력 조합을 말한다. 조합이 늘 때 이름을 조립하는 이유는 스냅샷 봉투가
    // 이 값으로 "복원 대상이 같은 능력의 어댑터인가"를 판정하기 때문이다.
    const suffix = [this._blockDeviceName ? "block" : null, this._packetDeviceName ? "net" : null].filter(Boolean).join("-");
    this.capabilities = {
      adapterVersion: suffix ? `pyproc-session-${suffix}-v1` : "pyproc-session-v1",
      snapshotScope: "portable",
      pauseMode: "cooperative",
      shutdownMode: "release",
      requiredDevices: [
        { name: "console", kind: "console" },
        ...(this._blockDeviceName ? [{ name: this._blockDeviceName, kind: "block" }] : []),
        ...(this._packetDeviceName
          ? [{ name: this._packetDeviceName, kind: "network", mode: "packet", methods: ["connect"] }]
          : []),
      ],
    };
    this._session = null;
    this._context = null;
    this._packetPort = null;
  }

  async boot(context, manifest, control) {
    throwIfOperationAborted(control, `${context.machineId}: pyproc boot`);
    this._context = context;
    this._session = await this._bootSession(manifest.session || {});
    this._ensureHome();
    if (this._blockDeviceName) {
      await readPyprocHomeVolume({ device: this._device(this._blockDeviceName), fs: this._session.rt.fs, allowEmpty: true });
    }
    this._attachPacketPort(context);
    throwIfOperationAborted(control, `${context.machineId}: pyproc boot`, { outcomeUnknown: true });
    consoleWrite(context, `pyproc:boot:${context.machineId}`);
  }

  async pause(control) {
    throwIfOperationAborted(control, "pyproc pause");
    if (this._blockDeviceName) {
      await writePyprocHomeVolume({ device: this._device(this._blockDeviceName), fs: this._session.rt.fs });
    }
    consoleWrite(this._context, "pyproc:pause");
  }

  async resume(control) {
    throwIfOperationAborted(control, "pyproc resume");
    consoleWrite(this._context, "pyproc:resume");
  }

  async snapshot(control) {
    throwIfOperationAborted(control, "pyproc snapshot");
    // 표면을 걷어낼 이유가 사라졌다: 값 경계에는 이미지가 나르지 못할 핸들이 없다(2026-08-01
    // 근본 원인 기록). 대신 뜨기 전에 펌프를 한 번 돌려, 파이썬이 보낸 프레임이 이미지 안에
    // 갇힌 채 저장되지 않게 한다(저장된 outbox는 부활 뒤 다시 나가 중복 배달이 된다).
    if (this._packetPort) this._packetPort.pump();
    const image = await this._session.exportImage({ includeHome: !this._blockDeviceName });
    throwIfOperationAborted(control, "pyproc snapshot", { outcomeUnknown: true });
    return new Uint8Array(await image.arrayBuffer());
  }

  async restore(payload, context, _manifest, control) {
    throwIfOperationAborted(control, `${context.machineId}: pyproc restore`);
    this._context = context;
    this._session = await this._openMachine(new Blob([payload], { type: "application/x-pymachine" }), { trust: true });
    this._ensureHome();
    if (this._blockDeviceName) {
      await readPyprocHomeVolume({ device: this._device(this._blockDeviceName), fs: this._session.rt.fs });
    }
    this._attachPacketPort(context);
    throwIfOperationAborted(control, `${context.machineId}: pyproc restore`, { outcomeUnknown: true });
    consoleWrite(context, `pyproc:restore:${context.machineId}`);
  }

  async shutdown(control) {
    throwIfOperationAborted(control, "pyproc shutdown");
    if (this._session && this._blockDeviceName) {
      const device = this._device(this._blockDeviceName);
      await writePyprocHomeVolume({ device, fs: this._session.rt.fs });
      await device.flush();
    }
    if (this._packetPort) {
      await this._packetPort.drain(); // 보낸 프레임이 스위치를 떠나기 전에 끊으면 유실이다
      this._packetPort.detach();
      this._packetPort = null;
    }
    consoleWrite(this._context, "pyproc:shutdown");
    this._session = null;
  }

  async request(message, control) {
    throwIfOperationAborted(control, "pyproc request");
    if (!this._session) throw new WebMachineError("WEB_MACHINE_GUEST_STATE", "pyproc adapter: no session");
    // history: 통합 상태 커널의 휘발 구역(체크포인트 나무)을 guest 요청으로 연다. 제품이
    // "실행 전 체크포인트, 실패하면 undo"를 서버 없이 쓴다. run/checkpoint/undo/historyDepth.
    const reactive = this._session.reactive;
    if (message.type === "checkpoint") {
      const info = reactive.checkpoint();
      return { index: info.index, changedPages: info.changedPages };
    }
    if (message.type === "undo") {
      // 지정 체크포인트(또는 직전)로 시간여행. 경계 위반은 restoreLive가 자동 재해시로 흡수한다.
      const target = Number.isInteger(message.index) ? message.index : reactive.tree().filter((node) => node.index < reactive.liveIdx).map((node) => node.index).pop();
      if (!Number.isInteger(target)) throw new WebMachineError("WEB_MACHINE_GUEST_STATE", "pyproc adapter: there is no checkpoint to undo to");
      reactive.checkpoint(); // 현재 경계를 닫아 즉시 복원 경로를 연다
      const restored = reactive.restoreLive(target);
      return { index: target, pagesWritten: restored.pagesWritten, rehashed: restored.rehashed };
    }
    if (message.type === "historyDepth") {
      return { depth: reactive.tree().length, live: reactive.liveIdx };
    }
    if (message.type !== "run") throw new WebMachineError("WEB_MACHINE_GUEST_STATE", `unsupported pyproc adapter request: ${message.type}`);
    // 패킷 표면은 값 경계라 바이트가 저절로 건너지 않는다. 턴 경계에서만 펌프를 돌린다:
    // 들어온 프레임을 실행 전에 파이썬 inbox로 넣고, 파이썬이 send한 것을 실행 뒤에 스위치로
    // 내보낸다. 파이썬이 스택에 있는 동안 run()을 다시 부를 수 없으므로 여기가 유일한 지점이다.
    if (this._packetPort) this._packetPort.pump();
    try {
      return this._session.rt.run(String(message.code || ""));
    } finally {
      if (this._packetPort) this._packetPort.pump();
    }
  }

  inspect() {
    return {
      engine: "pyodide",
      ready: !!this._session,
      heapBytes: this._session ? this._session.rt.memory.byteLength() : 0,
      snapshotScope: this.capabilities.snapshotScope,
      shutdownMode: this.capabilities.shutdownMode,
      ...(this._packetPort ? { network: this._packetPort.inspect() } : {}),
    };
  }

  // 파이썬 guest를 스위치에 붙인다. 주소는 endpoint별로 갈라야 같은 스위치의 두 guest가
  // 서로를 구분한다(machineId를 씨앗으로 마지막 옥텟을 나눈다).
  _attachPacketPort(context) {
    if (!this._packetDeviceName) return;
    // 재부착 전 옛 endpoint를 끊는다. restore는 세션을 통째로 갈아끼우므로 이 어댑터는 두 번째
    // port를 같은 endpointId로 열게 되는데, 스위치는 중복 endpoint를 거부한다(그래야 두 guest가
    // 서로의 프레임을 훔치지 않는다). 그래서 네트워크를 쓰는 guest는 warm restore 자체가
    // WEB_MACHINE_NETWORK_ENDPOINT_DUPLICATE로 죽었다(workerGuest 캠페인 통제군 실측 2026-07-31:
    // 워커가 아니라 메인 스레드의 shipped 어댑터에서 났다. 이 경로에 게이트가 없었다).
    if (this._packetPort) {
      this._packetPort.detach();
      this._packetPort = null;
    }
    const device = this._device(this._packetDeviceName);
    const seed = this._machineOctet(context.machineId);
    this._packetPort = new PyprocPacketPort({
      device,
      endpointId: `pyproc:${context.machineId}`,
      macAddress: [0x02, 0, 0, 0, 0, seed],
      ipv4Address: [10, 77, 0, seed],
    });
    this._packetPort.attach(this._session.rt);
  }

  // 결정적 옥텟(2~254). 같은 machineId면 재부팅해도 같은 주소를 갖는다: 상대 guest의 ARP
  // 캐시가 복원 후에도 유효해야 한다.
  _machineOctet(machineId) {
    let hash = 0;
    for (const ch of String(machineId)) hash = (hash * 31 + ch.charCodeAt(0)) % 253;
    return 2 + hash;
  }

  _ensureHome() {
    this._session.rt.run("from pathlib import Path\nPath('/home/web').mkdir(parents=True, exist_ok=True)");
  }

  // 선언(capabilities.requiredDevices)이 유일 진실이다. 판정은 contracts/deviceRequirement.js.
  _device(name) {
    if (!this._requirementByName) this._requirementByName = indexRequirements(this.capabilities.requiredDevices);
    return resolveRequiredDevice(this._context?.devices, this._requirementByName.get(name), "pyproc adapter");
  }
}
