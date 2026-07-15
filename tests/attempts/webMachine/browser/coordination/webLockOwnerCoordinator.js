// webLockOwnerCoordinator.js - Web Lock 단일 owner와 durable epoch claim의 수명주기를 묶는다.
import { WebMachineError } from "../../host/webMachineError.js";

export function webMachineOwnerLockName(machineId) {
  const id = String(machineId || "");
  if (!id) throw new TypeError("machineId가 필요하다");
  return `webMachineOwner/${id}`;
}

export class WebLockOwnerCoordinator {
  constructor({ lockManager, epochStore, machineId, ownerId, onAcquired, onLost }) {
    if (!lockManager || typeof lockManager.request !== "function") throw new TypeError("Web Lock manager가 필요하다");
    if (!epochStore || typeof epochStore.claim !== "function" || typeof epochStore.release !== "function") {
      throw new TypeError("owner epoch store가 필요하다");
    }
    if (typeof onAcquired !== "function") throw new TypeError("onAcquired 함수가 필요하다");
    if (typeof onLost !== "function") throw new TypeError("onLost 함수가 필요하다");
    this.machineId = String(machineId || "");
    this.ownerId = String(ownerId || "");
    if (!this.machineId) throw new TypeError("machineId가 필요하다");
    if (!this.ownerId) throw new TypeError("ownerId가 필요하다");
    this._lockManager = lockManager;
    this._epochStore = epochStore;
    this._onAcquired = onAcquired;
    this._onLost = onLost;
    this._lockName = webMachineOwnerLockName(this.machineId);
    this._state = "idle";
    this._token = null;
    this._error = null;
    this._abort = null;
    this._requestPromise = null;
    this._acquiredPromise = null;
    this._resolveAcquired = null;
    this._rejectAcquired = null;
    this._holdPromise = null;
    this._releaseHold = null;
    this._epochReleased = false;
    this._stopRequested = false;
    this._stopReason = "owner stopped";
    this._lostNotified = false;
  }

  start() {
    if (this._state !== "idle") throw new Error(`owner coordinator start 불가: ${this._state}`);
    this._state = "waiting";
    this._abort = new AbortController();
    this._acquiredPromise = new Promise((resolve, reject) => {
      this._resolveAcquired = resolve;
      this._rejectAcquired = reject;
    });
    this._holdPromise = new Promise((resolve) => { this._releaseHold = resolve; });
    this._requestPromise = this._lockManager.request(
      this._lockName,
      { mode: "exclusive", signal: this._abort.signal },
      async () => this._holdOwnership(),
    ).catch((error) => {
      if (this._stopRequested && error?.name === "AbortError") return;
      this._error = error;
      this._state = "failed";
      this._rejectAcquired?.(error);
    });
    return this._acquiredPromise;
  }

  async stop(reason = "owner stopped") {
    if (["stopped", "idle"].includes(this._state)) {
      this._state = "stopped";
      return;
    }
    if (this._state === "stopping") {
      await this._requestPromise?.catch(() => undefined);
      return;
    }
    this._stopRequested = true;
    this._stopReason = String(reason);
    if (this._state === "waiting") {
      this._state = "stopping";
      this._rejectAcquired?.(new WebMachineError("WEB_MACHINE_OWNER_STOPPED", `${this.machineId}: owner 대기 중단`));
      this._abort?.abort();
      await this._requestPromise?.catch(() => undefined);
      this._state = "stopped";
      return;
    }
    if (this._state === "acquiring") {
      this._state = "stopping";
      this._rejectAcquired?.(new WebMachineError("WEB_MACHINE_OWNER_STOPPED", `${this.machineId}: owner 획득 중단`));
      await this._requestPromise?.catch(() => undefined);
      this._state = this._error ? "failed" : "stopped";
      if (this._error) throw this._error;
      return;
    }
    if (this._state !== "owned") throw this._error || new Error(`owner coordinator stop 불가: ${this._state}`);
    this._state = "stopping";
    let failure = null;
    try {
      await this._notifyLost();
    } catch (error) {
      failure = error;
    }
    try {
      await this._releaseEpoch();
    } catch (error) {
      failure ||= error;
    }
    this._releaseHold?.();
    await this._requestPromise?.catch((error) => { failure ||= error; });
    this._state = failure ? "failed" : "stopped";
    if (failure) throw failure;
  }

  inspect() {
    return Object.freeze({
      machineId: this.machineId,
      ownerId: this.ownerId,
      lockName: this._lockName,
      state: this._state,
      epoch: this._token?.epoch || 0,
      error: this._error ? String(this._error?.message || this._error) : null,
    });
  }

  async _holdOwnership() {
    try {
      if (this._stopRequested) return;
      this._token = await this._epochStore.claim({ machineId: this.machineId, ownerId: this.ownerId });
      if (this._stopRequested) {
        await this._releaseEpoch();
        return;
      }
      this._state = "acquiring";
      await this._onAcquired(this._token);
      if (this._stopRequested) {
        await this._notifyLost();
        await this._releaseEpoch();
        return;
      }
      this._state = "owned";
      this._resolveAcquired?.(this._token);
      await this._holdPromise;
    } catch (error) {
      this._error = error;
      this._rejectAcquired?.(error);
      throw error;
    } finally {
      if (this._token && !this._epochReleased) await this._releaseEpoch().catch((error) => { this._error ||= error; });
    }
  }

  async _releaseEpoch() {
    if (!this._token || this._epochReleased) return;
    await this._epochStore.release(this._token);
    this._epochReleased = true;
  }

  async _notifyLost() {
    if (!this._token || this._lostNotified) return;
    this._lostNotified = true;
    await this._onLost(this._token, this._stopReason);
  }
}
