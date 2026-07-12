// wasiSession.js - Layer 0 공개 표면: non-Pyodide CPython(WASI) 세션.
// Pyodide는 메인 스레드 동기(boot/Runtime)지만 WASI는 워커 안 비동기라, 동기 Runtime에 끼우지
// 않고 별도 async 세션으로 둔다(Runtime/boot/PyProc/ReactiveController 소비자 무영향, 전부 additive).
// 엔진 무관 실증(enginePort 12/12): pyproc의 리액티브 전제(체크포인트/복원/재개/분기)가 Pyodide
// `_module.HEAPU8`/FFI 없이 exports.memory 위에서 성립. 이 세션이 그 능력을 계약으로 노출한다.
//
// 값 채널 무상태화(완전 시간여행의 열쇠)는 여기서 완전히 캡슐화한다: 소비자는 async run/get/set/
// checkpoint/timeTravel만 보고, /cmd 파일 + 신호 1바이트 + EOT 와이어(wasiProtocol.js)는 모른다.
// 값 다리는 JSON 직렬화 한정이다(WASI엔 FFI가 없어 함수/numpy/live 객체는 못 넘긴다).
import { SIGNAL_META, EOT, CTL_WORDS, DATA_SAB_BYTES } from "./wasiProtocol.js";

// 기본 엔진 배포 지점(WLR CPython 3.12 WASI). COOP/COEP(crossOriginIsolated) 하에서는 CDN 직
// fetch가 CORP에 걸릴 수 있으므로 소비자 셀프 호스팅이 권장이다(manifest.wasmURL로 교체). 출처를
// 명시하는 이름 붙인 상수(하드코딩 금지): 버전 변경 = 릴리즈 사유.
const DEFAULT_WASM_URL = "https://github.com/vmware-labs/webassembly-language-runtimes/releases/download/python%2F3.12.0%2B20231211-040d5a6/python-3.12.0.wasm";

// WASI 세션을 부팅한다. manifest.wasmURL(소비자 제공, 기본 위), deterministic(리플레이 결정성).
export async function bootWasi(manifest = {}) {
  const wasmURL = manifest.wasmURL || DEFAULT_WASM_URL;
  const resp = await fetch(wasmURL);
  if (!resp.ok) throw new Error(`bootWasi: wasm 로드 실패(${resp.status}) ${wasmURL}`);
  const wasmBytes = await resp.arrayBuffer();
  const session = new WasiSession(wasmBytes, !!manifest.deterministic);
  await session._boot();
  return session;
}

export class WasiSession {
  constructor(wasmBytes, deterministic) {
    this._wasmBytes = wasmBytes;
    this._deterministic = deterministic;
    this._worker = null;
    this._ctl = new Int32Array(new SharedArrayBuffer(CTL_WORDS * 4));
    this._data = new Uint8Array(new SharedArrayBuffer(DATA_SAB_BYTES));
    this._queue = []; this._idle = false; this._cur = null; this._lines = { stdout: [], stderr: [] };
  }

  async _boot() {
    this._worker = new Worker(new URL("./wasiWorker.js", import.meta.url), { type: "module" });
    this._worker.addEventListener("message", (e) => this._onMessage(e.data));
    await new Promise((resolve, reject) => {
      const onReady = (e) => {
        if (e.data.type === "ready") { this._worker.removeEventListener("message", onReady); resolve(); }
        else if (e.data.type === "bootError") { this._worker.removeEventListener("message", onReady); reject(new Error(e.data.error)); }
      };
      this._worker.addEventListener("message", onReady);
      this._worker.postMessage({ type: "boot", deterministic: this._deterministic, wasmBytes: this._wasmBytes, ctlSab: this._ctl.buffer, dataSab: this._data.buffer });
    });
  }

  _onMessage(m) {
    if (m.type === "idle") { this._idle = true; this._pump(); }
    else if (m.type === "meta") { const c = this._cur; this._cur = null; if (c) c.resolve(m); this._pump(); }
    else if (m.type === "out") {
      if (m.line === String.fromCharCode(EOT)) {
        const out = this._lines.stdout.join("\n"), err = this._lines.stderr.join("\n");
        this._lines = { stdout: [], stderr: [] };
        const c = this._cur; this._cur = null; if (c) c.resolve({ out, err }); this._pump();
      } else this._lines[m.stream].push(m.line);
    }
  }

  _send(payload) {
    return new Promise((resolve, reject) => {
      if (!this._worker) return reject(new Error("WasiSession: 종료됨"));
      this._queue.push({ payload, resolve });
      this._pump();
    });
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
  async run(code) {
    const b = new TextEncoder().encode(code);
    const payload = new Uint8Array(1 + b.length); payload[0] = 1; payload.set(b, 1); // SIGNAL_EXEC
    const { out, err } = await this._send(payload);
    if (err) throw new Error("WASI 실행 예외: " + err.trim());
    return out;
  }

  // 값 다리(JSON 직렬화 한정): 파이썬 전역 값을 회수/주입한다.
  async get(name) { return JSON.parse((await this.run(`import json as pyprocJson\nprint(pyprocJson.dumps(${name}))`)).trim()); }
  async set(name, value) { await this.run(`import json as pyprocJson\n${name} = pyprocJson.loads(${JSON.stringify(JSON.stringify(value))})`); }

  // 지금 상태를 체크포인트(경계 힙 스냅샷). 반환: { idx, mb }.
  async checkpoint() { const m = await this._send(new TextEncoder().encode(String.fromCharCode(SIGNAL_META) + "checkpoint")); return { idx: m.idx, mb: m.mb }; }
  // 시간여행: 체크포인트 idx로 복원한다. 복원 후 파이썬은 그 시점 상태로 재개한다(분기 가능).
  async timeTravel(idx) { await this._send(new TextEncoder().encode(String.fromCharCode(SIGNAL_META) + "restore " + idx)); }

  terminate() { if (this._worker) { this._worker.terminate(); this._worker = null; } for (const q of this._queue) q.resolve({ out: "", err: "종료됨" }); this._queue = []; }
}
