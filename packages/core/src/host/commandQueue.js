// commandQueue.js - machine별 직렬 실행과 ownership 결과 fencing.
import { WebMachineError } from "../contracts/webMachineError.js";
import { operationAbortError, throwIfOperationAborted } from "../contracts/operationControl.js";

export class CommandQueue {
  constructor({ machineId, instanceId, readFence }) {
    this._machineId = machineId;
    this._instanceId = instanceId;
    this._readFence = readFence;
    this._tail = Promise.resolve();
    this._operationSeq = 0;
  }

  enqueue(label, operation, { fenced = true, control } = {}) {
    const operationId = `${this._instanceId}/${++this._operationSeq}`;
    let callerSettled = false;
    let resolveCaller;
    let rejectCaller;
    const caller = new Promise((resolve, reject) => {
      resolveCaller = resolve;
      rejectCaller = reject;
    });
    const settleCaller = (method, value) => {
      if (callerSettled) return;
      callerSettled = true;
      method(value);
    };
    let started = false;
    let sentFence = null;
    const onAbort = () => settleCaller(rejectCaller, operationAbortError(control, `${this._machineId}: ${label}`, {
      outcomeUnknown: started,
      details: sentFence
        ? { operationId, sentOwnerId: sentFence.ownerId, sentEpoch: sentFence.epoch }
        : { operationId },
    }));
    control?.signal?.addEventListener("abort", onAbort, { once: true });
    if (control?.signal?.aborted) onAbort();
    const task = this._tail.then(async () => {
      try {
        throwIfOperationAborted(control, `${this._machineId}: ${label}`, { details: { operationId } });
      } catch (error) {
        control?.signal?.removeEventListener("abort", onAbort);
        settleCaller(rejectCaller, error);
        return;
      }
      sentFence = this._readFence();
      started = true;
      if (control?.signal?.aborted) {
        onAbort();
        control.signal.removeEventListener("abort", onAbort);
        return;
      }
      let result;
      let failure = null;
      try {
        result = await operation();
      } catch (error) {
        failure = error;
      } finally {
        control?.signal?.removeEventListener("abort", onAbort);
      }
      const currentFence = this._readFence();
      if (fenced && (sentFence.epoch !== currentFence.epoch || sentFence.ownerId !== currentFence.ownerId)) {
        settleCaller(rejectCaller, new WebMachineError(
          "WEB_MACHINE_OUTCOME_UNKNOWN",
          `${this._machineId}: ${label} 결과 불명, 자동 replay 금지`,
          {
            operationId,
            sentOwnerId: sentFence.ownerId,
            currentOwnerId: currentFence.ownerId,
            sentEpoch: sentFence.epoch,
            currentEpoch: currentFence.epoch,
            retryable: false,
          },
        ));
        return;
      }
      if (failure) settleCaller(rejectCaller, failure);
      else settleCaller(resolveCaller, result);
    });
    this._tail = task.catch((error) => { settleCaller(rejectCaller, error); });
    return caller;
  }
}
