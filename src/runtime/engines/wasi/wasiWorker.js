// wasiWorker.js - WASI "프로세스": non-Pyodide CPython(WASI)을 vendored shim으로 워커에서
// 부팅하고, pyproc이 소유한 드라이버(wasiReplDriver)를 세워 코드 조각을 반복 실행한다.
// wasiSession.js가 이 파일을 new URL 상대경로로 spawn한다(위치 = 번들러 워커 emit 계약).
// 값 채널 무상태화(완전 시간여행): 코드는 preopen 파일 /cmd(힙 밖), stdin은 신호 1바이트.
// 실행 경계(fd_read = 파이썬이 다음 신호 대기)에서 힙 체크포인트/복원 메타를 처리하므로
// 복원이 파이썬 I/O 상태를 어긋내지 않는다(reactive 완전 시간여행이 exports.memory 위에서 성립).
import { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory, wasi } from "./browserWasiShim.js";
import { DRIVER_SOURCE } from "./wasiReplDriver.js";
import { SIGNAL_META, EOT, CMD_PATH, DRIVER_PATH, FILETYPE_CHARACTER_DEVICE } from "./wasiProtocol.js";

// 결정적 부팅: WASI는 엔트로피/시간이 import 2개로 수렴한다(Pyodide 3소스 스텁보다 깨끗).
function makeDeterministic(wasiInst, getInst) {
  wasiInst.wasiImport.random_get = (buf, len) => { new Uint8Array(getInst().exports.memory.buffer, buf, len).fill(7); return 0; };
  wasiInst.wasiImport.clock_time_get = (id, prec, out) => { new DataView(getInst().exports.memory.buffer).setBigUint64(out, 1750000000000000000n, true); return 0; };
}

// SAB 블로킹 신호 stdin. stdin은 "실행 신호 1바이트"만 나르고, 코드는 /cmd 파일(힙 밖)로 나른다.
// 그래서 fd_read는 항상 1바이트만 반환하고, 그 1바이트가 유일한 입력 상태라 힙 복원이 스트림을
// 어긋낼 여지가 없다. OpenFile 상속: 파이썬 stdin 초기화가 fdstat/seek를 조회하는데 Fd(부분
// 구현)면 깨진다(File은 되고 부분 Fd는 memory access out of bounds).
class SabStdin extends OpenFile {
  constructor(ctlSab, dataSab, cmdFile) {
    super(new File([]));
    this.ctl = new Int32Array(ctlSab);
    this.data = new Uint8Array(dataSab);
    this.cmdFile = cmdFile;  // /cmd preopen File: 실행할 코드를 여기에 싣는다(힙 밖 채널)
    this.inst = null;        // exports.memory 접근용(체크포인트/복원)
    this.snapshots = [];     // 시간여행: 경계에서 찍은 힙 스냅샷
  }
  setInst(inst) { this.inst = inst; }
  _heapU8() { return new Uint8Array(this.inst.exports.memory.buffer); }
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
          this.snapshots.push(this._heapU8().slice());
          postMessage({ type: "meta", kind: "checkpoint", idx: this.snapshots.length - 1, mb: +(this._heapU8().length / 1048576).toFixed(1) });
        } else if (cmd.startsWith("restore ")) {
          const i = +cmd.slice(8);
          this._heapU8().set(this.snapshots[i]); // 힙 전체를 경계 스냅샷으로 되돌림(스택 포함)
          postMessage({ type: "meta", kind: "restore", idx: i });
        }
        continue; // 메타는 파이썬 왕복 아님(다음 신호 계속 대기)
      }
      // exec 신호: raw = [SIGNAL_EXEC, ...코드]. 코드를 /cmd에 싣고 신호 1바이트만 반환한다.
      this.cmdFile.data = raw.subarray(1).slice();
      return { ret: 0, data: new Uint8Array([1]) }; // 파이썬 os.read(0,1)이 받는 무상태 신호
    }
  }
}

onmessage = async (e) => {
  const msg = e.data;
  if (msg.type !== "boot") return;
  try {
    const { deterministic, wasmBytes, ctlSab, dataSab } = msg;
    const emit = (stream) => (line) => postMessage({ type: "out", stream, line });
    // 드라이버/코드는 preopen 파일로 실행한다(argv에 UTF-8을 실으면 args 처리가 크래시).
    const cmdFile = new File([]);
    const preopen = new PreopenDirectory("/", [
      [DRIVER_PATH.slice(1), new File(new TextEncoder().encode(DRIVER_SOURCE))],
      [CMD_PATH.slice(1), cmdFile],
    ]);
    const stdin = new SabStdin(ctlSab, dataSab, cmdFile);
    const fds = [stdin, ConsoleStdout.lineBuffered(emit("stdout")), ConsoleStdout.lineBuffered(emit("stderr")), preopen];
    const wasiInst = new WASI(["python", "-B", DRIVER_PATH], ["PYTHONHASHSEED=0", "PYTHONDONTWRITEBYTECODE=1"], fds);
    let inst = null;
    if (deterministic) makeDeterministic(wasiInst, () => inst);
    ({ instance: inst } = await WebAssembly.instantiate(wasmBytes, { wasi_snapshot_preview1: wasiInst.wasiImport }));
    stdin.setInst(inst);
    postMessage({ type: "ready", heapLen: inst.exports.memory.buffer.byteLength, eot: EOT });
    try { wasiInst.start(inst); } catch (err) { postMessage({ type: "out", stream: "stderr", line: String(err) }); }
    postMessage({ type: "exited" });
  } catch (err) {
    postMessage({ type: "bootError", error: String(err).slice(-300) });
  }
};
