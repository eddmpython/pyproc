// kernelElection.js - Layer 3: 같은 origin의 여러 탭을 하나의 지속 Python 머신으로 묶는다.
// "누가 그 Session을 소유하는가"가 전부라 session.js와 같은 층이다(bootSession 소비).
// Web Locks가 리더를 하나로 제한하고, 영속 epoch가 이전 리더의 늦은 응답을 fence한다.
// 리더 탭이 사라지면 다음 참여자가 같은 매니페스트로 부팅하고 MachineJournal의 마지막
// commit 경계에서 힙과 /home/web을 함께 복구한다. SharedWorker와 달리 문서의 COI/SAB를 유지한다.
import { bootSession } from "./session.js";
import { MachineJournal } from "../capabilities/machineJournal.js";
import { PyProcError } from "../runtime/errors.js";
import { sha256Hex } from "../runtime/contentDigest.js";

const PROTOCOL_VERSION = 2;
const EPOCH_FILE = "EPOCH.json";
const DEFAULT_HEARTBEAT_MS = 1000;
const DEFAULT_PRESENCE_TIMEOUT_MS = 5000;
const DEFAULT_READY_TIMEOUT_MS = 20000;
const DEFAULT_RPC_TIMEOUT_MS = 8000;
const SERVED_CACHE_MAX = 256;
const MACHINE_ROOT = "pyprocMachines";

function makeId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
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

function normalizeResult(result) {
  const value = result && result.toJs ? result.toJs() : (result === undefined ? null : result);
  if (result && result.destroy) result.destroy();
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
    if (!globalThis.navigator?.locks?.request) throw new PyProcError("PYPROC_ENV_UNSUPPORTED", "KernelElection: Web Locks API가 필요하다");
    if (typeof BroadcastChannel !== "function") throw new PyProcError("PYPROC_ENV_UNSUPPORTED", "KernelElection: BroadcastChannel API가 필요하다");
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
      this._fail(kernelError(`KernelElection: leader lock 실패(${String(error).slice(-180)})`, "PYPROC_LEADER_LOCK_FAILED", true));
    });
    return this;
  }

  async _nextEpoch() {
    if (!this._journalDir) return Math.max(1, this._epoch + 1);
    let current = 0;
    try {
      const file = await (await this._journalDir.getFileHandle(EPOCH_FILE)).getFile();
      const doc = JSON.parse(await file.text());
      if (!Number.isSafeInteger(doc.epoch) || doc.epoch < 0) throw new PyProcError("PYPROC_INTERNAL", "epoch 범위 위반");
      current = doc.epoch;
    } catch (error) {
      if (error.name !== "NotFoundError") throw new PyProcError("PYPROC_JOURNAL_CORRUPT", `KernelElection: EPOCH.json 파손(${String(error.message || error).slice(-160)})`);
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
    if (this._pending.size) this._rejectPendingOutcomeUnknown("요청을 보낸 participant가 새 leader로 승격됐다");
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
        });
        const recoveryStarted = now();
        recovered = await this._journal.recover();
        this._recoveryMs = Math.round(now() - recoveryStarted);
        this._recovered = !!recovered;
        this._lastCommitAt = recovered?.committedAt || null;
        this._journal.start();
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
      this._serve(message);
      return;
    }
    if (message.type === "rpcRes") this._acceptResponse(message);
  }

  _acceptLeader(message) {
    if (!Number.isSafeInteger(message.epoch) || message.epoch < 1 || !message.leaderId) return;
    if (message.epoch < this._epoch) return;
    if (message.epoch === this._epoch && this._leaderId && this._leaderId !== message.leaderId) {
      this._fail(kernelError(`KernelElection: 같은 epoch ${message.epoch}에 leader가 둘이다`, "PYPROC_SPLIT_BRAIN"));
      return;
    }
    const changed = this._leaderId && (message.epoch > this._epoch || message.leaderId !== this._leaderId);
    if (changed) this._rejectPendingOutcomeUnknown("leader가 요청 처리 중 바뀌었다");
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
    let response;
    try {
      let result;
      if (message.action === "run") {
        const raw = message.async
          ? await this._session.rt.runAsync(message.code)
          : this._session.rt.run(message.code);
        result = normalizeResult(raw);
      } else if (message.action === "commit") {
        result = this._journal ? await this._journal.commit() : null;
        this._lastCommitAt = result?.committedAt || this._lastCommitAt;
        this._announceLeader(true);
      } else {
        throw kernelError(`KernelElection: 알 수 없는 RPC action(${message.action})`, "PYPROC_RPC_ACTION_INVALID");
      }
      response = {
        type: "rpcRes",
        to: message.participantId,
        requestId: message.requestId,
        leaderId: this.participantId,
        epoch: this._epoch,
        ok: true,
        result,
      };
    } catch (error) {
      response = {
        type: "rpcRes",
        to: message.participantId,
        requestId: message.requestId,
        leaderId: this.participantId,
        epoch: this._epoch,
        ok: false,
        ...errorPayload(error),
      };
    }
    this._served.set(message.requestId, response);
    if (this._served.size > SERVED_CACHE_MAX) this._served.delete(this._served.keys().next().value);
    this._post(response);
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

  _rejectPendingOutcomeUnknown(reason) {
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(kernelError(`KernelElection: ${reason}. 요청 결과는 알 수 없으므로 자동 재실행하지 않는다`, "PYPROC_RPC_OUTCOME_UNKNOWN", false));
    }
    this._pending.clear();
  }

  async _request(action, payload = {}, opts = {}) {
    await this.ready({ timeoutMs: opts.timeoutMs || this._rpcTimeoutMs });
    if (this._role === "leader") {
      if (action === "run") {
        const raw = payload.async
          ? await this._session.rt.runAsync(payload.code)
          : this._session.rt.run(payload.code);
        return normalizeResult(raw);
      }
      if (action === "commit") {
        const result = this._journal ? await this._journal.commit() : null;
        this._lastCommitAt = result?.committedAt || this._lastCommitAt;
        this._announceLeader(true);
        this._notify();
        return result;
      }
    }
    if (!this._leaderId || this._phase !== "ready") {
      throw kernelError("KernelElection: 실행 가능한 leader가 없다", "PYPROC_LEADER_UNAVAILABLE", true);
    }
    const leaderId = this._leaderId;
    const epoch = this._epoch;
    const requestId = `${this.participantId}/${++this._seq}`;
    const timeoutMs = opts.timeoutMs || this._rpcTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(requestId);
        this._notify();
        reject(kernelError("KernelElection: 전송한 RPC가 timeout됐다. 실행 여부를 알 수 없어 자동 재실행하지 않는다", "PYPROC_RPC_OUTCOME_UNKNOWN", false));
      }, timeoutMs);
      this._pending.set(requestId, { resolve, reject, timer, leaderId, epoch });
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
      rpcSemantics: "sent request is never auto-replayed; leader change or timeout means outcome unknown",
      error: this._error ? String(this._error.message || this._error) : null,
    });
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new PyProcError("PYPROC_INPUT_INVALID", "KernelElection.subscribe: 함수가 필요하다");
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
      waiter.reject(kernelError("KernelElection: participant가 떠났다", "PYPROC_PARTICIPANT_LEFT"));
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

export async function openPersistentMachine(opts = {}) {
  const name = opts.name || "pyprocMachine";
  let journalDir = opts.journalDir || null;
  let storageKey = opts.storageKey || null;
  if (!journalDir) {
    if (!globalThis.navigator?.storage?.getDirectory) throw new PyProcError("PYPROC_ENV_UNSUPPORTED", "openPersistentMachine: OPFS가 필요하다");
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
