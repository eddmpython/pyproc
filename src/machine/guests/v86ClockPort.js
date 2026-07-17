// v86ClockPort.js - 공통 clock을 v86 CPU tick과 CMOS RTC에 연결한다.
const DAY_MS = 24 * 60 * 60 * 1000;

import { WebMachineError } from "../contracts/webMachineError.js";
export class V86ClockPort {
  constructor({ device }) {
    if (!device || device.kind !== "clock" || device.mode !== "wall-monotonic"
      || typeof device.readWallTimeMs !== "function" || typeof device.readMonotonicTimeMs !== "function") {
      throw new TypeError("wall-monotonic clock device가 필요하다");
    }
    this._device = device;
    this._emulator = null;
    this._rtc = null;
    this._originalRtcTimer = null;
    this._rtcTimer = null;
    this._monotonicTicks = 0;
    this._rtcTicks = 0;
    this._wallSynchronizations = 0;
    this._raisedInterrupts = 0;
    this.microtick = () => this._readMonotonic();
  }

  attach(emulator) {
    const rtc = emulator?.v86?.cpu?.devices?.rtc;
    if (!rtc || typeof rtc.timer !== "function" || !rtc.cpu || typeof rtc.cpu.device_raise_irq !== "function") {
      throw new TypeError("v86 CMOS RTC가 필요하다");
    }
    if (this._emulator) throw new WebMachineError("WEB_MACHINE_GUEST_STATE", "v86 clock port 이미 연결됨");
    this._emulator = emulator;
    this._rtc = rtc;
    this._originalRtcTimer = rtc.timer;
    this._rtcTimer = () => this._tickRtc();
    rtc.timer = this._rtcTimer;
    this.synchronizeWallClock();
  }

  synchronizeWallClock() {
    if (!this._rtc) throw new WebMachineError("WEB_MACHINE_GUEST_STATE", "v86 clock port가 연결되지 않았다");
    const now = this._device.readWallTimeMs();
    this._rtc.rtc_time = now;
    this._rtc.last_update = now;
    this._wallSynchronizations += 1;
    return now;
  }

  detach() {
    if (this._rtc && this._rtc.timer === this._rtcTimer) this._rtc.timer = this._originalRtcTimer;
    this._emulator = null;
    this._rtc = null;
    this._originalRtcTimer = null;
    this._rtcTimer = null;
  }

  inspect() {
    return {
      mode: "wall-monotonic",
      attached: !!this._emulator,
      monotonicTicks: this._monotonicTicks,
      rtcTicks: this._rtcTicks,
      wallSynchronizations: this._wallSynchronizations,
      raisedInterrupts: this._raisedInterrupts,
    };
  }

  _readMonotonic() {
    this._monotonicTicks += 1;
    return this._device.readMonotonicTimeMs();
  }

  _tickRtc() {
    const rtc = this._rtc;
    const now = this._device.readWallTimeMs();
    this._rtcTicks += 1;
    rtc.rtc_time = now;
    rtc.last_update = now;

    if (rtc.periodic_interrupt) {
      const interval = Number(rtc.periodic_interrupt_time);
      const tolerance = Math.max(1000, interval * 2);
      if (!Number.isFinite(rtc.next_interrupt) || Math.abs(rtc.next_interrupt - now) > tolerance) {
        rtc.next_interrupt = now;
      }
    }
    if (rtc.update_interrupt && (!Number.isFinite(rtc.update_interrupt_time) || Math.abs(rtc.update_interrupt_time - now) > 1000)) {
      rtc.update_interrupt_time = now;
    }
    this._rebaseAlarm(rtc, now);

    if (rtc.periodic_interrupt && rtc.next_interrupt < now) {
      rtc.cpu.device_raise_irq(8);
      rtc.cmos_c |= 1 << 6 | 1 << 7;
      rtc.next_interrupt += rtc.periodic_interrupt_time * Math.ceil((now - rtc.next_interrupt) / rtc.periodic_interrupt_time);
      this._raisedInterrupts += 1;
    } else if (rtc.next_interrupt_alarm && rtc.next_interrupt_alarm < now) {
      rtc.cpu.device_raise_irq(8);
      rtc.cmos_c |= 1 << 5 | 1 << 7;
      rtc.next_interrupt_alarm = 0;
      this._raisedInterrupts += 1;
    } else if (rtc.update_interrupt && rtc.update_interrupt_time < now) {
      rtc.cpu.device_raise_irq(8);
      rtc.cmos_c |= 1 << 4 | 1 << 7;
      rtc.update_interrupt_time = now + 1000;
      this._raisedInterrupts += 1;
    }

    let nextDelayMs = 100;
    if (rtc.periodic_interrupt && rtc.next_interrupt) {
      nextDelayMs = Math.min(nextDelayMs, Math.max(0, rtc.next_interrupt - now));
    }
    if (rtc.next_interrupt_alarm) {
      nextDelayMs = Math.min(nextDelayMs, Math.max(0, rtc.next_interrupt_alarm - now));
    }
    if (rtc.update_interrupt) {
      nextDelayMs = Math.min(nextDelayMs, Math.max(0, rtc.update_interrupt_time - now));
    }
    return nextDelayMs;
  }

  _rebaseAlarm(rtc, now) {
    const alarm = Number(rtc.next_interrupt_alarm);
    if (!alarm || !Number.isFinite(alarm) || Math.abs(alarm - now) <= DAY_MS) return;
    const requested = new Date(alarm);
    const current = new Date(now);
    let rebased = Date.UTC(
      current.getUTCFullYear(),
      current.getUTCMonth(),
      current.getUTCDate(),
      requested.getUTCHours(),
      requested.getUTCMinutes(),
      requested.getUTCSeconds(),
    );
    if (rebased <= now) rebased += DAY_MS;
    rtc.next_interrupt_alarm = rebased;
  }
}
