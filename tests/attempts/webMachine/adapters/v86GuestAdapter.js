// v86GuestAdapter.js - attempts 전용 외부 주입형 x86 guest adapter.
// host와 pyproc 패키지는 v86에 의존하지 않고 integration probe만 생성자를 주입한다.

function consoleWrite(context, message) {
  context.devices.console?.write?.(String(message));
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function createV86GuestFactory({ V86, adapterVersion = "v86-linux-state-v1" }) {
  if (typeof V86 !== "function") throw new TypeError("V86 constructor가 필요하다");
  return () => new V86GuestAdapterDraft({ V86, adapterVersion });
}

class V86GuestAdapterDraft {
  constructor({ V86, adapterVersion }) {
    this.capabilities = {
      adapterVersion,
      snapshotScope: "portable",
      pauseMode: "emulator-stop",
      shutdownMode: "terminate",
      requiredDevices: [{ name: "console", kind: "console" }],
    };
    this._V86 = V86;
    this._emulator = null;
    this._context = null;
    this._manifest = null;
    this._serial = "";
    this._line = "";
    this._waiters = new Set();
    this._onSerialByte = (byte) => this._acceptSerialByte(byte);
  }

  async boot(context, manifest) {
    this._context = context;
    this._manifest = manifest;
    const readyPattern = String(manifest.v86?.readyPattern || "~% ");
    await this._createEmulator({ autostart: true });
    await this._waitFor(readyPattern, 0, Number(manifest.v86?.bootTimeoutMs || 120000));
    consoleWrite(context, `x86:boot:${context.machineId}`);
  }

  async pause() {
    await this._requireEmulator().stop();
    consoleWrite(this._context, "x86:pause");
  }

  async resume() {
    await this._requireEmulator().run();
    consoleWrite(this._context, "x86:resume");
  }

  async snapshot() {
    return new Uint8Array(await this._requireEmulator().save_state());
  }

  async restore(payload, context, manifest) {
    this._context = context;
    this._manifest = manifest;
    if (!this._emulator) await this._createEmulator({ autostart: false });
    await this._emulator.restore_state(toArrayBuffer(payload));
    consoleWrite(context, `x86:restore:${context.machineId}`);
  }

  async shutdown() {
    this._rejectWaiters(new Error("x86 adapter: shutdown"));
    if (this._emulator) {
      this._emulator.remove_listener("serial0-output-byte", this._onSerialByte);
      await this._emulator.destroy();
    }
    this._emulator = null;
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
    };
  }

  async _createEmulator({ autostart }) {
    const options = this._manifest?.v86?.options;
    if (!options || typeof options !== "object") throw new Error("x86 adapter: manifest.v86.options 없음");
    this._serial = "";
    this._line = "";
    const emulator = new this._V86({ ...options, autostart });
    this._emulator = emulator;
    emulator.add_listener("serial0-output-byte", this._onSerialByte);
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
}
