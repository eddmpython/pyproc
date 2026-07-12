// wasiWorker.js - probe 전용 워커: non-Pyodide CPython(WASI)을 vendored shim으로 부팅한다.
// 1회 실행 모델(_start = argv의 -c 실행 후 종료). 반복 실행은 stdin 프레임 드라이버가 다음 단계.
import { WASI, File, OpenFile, ConsoleStdout } from "./browserWasiShim.js";

onmessage = async (e) => {
  const { code, deterministic, wasmBytes } = e.data;
  try {
    let stdout = "", stderr = "";
    const fds = [
      new OpenFile(new File([])),
      ConsoleStdout.lineBuffered((line) => { stdout += line + "\n"; }),
      ConsoleStdout.lineBuffered((line) => { stderr += line + "\n"; }),
    ];
    const wasi = new WASI(["python", "-B", "-c", code], ["PYTHONHASHSEED=0", "PYTHONDONTWRITEBYTECODE=1"], fds);
    let inst = null;
    if (deterministic) {
      // 결정적 부팅: WASI에선 엔트로피/시간이 import 2개로 수렴한다(Pyodide의 3소스 스텁보다 깨끗).
      wasi.wasiImport.random_get = (buf, len) => { new Uint8Array(inst.exports.memory.buffer, buf, len).fill(7); return 0; };
      const ctg = wasi.wasiImport.clock_time_get;
      wasi.wasiImport.clock_time_get = (id, prec, out) => { new DataView(inst.exports.memory.buffer).setBigUint64(out, 1750000000000000000n, true); return 0; };
    }
    ({ instance: inst } = await WebAssembly.instantiate(wasmBytes, { wasi_snapshot_preview1: wasi.wasiImport }));
    const heapLen = inst.exports.memory.buffer.byteLength;
    let exitCode = 0;
    try { exitCode = wasi.start(inst); } catch (err) { exitCode = -1; stderr += String(err); }
    postMessage({ ok: true, stdout, stderr: stderr.slice(-300), exitCode, heapLen, heapLenAfter: inst.exports.memory.buffer.byteLength });
  } catch (err) {
    postMessage({ ok: false, error: String(err).slice(-300) });
  }
};
