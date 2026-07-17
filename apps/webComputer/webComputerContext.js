import { bootSession, openMachine } from "/index.js";
import { UNDESCRIBED_ASSET_PROVENANCE } from "./assetProvenance.js";
import {
  createBrowserHost,
  MemoryBlockDevice,
  MemoryScanCodeInputDevice,
  MemoryTextDisplayDevice,
} from "/packages/browser/index.js";
import { createPyprocGuestFactory } from "/packages/guest-pyproc/index.js";
import { createV86GuestFactory } from "/packages/guest-v86/index.js";
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
    const pythonDisk = new MemoryBlockDevice({ byteLength: PYTHON_DISK_BYTES });
    const linuxDisk = new MemoryBlockDevice({ byteLength: LINUX_DISK_BYTES });
    const display = new MemoryTextDisplayDevice();
    const input = new MemoryScanCodeInputDevice({ maxBatchBytes: 512, maxQueuedBatches: 32 });
    this.devices = {
      console: {
        kind: "console",
        write: (line) => {
          this._lastConsole = String(line);
          if (this._active) this._onConsole(this._lastConsole);
        },
      },
      pythonDisk,
      linuxDisk,
      display,
      input,
    };
    this.blockDevices = Object.freeze({ pythonDisk, linuxDisk });
    this.host = createBrowserHost({ devices: this.devices, cryptoProvider: crypto });
    this.host.registerAdapter("pyproc-block", createPyprocGuestFactory({
      bootSession,
      openMachine,
      blockDeviceName: "pythonDisk",
    }));
    this.host.registerAdapter("x86-linux-product", createV86GuestFactory({
      V86,
      adapterVersion: WEB_COMPUTER_ADAPTER_VERSION,
      blockDeviceName: "linuxDisk",
      blockMode: "filesystem",
      displayDeviceName: "display",
      inputDeviceName: "input",
    }));
    this.machines = new Map();
    if (createMachines) this._createDefaultMachines(indexURL);
    this._unsubscribeDisplay = display.subscribe((frame) => {
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

  _createDefaultMachines(indexURL) {
    this.machines.set("pythonOs", this.host.createMachine({
      machineId: "pythonOs",
      adapterId: "pyproc-block",
      // provenance: pyproc 게스트의 실행 자산은 아직 어떤 asset catalog도 기술하지 않는다.
      // 침묵하면 증거 없음이 문제 없음으로 읽히므로 부재를 명시로 싣는다.
      manifest: {
        session: { ...(indexURL ? { indexURL } : {}) },
        provenance: UNDESCRIBED_ASSET_PROVENANCE,
      },
      permissions: { devices: ["console", "pythonDisk"] },
    }));
    this.machines.set("linuxOs", this.host.createMachine({
      machineId: "linuxOs",
      adapterId: "x86-linux-product",
      manifest: createLinuxMachineManifest(),
      permissions: { devices: ["console", "linuxDisk", "display", "input"] },
    }));
  }
}
