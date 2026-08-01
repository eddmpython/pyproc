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
  constructor({ V86, indexURL, createMachines = true, durability, onConsole = () => {}, onDisplay = () => {} }) {
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
      durability,
      onConsole: (line) => {
        this._lastConsole = line;
        if (this._active) this._onConsole(line);
      },
    });
    this.computer = computer;
    this._displayDevice = null;
    this._unsubscribeDisplay = null;
    this.refreshPresentation();
  }

  get devices() {
    return this.computer.devices;
  }

  get host() {
    return this.computer.host;
  }

  get machines() {
    return this.computer.machines;
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

  // import가 내부 candidate를 active로 바꾼 뒤 제품의 유일한 책임인 display 구독을 새 장치로
  // 옮긴다. machine/device pointer와 수명주기 자체는 computer의 동적 getter가 소유한다.
  refreshPresentation() {
    const display = this.computer.devices.display;
    if (display === this._displayDevice) return;
    this._unsubscribeDisplay?.();
    this._displayDevice = display;
    this._unsubscribeDisplay = display.subscribe((frame) => {
      this._lastDisplay = { frame, text: displayText(frame) };
      if (this._active) this._onDisplay(this._lastDisplay);
    });
    if (this._active) {
      const frame = display.readFrame();
      if (frame.rows) this._onDisplay({ frame, text: displayText(frame) });
    }
  }

  sendLinuxScanCodes(codes) {
    return this.devices.input.sendScanCodes(codes);
  }

  inspect() {
    const snapshot = this.computer.inspect();
    return Object.freeze({
      ...snapshot,
      active: this._active,
    });
  }

  async dispose(control) {
    if (this._disposed) return;
    this._disposed = true;
    this.deactivate();
    let failure = null;
    try {
      await this.computer.dispose(control);
    } catch (error) {
      failure = error;
    } finally {
      this._unsubscribeDisplay?.();
      this._unsubscribeDisplay = null;
    }
    if (failure) throw failure;
  }

}
