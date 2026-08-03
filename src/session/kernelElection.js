// kernelElection.js - Layer 4: 같은 origin의 여러 탭을 하나의 지속 Python 머신으로 묶는다.
// "누가 그 Session을 소유하는가"가 전부라 session.js와 같은 층이다(bootSession 소비).
// Web Locks가 리더를 하나로 제한하고, 영속 epoch가 이전 리더의 늦은 응답을 fence한다.
// 리더 탭이 사라지면 다음 참여자가 같은 매니페스트로 부팅하고 MachineJournal의 마지막
// commit 경계에서 힙과 /home/web을 함께 복구한다. SharedWorker와 달리 문서의 COI/SAB를 유지한다.
import { bootSession } from "./session.js";
import { OUTCOME_LOG_MAX_RECORDS, appendOutcomeRecord, decodeOutcomeLog, encodeOutcomeLog, findOutcome } from "../state/outcomeLog.js";
import { MachineJournal } from "../capabilities/journal/machineJournal.js";
import { PyProcError } from "../runtime/errors.js";
import { hexFromBytes, sha256Hex } from "../runtime/contentDigest.js";

const PROTOCOL_VERSION = 2;
const EPOCH_FILE = "EPOCH.json";
const DEFAULT_HEARTBEAT_MS = 1000;
const DEFAULT_PRESENCE_TIMEOUT_MS = 5000;
const DEFAULT_READY_TIMEOUT_MS = 20000;
const DEFAULT_RPC_TIMEOUT_MS = 8000;

const MACHINE_ROOT = "pyprocMachines";
const RPC_SEMANTICS = "timeout or unprovable failover: outcome unknown; durable proven-portable failover: resend once by requestId";

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return hexFromBytes(bytes);
}

// 기존 code/retryable 계약을 PyProcError로 승계한다(코드 문자열 불변 = 게이트 호환).
function kernelError(message, code, retryable = false) {
  return new PyProcError(code, message, { retryable });
}

function errorPayload(error) {
  return {
    error: String(error && (error.message || error)).slice(-300),
    code: error && error.code ? error.code : "PYPROC_KERNEL_EXECUTION_ERROR",
    retryable: error && error.retryable === true,
  };
}

function durabilityUnknown(error) {
  return kernelError(
    `KernelElection: Python execution finished but its durable commit failed (${String(error?.message || error).slice(-180)}). The effect may still exist in the live kernel, so do not retry automatically`,
    "PYPROC_RPC_OUTCOME_UNKNOWN",
    false,
  );
}

function normalizeResult(runtime, result) {
  const value = runtime?.toHostValue ? runtime.toHostValue(result, { fallback: null }) : (result === undefined ? null : result);
  if (runtime?.destroyHostValue) runtime.destroyHostValue(result);
  return value;
}

async function sha256Name(value) {
  return sha256Hex(value);
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export class KernelElection {
  constructor(opts = {}) {
    this.name = opts.name || "pyprocKernel";
    this.manifest = opts.manifest || {};
    this.participantId = opts.participantId || makeId();
    this._journalDir = opts.journalDir || null;
    this._storageKey = opts.storageKey || null;
    this._lockName = "pyprocKernelLeader/" + this.name;
    this._chanName = "pyprocKernelRpc/" + this.name;
    this._heartbeatMs = opts.heartbeatMs || DEFAULT_HEARTBEAT_MS;
    this._presenceTimeoutMs = opts.presenceTimeoutMs || DEFAULT_PRESENCE_TIMEOUT_MS;
    this._rpcTimeoutMs = opts.rpcTimeoutMs || DEFAULT_RPC_TIMEOUT_MS;
    this._autoCommit = opts.autoCommit !== false;
    this._onLeader = opts.onLeader || null;
    this._listeners = new Set();
    if (opts.onStatus) this._listeners.add(opts.onStatus);

    this._role = "idle";
    this._phase = "idle";
    this._leaderId = null;
    this._epoch = 0;
    this._recovered = false;
    this._lastCommitAt = null;
    this._leaderBootMs = null;
    this._recoveryMs = null;
    this._error = null;
    this._session = null;
    this._journal = null;
    this._chan = null;
    this._seq = 0;
    this._pending = new Map();
    this._served = new Map();
    // 명령 실행과 generation commit은 한 줄에서 순서대로 끝난다. async run 두 개나 idle commit이
    // 겹치면 뒤 명령의 결과가 앞 generation에 섞이므로, durable 응답의 선형화 지점이 필요하다.
    this._commandChain = Promise.resolve();
    // 세대가 나르는 결과 기록. 승계자가 "그 명령이 실행됐는가"에 답할 수 있게 하는 유일한 근거다.
    this._outcomes = [];
    this._participants = new Map();
    this._readyWaiters = new Set();
    this._releaseLeader = null;
    this._lockAbort = null;
    this._heartbeatTimer = null;
    this._servingLeader = false;
    this._joined = false;
    this._left = false;
  }

  join() {
    if (this._joined) return this;
    if (!globalThis.navigator?.locks?.request) throw new PyProcError("PYPROC_ENV_UNSUPPORTED", "KernelElection: the Web Locks API is required");
    if (typeof BroadcastChannel !== "function") throw new PyProcError("PYPROC_ENV_UNSUPPORTED", "KernelElection: the BroadcastChannel API is required");
    this._joined = true;
    this._left = false;
    this._chan = new BroadcastChannel(this._chanName);
    this._chan.onmessage = (event) => this._onChannel(event.data);
    this._participants.set(this.participantId, Date.now());
    this._setState({ role: "pending", phase: "joining" });
    this._post({ type: "hello", participantId: this.participantId });
    this._heartbeatTimer = setInterval(() => this._heartbeat(), this._heartbeatMs);
    this._lockAbort = new AbortController();

    navigator.locks.request(this._lockName, { signal: this._lockAbort.signal }, async () => {
      await this._becomeLeader();
      await new Promise((resolve) => { this._releaseLeader = resolve; });
    }).catch((error) => {
      if (this._left) return;
      this._fail(kernelError(`KernelElection: leader lock failed (${String(error).slice(-180)})`, "PYPROC_LEADER_LOCK_FAILED", true));
    });
    return this;
  }

  async _nextEpoch() {
    if (!this._journalDir) return Math.max(1, this._epoch + 1);
    let current = 0;
    try {
      const file = await (await this._journalDir.getFileHandle(EPOCH_FILE)).getFile();
      const doc = JSON.parse(await file.text());
      if (!Number.isSafeInteger(doc.epoch) || doc.epoch < 0) throw new PyProcError("PYPROC_INTERNAL", "epoch out of range");
      current = doc.epoch;
    } catch (error) {
      if (error.name !== "NotFoundError") throw new PyProcError("PYPROC_JOURNAL_CORRUPT", `KernelElection: EPOCH.json is corrupt (${String(error.message || error).slice(-160)})`);
    }
    const epoch = current + 1;
    const file = await this._journalDir.getFileHandle(EPOCH_FILE, { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify({ version: 1, epoch, leaderId: this.participantId, claimedAt: new Date().toISOString() }));
    await writable.close();
    return epoch;
  }

  async _becomeLeader() {
    const started = now();
    if (this._pending.size) this._parkOrRejectPending("요청을 보낸 participant가 새 leader로 승격됐다");
    this._role = "leader";
    this._phase = "recovering";
    this._leaderId = this.participantId;
    this._epoch = await this._nextEpoch();
    this._recovered = false;
    this._error = null;
    this._notify();
    this._announceLeader(false);
    try {
      const bootStarted = now();
      this._session = await bootSession(this.manifest);
      this._leaderBootMs = Math.round(now() - bootStarted);
      let recovered = null;
      if (this._journalDir) {
        this._journal = new MachineJournal(this._session.rt, {
          dir: this._journalDir,
          reactive: this._session.reactive,
          // 결과 기록은 힙과 같은 세대에 실린다: 그래야 "답이 내구적이다"와 "효과가 내구적이다"가
          // 한 사실이 된다(세대 밖에 두면 승계자가 힙에 없는 효과의 결과를 답할 수 있다).
          sidecar: {
            id: "outcomes",
            collect: () => (this._outcomes.length ? encodeOutcomeLog(this._outcomes) : null),
            apply: (bytes) => { this._outcomes = bytes ? decodeOutcomeLog(bytes) : []; },
          },
        });
        const recoveryStarted = now();
        recovered = await this._journal.recover();
        this._recoveryMs = Math.round(now() - recoveryStarted);
        this._recovered = !!recovered;
        this._lastCommitAt = recovered?.committedAt || null;
        this._journal.requestPersistentStorage();
        // 자동 commit 경로는 명령 queue가 유일한 writer다. opt-out 경로만 옛 idle 저장을 쓴다.
        if (!this._autoCommit) this._journal.start();
      } else {
        this._recoveryMs = 0;
      }
      this._servingLeader = true;
      this._phase = "ready";
      this._participants.set(this.participantId, Date.now());
      this._notify();
      this._settleReady();
      this._announceLeader(true);
      if (this._onLeader) {
        this._onLeader({
          recovered: this._recovered,
          leaderId: this.participantId,
          epoch: this._epoch,
          bootMs: this._leaderBootMs,
          recoveryMs: this._recoveryMs,
          totalMs: Math.round(now() - started),
        });
      }
    } catch (error) {
      this._servingLeader = false;
      this._fail(error);
      if (this._releaseLeader) this._releaseLeader();
      throw error;
    }
  }

  _heartbeat() {
    if (!this._chan || this._left) return;
    const time = Date.now();
    this._participants.set(this.participantId, time);
    for (const [id, seenAt] of this._participants) {
      if (id !== this.participantId && time - seenAt > this._presenceTimeoutMs) this._participants.delete(id);
    }
    this._post({ type: "presence", participantId: this.participantId });
    if (this._role === "leader") this._announceLeader(this._phase === "ready");
    this._notify();
  }

  _post(message) {
    if (!this._chan) return;
    this._chan.postMessage({ protocol: PROTOCOL_VERSION, machine: this.name, ...message });
  }

  _announceLeader(ready, to = null) {
    this._post({
      type: "leaderState",
      to,
      leaderId: this.participantId,
      epoch: this._epoch,
      ready,
      recovered: this._recovered,
      lastCommitAt: this._lastCommitAt,
      bootMs: this._leaderBootMs,
      recoveryMs: this._recoveryMs,
    });
  }

  _onChannel(message) {
    if (!message || message.protocol !== PROTOCOL_VERSION || message.machine !== this.name) return;
    if (message.to && message.to !== this.participantId) return;
    if (message.participantId) this._participants.set(message.participantId, Date.now());
    if (message.type === "hello") {
      this._post({ type: "presence", participantId: this.participantId, to: message.participantId });
      if (this._role === "leader") this._announceLeader(this._phase === "ready", message.participantId);
      this._notify();
      return;
    }
    if (message.type === "presence") {
      this._notify();
      return;
    }
    if (message.type === "bye") {
      this._participants.delete(message.participantId);
      if (message.participantId === this._leaderId && this._role !== "leader") {
        this._leaderId = null;
        this._setState({ role: "pending", phase: "joining" });
      } else this._notify();
      return;
    }
    if (message.type === "leaderState") {
      this._acceptLeader(message);
      return;
    }
    if (message.type === "rpcReq" && this._role === "leader" && this._servingLeader) {
      this._enqueueCommand(() => this._serve(message)).catch((error) => {
        this._fail(error);
      });
      return;
    }
    if (message.type === "rpcRes") this._acceptResponse(message);
  }

  _acceptLeader(message) {
    if (!Number.isSafeInteger(message.epoch) || message.epoch < 1 || !message.leaderId) return;
    if (message.epoch < this._epoch) return;
    if (message.epoch === this._epoch && this._leaderId && this._leaderId !== message.leaderId) {
      this._fail(kernelError(`KernelElection: two leaders claim the same epoch ${message.epoch}`, "PYPROC_SPLIT_BRAIN"));
      return;
    }
    const changed = this._leaderId && (message.epoch > this._epoch || message.leaderId !== this._leaderId);
    if (changed) this._parkOrRejectPending("leader가 요청 처리 중 바뀌었다");
    this._leaderId = message.leaderId;
    this._epoch = message.epoch;
    this._recovered = message.recovered === true;
    this._lastCommitAt = message.lastCommitAt || null;
    this._leaderBootMs = message.bootMs ?? this._leaderBootMs;
    this._recoveryMs = message.recoveryMs ?? this._recoveryMs;
    this._participants.set(message.leaderId, Date.now());
    if (this._role !== "leader") {
      this._role = message.ready ? "follower" : "pending";
      this._phase = message.ready ? "ready" : "recovering";
    }
    this._notify();
    if (message.ready) this._settleReady();
  }

  async _serve(message) {
    if (message.targetLeaderId !== this.participantId || message.epoch !== this._epoch) return;
    const cached = this._served.get(message.requestId);
    if (cached) { this._post(cached); return; }
    // 세대가 나른 기록이 있으면 그 명령은 이미 실행됐고 효과가 이 힙 안에 있다. 다시 돌리면
    // 두 번 실행이므로, 기록으로 답한다(리더 신원과 epoch는 지금 것으로 채운다).
    const recorded = findOutcome(this._outcomes, message.requestId);
    if (recorded) {
      this._post({
        type: "rpcRes",
        to: message.participantId,
        requestId: message.requestId,
        leaderId: this.participantId,
        epoch: this._epoch,
        ok: recorded.ok,
        ...(recorded.ok ? { result: recorded.result } : { error: recorded.error, code: recorded.code, retryable: recorded.retryable }),
        replayed: true,
      });
      return;
    }
    let response = await this._execute(message.action, message);
    const outcomesBefore = this._outcomes;
    this._outcomes = appendOutcomeRecord(outcomesBefore, {
      requestId: message.requestId,
      epoch: this._epoch,
      action: message.action,
      ok: response.ok === true,
      ...(response.ok === true ? { result: response.result } : { error: response.error, code: response.code, retryable: response.retryable === true }),
    });
    // run의 결과 기록과 Python 효과를 같은 generation에 싣고 나서만 응답한다. commit action은
    // 자기 자신이 이미 generation 경계이므로 다음 세대에 결과 기록을 싣지 않아도 재실행 효과가 없다.
    if (message.action === "run" && this._autoCommit && this._journal) {
      try {
        await this._commitJournal();
      } catch (error) {
        this._outcomes = outcomesBefore;
        response = this._responseFor(message, false, errorPayload(durabilityUnknown(error)));
      }
    }
    this._served.set(message.requestId, response);
    if (this._served.size > OUTCOME_LOG_MAX_RECORDS) this._served.delete(this._served.keys().next().value);
    this._post(response);
  }

  _responseFor(message, ok, payload) {
    return {
      type: "rpcRes",
      to: message.participantId,
      requestId: message.requestId,
      leaderId: this.participantId,
      epoch: this._epoch,
      ok,
      ...payload,
    };
  }

  async _execute(action, payload) {
    try {
      let result;
      if (action === "run") {
        const raw = payload.async
          ? await this._session.rt.runAsync(payload.code)
          : this._session.rt.run(payload.code);
        result = normalizeResult(this._session.rt, raw);
      } else if (action === "commit") {
        result = await this._commitJournal();
      } else {
        throw kernelError(`KernelElection: unknown RPC action (${action})`, "PYPROC_RPC_ACTION_INVALID");
      }
      return this._responseFor(payload, true, { result });
    } catch (error) {
      return this._responseFor(payload, false, errorPayload(error));
    }
  }

  async _commitJournal() {
    const result = this._journal ? await this._journal.commit() : null;
    this._lastCommitAt = result?.committedAt || this._lastCommitAt;
    this._announceLeader(true);
    this._notify();
    return result;
  }

  _enqueueCommand(work) {
    const pending = this._commandChain.then(work, work);
    this._commandChain = pending.catch(() => {});
    return pending;
  }

  _acceptResponse(message) {
    const pending = this._pending.get(message.requestId);
    if (!pending) return;
    if (message.leaderId !== pending.leaderId || message.epoch !== pending.epoch) return;
    clearTimeout(pending.timer);
    this._pending.delete(message.requestId);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(kernelError(message.error, message.code || "PYPROC_KERNEL_EXECUTION_ERROR", message.retryable === true));
    this._notify();
  }

  // 리더 교체는 "모른다"가 아니라 "아직 모른다"다. 내구 머신이면 승계자가 세대를 부활시키고
  // 그 세대가 결과 기록을 나르므로, 대기시켰다가 준비 announce에서 한 번 다시 물으면 답이 온다.
  // 내구 머신이 아니면(journalDir 없음) 승계자에게 물어볼 세대가 없으므로 예전대로 거부한다:
  // 그 경우의 "모른다"는 여전히 참이다.
  _parkOrRejectPending(reason) {
    if (!this._journalDir) { this._rejectPendingOutcomeUnknown(reason); return; }
    // 승계자에게 다시 물으려면 그 커널이 쓸 수 있어야 한다. 힙에 JS 핸들이 있었던 머신은
    // 부활한 커널에서 프록시 경로가 전부 트랩하므로(이미지 이식성 계약, 2026-08-01 실측)
    // 재전송이 답 대신 죽은 인터프리터를 만난다. 그 경우의 "모른다"는 여전히 참이다.
    // 재전송이 안전하려면 승계자의 커널이 쓸 수 있어야 하는데, 그것을 아는 참가자는 세션을
    // 가진 쪽뿐이다. 세션이 없는 follower는 리더의 힙에 핸들이 있었는지 알 수 없으므로 park하지
    // 않는다: 모르는 것을 안다고 가정하면 재전송이 죽은 인터프리터를 만난다(소비자 게이트가
    // 부하 상태에서 그것을 잡았다). 아는 경우에만 park하고, 모르면 예전대로 정직하게 거부한다.
    const surfaces = this._session?.rt?.hostProxySurfaces?.();
    if (!surfaces || surfaces.length) { this._rejectPendingOutcomeUnknown(reason); return; }
    for (const entry of this._pending.values()) {
      clearTimeout(entry.timer);
      entry.timer = null;
      entry.awaitingLeader = true;
    }
    this._notify();
  }

  // 준비된 리더가 생기면 대기 중인 요청을 정확히 한 번 다시 보낸다. 중복 배달이 되더라도
  // 서버측이 결과 기록으로 답하므로(정확히 한 번의 리더 절반) 두 번 실행되지 않는다.
  _resendParkedPending() {
    if (this._phase !== "ready" || !this._leaderId) return;
    for (const [requestId, entry] of this._pending) {
      if (!entry.awaitingLeader) continue;
      entry.awaitingLeader = false;
      entry.leaderId = this._leaderId;
      entry.epoch = this._epoch;
      entry.timer = setTimeout(() => {
        this._pending.delete(requestId);
        this._notify();
        entry.reject(kernelError("KernelElection: the sent RPC timed out. Whether it ran is unknown, so it is not re-executed automatically", "PYPROC_RPC_OUTCOME_UNKNOWN", false));
      }, entry.timeoutMs);
      this._post({
        type: "rpcReq",
        requestId,
        participantId: this.participantId,
        targetLeaderId: this._leaderId,
        epoch: this._epoch,
        action: entry.action,
        ...entry.payload,
      });
    }
  }

  _rejectPendingOutcomeUnknown(reason) {
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(kernelError(`KernelElection: ${reason}. The outcome of the request is unknown, so it is not re-executed automatically`, "PYPROC_RPC_OUTCOME_UNKNOWN", false));
    }
    this._pending.clear();
  }

  async _request(action, payload = {}, opts = {}) {
    await this.ready({ timeoutMs: opts.timeoutMs || this._rpcTimeoutMs });
    if (this._role === "leader") {
      if (action === "run") {
        return this._enqueueCommand(async () => {
          const response = await this._execute("run", payload);
          if (this._autoCommit && this._journal) {
            try { await this._commitJournal(); }
            catch (error) { throw durabilityUnknown(error); }
          }
          if (response.ok) return response.result;
          throw kernelError(response.error, response.code || "PYPROC_KERNEL_EXECUTION_ERROR", response.retryable === true);
        });
      }
      if (action === "commit") {
        return this._enqueueCommand(() => this._commitJournal());
      }
    }
    const replayQueued = this._journalDir && [...this._pending.values()].some((entry) => entry.awaitingLeader);
    if (!replayQueued && (!this._leaderId || this._phase !== "ready")) {
      throw kernelError("KernelElection: no leader is available to run this", "PYPROC_LEADER_UNAVAILABLE", true);
    }
    const leaderId = this._leaderId;
    const epoch = this._epoch;
    const requestId = `${this.participantId}/${++this._seq}`;
    const timeoutMs = opts.timeoutMs || this._rpcTimeoutMs;
    // 승계 대기 중인 요청이 있으면 새 명령도 그 뒤에 선다. 먼저 보내면 호출자가 보낸 순서와
    // 리더가 실행한 순서가 달라진다(재전송이 나가기 전에 새 명령이 도착한다). Map은 삽입
    // 순서를 지키므로 줄 자체가 순서의 정본이다.
    const queuedBehindReplay = replayQueued;
    return new Promise((resolve, reject) => {
      const timer = queuedBehindReplay ? null : setTimeout(() => {
        this._pending.delete(requestId);
        this._notify();
        reject(kernelError("KernelElection: the sent RPC timed out. Whether it ran is unknown, so it is not re-executed automatically", "PYPROC_RPC_OUTCOME_UNKNOWN", false));
      }, timeoutMs);
      this._pending.set(requestId, { resolve, reject, timer, leaderId, epoch, action, payload, timeoutMs, awaitingLeader: queuedBehindReplay });
      if (queuedBehindReplay) { this._notify(); return; }
      this._post({
        type: "rpcReq",
        requestId,
        participantId: this.participantId,
        targetLeaderId: leaderId,
        epoch,
        action,
        ...payload,
      });
      this._notify();
    });
  }

  run(code, opts = {}) {
    return this._request("run", { code, async: !!opts.async }, opts);
  }

  commit(opts = {}) {
    return this._request("commit", {}, opts);
  }

  ready(opts = {}) {
    if (!this._joined) this.join();
    if (this._phase === "ready" && this._leaderId) return Promise.resolve(this.status());
    if (this._phase === "failed") return Promise.reject(this._error);
    const timeoutMs = opts.timeoutMs || DEFAULT_READY_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this._readyWaiters.delete(waiter);
        reject(kernelError("KernelElection: leader ready timeout", "PYPROC_LEADER_UNAVAILABLE", true));
      }, timeoutMs);
      this._readyWaiters.add(waiter);
    });
  }

  _settleReady() {
    if (this._phase !== "ready" || !this._leaderId) return;
    this._resendParkedPending();
    const status = this.status();
    for (const waiter of this._readyWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(status);
    }
    this._readyWaiters.clear();
  }

  _fail(error) {
    this._error = error instanceof Error ? error : new PyProcError("PYPROC_INTERNAL", String(error));
    this._phase = "failed";
    for (const waiter of this._readyWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(this._error);
    }
    this._readyWaiters.clear();
    this._rejectPendingOutcomeUnknown("kernel이 실패했다");
    this._notify();
  }

  _setState(state) {
    if (state.role) this._role = state.role;
    if (state.phase) this._phase = state.phase;
    this._notify();
  }

  status() {
    const cutoff = Date.now() - this._presenceTimeoutMs;
    const participants = [...this._participants.entries()]
      .filter(([, seenAt]) => seenAt >= cutoff)
      .map(([id]) => id)
      .sort();
    if (!participants.includes(this.participantId) && !this._left) participants.push(this.participantId);
    return Object.freeze({
      name: this.name,
      storageKey: this._storageKey,
      participantId: this.participantId,
      leaderId: this._leaderId,
      role: this._role,
      phase: this._phase,
      epoch: this._epoch,
      recovered: this._recovered,
      lastCommitAt: this._lastCommitAt,
      participantCount: participants.length,
      participants: Object.freeze(participants),
      pendingRequests: this._pending.size,
      bootMs: this._leaderBootMs,
      recoveryMs: this._recoveryMs,
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
      jspi: typeof WebAssembly.Suspending === "function",
      durable: !!this._journalDir,
      autoCommit: this._autoCommit,
      rpcSemantics: RPC_SEMANTICS,
      error: this._error ? String(this._error.message || this._error) : null,
    });
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new PyProcError("PYPROC_INPUT_INVALID", "KernelElection.subscribe: a function is required");
    this._listeners.add(listener);
    listener(this.status());
    return () => this._listeners.delete(listener);
  }

  _notify() {
    if (!this._listeners.size) return;
    const status = this.status();
    for (const listener of this._listeners) {
      try { listener(status); }
      catch (error) { queueMicrotask(() => { throw error; }); }
    }
  }

  role() { return this._role; }

  leave() {
    if (this._left) return;
    this._left = true;
    this._servingLeader = false;
    if (this._journal) this._journal.stop();
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
    if (this._lockAbort) { this._lockAbort.abort(); this._lockAbort = null; }
    this._post({ type: "bye", participantId: this.participantId });
    this._rejectPendingOutcomeUnknown("participant가 떠났다");
    for (const waiter of this._readyWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(kernelError("KernelElection: the participant left", "PYPROC_PARTICIPANT_LEFT"));
    }
    this._readyWaiters.clear();
    if (this._releaseLeader) { this._releaseLeader(); this._releaseLeader = null; }
    if (this._chan) { this._chan.close(); this._chan = null; }
    this._participants.clear();
    this._leaderId = null;
    this._role = "idle";
    this._phase = "left";
    this._notify();
  }
}

export async function openDurableMachine(opts = {}) {
  const name = opts.name || "pyprocMachine";
  let journalDir = opts.journalDir || null;
  let storageKey = opts.storageKey || null;
  if (!journalDir) {
    if (!globalThis.navigator?.storage?.getDirectory) throw new PyProcError("PYPROC_ENV_UNSUPPORTED", "open(): OPFS is required");
    const root = opts.storageRoot || await navigator.storage.getDirectory();
    const machines = await root.getDirectoryHandle(opts.machineRoot || MACHINE_ROOT, { create: true });
    storageKey ||= await sha256Name(name);
    journalDir = await machines.getDirectoryHandle(storageKey, { create: true });
  }
  const manifest = {
    ...(opts.manifest || {}),
    ...(opts.assetIntegrity ? { assetIntegrity: opts.assetIntegrity } : {}),
  };
  const machine = new KernelElection({
    name,
    manifest,
    journalDir,
    storageKey,
    participantId: opts.participantId,
    heartbeatMs: opts.heartbeatMs,
    presenceTimeoutMs: opts.presenceTimeoutMs,
    rpcTimeoutMs: opts.rpcTimeoutMs,
    onLeader: opts.onLeader,
    onStatus: opts.onStatus,
    autoCommit: opts.autoCommit,
  });
  machine.join();
  try {
    await machine.ready({ timeoutMs: opts.timeoutMs || DEFAULT_READY_TIMEOUT_MS });
    return machine;
  } catch (error) {
    machine.leave();
    throw error;
  }
}
