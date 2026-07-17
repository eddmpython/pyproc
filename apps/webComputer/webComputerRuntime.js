import { IndexedDbMachineStore, WebLockOwnerCoordinator } from "/src/machine/index.js";
import {
  WEB_COMPUTER_CAPABILITIES,
  WEB_COMPUTER_DATABASE,
  WEB_COMPUTER_GROUP_ID,
  WEB_COMPUTER_OWNER_DATABASE,
  WEB_COMPUTER_TIMEOUTS,
  loadV86Constructor,
} from "./machineConfig.js";
import { WebComputerContext } from "./webComputerContext.js";
import { swapWebComputerContext } from "./webComputerContextSwap.js";
import { WebComputerPersistence } from "./webComputerPersistence.js";

function approvedPermissions(manifest) {
  return Object.fromEntries(manifest.machines.map((entry) => [entry.machineId, { devices: [...entry.permissions.devices] }]));
}

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
    this.startupMode = "none";
    this.V86 = null;
    this.store = null;
    this.persistence = null;
    this.ownerCoordinator = null;
    this.ownerToken = null;
    this.context = null;
    this.disposed = false;
    this.cleanupError = null;
    this.durabilityState = "clean";
    this.durabilityError = null;
    this._lifetime = new AbortController();
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
      this.persistence = new WebComputerPersistence({
        store: this.store,
        cryptoProvider: crypto,
        idFactory: () => crypto.randomUUID(),
        nowFactory: () => Date.now(),
      });
      await this._acquireOwnership(this._control("owner"));
      const context = this._createContext({ createMachines: !deferBoot, indexURL });
      context.adoptOwnership(this.ownerToken);
      try {
        if (deferBoot) {
          this._commitContext(context);
          this.startupMode = "deferred";
          this._emitState();
          return this.inspect();
        }

        const head = await this.persistence.readHead(this.groupId);
        if (head?.head) {
          this.onActivity("Restoring the last complete state");
          await this.persistence.restoreLatest({
            groupId: this.groupId,
            context,
            control: this._control("restore"),
          });
          await context.resumeAll(this._control("request"));
          this.startupMode = "restored";
          await this.persistence.pruneRecoveryWindow({
            groupId: this.groupId,
            ownerToken: this.ownerToken,
            control: this._control("save"),
          });
        } else {
          this.onActivity("Booting Python OS and Linux");
          await context.bootAll(this._control("restore"));
          this.startupMode = "booted";
        }
        this._commitContext(context);
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

  async runLinux(command) {
    const data = `${String(command || "").replace(/\n+$/, "")}\n`;
    const result = await this._machine("linuxOs").request(
      { type: "serial", data, waitFor: "~% " },
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
    await this._requireContext().pauseRunning(this._control("request"));
    this._emitState();
  }

  async resumeAll() {
    await this._requireContext().resumeAll(this._control("request"));
    this._emitState();
  }

  async save() {
    try {
      const committed = await this.persistence.save({
        groupId: this.groupId,
        context: this._requireContext(),
        ownerToken: this.ownerToken,
        control: this._control("save"),
      });
      this.durabilityState = "clean";
      this.durabilityError = null;
      this._emitState();
      return committed;
    } catch (error) {
      this.durabilityState = "unsaved";
      this.durabilityError = error;
      this._emitState();
      throw error;
    }
  }

  exportImage() {
    return this.persistence.exportImage({
      groupId: this.groupId,
      context: this._requireContext(),
      control: this._control("export"),
    });
  }

  async importImage(file, trustedPublicKey) {
    const control = this._control("import");
    this.onActivity("Verifying signature and every machine byte");
    const archive = await this.persistence.readImage({ file, trustedPublicKey, control });
    const preflightContext = this._createContext({ createMachines: false });
    try {
      this.persistence.preflightImport({
        archive,
        host: preflightContext.host,
        devices: preflightContext.blockDevices,
        approvedPermissions: approvedPermissions(archive.manifest),
        availableCapabilities: WEB_COMPUTER_CAPABILITIES,
      });
    } finally {
      await preflightContext.dispose();
    }
    const swapped = await swapWebComputerContext({
      current: this._requireContext(),
      createCandidate: () => this._createContext({ createMachines: false }),
      stageCandidate: async (next) => {
        const imported = await this.persistence.importVerified({
          archive,
          host: next.host,
          devices: next.blockDevices,
          approvedPermissions: approvedPermissions(archive.manifest),
          availableCapabilities: WEB_COMPUTER_CAPABILITIES,
          ownerToken: this.ownerToken,
          control,
        });
        next.setMachines(imported.machines);
      },
      commitCandidate: (next) => { this.context = next; },
      control,
    });
    this.cleanupError = swapped.cleanupError;
    this.startupMode = "imported";
    this.durabilityState = "unsaved";
    this._emitState();
    const committed = await this.save();
    return Object.freeze({ archive, cleanupError: this.cleanupError, committed });
  }

  inspect() {
    const snapshot = this.context?.inspect();
    return Object.freeze({
      owner: this.ownerCoordinator?.inspect() || null,
      startupMode: this.startupMode,
      groupId: this.groupId,
      machines: snapshot?.machines || Object.freeze({}),
      devices: snapshot?.devices || Object.freeze({}),
      persistence: Object.freeze({
        cleanupPending: this.persistence?.cleanupPending || false,
        lastPrune: this.persistence?.lastPrune || null,
        cleanupError: this.cleanupError ? String(this.cleanupError?.message || this.cleanupError) : null,
        durabilityState: this.durabilityState,
        durabilityError: this.durabilityError ? this.durabilityError?.code || String(this.durabilityError) : null,
      }),
    });
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._lifetime.abort(new DOMException("Web Computer disposed", "AbortError"));
    await this.context?.dispose().catch(() => undefined);
    await this.ownerCoordinator?.stop("page closed").catch(() => undefined);
    this.store?.close();
    this.context = null;
  }

  _createContext({ createMachines, indexURL } = {}) {
    return new WebComputerContext({
      V86: this.V86,
      createMachines,
      indexURL,
      onConsole: this.onConsole,
      onDisplay: this.onDisplay,
    });
  }

  _commitContext(context) {
    this.context?.deactivate();
    this.context = context;
    this.context.activate();
  }

  async _acquireOwnership(control) {
    this.onActivity("Waiting for exclusive workspace ownership");
    this.ownerCoordinator = new WebLockOwnerCoordinator({
      lockManager: navigator.locks,
      ownerStore: this.store,
      groupId: this.groupId,
      ownerId: this.ownerId,
      onAcquired: (token) => { this.ownerToken = token; },
      onLost: (_token, reason) => {
        this.context?.invalidateOwnership(reason);
        this._emitState();
      },
    });
    await this.ownerCoordinator.start(control);
  }

  async _cleanupFailedInitialize() {
    await this.context?.dispose().catch(() => undefined);
    await this.ownerCoordinator?.stop("startup failed").catch(() => undefined);
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
    return this._requireContext().machine(machineId);
  }

  _emitState() {
    this.onState(this.inspect());
  }
}
