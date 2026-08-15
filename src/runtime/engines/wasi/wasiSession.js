// wasiSession.js - Layer 0 public CPython/WASI session surface.
// The interpreter is worker-owned, so every command uses a Promise-first contract. Checkpoint,
// restore, resume, and branching use only PyProc-owned contracts over exported memory.
//
// 값 채널 무상태화(완전 시간여행의 열쇠)는 여기서 완전히 캡슐화한다: 소비자는 async run/get/set/
// checkpoint/timeTravel만 보고, /cmd 파일 + 신호 1바이트 + EOT 와이어(wasiProtocol.js)는 모른다.
// 값 다리는 JSON 직렬화 한정이라 함수, 배열 라이브러리 객체, live object는 넘기지 않는다.
import { SIGNAL_META, EOT, CTL_WORDS, DATA_SAB_BYTES, SITE_PATH } from "./wasiProtocol.js";
import { unzipWheel } from "./wheelUnzip.js";
import { verifyPyProcAssetIntegrity } from "../../assets.js";
import { PyProcError, fromErrorPayload } from "../../errors.js";
import { base64FromBytes, parseSha256Address, SHA256_ADDRESS_PREFIX } from "../../contentDigest.js";
import { inspectPurePythonWheel } from "../../wheelInstaller.js";
import { requireCoi } from "../../preflight.js";
import { CoreHostcallBroker } from "../../kernel/coreHostcallBroker.js";
import {
  HOSTCALL_ABI_VERSION,
  HOSTCALL_CONTROL_WORDS,
  HOSTCALL_DATA_BYTES,
  HOSTCALL_ERROR,
  HOSTCALL_MAGIC,
  HOSTCALL_STATE,
  HOSTCALL_WORD,
  assertHostcallControl,
  createHostcallSharedState,
  hostcallRequestId,
} from "../../kernel/hostcallProtocol.js";
import {
  RUNTIME_CAPABILITIES,
  RUNTIME_CONTRACT_VERSION,
} from "../../runtimeContract.js";

const WASI_RUNTIME_CAPABILITIES = Object.freeze([
  RUNTIME_CAPABILITIES.asyncExecution,
  RUNTIME_CAPABILITIES.globals,
  RUNTIME_CAPABILITIES.hostValues,
  RUNTIME_CAPABILITIES.checkpoint,
  RUNTIME_CAPABILITIES.packages,
]);
let hostcallSessionCounter = 0;

const DEFAULT_STDLIB_DIR = "python3.14";

const PYTHON_VALUE_ENVELOPE_HELPER = `
import base64 as _pyprocEnvelopeB64
import hashlib as _pyprocEnvelopeHash
import inspect as _pyprocEnvelopeInspect
import json as _pyprocEnvelopeJson
import math as _pyprocEnvelopeMath

_PYPROC_ENVELOPE_PROTOCOL = "pyproc.value-envelope"

def _pyprocEnvelopeBase(kind, **fields):
    return {"protocol": _PYPROC_ENVELOPE_PROTOCOL, "version": 1, "kind": kind, **fields}

def _pyprocEnvelopeEncode(value, state=None, depth=0):
    if state is None:
        state = {"seen": set(), "nodes": 0, "inline": 0, "maxDepth": 32,
                 "maxNodes": 10000, "maxInline": 1024 * 1024, "maxString": 1024 * 1024}
    if depth > state["maxDepth"]:
        raise ValueError("KERNEL_VALUE_LIMIT: depth")
    state["nodes"] += 1
    if state["nodes"] > state["maxNodes"]:
        raise ValueError("KERNEL_VALUE_LIMIT: nodes")
    if value is None:
        return _pyprocEnvelopeBase("null")
    if isinstance(value, bool):
        return _pyprocEnvelopeBase("bool", value=value)
    if isinstance(value, int):
        if -(2 ** 53 - 1) <= value <= 2 ** 53 - 1:
            return _pyprocEnvelopeBase("number", value=value)
        return _pyprocEnvelopeBase("bigint", decimal=str(value))
    if isinstance(value, float):
        if not _pyprocEnvelopeMath.isfinite(value):
            raise ValueError("KERNEL_VALUE_INVALID: non-finite number")
        return _pyprocEnvelopeBase("number", value=0 if value == 0 else value)
    if isinstance(value, str):
        size = len(value.encode("utf-8"))
        if size > state["maxString"]:
            raise ValueError("KERNEL_VALUE_LIMIT: string")
        state["inline"] += size
        if state["inline"] > state["maxInline"]:
            raise ValueError("KERNEL_VALUE_LIMIT: inline")
        return _pyprocEnvelopeBase("string", value=value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        raw = bytes(value)
        state["inline"] += len(raw)
        if state["inline"] > state["maxInline"]:
            raise ValueError("KERNEL_VALUE_LIMIT: inline")
        return _pyprocEnvelopeBase("bytes", base64=_pyprocEnvelopeB64.b64encode(raw).decode("ascii"),
            byteLength=len(raw), sha256=${JSON.stringify(SHA256_ADDRESS_PREFIX)} + _pyprocEnvelopeHash.sha256(raw).hexdigest())
    if not isinstance(value, (list, tuple, dict)):
        raise TypeError("KERNEL_VALUE_INVALID: unsupported Python value")
    identity = id(value)
    if identity in state["seen"]:
        raise ValueError("KERNEL_VALUE_INVALID: cycle or shared identity")
    state["seen"].add(identity)
    if isinstance(value, (list, tuple)):
        return _pyprocEnvelopeBase("list", items=[_pyprocEnvelopeEncode(item, state, depth + 1) for item in value])
    entries = []
    for key in sorted(value.keys(), key=lambda item: str(item).encode("utf-8")):
        if not isinstance(key, str):
            raise TypeError("KERNEL_VALUE_INVALID: map key must be string")
        keySize = len(key.encode("utf-8"))
        if keySize > state["maxString"]:
            raise ValueError("KERNEL_VALUE_LIMIT: map key")
        state["inline"] += keySize
        entries.append([key, _pyprocEnvelopeEncode(value[key], state, depth + 1)])
    if state["inline"] > state["maxInline"]:
        raise ValueError("KERNEL_VALUE_LIMIT: inline")
    return _pyprocEnvelopeBase("map", entries=entries)

def _pyprocEnvelopeDecode(envelope):
    if not isinstance(envelope, dict) or envelope.get("protocol") != _PYPROC_ENVELOPE_PROTOCOL or envelope.get("version") != 1:
        raise ValueError("KERNEL_VALUE_INVALID: protocol")
    kind = envelope.get("kind")
    if kind == "null":
        return None
    if kind in ("bool", "number", "string"):
        return envelope["value"]
    if kind == "bigint":
        return int(envelope["decimal"])
    if kind == "bytes":
        raw = _pyprocEnvelopeB64.b64decode(envelope["base64"], validate=True)
        if len(raw) != envelope["byteLength"] or ${JSON.stringify(SHA256_ADDRESS_PREFIX)} + _pyprocEnvelopeHash.sha256(raw).hexdigest() != envelope["sha256"]:
            raise ValueError("KERNEL_VALUE_INVALID: bytes integrity")
        return raw
    if kind == "list":
        return [_pyprocEnvelopeDecode(item) for item in envelope["items"]]
    if kind == "map":
        return {key: _pyprocEnvelopeDecode(item) for key, item in envelope["entries"]}
    raise ValueError("KERNEL_VALUE_INVALID: unsupported transport kind")

def _pyprocDriveImmediateAwaitable(awaitable):
    sendValue = None
    while True:
        try:
            yielded = awaitable.send(sendValue)
        except StopIteration as completed:
            return completed.value
        if yielded is None:
            sendValue = None
        elif _pyprocEnvelopeInspect.isawaitable(yielded):
            sendValue = _pyprocDriveImmediateAwaitable(yielded)
        else:
            raise RuntimeError("KERNEL_APPLICATION_AWAIT_UNSUPPORTED")

def _pyprocInvokeApplication(name, args):
    fn = globals()[name]
    result = fn(*[_pyprocEnvelopeDecode(item) for item in args])
    if _pyprocEnvelopeInspect.isawaitable(result):
        result = _pyprocDriveImmediateAwaitable(result)
    return _pyprocEnvelopeEncode(result)
`;

function pythonName(name, operation) {
  if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new PyProcError("PYPROC_INPUT_INVALID", `${operation}: Python global name is invalid`);
  }
  return name;
}

// WASI 세션은 KernelFactory가 digest 검증한 engine과 stdlib bytes만 받는다. 네트워크 위치를
// 해석하거나 fallback artifact를 고르는 책임은 이 loader에 없다.
export async function bootWasi(manifest = {}) {
  if (!(manifest.wasmBytes instanceof ArrayBuffer) && !(manifest.wasmBytes instanceof Uint8Array)
    || !(manifest.stdlibBytes instanceof ArrayBuffer) && !(manifest.stdlibBytes instanceof Uint8Array)) {
    throw new PyProcError("PYPROC_ASSET_MISSING",
      "bootWasi requires verified wasmBytes and stdlibBytes from KernelFactory");
  }
  const stdlibDir = manifest.stdlibDir || DEFAULT_STDLIB_DIR;
  const wasmBytes = manifest.wasmBytes instanceof Uint8Array
    ? manifest.wasmBytes.slice().buffer : manifest.wasmBytes.slice(0);
  const stdlibBytes = manifest.stdlibBytes instanceof Uint8Array
    ? manifest.stdlibBytes : new Uint8Array(manifest.stdlibBytes);
  const stdlibFiles = await unzipWheel(stdlibBytes);
  const session = new WasiSession(wasmBytes, !!manifest.deterministic, stdlibFiles, stdlibDir,
    manifest.assetIntegrity || null, manifest.hostBroker || null, manifest.bootstrapSnapshot || null);
  await session._boot();
  if (manifest.bootstrapSnapshot) await session.importBootstrapSnapshot();
  if (manifest.packageEnvironment) await session.installEnvironment(manifest.packageEnvironment);
  for (const wheel of manifest.wheels || []) await session.installWheel(wheel);
  await session._ensureValueEnvelope();
  return session;
}

export class WasiSession {
  constructor(wasmBytes, deterministic, stdlibFiles, stdlibDir, assetIntegrity = null, hostBroker = null,
    bootstrapSnapshot = null) {
    this._wasmBytes = wasmBytes;
    this._deterministic = deterministic;
    this._stdlibFiles = stdlibFiles || null; // 외부 stdlib 빌드면 [[상대경로,바이트]], self-contained면 null
    this._stdlibDir = stdlibDir || null;     // /lib/<stdlibDir> 마운트 지점
    this._worker = null;
    this._assetIntegrity = assetIntegrity;
    this._terminalError = null;
    this._failureListeners = new Set();
    this._valueEnvelopeReady = null;
    this._packageTransactions = 0;
    this._environmentPaths = [];
    this._environmentNames = [];
    this._hostBroker = hostBroker || new CoreHostcallBroker();
    this._ownsHostBroker = !hostBroker;
    this._hostcallNamespace = `wasi-session:${++hostcallSessionCounter}`;
    this._hostcallControllers = new Map();
    this._bootstrapSnapshot = bootstrapSnapshot;
    this.bootstrapSnapshotIndex = null;
    // 이 세션은 제어/데이터 채널이 SAB다. 가드 없이 만들면 헤더 없는 페이지에서
    // "SharedArrayBuffer is not defined"가 그대로 새어나간다(README가 없다고 약속한 문장).
    requireCoi("bootWasi (WASI CPython session)");
    this._ctl = new Int32Array(new SharedArrayBuffer(CTL_WORDS * 4));
    this._data = new Uint8Array(new SharedArrayBuffer(DATA_SAB_BYTES));
    const hostcallShared = createHostcallSharedState(
      new SharedArrayBuffer(HOSTCALL_CONTROL_WORDS * Int32Array.BYTES_PER_ELEMENT),
      new SharedArrayBuffer(HOSTCALL_DATA_BYTES),
    );
    this._hostcallControl = new Int32Array(hostcallShared.control);
    this._hostcallData = new Uint8Array(hostcallShared.data);
    this._queue = []; this._idle = false; this._cur = null; this._lines = { stdout: [], stderr: [] };
  }
  get runtimeContractVersion() { return RUNTIME_CONTRACT_VERSION; }
  get runtimeKind() { return "wasi"; }
  capabilities() { return WASI_RUNTIME_CAPABILITIES; }

  async _boot() {
    if (this._assetIntegrity) await verifyPyProcAssetIntegrity(this._assetIntegrity, { roles: ["wasiWorker"] });
    this._worker = new Worker(new URL("./wasiWorker.js", import.meta.url), { type: "module" });
    this._worker.addEventListener("message", (e) => this._onMessage(e.data));
    this._worker.addEventListener("error", (event) => this._fail(new PyProcError(
      "PYPROC_WORKER_CRASHED", `WasiSession worker error: ${event.message || "unknown error"}`)));
    this._worker.addEventListener("messageerror", () => this._fail(new PyProcError(
      "PYPROC_WORKER_CRASHED", "WasiSession worker message could not be deserialized")));
    try {
      await new Promise((resolve, reject) => {
        const onReady = (e) => {
          if (e.data.type === "ready") { this._worker.removeEventListener("message", onReady); resolve(); }
          else if (e.data.type === "bootError") { this._worker.removeEventListener("message", onReady); reject(fromErrorPayload(e.data, "PYPROC_BOOT_FAILED")); }
        };
        this._worker.addEventListener("message", onReady);
        this._worker.postMessage({ type: "boot", deterministic: this._deterministic,
          wasmBytes: this._wasmBytes, stdlibFiles: this._stdlibFiles, stdlibDir: this._stdlibDir,
          ctlSab: this._ctl.buffer, dataSab: this._data.buffer,
          hostcallControlSab: this._hostcallControl.buffer, hostcallDataSab: this._hostcallData.buffer,
          bootstrapSnapshot: this._bootstrapSnapshot });
      });
    } catch (error) {
      this._fail(error);
      throw this._terminalError;
    }
  }

  _onMessage(m) {
    if (m.type === "idle") { this._idle = true; this._pump(); }
    else if (m.type === "meta") { const c = this._cur; this._cur = null; if (c) c.resolve(m); this._pump(); }
    else if (m.type === "runtimeFault") this._fail(fromErrorPayload(m, "PYPROC_WORKER_CRASHED"));
    else if (m.type === "exited") this._fail(new PyProcError("PYPROC_WORKER_CRASHED", "WasiSession worker exited unexpectedly"));
    else if (m.type === "hostcallRequest") this._dispatchHostcall().catch((error) => this._fail(error));
    else if (m.type === "out") {
      if (m.line === String.fromCharCode(EOT)) {
        const out = this._lines.stdout.join("\n"), err = this._lines.stderr.join("\n");
        this._lines = { stdout: [], stderr: [] };
        const c = this._cur; this._cur = null; if (c) c.resolve({ out, err }); this._pump();
      } else this._lines[m.stream].push(m.line);
    }
  }

  async _dispatchHostcall() {
    const control = this._hostcallControl;
    const data = this._hostcallData;
    assertHostcallControl(control, data);
    if (Atomics.compareExchange(control, HOSTCALL_WORD.state, HOSTCALL_STATE.request,
      HOSTCALL_STATE.processing) !== HOSTCALL_STATE.request) return;
    const requestOffset = Atomics.load(control, HOSTCALL_WORD.requestOffset) >>> 0;
    const requestLength = Atomics.load(control, HOSTCALL_WORD.requestLength) >>> 0;
    const responseOffset = Atomics.load(control, HOSTCALL_WORD.responseOffset) >>> 0;
    const responseCapacity = Atomics.load(control, HOSTCALL_WORD.responseCapacity) >>> 0;
    const invalid = Atomics.load(control, HOSTCALL_WORD.magic) !== HOSTCALL_MAGIC
      || Atomics.load(control, HOSTCALL_WORD.abiVersion) !== HOSTCALL_ABI_VERSION
      || requestOffset + requestLength > data.byteLength
      || responseOffset + responseCapacity > data.byteLength;
    if (invalid) {
      Atomics.store(control, HOSTCALL_WORD.responseLength, 0);
      Atomics.store(control, HOSTCALL_WORD.errorCode, HOSTCALL_ERROR.invalid);
      Atomics.store(control, HOSTCALL_WORD.state, HOSTCALL_STATE.error);
      Atomics.notify(control, HOSTCALL_WORD.state);
      return;
    }
    const requestId = hostcallRequestId(control);
    const requestKey = `${this._hostcallNamespace}:${requestId}`;
    const controller = new AbortController();
    this._hostcallControllers.set(requestKey, controller);
    let result;
    try {
      const context = this._cur?.context || {};
      result = await this._hostBroker.dispatch({
        requestKey,
        opcode: Atomics.load(control, HOSTCALL_WORD.opcode) >>> 0,
        flags: Atomics.load(control, HOSTCALL_WORD.flags) >>> 0,
        payload: data.slice(requestOffset, requestOffset + requestLength),
        responseCapacity,
        deadlineMs: Atomics.load(control, HOSTCALL_WORD.deadlineMs) >>> 0,
        authorityRef: context.authorityRef,
        commandId: context.commandId,
        kernelRef: context.kernelRef,
      }, { signal: controller.signal });
    } finally {
      this._hostcallControllers.delete(requestKey);
    }
    if (Atomics.load(control, HOSTCALL_WORD.state) !== HOSTCALL_STATE.processing) return;
    let state = result.state;
    let errorCode = result.errorCode;
    let bytes = result.bytes instanceof Uint8Array ? result.bytes : new Uint8Array();
    if (bytes.byteLength > responseCapacity) {
      state = HOSTCALL_STATE.error;
      errorCode = HOSTCALL_ERROR.overflow;
      bytes = new Uint8Array();
    }
    data.set(bytes, responseOffset);
    if (Atomics.load(control, HOSTCALL_WORD.state) !== HOSTCALL_STATE.processing) return;
    Atomics.store(control, HOSTCALL_WORD.responseLength, bytes.byteLength);
    Atomics.store(control, HOSTCALL_WORD.errorCode, errorCode);
    Atomics.store(control, HOSTCALL_WORD.state, state);
    Atomics.notify(control, HOSTCALL_WORD.state);
  }

  _send(payload, context = null) {
    return new Promise((resolve, reject) => {
      if (this._terminalError) return reject(this._terminalError);
      if (!this._worker) return reject(new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "WasiSession: terminated"));
      this._queue.push({ payload, context, resolve, reject });
      this._pump();
    });
  }

  _fail(error) {
    if (this._terminalError) return;
    this._terminalError = error instanceof PyProcError ? error : new PyProcError(
      "PYPROC_WORKER_CRASHED", `WasiSession failed: ${String(error)}`, { cause: error });
    const current = this._cur;
    this._cur = null;
    if (current) current.reject(this._terminalError);
    for (const queued of this._queue) queued.reject(this._terminalError);
    this._queue = [];
    this._idle = false;
    if (this._ownsHostBroker) this._hostBroker.close("WASI session failed");
    else for (const controller of this._hostcallControllers.values()) controller.abort("WASI session failed");
    this._hostcallControllers.clear();
    for (const listener of this._failureListeners) {
      try { listener(this._terminalError); }
      catch (listenerError) { queueMicrotask(() => { throw listenerError; }); }
    }
    if (this._worker) this._worker.terminate();
    this._worker = null;
  }

  onFailure(listener) {
    if (typeof listener !== "function") throw new PyProcError("PYPROC_INPUT_INVALID", "WasiSession.onFailure requires a function");
    this._failureListeners.add(listener);
    if (this._terminalError) queueMicrotask(() => listener(this._terminalError));
    return () => this._failureListeners.delete(listener);
  }

  _pump() {
    if (!this._idle || this._cur || !this._queue.length) return;
    this._cur = this._queue.shift(); this._idle = false;
    const bytes = this._cur.payload;
    if (bytes.length > DATA_SAB_BYTES) { const c = this._cur; this._cur = null; return c.resolve({ out: "", err: "코드가 채널 상한 초과" }); }
    this._data.set(bytes);
    Atomics.store(this._ctl, 1, bytes.length);
    Atomics.store(this._ctl, 0, 1);
    Atomics.notify(this._ctl, 0);
  }

  // 코드 실행(async). stdout을 반환하고, 파이썬 예외(stderr)는 WasiSession 에러로 던진다.
  async run(code, context = null) {
    const b = new TextEncoder().encode(code);
    const payload = new Uint8Array(1 + b.length); payload[0] = 1; payload.set(b, 1); // SIGNAL_EXEC
    const { out, err } = await this._send(payload, context);
    if (err) throw new PyProcError("PYPROC_WORKER_TASK_ERROR", "WASI execution error: " + err.trim());
    return out;
  }
  runAsync(code) { return this.run(code); }

  // 값 다리(JSON 직렬화 한정): 파이썬 전역 값을 회수/주입한다.
  async get(name) { return JSON.parse((await this.run(`import json as pyprocJson\nprint(pyprocJson.dumps(${name}))`)).trim()); }
  async set(name, value) { await this.run(`import json as pyprocJson\n${name} = pyprocJson.loads(${JSON.stringify(JSON.stringify(value))})`); }
  getGlobal(name) { return this.get(name); }
  setGlobal(name, value) { return this.set(name, value); }
  toHostValue(value, options = {}) {
    if (value === undefined && Object.prototype.hasOwnProperty.call(options, "fallback")) return options.fallback;
    return value;
  }
  destroyHostValue() {}

  async _ensureValueEnvelope() {
    if (!this._valueEnvelopeReady) {
      this._valueEnvelopeReady = this.run(PYTHON_VALUE_ENVELOPE_HELPER).catch((error) => {
        this._valueEnvelopeReady = null;
        throw error;
      });
    }
    await this._valueEnvelopeReady;
  }

  async getEnvelope(name) {
    await this._ensureValueEnvelope();
    const acceptedName = pythonName(name, "WasiSession.getEnvelope");
    return JSON.parse(await this.run(`print(_pyprocEnvelopeJson.dumps(_pyprocEnvelopeEncode(globals()[${JSON.stringify(acceptedName)}]), separators=(",", ":"), sort_keys=True, allow_nan=False))`));
  }

  async setEnvelope(name, envelopeValue) {
    await this._ensureValueEnvelope();
    const acceptedName = pythonName(name, "WasiSession.setEnvelope");
    const serialized = JSON.stringify(envelopeValue);
    await this.run(`globals()[${JSON.stringify(acceptedName)}] = _pyprocEnvelopeDecode(_pyprocEnvelopeJson.loads(${JSON.stringify(serialized)}))`);
  }

  async hasCallable(name) {
    const acceptedName = pythonName(name, "WasiSession.hasCallable");
    return (await this.run(`print(callable(globals().get(${JSON.stringify(acceptedName)})))`)).trim() === "True";
  }

  async invokeApplication(name, argumentEnvelopes) {
    await this._ensureValueEnvelope();
    const acceptedName = pythonName(name, "WasiSession.invokeApplication");
    const serialized = JSON.stringify(argumentEnvelopes);
    return JSON.parse(await this.run(`print(_pyprocEnvelopeJson.dumps(_pyprocInvokeApplication(${JSON.stringify(acceptedName)}, _pyprocEnvelopeJson.loads(${JSON.stringify(serialized)})), separators=(",", ":"), sort_keys=True, allow_nan=False))`));
  }

  // Compatibility entry point for callers that already hold one wheel. New package environments
  // use installEnvironment so the whole locked set becomes visible in one state transition.
  async installWheel(wheel, options = {}) {
    this._packageTransactions += 1;
    try {
      const tree = await inspectPurePythonWheel(wheel, options);
      return await this._installWheelTrees([tree], tree.wheelDigest, { preserveExisting: true });
    } finally {
      this._packageTransactions -= 1;
    }
  }

  async installEnvironment(request) {
    if (!request || typeof request !== "object" || !parseSha256Address(request.environmentId)
      || !Array.isArray(request.wheels) || !request.wheels.length) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "WasiSession.installEnvironment requires an environment digest and wheels");
    }
    this._packageTransactions += 1;
    try {
      const trees = [];
      for (const wheel of request.wheels) {
        trees.push(await inspectPurePythonWheel(wheel.bytes, {
          filename: wheel.filename,
          expectedName: wheel.name,
          expectedVersion: wheel.version,
          expectedSha256: wheel.sha256,
          allowedTags: request.allowedTags,
          limits: request.limits,
        }));
      }
      return await this._installWheelTrees(trees, request.environmentId);
    } finally {
      this._packageTransactions -= 1;
    }
  }

  async _installWheelTrees(trees, environmentId, { preserveExisting = false } = {}) {
    const paths = [];
    const names = new Set();
    let files = 0;
    for (const tree of trees) {
      const layerPath = `${SITE_PATH}/.pyprocLayers/${tree.treeDigest.slice(SHA256_ADDRESS_PREFIX.length)}`;
      paths.push(layerPath);
      for (const [path, bytes] of tree.files) {
        const purelib = /^[^/]+\.data\/purelib\/(.+)$/u.exec(path)?.[1] || path;
        await this._writeSiteFile(purelib, bytes, layerPath);
        files += 1;
        const top = purelib.split("/")[0];
        if (purelib.endsWith(".py") && top && !top.endsWith(".dist-info") && !top.endsWith(".data")
          && (/^[A-Za-z_][A-Za-z0-9_]*\.py$/u.test(top) || /^[A-Za-z_][A-Za-z0-9_]*$/u.test(top))) {
          names.add(top.replace(/\.py$/u, ""));
        }
      }
    }
    const nextPaths = [...new Set([...(preserveExisting ? this._environmentPaths : []), ...paths])];
    const switchNames = [...new Set([...this._environmentNames, ...names])].sort();
    const switchCode = `
import importlib as _pyprocPackageImportlib
import sys as _pyprocPackageSys
_pyprocEnvSwitchOldPaths = list(_pyprocPackageSys.path)
_pyprocEnvSwitchNames = ${JSON.stringify(switchNames)}
_pyprocEnvSwitchPrefixes = tuple(_pyprocEnvSwitchNames)
_pyprocEnvSwitchModules = {key: value for key, value in _pyprocPackageSys.modules.items()
    if key in _pyprocEnvSwitchPrefixes or key.startswith(tuple(name + "." for name in _pyprocEnvSwitchPrefixes))}
try:
    for _pyprocEnvSwitchKey in list(_pyprocEnvSwitchModules):
        _pyprocPackageSys.modules.pop(_pyprocEnvSwitchKey, None)
    for _pyprocPackagePath in list(globals().get("_pyprocEnvironmentPaths", [])):
        while _pyprocPackagePath in _pyprocPackageSys.path:
            _pyprocPackageSys.path.remove(_pyprocPackagePath)
    _pyprocEnvironmentPaths = ${JSON.stringify(nextPaths)}
    _pyprocPackageSys.path[0:0] = _pyprocEnvironmentPaths
    _pyprocPackageImportlib.invalidate_caches()
except BaseException:
    _pyprocPackageSys.path[:] = _pyprocEnvSwitchOldPaths
    _pyprocPackageSys.modules.update(_pyprocEnvSwitchModules)
    _pyprocPackageImportlib.invalidate_caches()
    raise
`;
    const smokeCode = `
import importlib as _pyprocPackageImportlib
import sys as _pyprocPackageSys
_pyprocSmokeNames = ${JSON.stringify([...names].sort())}
_pyprocSmokePrefixes = tuple(_pyprocSmokeNames)
_pyprocSmokePaths = list(_pyprocPackageSys.path)
_pyprocSmokeModules = {key: value for key, value in _pyprocPackageSys.modules.items()
    if key in _pyprocSmokePrefixes or key.startswith(tuple(name + "." for name in _pyprocSmokePrefixes))}
for _pyprocSmokeKey in list(_pyprocSmokeModules):
    _pyprocPackageSys.modules.pop(_pyprocSmokeKey, None)
try:
    _pyprocPackageSys.path[:] = ${JSON.stringify(nextPaths)} + [path for path in _pyprocPackageSys.path if path not in ${JSON.stringify(nextPaths)}]
    _pyprocPackageImportlib.invalidate_caches()
    for _pyprocPackageName in _pyprocSmokeNames:
        _pyprocPackageImportlib.import_module(_pyprocPackageName)
finally:
    for _pyprocSmokeKey in list(_pyprocPackageSys.modules):
        if _pyprocSmokeKey in _pyprocSmokePrefixes or _pyprocSmokeKey.startswith(tuple(name + "." for name in _pyprocSmokePrefixes)):
            _pyprocPackageSys.modules.pop(_pyprocSmokeKey, None)
    _pyprocPackageSys.modules.update(_pyprocSmokeModules)
    _pyprocPackageSys.path[:] = _pyprocSmokePaths
    _pyprocPackageImportlib.invalidate_caches()
`;
    await this.run(smokeCode);
    await this.run(switchCode);
    this._environmentPaths = nextPaths;
    this._environmentNames = [...names].sort();
    return Object.freeze({ protocol: "pyproc.session-environment", version: 1, environmentId,
      files, names: Object.freeze([...names].sort()),
      layers: Object.freeze(trees.map((tree, index) => Object.freeze({ path: paths[index],
        name: tree.name, packageVersion: tree.packageVersion, wheelDigest: tree.wheelDigest,
        treeDigest: tree.treeDigest }))) });
  }

  // /site 아래 한 파일을 파이썬을 통해 쓴다(base64로 실어 바이너리 보존). 중첩 경로는 makedirs로
  // 만들고, 채널 상한(DATA_SAB_BYTES)을 넘는 큰 파일은 append로 청크한다. 파일은 shim(JS)에 살아
  // wasm 힙 밖 = 시간여행 스냅샷과 독립(패키지는 안정 상태, 되돌릴 값이 아니다).
  async _writeSiteFile(relPath, bytes, basePath = SITE_PATH) {
    const full = basePath + "/" + relPath;
    const dir = full.slice(0, full.lastIndexOf("/"));
    const q = (s) => JSON.stringify(s);
    await this.run(`import os\nos.makedirs(${q(dir)}, exist_ok=True)\nopen(${q(full)}, "wb").close()`);
    const step = 480 * 1024; // base64 후 ~640KB < 1MiB 채널(파이썬 래퍼 여유분 확보)
    for (let off = 0; off < bytes.length; off += step) {
      const b64 = base64FromBytes(bytes.subarray(off, off + step));
      await this.run(`import base64\nwith open(${q(full)}, "ab") as siteFile:\n    siteFile.write(base64.b64decode(${q(b64)}))`);
    }
  }

  // 지금 상태를 체크포인트(경계 힙 스냅샷). 반환: { idx, mb }.
  async checkpoint() {
    const m = await this._send(new TextEncoder().encode(String.fromCharCode(SIGNAL_META) + "checkpoint"));
    return { idx: m.idx, mb: m.mb, snapshotKind: m.snapshotKind, parentIdx: m.parentIdx,
      deltaDepth: m.deltaDepth, stackBoundary: m.stackBoundary, initialPages: m.initialPages,
      currentPages: m.currentPages, memoryBytes: m.memoryBytes, regionBytes: m.regionBytes,
      changedPages: m.changedPages, pages: m.pages };
  }
  async resetCheckpointLineage() {
    const metadata = await this._send(new TextEncoder().encode(
      String.fromCharCode(SIGNAL_META) + "reset-checkpoint-lineage"));
    return Object.freeze({ state: metadata.kind === "reset-checkpoint-lineage" ? "reset" : "unknown" });
  }
  async importBootstrapSnapshot() {
    if (!this._bootstrapSnapshot) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "WasiSession has no bootstrap checkpoint to import");
    }
    const metadata = await this._send(new TextEncoder().encode(String.fromCharCode(SIGNAL_META) + "import"));
    this.bootstrapSnapshotIndex = metadata.idx;
    this._bootstrapSnapshot = null;
    return { idx: metadata.idx, snapshotKind: metadata.snapshotKind, parentIdx: metadata.parentIdx,
      deltaDepth: metadata.deltaDepth, stackBoundary: metadata.stackBoundary,
      initialPages: metadata.initialPages, currentPages: metadata.currentPages,
      memoryBytes: metadata.memoryBytes, regionBytes: metadata.regionBytes,
      changedPages: metadata.changedPages };
  }
  inspectCheckpointBoundary() {
    return Object.freeze({ acceptedHostcalls: this._hostcallControllers.size,
      activeTransactions: this._packageTransactions,
      outputDrained: true, openResources: [], vfsRootDigest: null });
  }
  // 시간여행: 체크포인트 idx로 복원한다. 복원 후 파이썬은 그 시점 상태로 재개한다(분기 가능).
  async timeTravel(idx) { await this._send(new TextEncoder().encode(String.fromCharCode(SIGNAL_META) + "restore " + idx)); }

  terminate() {
    this._fail(new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "WasiSession: terminated"));
  }
}
