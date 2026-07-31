import { createWebComputer } from "/index.js";
import { WEB_COMPUTER_ASSET_PROVENANCE } from "./assetProvenance.js";
import {
  LINUX_DISK_BYTES,
  PYTHON_DISK_BYTES,
  WEB_COMPUTER_ADAPTER_VERSION,
  createLinuxMachineManifest,
} from "./machineConfig.js";

function displayText(frame) {
  const lines = [];
  for (let row = 0; row < frame.rows; row += 1) {
    const offset = row * frame.columns;
    lines.push(Array.from(
      frame.cells.subarray(offset, offset + frame.columns),
      (glyph) => String.fromCodePoint(glyph || 32),
    ).join("").trimEnd());
  }
  return lines.join("\n").trimEnd();
}

export class WebComputerContext {
  constructor({ V86, indexURL, createMachines = true, onConsole = () => {}, onDisplay = () => {} }) {
    if (typeof V86 !== "function") throw new TypeError("V86 constructor가 필요하다");
    this._onConsole = onConsole;
    this._onDisplay = onDisplay;
    this._active = false;
    this._disposed = false;
    this._lastConsole = null;
    this._lastDisplay = null;
    // 조립은 공개 표면의 createWebComputer가 한다. 제품이 더하는 것은 자기 값뿐이다:
    // provenance 명시(두 guest의 실행 자산 전부를 같은 catalog가 기술한다), Linux 부팅
    // 매니페스트, 디스크 크기, adapter 버전.
    const computer = createWebComputer({
      createMachines,
      python: {
        diskBytes: PYTHON_DISK_BYTES,
        manifest: {
          session: { ...(indexURL ? { indexURL } : {}) },
          provenance: WEB_COMPUTER_ASSET_PROVENANCE,
        },
      },
      linux: {
        V86,
        diskBytes: LINUX_DISK_BYTES,
        adapterVersion: WEB_COMPUTER_ADAPTER_VERSION,
        manifest: createLinuxMachineManifest(),
      },
      onConsole: (line) => {
        this._lastConsole = line;
        if (this._active) this._onConsole(line);
      },
    });
    this.computer = computer;
    this.devices = computer.devices;
    this.blockDevices = Object.freeze({
      pythonDisk: computer.devices.pythonDisk,
      linuxDisk: computer.devices.linuxDisk,
    });
    this.host = computer.host;
    this.machines = computer.machines;
    this._unsubscribeDisplay = this.devices.display.subscribe((frame) => {
      this._lastDisplay = { frame, text: displayText(frame) };
      if (this._active) this._onDisplay(this._lastDisplay);
    });
  }

  activate() {
    if (this._disposed) throw new Error("disposed Web Computer context는 activate 불가");
    this._active = true;
    if (this._lastConsole) this._onConsole(this._lastConsole);
    const frame = this.devices.display.readFrame();
    if (frame.rows) {
      this._lastDisplay = { frame, text: displayText(frame) };
      this._onDisplay(this._lastDisplay);
    }
  }

  deactivate() {
    this._active = false;
  }

  // 아래 동사들은 전부 위임이다. 예전에는 같은 팬아웃 10벌이 이 파일에 다시 구현돼 있었는데,
  // 그 사본은 오류 어휘까지 갈라져 있었다(이 파일은 new Error, 커널은 WebMachineError). 계약이
  // 두 곳에 있으면 소비자가 코드로 분기할 수 없다. 제품이 소유하는 것은 화면 관심사(활성 상태,
  // console/display 관찰, dispose)뿐이고 수명주기는 컴퓨터가 소유한다.
  setMachines(machines) {
    this.computer.adoptMachines(machines);
  }

  adoptOwnership(token) {
    this.computer.adoptOwnership(token);
  }

  invalidateOwnership(reason) {
    this.computer.invalidateOwnership(reason);
  }

  machine(machineId) {
    return this.computer.machine(machineId);
  }

  runningMachineIds() {
    return this.computer.runningMachineIds();
  }

  bootAll(control) {
    return this.computer.bootAll(control);
  }

  pauseRunning(control) {
    return this.computer.pauseRunning(control);
  }

  resumeMachineIds(machineIds, control) {
    return this.computer.resumeMachineIds(machineIds, control);
  }

  resumeAll(control) {
    return this.computer.resumeAll(control);
  }

  shutdownAll(control) {
    return this.computer.shutdownAll(control);
  }

  sendLinuxScanCodes(codes) {
    return this.devices.input.sendScanCodes(codes);
  }

  inspect() {
    return Object.freeze({
      active: this._active,
      machines: Object.freeze(Object.fromEntries(
        [...this.machines].map(([id, machine]) => [id, machine.inspectNow()]),
      )),
      devices: Object.freeze({
        pythonDisk: this.devices.pythonDisk.inspect(),
        linuxDisk: this.devices.linuxDisk.inspect(),
        display: this.devices.display.inspect(),
        input: this.devices.input.inspect(),
      }),
    });
  }

  async dispose(control) {
    if (this._disposed) return;
    this._disposed = true;
    this.deactivate();
    let failure = null;
    try {
      await this.shutdownAll(control);
    } catch (error) {
      failure = error;
    } finally {
      this._unsubscribeDisplay?.();
      this._unsubscribeDisplay = null;
    }
    if (failure) throw failure;
  }

}
