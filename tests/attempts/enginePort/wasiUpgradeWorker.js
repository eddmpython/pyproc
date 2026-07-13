// wasiUpgradeWorker.js - probe 워커: brettcannon CPython 3.14.6(WASI)을 부팅한다.
// 자동 성장(WLR->brettcannon 소스 이전)의 실측: WLR(3.12, 죽은 소스)은 stdlib를 wasm에 baked-in한
// 단일 파일이지만, brettcannon은 python.wasm + 외부 stdlib(.py 묶음)라 stdlib를 preopen
// /lib/python3.14로 마운트하고 PYTHONHOME=/로 CPython이 찾게 해야 한다(부팅 경로 손질 = 이전 실작업).
// zlib 부재로 zipimport 대신 loose 파일 트리(shim readdir가 서빙, wasiPackages가 이미 실증).
import { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory, Directory, wasi } from "../../../src/runtime/engines/wasi/browserWasiShim.js";

// REPL 드라이버. 벽3 핵심: os.read(0,1)은 매 반복 새 bytes를 힙에 할당하고, 그 포인터가 fd_read
// 경계를 넘어 살아있다(shadow stack iovec + WASM VM 로컬 = 선형메모리 밖, 복원 불가). 3.12는
// obmalloc이 같은 슬롯을 우연히 줘 주소가 안정(생존)하지만 3.14는 주소가 바뀌어 복원 후 재개가
// 그 포인터를 dereference하며 트랩한다. 해법(할당 불변): 모듈 레벨 1회 할당 버퍼에 readinto로 읽어
// 경계를 넘는 유일한 힙 포인터(rawStdin/sigBuf)를 안정시킨다 = 복원이 그 객체를 어긋낼 여지 제거.
// gc.freeze로 시작 객체를 영구 세대로(경계 churn 최소화). 파이썬 식별자도 camelCase(규칙).
const DRIVER = String.raw`import os, io, gc, sys
rawStdin = io.FileIO(0, closefd=False)  # unbuffered raw 리더(1회 할당, 안정 주소)
sigBuf = bytearray(1)                    # readinto 대상(1회 할당, 안정 주소)
userNs = {}
gc.collect()
gc.freeze()
while True:
    n = rawStdin.readinto(sigBuf)        # 대상에 in-place 기록 = 매 반복 힙 할당 없음
    if not n:
        break
    with open("/cmd", "rb") as commandFile:
        source = commandFile.read()
    try:
        exec(source.decode(), userNs)
    except BaseException as execError:
        os.write(2, (repr(execError) + "\n").encode())
    os.write(1, b"\x04\n")
`;

// wasm 바이너리에서 __heap_base를 얻는다. 이 빌드는 심볼을 export 안 하지만(memory/_start만),
// __stack_pointer는 관례상 global 0(mut i32)이고 그 초기값 = 스택 top = 힙 시작(스택은 그 아래로
// 자라고 힙은 그 위). global 섹션(id=6)의 첫 global init(i32.const)을 파싱한다. = heap-only 복원의 경계.
function parseHeapBase(bytes) {
  const u = new Uint8Array(bytes); let p = 8; // magic(4)+version(4)
  const uLEB = () => { let r = 0, s = 0, b; do { b = u[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r >>> 0; };
  const sLEB = () => { let r = 0, s = 0, b; do { b = u[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); if (s < 32 && (b & 0x40)) r |= (-1 << s); return r; };
  while (p < u.length) {
    const id = u[p++]; const size = uLEB(); const end = p + size;
    if (id === 6) { const count = uLEB(); if (count > 0) { p++; p++; const op = u[p++]; if (op === 0x41) return sLEB() >>> 0; } return 0; }
    p = end;
  }
  return 0;
}

function makeDeterministic(wasiInst, getInst) {
  wasiInst.wasiImport.random_get = (buf, len) => { new Uint8Array(getInst().exports.memory.buffer, buf, len).fill(7); return 0; };
  wasiInst.wasiImport.clock_time_get = (id, prec, out) => { new DataView(getInst().exports.memory.buffer).setBigUint64(out, 1750000000000000000n, true); return 0; };
}

// 평평한 [상대경로, 바이트]를 shim File/Directory 트리로. stdlib(os.py, encodings/...)를 마운트.
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

class SabStdin extends OpenFile {
  constructor(ctlSab, dataSab, cmdFile) { super(new File([])); this.ctl = new Int32Array(ctlSab); this.data = new Uint8Array(dataSab); this.cmdFile = cmdFile; this.inst = null; this.snapshots = []; }
  setInst(inst) {
    this.inst = inst;
    // __heap_base: 이 아래는 정적 데이터 + C 스택(라이브 실행), 위는 malloc 힙(파이썬 객체).
    // 복원 시 힙만 되돌리고 스택은 보존해야 재개 시 트랩(memory access out of bounds)이 없다.
    const hb = inst.exports.__heap_base;
    this.heapBase = typeof hb === "object" && hb ? hb.value : (typeof hb === "number" ? hb : 0);
  }
  _heapU8() { return new Uint8Array(this.inst.exports.memory.buffer); }
  fd_fdstat_get() { return { ret: 0, fdstat: new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0) }; }
  fd_read() {
    for (;;) {
      postMessage({ type: "idle" });
      Atomics.wait(this.ctl, 0, 0);
      const n = Atomics.load(this.ctl, 1);
      const raw = this.data.slice(0, n);
      Atomics.store(this.ctl, 0, 0); Atomics.notify(this.ctl, 0);
      if (raw.length > 0 && raw[0] === 0) {
        const cmd = new TextDecoder().decode(raw.subarray(1));
        if (cmd === "checkpoint") { this.snapshots.push(this._heapU8().slice()); postMessage({ type: "meta", kind: "checkpoint", idx: this.snapshots.length - 1, mb: +(this._heapU8().length / 1048576).toFixed(1) }); }
        else if (cmd.startsWith("restore ")) {
          const i = +cmd.slice(8);
          const snap = this.snapshots[i]; const cur = this._heapU8(); const base = this.heapBase || 0;
          // 힙 영역만 되돌린다(__heap_base 위). 그 아래(C 스택)는 라이브 fd_read 호출 체인이라 보존.
          cur.set(snap.subarray(base), base);
          postMessage({ type: "meta", kind: "restore", idx: i });
        }
        continue;
      }
      this.cmdFile.data = raw.subarray(1).slice();
      return { ret: 0, data: new Uint8Array([1]) };
    }
  }
}

onmessage = async (e) => {
  const msg = e.data; if (msg.type !== "boot") return;
  try {
    const { deterministic, wasmBytes, stdlibFiles, ctlSab, dataSab } = msg;
    const emit = (stream) => (line) => postMessage({ type: "out", stream, line });
    const cmdFile = new File([]);
    // stdlib를 /lib/python3.14로 마운트(PYTHONHOME=/가 여기를 찾는다).
    const preopen = new PreopenDirectory("/", [
      ["driver.py", new File(new TextEncoder().encode(DRIVER))],
      ["cmd", cmdFile],
      ["lib", new Directory([["python3.14", buildTree(stdlibFiles)]])],
    ]);
    const stdin = new SabStdin(ctlSab, dataSab, cmdFile);
    const fds = [stdin, ConsoleStdout.lineBuffered(emit("stdout")), ConsoleStdout.lineBuffered(emit("stderr")), preopen];
    const env = ["PYTHONHOME=/", "PYTHONPATH=/lib/python3.14", "PYTHONHASHSEED=0", "PYTHONDONTWRITEBYTECODE=1"];
    const wasiInst = new WASI(["python", "/driver.py"], env, fds);
    let inst = null;
    if (deterministic) makeDeterministic(wasiInst, () => inst);
    ({ instance: inst } = await WebAssembly.instantiate(wasmBytes, { wasi_snapshot_preview1: wasiInst.wasiImport }));
    stdin.setInst(inst);
    // 심볼 export가 없으면 wasm 바이너리 파싱으로 heap base 확보(heap-only 복원의 경계).
    if (!stdin.heapBase) stdin.heapBase = parseHeapBase(wasmBytes);
    postMessage({ type: "exports", keys: Object.keys(inst.exports), heapBase: stdin.heapBase });
    postMessage({ type: "ready" });
    try { wasiInst.start(inst); } catch (err) { postMessage({ type: "out", stream: "stderr", line: String(err) }); }
    postMessage({ type: "exited" });
  } catch (err) { postMessage({ type: "bootError", error: String(err).slice(-300) }); }
};
