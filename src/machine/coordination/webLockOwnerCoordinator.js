// webLockOwnerCoordinator.js - Web Lock 단일 owner와 durable epoch claim의 수명주기를 묶는다.
import { operationAbortError, throwIfOperationAborted } from "../contracts/operationControl.js";
import { WebMachineError } from "../contracts/webMachineError.js";

export function webMachineOwnerLockName(groupId) {
  const id = String(groupId || "");
  if (!id) throw new TypeError("groupId가 필요하다");
  return `webMachineOwner/${id}`;
}

export class WebLockOwnerCoordinator {
  constructor({ lockManager, ownerStore, groupId, ownerId, onAcquired, onLost }) {
    if (!lockManager || typeof lockManager.request !== "function") throw new TypeError("Web Lock manager가 필요하다");
    if (!ownerStore || typeof ownerStore.claimOwner !== "function" || typeof ownerStore.releaseOwner !== "function") {
      throw new TypeError("owner store가 필요하다");
    }
    if (typeof onAcquired !== "function") throw new TypeError("onAcquired 함수가 필요하다");
    if (typeof onLost !== "function") throw new TypeError("onLost 함수가 필요하다");
    this.groupId = String(groupId || "");
    this.ownerId = String(ownerId || "");
    if (!this.groupId) throw new TypeError("groupId가 필요하다");
    if (!this.ownerId) throw new TypeError("ownerId가 필요하다");
    this._lockManager = lockManager;
    this._ownerStore = ownerStore;
    this._onAcquired = onAcquired;
    this._onLost = onLost;
    this._lockName = webMachineOwnerLockName(this.groupId);
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
    this._acquireControl = null;
    this._externalAbortListener = null;
  }

  start(control) {
    if (this._state !== "idle") throw new Error(`owner coordinator start 불가: ${this._state}`);
    throwIfOperationAborted(control, `${this.groupId}: owner wait`);
    this._acquireControl = control;
    this._state = "waiting";
    this._abort = new AbortController();
    this._acquiredPromise = new Promise((resolve, reject) => {
      this._resolveAcquired = resolve;
      this._rejectAcquired = reject;
    });
    this._holdPromise = new Promise((resolve) => { this._releaseHold = resolve; });
    this._externalAbortListener = () => {
      const error = operationAbortError(control, `${this.groupId}: owner wait`);
      this._error = error;
      this._state = "stopping";
      this._rejectAcquired?.(error);
      this._abort?.abort(error);
    };
    control?.signal?.addEventListener("abort", this._externalAbortListener, { once: true });
    if (control?.signal?.aborted) this._externalAbortListener();
    this._requestPromise = this._lockManager.request(
      this._lockName,
      { mode: "exclusive", signal: this._abort.signal },
      async () => this._holdOwnership(),
    ).catch((error) => {
      if ((this._stopRequested || control?.signal?.aborted) && error?.name === "AbortError") {
        this._state = "stopped";
        return;
      }
      this._error = error;
      this._state = "failed";
      this._rejectAcquired?.(error);
    });
    return this._acquiredPromise;
  }

  async stop(reason = "owner stopped") {
    this._removeAcquireAbortListener();
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
      this._rejectAcquired?.(new WebMachineError("WEB_MACHINE_OWNER_STOPPED", `${this.groupId}: owner 대기 중단`));
      this._abort?.abort();
      await this._requestPromise?.catch(() => undefined);
      this._state = "stopped";
      return;
    }
    if (this._state === "acquiring") {
      this._state = "stopping";
      this._rejectAcquired?.(new WebMachineError("WEB_MACHINE_OWNER_STOPPED", `${this.groupId}: owner 획득 중단`));
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
      await this._releaseOwner();
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
      groupId: this.groupId,
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
      throwIfOperationAborted(this._acquireControl, `${this.groupId}: owner wait`);
      this._token = await this._ownerStore.claimOwner({ groupId: this.groupId, ownerId: this.ownerId });
      if (this._stopRequested) {
        await this._releaseOwner();
        return;
      }
      this._state = "acquiring";
      await this._onAcquired(this._token);
      if (this._stopRequested) {
        await this._notifyLost();
        await this._releaseOwner();
        return;
      }
      this._state = "owned";
      this._removeAcquireAbortListener();
      this._resolveAcquired?.(this._token);
      await this._holdPromise;
    } catch (error) {
      this._error = error;
      this._rejectAcquired?.(error);
      throw error;
    } finally {
      this._removeAcquireAbortListener();
      if (this._token && !this._epochReleased) await this._releaseOwner().catch((error) => { this._error ||= error; });
    }
  }

  async _releaseOwner() {
    if (!this._token || this._epochReleased) return;
    await this._ownerStore.releaseOwner(this._token);
    this._epochReleased = true;
  }

  async _notifyLost() {
    if (!this._token || this._lostNotified) return;
    this._lostNotified = true;
    await this._onLost(this._token, this._stopReason);
  }

  _removeAcquireAbortListener() {
    if (!this._externalAbortListener) return;
    this._acquireControl?.signal?.removeEventListener("abort", this._externalAbortListener);
    this._externalAbortListener = null;
  }
}
