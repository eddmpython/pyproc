import { IndexedDbMachineStore } from "/src/machine/index.js";
import {
  WEB_COMPUTER_DATABASE,
  WEB_COMPUTER_GROUP_ID,
  WEB_COMPUTER_OWNER_DATABASE,
  WEB_COMPUTER_TIMEOUTS,
  LINUX_SHELL_PROMPT,
  loadV86Constructor,
} from "./machineConfig.js";
import { WebComputerContext } from "./webComputerContext.js";
import { createWebComputerDurabilityPolicy } from "./webComputerPersistence.js";

function operationControl(lifetimeSignal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return Object.freeze({
    signal: AbortSignal.any([lifetimeSignal, timeoutSignal]),
    deadlineAt: Date.now() + timeoutMs,
  });
}

export class WebComputerRuntime {
  constructor({ onActivity = () => {}, onConsole = () => {}, onDisplay = () => {}, onState = () => {} } = {}) {
    this.onActivity = onActivity;
    this.onConsole = onConsole;
    this.onDisplay = onDisplay;
    this.onState = onState;
    this.groupId = WEB_COMPUTER_GROUP_ID;
    this.ownerId = crypto.randomUUID();
    this.V86 = null;
    this.store = null;
    this.context = null;
    this.disposed = false;
    this._lifetime = new AbortController();
  }

  get startupMode() {
    return this.context?.computer.inspect().startupMode || "none";
  }

  async initialize({ deferBoot = false, indexURL } = {}) {
    if (!crossOriginIsolated || typeof SharedArrayBuffer !== "function") {
      throw new Error("Web Computer requires cross-origin isolation and SharedArrayBuffer");
    }
    if (!navigator.locks) throw new Error("Web Computer requires the Web Locks API");
    try {
      this.onActivity("Verifying the execution engine");
      this.V86 = await loadV86Constructor();
      this.store = new IndexedDbMachineStore({
        indexedDb: indexedDB,
        databaseName: WEB_COMPUTER_DATABASE,
        legacyOwnerDatabaseName: WEB_COMPUTER_OWNER_DATABASE,
      });
      const durability = createWebComputerDurabilityPolicy({
        store: this.store,
        ownerId: this.ownerId,
        onOwnerChanged: () => this._emitState(),
      });
      const context = this._createContext({ createMachines: !deferBoot, indexURL, durability });
      this.context = context;
      try {
        this.onActivity("Claiming and restoring the Web Computer");
        await context.computer.initialize({
          deferBoot,
          ownerControl: this._control("owner"),
          restoreControl: this._control("restore"),
          resumeControl: this._control("request"),
          pruneControl: this._control("save"),
        });
        context.activate();
      } catch (error) {
        await context.dispose().catch(() => undefined);
        throw error;
      }
      this._emitState();
      return this.inspect();
    } catch (error) {
      await this._cleanupFailedInitialize();
      throw error;
    }
  }

  async runPython(code) {
    const result = await this._machine("pythonOs").request({ type: "run", code: String(code || "") }, this._control("request"));
    this._emitState();
    return result;
  }

  // history: 통합 상태 커널의 시간여행을 제품 표면으로 연다(체크포인트/undo). 서버 0.
  async checkpointPython() {
    const info = await this._machine("pythonOs").request({ type: "checkpoint" }, this._control("request"));
    this._emitState();
    return info;
  }

  async undoPython(index) {
    const message = Number.isInteger(index) ? { type: "undo", index } : { type: "undo" };
    const info = await this._machine("pythonOs").request(message, this._control("request"));
    this._emitState();
    return info;
  }

  async pythonHistoryDepth() {
    return this._machine("pythonOs").request({ type: "historyDepth" }, this._control("request"));
  }

  async runLinux(command) {
    const data = `${String(command || "").replace(/\n+$/, "")}\n`;
    const result = await this._machine("linuxOs").request(
      { type: "serial", data, waitFor: LINUX_SHELL_PROMPT },
      this._control("request"),
    );
    this._emitState();
    return result;
  }

  sendLinuxScanCodes(codes) {
    return this._requireContext().sendLinuxScanCodes(codes);
  }

  async pauseMachine(machineId) {
    const machine = this._machine(machineId);
    if (machine.state === "running") await machine.pause(this._control("request"));
    this._emitState();
  }

  async resumeMachine(machineId) {
    const machine = this._machine(machineId);
    const control = this._control("restore");
    if (machine.state === "paused") await machine.resume(control);
    else if (machine.state === "stopped") await machine.boot(control);
    this._emitState();
  }

  async shutdownMachine(machineId) {
    const machine = this._machine(machineId);
    if (machine.state !== "stopped") await machine.shutdown(this._control("request"));
    this._emitState();
  }

  async pauseAll() {
    await this._computer().pauseRunning(this._control("request"));
    this._emitState();
  }

  async resumeAll() {
    await this._computer().resumeAll(this._control("request"));
    this._emitState();
  }

  async save() {
    try {
      return await this._computer().save(this._control("save"));
    } finally {
      this._emitState();
    }
  }

  exportImage() {
    return this._computer().exportImage({ control: this._control("export") });
  }

  async importImage(file, trustedPublicKey, approvedPermissions) {
    if (!approvedPermissions) throw new TypeError("Approved machine permissions are required");
    const control = this._control("import");
    this.onActivity("Verifying signature and every machine byte");
    try {
      return await this._computer().importImage(file, {
        trustedPublicKeys: [trustedPublicKey],
        approvedPermissions,
        control,
      });
    } finally {
      // commit 실패면 같은 display이고, 성공이면 새 candidate의 display다. 두 경우 모두 한
      // 호출로 제품 구독을 active 장치에 맞춘다.
      this._requireContext().refreshPresentation();
      this._emitState();
    }
  }

  inspect() {
    const snapshot = this.context?.inspect();
    return Object.freeze({
      owner: snapshot?.owner || null,
      startupMode: snapshot?.startupMode || "none",
      groupId: this.groupId,
      machines: snapshot?.machines || Object.freeze({}),
      devices: snapshot?.devices || Object.freeze({}),
      persistence: snapshot?.persistence || Object.freeze({}),
    });
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._lifetime.abort(new DOMException("Web Computer disposed", "AbortError"));
    await this.context?.dispose().catch(() => undefined);
    this.store?.close();
    this.context = null;
  }

  _createContext({ createMachines, indexURL, durability } = {}) {
    return new WebComputerContext({
      V86: this.V86,
      createMachines,
      indexURL,
      durability,
      onConsole: this.onConsole,
      onDisplay: this.onDisplay,
    });
  }

  async _cleanupFailedInitialize() {
    await this.context?.dispose().catch(() => undefined);
    this.store?.close();
    this.context = null;
  }

  _control(name) {
    return operationControl(this._lifetime.signal, WEB_COMPUTER_TIMEOUTS[name]);
  }

  _requireContext() {
    if (!this.context) throw new Error("Web Computer context is not available");
    return this.context;
  }

  _machine(machineId) {
    return this._computer().machine(machineId);
  }

  _computer() {
    return this._requireContext().computer;
  }

  _emitState() {
    this.onState(this.inspect());
  }
}
