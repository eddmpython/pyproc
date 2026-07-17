import { createWebComputer } from "/index.js";
import { UNDESCRIBED_ASSET_PROVENANCE } from "./assetProvenance.js";
import {
  LINUX_DISK_BYTES,
  PYTHON_DISK_BYTES,
  WEB_COMPUTER_ADAPTER_VERSION,
  createLinuxMachineManifest,
} from "./machineConfig.js";

export const WEB_COMPUTER_MACHINE_IDS = Object.freeze(["pythonOs", "linuxOs"]);

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
    // provenance 명시(부재를 명시로 싣는다), Linux 부팅 매니페스트, 디스크 크기, adapter 버전.
    const computer = createWebComputer({
      createMachines,
      python: {
        diskBytes: PYTHON_DISK_BYTES,
        manifest: {
          session: { ...(indexURL ? { indexURL } : {}) },
          provenance: UNDESCRIBED_ASSET_PROVENANCE,
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

  setMachines(machines) {
    if (!(machines instanceof Map)) throw new TypeError("machines Map이 필요하다");
    this.machines = machines;
  }

  adoptOwnership(token) {
    for (const machine of this.machines.values()) machine.adoptOwnership(token);
  }

  invalidateOwnership(reason) {
    for (const machine of this.machines.values()) machine.invalidateOwnership(reason);
  }

  machine(machineId) {
    const machine = this.machines.get(machineId);
    if (!machine || !WEB_COMPUTER_MACHINE_IDS.includes(machineId)) throw new Error(`Machine is not available: ${machineId}`);
    return machine;
  }

  runningMachineIds() {
    return [...this.machines.values()]
      .filter((machine) => machine.state === "running")
      .map((machine) => machine.machineId);
  }

  async bootAll(control) {
    await Promise.all([...this.machines.values()].map((machine) => machine.boot(control)));
  }

  async pauseRunning(control) {
    const runningIds = this.runningMachineIds();
    const pausedIds = [];
    try {
      for (const machineId of runningIds) {
        await this.machine(machineId).pause(control);
        pausedIds.push(machineId);
      }
    } catch (error) {
      await this.resumeMachineIds(pausedIds).catch(() => undefined);
      throw error;
    }
    return runningIds;
  }

  async resumeMachineIds(machineIds, control) {
    await Promise.all(machineIds.map((machineId) => {
      const machine = this.machine(machineId);
      return machine.state === "paused" ? machine.resume(control) : undefined;
    }));
  }

  async resumeAll(control) {
    await this.resumeMachineIds(
      [...this.machines.values()].filter((machine) => machine.state === "paused").map((machine) => machine.machineId),
      control,
    );
  }

  async shutdownAll(control) {
    await Promise.all([...this.machines.values()]
      .filter((machine) => machine.state !== "stopped")
      .map((machine) => machine.shutdown(control)));
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
