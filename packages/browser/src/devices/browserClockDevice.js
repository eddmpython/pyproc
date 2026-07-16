// browserClockDevice.js - 주입된 browser 시간원과 scheduler를 bounded clock 계약으로 좁힌다.
import { WebMachineError } from "@web-machine/core";

function finiteTime(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new WebMachineError("WEB_MACHINE_CLOCK_VALUE", `${label}은 0 이상 유한값이어야 한다: ${value}`);
  }
  return value;
}

export class BrowserClockDevice {
  constructor({
    wallNow,
    monotonicNow,
    scheduleTimer,
    cancelTimer,
    maxTimerDelayMs = 24 * 60 * 60 * 1000,
    maxPendingTimers = 1024,
  } = {}) {
    if (typeof wallNow !== "function") throw new TypeError("wallNow 함수가 필요하다");
    if (typeof monotonicNow !== "function") throw new TypeError("monotonicNow 함수가 필요하다");
    if (typeof scheduleTimer !== "function") throw new TypeError("scheduleTimer 함수가 필요하다");
    if (typeof cancelTimer !== "function") throw new TypeError("cancelTimer 함수가 필요하다");
    if (!Number.isFinite(maxTimerDelayMs) || maxTimerDelayMs <= 0) throw new TypeError("maxTimerDelayMs는 양수여야 한다");
    if (!Number.isInteger(maxPendingTimers) || maxPendingTimers <= 0) throw new TypeError("maxPendingTimers는 양의 정수여야 한다");
    this.kind = "clock";
    this.mode = "wall-monotonic";
    this.maxTimerDelayMs = maxTimerDelayMs;
    this.maxPendingTimers = maxPendingTimers;
    this._wallNow = wallNow;
    this._monotonicNow = monotonicNow;
    this._scheduleTimer = scheduleTimer;
    this._cancelTimer = cancelTimer;
    this._lastMonotonicMs = null;
    this._nextTimerId = 0;
    this._pendingTimers = new Map();
    this._wallReads = 0;
    this._monotonicReads = 0;
    this._scheduledTimers = 0;
    this._firedTimers = 0;
    this._cancelledTimers = 0;
    this._timerErrors = 0;
    this._lastError = null;
  }

  readWallTimeMs() {
    const value = finiteTime(this._wallNow(), "wall clock");
    this._wallReads += 1;
    return value;
  }

  readMonotonicTimeMs() {
    const value = finiteTime(this._monotonicNow(), "monotonic clock");
    if (this._lastMonotonicMs !== null && value < this._lastMonotonicMs) {
      throw new WebMachineError(
        "WEB_MACHINE_CLOCK_REGRESSION",
        `monotonic clock 역행: ${value} < ${this._lastMonotonicMs}`,
      );
    }
    this._lastMonotonicMs = value;
    this._monotonicReads += 1;
    return value;
  }

  schedule({ delayMs, callback } = {}) {
    if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > this.maxTimerDelayMs) {
      throw new WebMachineError("WEB_MACHINE_CLOCK_DELAY", `timer delay 범위 초과: ${delayMs}/${this.maxTimerDelayMs}`);
    }
    if (typeof callback !== "function") throw new TypeError("timer callback이 필요하다");
    if (this._pendingTimers.size >= this.maxPendingTimers) {
      throw new WebMachineError("WEB_MACHINE_CLOCK_TIMER_FULL", `clock timer 포화: ${this.maxPendingTimers}`);
    }
    const id = ++this._nextTimerId;
    const scheduledAtMs = this.readMonotonicTimeMs();
    const entry = { id, handle: null, scheduledAtMs, cancelled: false };
    this._pendingTimers.set(id, entry);
    try {
      entry.handle = this._scheduleTimer(() => this._fire(entry, callback), delayMs);
    } catch (error) {
      this._pendingTimers.delete(id);
      throw error;
    }
    this._scheduledTimers += 1;
    return Object.freeze({ id, cancel: () => this._cancel(entry) });
  }

  inspect() {
    return {
      kind: this.kind,
      mode: this.mode,
      wallReads: this._wallReads,
      monotonicReads: this._monotonicReads,
      scheduledTimers: this._scheduledTimers,
      firedTimers: this._firedTimers,
      cancelledTimers: this._cancelledTimers,
      pendingTimers: this._pendingTimers.size,
      timerErrors: this._timerErrors,
      lastError: this._lastError,
    };
  }

  _fire(entry, callback) {
    if (entry.cancelled || !this._pendingTimers.delete(entry.id)) return;
    this._firedTimers += 1;
    try {
      callback(Object.freeze({
        timerId: entry.id,
        scheduledAtMs: entry.scheduledAtMs,
        firedAtMs: this.readMonotonicTimeMs(),
      }));
    } catch (error) {
      this._timerErrors += 1;
      this._lastError = String(error?.message || error);
    }
  }

  _cancel(entry) {
    if (entry.cancelled || !this._pendingTimers.delete(entry.id)) return false;
    entry.cancelled = true;
    this._cancelTimer(entry.handle);
    this._cancelledTimers += 1;
    return true;
  }
}
