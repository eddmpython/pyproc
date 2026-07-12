// wasiWorker.js - probe 전용 워커: non-Pyodide CPython(WASI)을 vendored shim으로 부팅한다.
// 외부 CPython 바이너리는 참조만 하고, 파이썬 엔진 로직(반복 실행 드라이버)은 pyproc이
// 정본으로 소유한다: wasiReplDriver.py. 이 워커는 엔진 배선(shim + 값 프로토콜)만 담당한다.
// 두 모드:
//  - "boot": 1회 실행(_start = argv의 -c 실행 후 종료). 부팅/결정성/선형 메모리 실측.
//  - "replBoot": 드라이버를 세워두고 코드 조각을 N회 실행(반복 실행 = reactive의 전제).
//    WASI엔 FFI가 없으므로 값 다리는 stdin/stdout 값 프로토콜(base64 코드 in, 결과 out)이다.
//    SAB 블로킹 stdin(Atomics.wait)으로 인터랙티브 왕복을 만든다(워커라 Atomics.wait 합법).
import { WASI, File, OpenFile, ConsoleStdout, Fd, PreopenDirectory, wasi } from "./browserWasiShim.js";

// 결정적 부팅: WASI는 엔트로피/시간이 import 2개로 수렴한다(Pyodide 3소스 스텁보다 깨끗).
function makeDeterministic(wasi, getInst) {
  wasi.wasiImport.random_get = (buf, len) => { new Uint8Array(getInst().exports.memory.buffer, buf, len).fill(7); return 0; };
  wasi.wasiImport.clock_time_get = (id, prec, out) => { new DataView(getInst().exports.memory.buffer).setBigUint64(out, 1750000000000000000n, true); return 0; };
}

// SAB 블로킹 신호 stdin. 값 채널 무상태화: stdin은 "실행 신호 1바이트"만 나르고, 코드는
// preopen 파일 /cmd(힙 밖)로 나른다. 그래서 fd_read는 항상 정확히 1바이트만 반환하고, 그
// 1바이트가 유일한 입력 상태라 힙 복원이 스트림을 어긋낼 여지가 없다(가변 길이 stdin의 밀림 제거).
// OpenFile 상속: 파이썬 stdin 초기화가 fdstat/filestat/seek를 조회하는데 Fd(부분 구현)면 깨진다.
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
  fd_fdstat_get() { return { ret: 0, fdstat: new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0) }; }
  fd_read(size) {
    // 이 지점이 실행 경계(파이썬이 신호 1바이트 대기 = 스택 항상 같은 깊이, 입력 상태 = 없음).
    // reactive checkpoint/restore를 여기서 처리하면 복원이 파이썬 I/O 상태를 어긋내지 않는다.
    for (;;) {
      postMessage({ type: "idle" });
      Atomics.wait(this.ctl, 0, 0);
      const n = Atomics.load(this.ctl, 1);
      const raw = this.data.slice(0, n);
      Atomics.store(this.ctl, 0, 0);
      Atomics.notify(this.ctl, 0);
      if (raw.length > 0 && raw[0] === 0) {
        const cmd = new TextDecoder().decode(raw.subarray(1));
        if (cmd === "checkpoint") {
          this.snapshots.push(this._heapU8().slice());
          postMessage({ type: "meta", kind: "checkpoint", idx: this.snapshots.length - 1, mb: +(this._heapU8().length / 1048576).toFixed(1) });
        } else if (cmd.startsWith("restore ")) {
          const i = +cmd.slice(8);
          this._heapU8().set(this.snapshots[i]); // 힙 전체를 경계 스냅샷으로 되돌림(스택 포함).
          postMessage({ type: "meta", kind: "restore", idx: i });
        }
        continue; // 메타는 파이썬 왕복 아님(다음 신호 계속 대기)
      }
      // exec 신호: raw = "\x01" + 코드바이트. 코드를 /cmd 파일에 싣고 신호 1바이트만 반환한다.
      this.cmdFile.data = raw.subarray(1).slice();
      return { ret: 0, data: new Uint8Array([1]) }; // 파이썬 os.read(0,1)이 받는 무상태 신호
    }
  }
}

onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === "boot") {
      const { code, deterministic, wasmBytes, stdinText } = msg;
      let stdout = "", stderr = "";
      const fds = [
        new OpenFile(new File(stdinText ? new TextEncoder().encode(stdinText) : [])), // stdinText 주면 그걸 stdin으로
        ConsoleStdout.lineBuffered((line) => { stdout += line + "\n"; }),
        ConsoleStdout.lineBuffered((line) => { stderr += line + "\n"; }),
      ];
      const wasi = new WASI(["python", "-B", "-c", code], ["PYTHONHASHSEED=0", "PYTHONDONTWRITEBYTECODE=1"], fds);
      let inst = null;
      if (deterministic) makeDeterministic(wasi, () => inst);
      ({ instance: inst } = await WebAssembly.instantiate(wasmBytes, { wasi_snapshot_preview1: wasi.wasiImport }));
      const heapLen = inst.exports.memory.buffer.byteLength;
      let exitCode = 0;
      try { exitCode = wasi.start(inst); } catch (err) { exitCode = -1; stderr += String(err); }
      postMessage({ type: "done", ok: true, stdout, stderr: stderr.slice(-300), exitCode, heapLen, heapLenAfter: inst.exports.memory.buffer.byteLength });
    } else if (msg.type === "replBoot") {
      // 반복 실행 모드. 드라이버 소스(wasiReplDriver.py)는 메인이 -c로 넘긴다(정본은 그 파일).
      // stdout 콜백이 즉시 postMessage로 결과를 흘려보낸다(워커가 start 안에 갇혀도 워커->메인
      // postMessage는 전달된다). 메인은 EOT() 줄까지 모아 한 왕복으로 본다.
      const { driverSource, deterministic, wasmBytes, ctlSab, dataSab } = msg;
      const emit = (stream) => (line) => postMessage({ type: "out", stream, line });
      // 드라이버는 -c argv가 아니라 preopen FS의 파일로 실행한다: argv에 UTF-8 멀티바이트(한글
      // 주석)를 실으면 WLR/shim의 args 처리가 memory access out of bounds로 깨진다(실측 특정).
      // 파일 경로(ASCII)만 argv에 싣고 소스는 파일 내용(정상 UTF-8)으로 둔다. 파이썬 엔진을
      // 파일로 소유하는 정식 실행 모델이기도 하다.
      // /cmd = 코드 채널(힙 밖). 드라이버 소스도 파일로(argv UTF-8 회피). SabStdin이 cmdFile을
      // 매 실행 갱신하고, 파이썬은 open("/cmd").read()로 fresh하게 읽는다.
      const cmdFile = new File([]);
      const preopen = new PreopenDirectory("/", [
        ["driver.py", new File(new TextEncoder().encode(driverSource))],
        ["cmd", cmdFile],
      ]);
      const stdin = new SabStdin(ctlSab, dataSab, cmdFile);
      const fds = [
        stdin,
        ConsoleStdout.lineBuffered(emit("stdout")),
        ConsoleStdout.lineBuffered(emit("stderr")),
        preopen,
      ];
      const wasi = new WASI(["python", "-B", "/driver.py"], ["PYTHONHASHSEED=0", "PYTHONDONTWRITEBYTECODE=1"], fds);
      let inst = null;
      if (deterministic) makeDeterministic(wasi, () => inst);
      ({ instance: inst } = await WebAssembly.instantiate(wasmBytes, { wasi_snapshot_preview1: wasi.wasiImport }));
      stdin.setInst(inst); // 체크포인트/복원이 exports.memory에 접근
      postMessage({ type: "ready", heapLen: inst.exports.memory.buffer.byteLength });
      try { wasi.start(inst); } catch (err) { postMessage({ type: "out", stream: "stderr", line: String(err) }); }
      postMessage({ type: "exited" });
    }
  } catch (err) {
    postMessage({ type: "done", ok: false, error: String(err).slice(-300) });
  }
};
