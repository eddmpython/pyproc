// v86GuestAdapter.js - attempts 전용 외부 주입형 x86 guest adapter.
// host와 pyproc 패키지는 v86에 의존하지 않고 integration probe만 생성자를 주입한다.
import { V86BlockBuffer } from "./v86/v86BlockBuffer.js";
import {
  readV86FileSystemVolume,
  serializeV86FileSystemState,
  writeV86FileSystemVolume,
} from "./v86/v86FileSystemVolume.js";
import { V86PacketPort } from "./v86/v86PacketPort.js";
import { V86DisplayPort } from "./v86/v86DisplayPort.js";
import { V86InputPort } from "./v86/v86InputPort.js";

function consoleWrite(context, message) {
  context.devices.console?.write?.(String(message));
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function createV86GuestFactory({
  V86,
  adapterVersion = "v86-linux-state-v1",
  blockDeviceName = null,
  blockMode = null,
  packetDeviceName = null,
  displayDeviceName = null,
  inputDeviceName = null,
}) {
  if (typeof V86 !== "function") throw new TypeError("V86 constructor가 필요하다");
  return () => new V86GuestAdapterDraft({
    V86,
    adapterVersion,
    blockDeviceName,
    blockMode,
    packetDeviceName,
    displayDeviceName,
    inputDeviceName,
  });
}

class V86GuestAdapterDraft {
  constructor({ V86, adapterVersion, blockDeviceName, blockMode, packetDeviceName, displayDeviceName, inputDeviceName }) {
    this._blockDeviceName = blockDeviceName ? String(blockDeviceName) : null;
    this._blockMode = this._blockDeviceName ? String(blockMode || "ata") : null;
    if (this._blockMode && !["ata", "filesystem"].includes(this._blockMode)) throw new TypeError(`v86 block mode 미지원: ${this._blockMode}`);
    this._packetDeviceName = packetDeviceName ? String(packetDeviceName) : null;
    this._displayDeviceName = displayDeviceName ? String(displayDeviceName) : null;
    this._inputDeviceName = inputDeviceName ? String(inputDeviceName) : null;
    this.capabilities = {
      adapterVersion,
      snapshotScope: "portable",
      pauseMode: "emulator-stop",
      shutdownMode: "terminate",
      requiredDevices: [
        { name: "console", kind: "console" },
        ...(this._blockDeviceName ? [{ name: this._blockDeviceName, kind: "block" }] : []),
        ...(this._packetDeviceName ? [{ name: this._packetDeviceName, kind: "network", mode: "packet" }] : []),
        ...(this._displayDeviceName ? [{ name: this._displayDeviceName, kind: "display", mode: "text-cells" }] : []),
        ...(this._inputDeviceName ? [{ name: this._inputDeviceName, kind: "input", mode: "ps2-scan-code" }] : []),
      ],
    };
    this._V86 = V86;
    this._emulator = null;
    this._context = null;
    this._manifest = null;
    this._blockBuffer = null;
    this._emptyFileSystemState = null;
    this._volumeStats = null;
    this._packetPort = null;
    this._displayPort = null;
    this._inputPort = null;
    this._serial = "";
    this._line = "";
    this._waiters = new Set();
    this._onSerialByte = (byte) => this._acceptSerialByte(byte);
  }

  async boot(context, manifest) {
    this._context = context;
    this._manifest = manifest;
    const readyPattern = String(manifest.v86?.readyPattern || "~% ");
    await this._createEmulator({ autostart: this._blockMode !== "filesystem", attachInput: true });
    if (this._blockMode === "filesystem") {
      this._volumeStats = await readV86FileSystemVolume({
        device: this._blockDevice(),
        fileSystem: this._fileSystem(),
        emptyState: this._emptyFileSystemState,
        allowEmpty: true,
      });
      await this._emulator.run();
    }
    await this._waitFor(readyPattern, 0, Number(manifest.v86?.bootTimeoutMs || 120000));
    consoleWrite(context, `x86:boot:${context.machineId}`);
  }

  async pause() {
    await this._inputPort?.drain();
    this._inputPort?.detach();
    try {
      await this._requireEmulator().stop();
      await this._blockBuffer?.drain();
      await this._packetPort?.drain();
      await this._displayPort?.drain();
      if (this._blockMode === "filesystem") {
        this._volumeStats = await writeV86FileSystemVolume({ device: this._blockDevice(), fileSystem: this._fileSystem() });
      }
    } catch (error) {
      this._inputPort?.attach(this._requireEmulator());
      throw error;
    }
    consoleWrite(this._context, "x86:pause");
  }

  async resume() {
    this._inputPort?.attach(this._requireEmulator());
    try {
      await this._requireEmulator().run();
    } catch (error) {
      this._inputPort?.detach();
      throw error;
    }
    consoleWrite(this._context, "x86:resume");
  }

  async snapshot() {
    await this._blockBuffer?.drain();
    await this._packetPort?.drain();
    await this._displayPort?.drain();
    if (this._blockMode !== "filesystem") return new Uint8Array(await this._requireEmulator().save_state());
    const fileSystem = this._fileSystem();
    const liveState = serializeV86FileSystemState(fileSystem);
    fileSystem.set_state(this._emptyFileSystemState);
    try {
      return new Uint8Array(await this._requireEmulator().save_state());
    } finally {
      fileSystem.set_state(liveState);
    }
  }

  async restore(payload, context, manifest) {
    this._context = context;
    this._manifest = manifest;
    if (!this._emulator) await this._createEmulator({ autostart: false, attachInput: false });
    await this._emulator.restore_state(toArrayBuffer(payload));
    if (this._blockMode === "filesystem") {
      this._volumeStats = await readV86FileSystemVolume({
        device: this._blockDevice(),
        fileSystem: this._fileSystem(),
        emptyState: this._emptyFileSystemState,
      });
    }
    await this._displayPort?.drain();
    consoleWrite(context, `x86:restore:${context.machineId}`);
  }

  async shutdown() {
    this._rejectWaiters(new Error("x86 adapter: shutdown"));
    if (this._emulator) {
      await this._inputPort?.drain();
      this._inputPort?.detach();
      await this._emulator.stop();
      await this._blockBuffer?.drain();
      await this._packetPort?.drain();
      await this._displayPort?.drain();
      if (this._blockMode === "filesystem" && this._emulator.fs9p) {
        this._volumeStats = await writeV86FileSystemVolume({ device: this._blockDevice(), fileSystem: this._fileSystem() });
      }
      if (this._blockDeviceName) await this._blockDevice().flush();
      this._emulator.remove_listener("serial0-output-byte", this._onSerialByte);
      this._packetPort?.detach();
      this._displayPort?.detach();
      await this._emulator.destroy();
    }
    this._emulator = null;
    this._packetPort = null;
    this._displayPort = null;
    this._inputPort = null;
    consoleWrite(this._context, "x86:shutdown");
  }

  async request(message) {
    const emulator = this._requireEmulator();
    if (message.type !== "serial") throw new Error(`x86 adapter request 미지원: ${message.type}`);
    const data = String(message.data || "");
    const waitFor = String(message.waitFor || this._manifest.v86?.readyPattern || "~% ");
    const from = this._serial.length;
    const waiting = this._waitFor(waitFor, from, Number(message.timeoutMs || 30000));
    emulator.serial0_send(data);
    const end = await waiting;
    return this._serial.slice(from, end);
  }

  inspect() {
    return {
      engine: "v86",
      ready: !!this._emulator,
      running: this._emulator?.is_running?.() || false,
      serialChars: this._serial.length,
      snapshotScope: this.capabilities.snapshotScope,
      shutdownMode: this.capabilities.shutdownMode,
      block: this._blockBuffer?.inspect() || (this._blockMode === "filesystem" ? { mode: "filesystem", ...this._volumeStats } : null),
      network: this._packetPort?.inspect() || null,
      display: this._displayPort?.inspect() || null,
      input: this._inputPort?.inspect() || null,
    };
  }

  async _createEmulator({ autostart, attachInput }) {
    const sourceOptions = this._manifest?.v86?.options;
    if (!sourceOptions || typeof sourceOptions !== "object") throw new Error("x86 adapter: manifest.v86.options 없음");
    const options = { ...sourceOptions };
    if (this._packetDeviceName && (options.network_relay_url || options.net_device?.relay_url)) {
      throw new Error("x86 adapter: packet device와 relay 동시 사용 불가");
    }
    if (this._packetDeviceName) options.preserve_mac_from_state_image = true;
    if (this._blockMode === "ata") {
      const device = this._context?.devices?.[this._blockDeviceName];
      this._blockBuffer = new V86BlockBuffer(device);
      options.hda = this._blockBuffer;
      if (!options.boot_order) options.boot_order = 0x123;
    }
    this._serial = "";
    this._line = "";
    const emulator = new this._V86({ ...options, autostart });
    this._emulator = emulator;
    emulator.add_listener("serial0-output-byte", this._onSerialByte);
    if (this._packetDeviceName) {
      this._packetPort = new V86PacketPort({
        device: this._packetDevice(),
        endpointId: this._context.machineId,
      });
      this._packetPort.attach(emulator);
    }
    if (this._displayDeviceName) {
      this._displayPort = new V86DisplayPort({
        device: this._displayDevice(),
        endpointId: this._context.machineId,
      });
      this._displayPort.attach(emulator);
    }
    if (this._inputDeviceName) {
      this._inputPort = new V86InputPort({
        device: this._inputDevice(),
        endpointId: this._context.machineId,
      });
      if (attachInput) this._inputPort.attach(emulator);
    }
    const timeoutMs = Number(this._manifest.v86?.engineTimeoutMs || 60000);
    await new Promise((resolve, reject) => {
      const onReady = () => {
        clearTimeout(timer);
        emulator.remove_listener("emulator-ready", onReady);
        emulator.remove_listener("download-error", onDownloadError);
        resolve();
      };
      const onDownloadError = (event) => {
        clearTimeout(timer);
        emulator.remove_listener("emulator-ready", onReady);
        emulator.remove_listener("download-error", onDownloadError);
        reject(new Error(`x86 adapter asset download 실패: ${event?.file_name || "unknown"}`));
      };
      const timer = setTimeout(() => {
        emulator.remove_listener("emulator-ready", onReady);
        emulator.remove_listener("download-error", onDownloadError);
        reject(new Error(`x86 adapter engine ready timeout: ${timeoutMs}ms`));
      }, timeoutMs);
      emulator.add_listener("emulator-ready", onReady);
      emulator.add_listener("download-error", onDownloadError);
    });
    if (this._blockMode === "filesystem") {
      this._emptyFileSystemState = serializeV86FileSystemState(this._fileSystem());
    }
  }

  _acceptSerialByte(byte) {
    const character = String.fromCharCode(byte);
    if (character === "\r") return;
    this._serial += character;
    if (character === "\n") {
      if (this._line) consoleWrite(this._context, `x86:${this._line}`);
      this._line = "";
    } else {
      this._line += character;
    }
    for (const waiter of [...this._waiters]) {
      const matchAt = this._serial.indexOf(waiter.pattern, waiter.from);
      if (matchAt >= 0) waiter.resolve(matchAt + waiter.pattern.length);
    }
  }

  _waitFor(pattern, from, timeoutMs) {
    const current = this._serial.indexOf(pattern, from);
    if (current >= 0) return Promise.resolve(current + pattern.length);
    return new Promise((resolve, reject) => {
      const waiter = {
        pattern,
        from,
        resolve: (value) => {
          clearTimeout(waiter.timer);
          this._waiters.delete(waiter);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(waiter.timer);
          this._waiters.delete(waiter);
          reject(error);
        },
        timer: null,
      };
      waiter.timer = setTimeout(() => waiter.reject(new Error(`x86 serial wait timeout: ${pattern}`)), timeoutMs);
      this._waiters.add(waiter);
    });
  }

  _rejectWaiters(error) {
    for (const waiter of [...this._waiters]) waiter.reject(error);
  }

  _requireEmulator() {
    if (!this._emulator) throw new Error("x86 adapter: emulator 없음");
    return this._emulator;
  }

  _blockDevice() {
    const device = this._context?.devices?.[this._blockDeviceName];
    if (!device || device.kind !== "block") throw new Error(`x86 adapter: block device 없음 ${this._blockDeviceName}`);
    return device;
  }

  _packetDevice() {
    const device = this._context?.devices?.[this._packetDeviceName];
    if (!device || device.kind !== "network" || device.mode !== "packet" || typeof device.connect !== "function") {
      throw new Error(`x86 adapter: packet network device 없음 ${this._packetDeviceName}`);
    }
    return device;
  }

  _displayDevice() {
    const device = this._context?.devices?.[this._displayDeviceName];
    if (!device || device.kind !== "display" || device.mode !== "text-cells" || typeof device.connect !== "function") {
      throw new Error(`x86 adapter: text display device 없음 ${this._displayDeviceName}`);
    }
    return device;
  }

  _inputDevice() {
    const device = this._context?.devices?.[this._inputDeviceName];
    if (!device || device.kind !== "input" || device.mode !== "ps2-scan-code" || typeof device.connect !== "function") {
      throw new Error(`x86 adapter: PS/2 input device 없음 ${this._inputDeviceName}`);
    }
    return device;
  }

  _fileSystem() {
    const fileSystem = this._requireEmulator().fs9p;
    if (!fileSystem) throw new Error("x86 adapter: 9P filesystem 없음");
    return fileSystem;
  }
}
