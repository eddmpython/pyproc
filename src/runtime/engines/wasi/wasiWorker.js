// wasiWorker.js - Layer 0: CPython/WASI process running with the vendored shim in a worker.
// 부팅하고, pyproc이 소유한 드라이버(wasiReplDriver)를 세워 코드 조각을 반복 실행한다.
// wasiSession.js가 이 파일을 new URL 상대경로로 spawn한다(위치 = 번들러 워커 emit 계약).
// 값 채널 무상태화(완전 시간여행): 코드는 preopen 파일 /cmd(힙 밖), stdin은 신호 1바이트.
// 실행 경계(fd_read = 파이썬이 다음 신호 대기)에서 힙 체크포인트/복원 메타를 처리하므로
// 복원이 파이썬 I/O 상태를 어긋내지 않는다(reactive 완전 시간여행이 exports.memory 위에서 성립).
import { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory, Directory, wasi } from "./browserWasiShim.js";
import { DRIVER_SOURCE } from "./wasiReplDriver.js";
import { SIGNAL_META, EOT, CMD_PATH, DRIVER_PATH, SITE_PATH, FILETYPE_CHARACTER_DEVICE } from "./wasiProtocol.js";
import { PyProcError, toErrorPayload } from "../../errors.js";
import { PAGE_SIZE, bytesToMb } from "../../memoryLayout.js";
import {
  HOSTCALL_ABI_VERSION,
  HOSTCALL_DATA_BYTES,
  HOSTCALL_ERROR,
  HOSTCALL_MAGIC,
  HOSTCALL_PATH,
  HOSTCALL_REQUEST_HEADER_BYTES,
  HOSTCALL_RESPONSE_HEADER_BYTES,
  HOSTCALL_STATE,
  HOSTCALL_WORD,
  hostcallTerminalState,
} from "../../kernel/hostcallProtocol.js";

const MAX_CHECKPOINT_DELTA_DEPTH = 50;

// Deterministic boot owns the entropy and clock imports at this boundary.
function makeDeterministic(wasiInst, getInst) {
  wasiInst.wasiImport.random_get = (buf, len) => { new Uint8Array(getInst().exports.memory.buffer, buf, len).fill(7); return 0; };
  wasiInst.wasiImport.clock_time_get = (id, prec, out) => { new DataView(getInst().exports.memory.buffer).setBigUint64(out, 1750000000000000000n, true); return 0; };
}

// 시간여행 파티션 경계: wasm global[0](관례상 __stack_pointer)의 init = 스택 top = 정적 데이터 시작
// (CPython WASI는 --stack-first 링크). 복원 시 [0, stackTop)=shadow stack(라이브 실행)은 보존하고
// [stackTop, end)=정적데이터+힙은 되돌린다. export 심볼이 없어도(memory/_start만) 파싱으로 얻는다.
function parseStackTop(bytes) {
  const u = new Uint8Array(bytes); let p = 8; // magic(4)+version(4)
  const uLEB = () => { let r = 0, s = 0, b; do { b = u[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r >>> 0; };
  const sLEB = () => { let r = 0, s = 0, b; do { b = u[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); if (s < 32 && (b & 0x40)) r |= (-1 << s); return r; };
  while (p < u.length) {
    const id = u[p++]; const size = uLEB(); const end = p + size;
    if (id === 6) { const count = uLEB(); if (count > 0) { p++; p++; if (u[p++] === 0x41) return sLEB() >>> 0; } return 0; }
    p = end;
  }
  return 0;
}

// 평평한 [상대경로, 바이트]를 shim File/Directory 트리로. 외부 stdlib(python.wasm + 별도 lib)
// 빌드를 마운트할 때 쓴다. self-contained 빌드(WLR = stdlib baked-in)는 이게 필요 없다.
function buildTree(files) {
  const root = new Map();
  for (const [rel, bytes] of files) {
    const parts = rel.split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) { if (!node.has(parts[i])) node.set(parts[i], new Map()); node = node.get(parts[i]); }
    node.set(parts[parts.length - 1], bytes);
  }
  const mat = (node) => { const e = []; for (const [n, v] of node) e.push([n, v instanceof Map ? mat(v) : new File(v)]); return new Directory(e); };
  return mat(root);
}

// SAB 블로킹 신호 stdin. stdin은 "실행 신호 1바이트"만 나르고, 코드는 /cmd 파일(힙 밖)로 나른다.
// 그래서 fd_read는 항상 1바이트만 반환하고, 그 1바이트가 유일한 입력 상태라 힙 복원이 스트림을
// 어긋낼 여지가 없다. OpenFile 상속: 파이썬 stdin 초기화가 fdstat/seek를 조회하는데 Fd(부분
// 구현)면 깨진다(File은 되고 부분 Fd는 memory access out of bounds).
class SabStdin extends OpenFile {
  constructor(ctlSab, dataSab, cmdFile, bootstrapSnapshot = null) {
    super(new File([]));
    this.ctl = new Int32Array(ctlSab);
    this.data = new Uint8Array(dataSab);
    this.cmdFile = cmdFile;  // /cmd preopen File: 실행할 코드를 여기에 싣는다(힙 밖 채널)
    this.inst = null;        // exports.memory 접근용(체크포인트/복원)
    this.snapshots = [];     // 시간여행: 경계에서 찍은 힙 스냅샷
    this.activeSnapshotIdx = null;
    this.initialPages = 0;
    this.stackTop = 0;       // 파티션 복원 경계(parseStackTop, 0이면 전체 복원 폴백)
    this.bootstrapSnapshot = bootstrapSnapshot;
  }
  setInst(inst) {
    this.inst = inst;
    this.initialPages = this._heapU8().byteLength / PAGE_SIZE;
  }
  _heapU8() { return new Uint8Array(this.inst.exports.memory.buffer); }
  _materialize(index) {
    const chain = [];
    let cursor = this.snapshots[index];
    if (!cursor) throw new PyProcError("PYPROC_STATE_CORRUPT", `WASI checkpoint ${index} is unavailable`);
    while (cursor) {
      chain.push(cursor);
      if (cursor.kind === "full") break;
      cursor = this.snapshots[cursor.parentIdx];
    }
    if (!cursor || cursor.kind !== "full") throw new PyProcError("PYPROC_STATE_CORRUPT", "WASI checkpoint delta has no full ancestor");
    const output = new Uint8Array(chain[0].regionBytes);
    for (let chainIndex = chain.length - 1; chainIndex >= 0; chainIndex -= 1) {
      for (const [pageIndex, bytes] of chain[chainIndex].pages) output.set(bytes, pageIndex * PAGE_SIZE);
    }
    return output;
  }
  _checkpoint() {
    const heap = this._heapU8();
    const stackBoundary = this.stackTop || 0;
    const region = heap.subarray(stackBoundary);
    const parentIdx = this.activeSnapshotIdx;
    const parent = parentIdx === null ? null : this.snapshots[parentIdx];
    const requiresFull = !parent || parent.regionBytes !== region.byteLength
      || parent.deltaDepth >= MAX_CHECKPOINT_DELTA_DEPTH;
    const baseline = requiresFull ? null : this._materialize(parentIdx);
    const pages = [];
    for (let offset = 0, pageIndex = 0; offset < region.byteLength; offset += PAGE_SIZE, pageIndex += 1) {
      const current = region.subarray(offset, Math.min(offset + PAGE_SIZE, region.byteLength));
      if (!baseline) {
        pages.push([pageIndex, current.slice()]);
        continue;
      }
      const previous = baseline.subarray(offset, offset + current.byteLength);
      let changed = false;
      for (let byteIndex = 0; byteIndex < current.byteLength; byteIndex += 1) {
        if (current[byteIndex] !== previous[byteIndex]) { changed = true; break; }
      }
      if (changed) pages.push([pageIndex, current.slice()]);
    }
    const snapshot = {
      kind: requiresFull ? "full" : "delta",
      parentIdx: requiresFull ? null : parentIdx,
      deltaDepth: requiresFull ? 0 : parent.deltaDepth + 1,
      stackBoundary,
      memoryBytes: heap.byteLength,
      regionBytes: region.byteLength,
      pages,
    };
    this.snapshots.push(snapshot);
    const idx = this.snapshots.length - 1;
    this.activeSnapshotIdx = idx;
    const exportedPages = pages.map(([pageIndex, bytes]) => [pageIndex, bytes.slice()]);
    postMessage({ type: "meta", kind: "checkpoint", idx, mb: bytesToMb(heap.length),
      snapshotKind: snapshot.kind, parentIdx: snapshot.parentIdx, deltaDepth: snapshot.deltaDepth,
      stackBoundary, initialPages: this.initialPages, currentPages: heap.byteLength / PAGE_SIZE,
      memoryBytes: heap.byteLength, regionBytes: region.byteLength, changedPages: pages.length,
      pages: exportedPages }, exportedPages.map((entry) => entry[1].buffer));
  }
  _restore(index) {
    const snapshot = this.snapshots[index];
    const materialized = this._materialize(index);
    const current = this._heapU8();
    if (snapshot.stackBoundary !== (this.stackTop || 0) || current.byteLength < snapshot.memoryBytes) {
      throw new PyProcError("PYPROC_STATE_CORRUPT", "WASI checkpoint memory layout is incompatible");
    }
    const region = current.subarray(snapshot.stackBoundary);
    region.fill(0);
    region.set(materialized);
    this.activeSnapshotIdx = index;
    postMessage({ type: "meta", kind: "restore", idx: index, snapshotKind: snapshot.kind,
      deltaDepth: snapshot.deltaDepth, currentPages: current.byteLength / PAGE_SIZE });
  }
  _importBootstrap() {
    const incoming = this.bootstrapSnapshot;
    if (!incoming || !(incoming.bytes instanceof Uint8Array)
      || !Number.isSafeInteger(incoming.stackBoundary) || incoming.stackBoundary < 0
      || !Number.isSafeInteger(incoming.memoryBytes) || incoming.memoryBytes < 1
      || !Number.isSafeInteger(incoming.deltaDepth) || incoming.deltaDepth < 0
      || incoming.memoryBytes - incoming.stackBoundary !== incoming.bytes.byteLength
      || incoming.stackBoundary !== (this.stackTop || 0)
      || incoming.memoryBytes % PAGE_SIZE !== 0) {
      throw new PyProcError("PYPROC_STATE_CORRUPT", "WASI bootstrap checkpoint is invalid");
    }
    let current = this._heapU8();
    if (current.byteLength > incoming.memoryBytes) {
      throw new PyProcError("PYPROC_STATE_CORRUPT", "WASI bootstrap checkpoint is smaller than the fresh engine memory");
    }
    if (current.byteLength < incoming.memoryBytes) {
      const pages = (incoming.memoryBytes - current.byteLength) / PAGE_SIZE;
      this.inst.exports.memory.grow(pages);
      current = this._heapU8();
    }
    if (current.byteLength !== incoming.memoryBytes) {
      throw new PyProcError("PYPROC_STATE_CORRUPT", "WASI bootstrap checkpoint memory growth did not reach the requested size");
    }
    const region = current.subarray(incoming.stackBoundary);
    region.set(incoming.bytes);
    const pages = [];
    for (let offset = 0, pageIndex = 0; offset < region.byteLength; offset += PAGE_SIZE, pageIndex += 1) {
      pages.push([pageIndex, region.slice(offset, Math.min(offset + PAGE_SIZE, region.byteLength))]);
    }
    const snapshot = { kind: "full", parentIdx: null, deltaDepth: incoming.deltaDepth,
      stackBoundary: incoming.stackBoundary, memoryBytes: incoming.memoryBytes,
      regionBytes: region.byteLength, pages };
    this.snapshots.push(snapshot);
    const idx = this.snapshots.length - 1;
    this.activeSnapshotIdx = idx;
    this.bootstrapSnapshot = null;
    postMessage({ type: "meta", kind: "import", idx, snapshotKind: "full", parentIdx: null,
      deltaDepth: snapshot.deltaDepth, stackBoundary: snapshot.stackBoundary, initialPages: this.initialPages,
      currentPages: current.byteLength / PAGE_SIZE, memoryBytes: current.byteLength,
      regionBytes: region.byteLength, changedPages: pages.length });
  }
  fd_fdstat_get() { return { ret: 0, fdstat: new wasi.Fdstat(FILETYPE_CHARACTER_DEVICE, 0) }; }
  fd_read() {
    // 실행 경계(파이썬이 신호 1바이트 대기 = 스택 항상 같은 깊이, 입력 상태 = 없음).
    // checkpoint/restore를 여기서 처리하면 복원이 파이썬 I/O 상태를 어긋내지 않는다.
    for (;;) {
      postMessage({ type: "idle" });
      Atomics.wait(this.ctl, 0, 0);
      const n = Atomics.load(this.ctl, 1);
      const raw = this.data.slice(0, n);
      Atomics.store(this.ctl, 0, 0);
      Atomics.notify(this.ctl, 0);
      if (raw.length > 0 && raw[0] === SIGNAL_META) {
        const cmd = new TextDecoder().decode(raw.subarray(1));
        if (cmd === "checkpoint") {
          this._checkpoint();
        } else if (cmd === "import") {
          this._importBootstrap();
        } else if (cmd.startsWith("restore ")) {
          const i = +cmd.slice(8);
          // 파티션 복원: [0, stackTop)=shadow stack(라이브 fd_read 호출 체인)은 보존, [stackTop, end)=
          // 정적데이터(_PyRuntime/allocator 상태)+힙은 되돌린다(둘이 lockstep이라야 allocator 정합).
          // 할당 불변 드라이버(readinto)와 짝: 경계-넘는 힙 포인터가 안정이라 복원이 무해하다.
          this._restore(i);
        }
        continue; // 메타는 파이썬 왕복 아님(다음 신호 계속 대기)
      }
      // exec 신호: raw = [SIGNAL_EXEC, ...코드]. 코드를 /cmd에 싣고 신호 1바이트만 반환한다.
      this.cmdFile.data = raw.subarray(1).slice();
      return { ret: 0, data: new Uint8Array([1]) }; // 파이썬 os.read(0,1)이 받는 무상태 신호
    }
  }
}

class HostcallOpenFile extends OpenFile {
  constructor(controlSab, hostcallDataSab) {
    super(new File([]));
    this.control = new Int32Array(controlSab);
    this.data = new Uint8Array(hostcallDataSab);
    this.response = new Uint8Array();
    this.responseOffset = 0;
  }
  _responseFrame(state, errorCode, payload = new Uint8Array()) {
    const frame = new Uint8Array(HOSTCALL_RESPONSE_HEADER_BYTES + payload.byteLength);
    const view = new DataView(frame.buffer);
    view.setUint32(0, HOSTCALL_MAGIC, true);
    view.setUint32(4, HOSTCALL_ABI_VERSION, true);
    view.setUint32(8, state, true);
    view.setUint32(12, payload.byteLength, true);
    view.setUint32(16, errorCode, true);
    frame.set(payload, HOSTCALL_RESPONSE_HEADER_BYTES);
    this.response = frame;
    this.responseOffset = 0;
  }
  _localError(message) {
    this._responseFrame(HOSTCALL_STATE.error, HOSTCALL_ERROR.invalid,
      new TextEncoder().encode(message).subarray(0, 1000));
  }
  fd_write(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < HOSTCALL_REQUEST_HEADER_BYTES) {
      this._localError("hostcall request frame is truncated");
      return { ret: 0, nwritten: bytes?.byteLength || 0 };
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = view.getUint32(0, true);
    const abiVersion = view.getUint32(4, true);
    const opcode = view.getUint32(8, true);
    const flags = view.getUint32(12, true);
    const requestIdLow = view.getUint32(16, true);
    const requestIdHigh = view.getUint32(20, true);
    const deadlineMs = view.getUint32(24, true);
    const requestLength = view.getUint32(28, true);
    const responseCapacity = view.getUint32(32, true);
    const responseOffset = requestLength;
    if (magic !== HOSTCALL_MAGIC || abiVersion !== HOSTCALL_ABI_VERSION
      || bytes.byteLength !== HOSTCALL_REQUEST_HEADER_BYTES + requestLength
      || deadlineMs === 0 || requestLength + responseCapacity > HOSTCALL_DATA_BYTES) {
      this._localError("hostcall request frame is invalid");
      return { ret: 0, nwritten: bytes.byteLength };
    }
    if (Atomics.load(this.control, HOSTCALL_WORD.state) !== HOSTCALL_STATE.idle) {
      this._localError("hostcall shared record is busy");
      return { ret: 0, nwritten: bytes.byteLength };
    }
    this.data.set(bytes.subarray(HOSTCALL_REQUEST_HEADER_BYTES), 0);
    Atomics.store(this.control, HOSTCALL_WORD.magic, magic);
    Atomics.store(this.control, HOSTCALL_WORD.abiVersion, abiVersion);
    Atomics.store(this.control, HOSTCALL_WORD.opcode, opcode);
    Atomics.store(this.control, HOSTCALL_WORD.flags, flags);
    Atomics.store(this.control, HOSTCALL_WORD.requestIdLow, requestIdLow);
    Atomics.store(this.control, HOSTCALL_WORD.requestIdHigh, requestIdHigh);
    Atomics.store(this.control, HOSTCALL_WORD.requestOffset, 0);
    Atomics.store(this.control, HOSTCALL_WORD.requestLength, requestLength);
    Atomics.store(this.control, HOSTCALL_WORD.responseOffset, responseOffset);
    Atomics.store(this.control, HOSTCALL_WORD.responseCapacity, responseCapacity);
    Atomics.store(this.control, HOSTCALL_WORD.responseLength, 0);
    Atomics.store(this.control, HOSTCALL_WORD.errorCode, HOSTCALL_ERROR.none);
    Atomics.store(this.control, HOSTCALL_WORD.deadlineMs, deadlineMs);
    Atomics.store(this.control, HOSTCALL_WORD.state, HOSTCALL_STATE.request);
    postMessage({ type: "hostcallRequest" });
    const watchdogAt = performance.now() + deadlineMs + 1000;
    for (;;) {
      const state = Atomics.load(this.control, HOSTCALL_WORD.state);
      if (hostcallTerminalState(state)) break;
      const remaining = Math.max(1, watchdogAt - performance.now());
      const waited = Atomics.wait(this.control, HOSTCALL_WORD.state, state, remaining);
      if (waited === "timed-out" && performance.now() >= watchdogAt) {
        if (Atomics.compareExchange(this.control, HOSTCALL_WORD.state, state,
          HOSTCALL_STATE.timeout) === state) {
          Atomics.store(this.control, HOSTCALL_WORD.responseLength, 0);
          Atomics.store(this.control, HOSTCALL_WORD.errorCode, HOSTCALL_ERROR.timeout);
        }
      }
    }
    const state = Atomics.load(this.control, HOSTCALL_WORD.state);
    const errorCode = Atomics.load(this.control, HOSTCALL_WORD.errorCode);
    const responseLength = Atomics.load(this.control, HOSTCALL_WORD.responseLength);
    if (responseLength < 0 || responseLength > responseCapacity
      || responseOffset + responseLength > this.data.byteLength) {
      this._localError("hostcall response record is invalid");
    } else {
      this._responseFrame(state, errorCode,
        this.data.slice(responseOffset, responseOffset + responseLength));
    }
    return { ret: 0, nwritten: bytes.byteLength };
  }
  fd_read(length) {
    const chunk = this.response.slice(this.responseOffset, this.responseOffset + length);
    this.responseOffset += chunk.byteLength;
    if (this.responseOffset >= this.response.byteLength) {
      Atomics.store(this.control, HOSTCALL_WORD.state, HOSTCALL_STATE.idle);
      Atomics.notify(this.control, HOSTCALL_WORD.state);
    }
    return { ret: 0, data: chunk };
  }
  fd_close() {
    if (hostcallTerminalState(Atomics.load(this.control, HOSTCALL_WORD.state))) {
      Atomics.store(this.control, HOSTCALL_WORD.state, HOSTCALL_STATE.idle);
      Atomics.notify(this.control, HOSTCALL_WORD.state);
    }
    return 0;
  }
}

class HostcallFile extends File {
  constructor(controlSab, dataSab) {
    super([]);
    this.controlSab = controlSab;
    this.dataSab = dataSab;
  }
  path_open() {
    return { ret: 0, fd_obj: new HostcallOpenFile(this.controlSab, this.dataSab) };
  }
}

onmessage = async (e) => {
  const msg = e.data;
  if (msg.type !== "boot") return;
  try {
    const { deterministic, wasmBytes, stdlibFiles, stdlibDir, ctlSab, dataSab,
      hostcallControlSab, hostcallDataSab, bootstrapSnapshot } = msg;
    const emit = (stream) => (line) => postMessage({ type: "out", stream, line });
    // 드라이버/코드는 preopen 파일로 실행한다(argv에 UTF-8을 실으면 args 처리가 크래시).
    const cmdFile = new File([]);
    // /site = 쓰기 가능한 빈 preopen 디렉터리(브라우저판 site-packages). installWheel이 파이썬을
    // 통해 여기에 순수 파이썬 wheel 파일을 쓰고, 드라이버가 /site를 sys.path에 끼워 import한다.
    // 파일은 shim(JS) 쪽에 산다 = wasm 힙 밖 = 시간여행 스냅샷과 무관(패키지는 안정 상태).
    const entries = [
      [DRIVER_PATH.slice(1), new File(new TextEncoder().encode(DRIVER_SOURCE))],
      [CMD_PATH.slice(1), cmdFile],
      [HOSTCALL_PATH.slice(1), new HostcallFile(hostcallControlSab, hostcallDataSab)],
      [SITE_PATH.slice(1), new Directory([])],
    ];
    const env = ["PYTHONHASHSEED=0", "PYTHONDONTWRITEBYTECODE=1"];
    // 외부 stdlib 빌드(brettcannon = python.wasm + 별도 lib): stdlibFiles를 /lib/<dir>로 마운트하고
    // PYTHONHOME을 줘 getpath가 찾게 한다. self-contained 빌드(WLR)는 stdlibFiles 없이 그대로.
    if (stdlibFiles && stdlibFiles.length && stdlibDir) {
      entries.push(["lib", new Directory([[stdlibDir, buildTree(stdlibFiles)]])]);
      env.push("PYTHONHOME=/", "PYTHONPATH=/lib/" + stdlibDir);
    }
    const preopen = new PreopenDirectory("/", entries);
    const stdin = new SabStdin(ctlSab, dataSab, cmdFile, bootstrapSnapshot || null);
    const fds = [stdin, ConsoleStdout.lineBuffered(emit("stdout")), ConsoleStdout.lineBuffered(emit("stderr")), preopen];
    const wasiInst = new WASI(["python", "-B", DRIVER_PATH], env, fds);
    let inst = null;
    if (deterministic) makeDeterministic(wasiInst, () => inst);
    ({ instance: inst } = await WebAssembly.instantiate(wasmBytes, { wasi_snapshot_preview1: wasiInst.wasiImport }));
    stdin.setInst(inst);
    stdin.stackTop = parseStackTop(wasmBytes); // 시간여행 파티션 경계(global[0] init = stack top)
    postMessage({ type: "ready", heapLen: inst.exports.memory.buffer.byteLength, eot: EOT });
    try { wasiInst.start(inst); }
    catch (err) {
      postMessage({ type: "runtimeFault", ...toErrorPayload(new PyProcError(
        "PYPROC_WORKER_CRASHED", String(err).slice(-300), { cause: err })) });
    }
    postMessage({ type: "exited" });
  } catch (err) {
    postMessage({ type: "bootError", ...toErrorPayload(new PyProcError("PYPROC_BOOT_FAILED", String(err).slice(-300), { retryable: true, cause: err })) });
  }
};
