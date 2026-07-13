// wasiSession.js - Layer 0 공개 표면: non-Pyodide CPython(WASI) 세션.
// Pyodide는 메인 스레드 동기(boot/Runtime)지만 WASI는 워커 안 비동기라, 동기 Runtime에 끼우지
// 않고 별도 async 세션으로 둔다(Runtime/boot/PyProc/ReactiveController 소비자 무영향, 전부 additive).
// 엔진 무관 실증(enginePort 12/12): pyproc의 리액티브 전제(체크포인트/복원/재개/분기)가 Pyodide
// `_module.HEAPU8`/FFI 없이 exports.memory 위에서 성립. 이 세션이 그 능력을 계약으로 노출한다.
//
// 값 채널 무상태화(완전 시간여행의 열쇠)는 여기서 완전히 캡슐화한다: 소비자는 async run/get/set/
// checkpoint/timeTravel만 보고, /cmd 파일 + 신호 1바이트 + EOT 와이어(wasiProtocol.js)는 모른다.
// 값 다리는 JSON 직렬화 한정이다(WASI엔 FFI가 없어 함수/numpy/live 객체는 못 넘긴다).
import { SIGNAL_META, EOT, CTL_WORDS, DATA_SAB_BYTES, SITE_PATH } from "./wasiProtocol.js";
import { unzipWheel } from "./wheelUnzip.js";

// 바이트를 base64로(파이썬에 코드로 실어 /site에 쓰기 위함). 큰 배열은 청크로 스택 초과 방지.
function base64FromBytes(bytes) {
  let s = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  return btoa(s);
}

// 기본 엔진 핀 = brettcannon CPython 3.14.6(살아있는 소스, 업스트림 당일 추적). WLR 3.12는 죽어서
// (2023-12 마지막) 3.14로 이전했다. brettcannon은 python.wasm + 외부 stdlib를 한 릴리즈 zip으로
// 준다. COOP/COEP(crossOriginIsolated) 하에선 CDN 직 fetch가 CORP에 걸릴 수 있으므로 소비자 셀프
// 호스팅 권장(manifest.wasmURL + manifest.stdlibURL로 분리 교체). 버전 변경 = 릴리즈 사유(하드코딩
// 금지: 버전/경로/URL을 이름 붙인 핀 한 곳에). engine-watch가 이 핀을 새 릴리즈로 범프하고 게이트로 인증.
const WASI_ENGINE_PIN = {
  version: "3.14.6",
  stdlibDir: "python3.14", // 릴리즈 zip 안 stdlib 경로(lib/<stdlibDir>/). 버전과 함께 이동.
  releaseURL: "https://github.com/brettcannon/cpython-wasi-build/releases/download/v3.14.6/python-3.14.6-wasi_sdk-24.zip",
};

async function fetchBytes(url, what) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`bootWasi: ${what} 로드 실패(${resp.status}) ${url}`);
  return resp.arrayBuffer();
}

// WASI 세션을 부팅한다. 기본은 brettcannon 릴리즈 zip(python.wasm + stdlib)을 풀어 마운트한다.
// 셀프 호스팅: manifest.wasmURL(+ manifest.stdlibURL). stdlibURL 없이 wasmURL만 주면 self-contained
// 빌드(WLR = stdlib baked-in)로 본다. deterministic(리플레이 결정성). wheels(부팅 직후 설치).
export async function bootWasi(manifest = {}) {
  const stdlibDir = manifest.stdlibDir || WASI_ENGINE_PIN.stdlibDir;
  let wasmBytes, stdlibFiles = null;
  if (manifest.wasmURL) {
    wasmBytes = await fetchBytes(manifest.wasmURL, "wasm");
    if (manifest.stdlibURL) stdlibFiles = await unzipWheel(await fetchBytes(manifest.stdlibURL, "stdlib"));
  } else {
    // 기본: 릴리즈 zip 하나를 풀어 python.wasm + lib/<dir>/*을 얻는다(네이티브 DecompressionStream).
    const entries = await unzipWheel(await fetchBytes(WASI_ENGINE_PIN.releaseURL, "release zip"));
    const wasmEntry = entries.find(([p]) => p === "python.wasm" || p.endsWith("/python.wasm"));
    if (!wasmEntry) throw new Error("bootWasi: 릴리즈 zip에 python.wasm 없음");
    wasmBytes = wasmEntry[1];
    const prefix = "lib/" + stdlibDir + "/";
    stdlibFiles = entries.filter(([p]) => p.startsWith(prefix)).map(([p, b]) => [p.slice(prefix.length), b]);
  }
  const session = new WasiSession(wasmBytes, !!manifest.deterministic, stdlibFiles, stdlibDir);
  await session._boot();
  for (const wheel of manifest.wheels || []) await session.installWheel(wheel);
  return session;
}

export class WasiSession {
  constructor(wasmBytes, deterministic, stdlibFiles, stdlibDir) {
    this._wasmBytes = wasmBytes;
    this._deterministic = deterministic;
    this._stdlibFiles = stdlibFiles || null; // 외부 stdlib 빌드면 [[상대경로,바이트]], self-contained면 null
    this._stdlibDir = stdlibDir || null;     // /lib/<stdlibDir> 마운트 지점
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
      this._worker.postMessage({ type: "boot", deterministic: this._deterministic, wasmBytes: this._wasmBytes, stdlibFiles: this._stdlibFiles, stdlibDir: this._stdlibDir, ctlSab: this._ctl.buffer, dataSab: this._data.buffer });
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

  // 순수 파이썬 wheel을 이 라이브 세션에 설치한다(= 브라우저판 pip install). wheel(ArrayBuffer/
  // Uint8Array)을 네이티브로 풀어 /site에 파일을 쓰고 import 캐시를 무효화한다. 이후 그 패키지를
  // import할 수 있다. 순수 파이썬 한정: C 확장(.so)은 WASI 동적 링크 부재로 import 불가(PEP 783
  // 대기). 값 다리(JSON 한정)와 무관하다 - 패키지는 파일 채널이라 FFI가 필요 없다.
  // 반환: { files, names } = 쓴 파일 수 + 최상위 패키지 이름들.
  async installWheel(wheel) {
    const files = await unzipWheel(wheel);
    const names = new Set();
    for (const [path, bytes] of files) {
      await this._writeSiteFile(path, bytes);
      const top = path.split("/")[0];
      if (top && !top.endsWith(".dist-info") && !top.endsWith(".data")) names.add(top.replace(/\.py$/, ""));
    }
    await this.run("import importlib as pyprocImportlib\npyprocImportlib.invalidate_caches()");
    return { files: files.length, names: [...names] };
  }

  // /site 아래 한 파일을 파이썬을 통해 쓴다(base64로 실어 바이너리 보존). 중첩 경로는 makedirs로
  // 만들고, 채널 상한(DATA_SAB_BYTES)을 넘는 큰 파일은 append로 청크한다. 파일은 shim(JS)에 살아
  // wasm 힙 밖 = 시간여행 스냅샷과 독립(패키지는 안정 상태, 되돌릴 값이 아니다).
  async _writeSiteFile(relPath, bytes) {
    const full = SITE_PATH + "/" + relPath;
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
  async checkpoint() { const m = await this._send(new TextEncoder().encode(String.fromCharCode(SIGNAL_META) + "checkpoint")); return { idx: m.idx, mb: m.mb }; }
  // 시간여행: 체크포인트 idx로 복원한다. 복원 후 파이썬은 그 시점 상태로 재개한다(분기 가능).
  async timeTravel(idx) { await this._send(new TextEncoder().encode(String.fromCharCode(SIGNAL_META) + "restore " + idx)); }

  terminate() { if (this._worker) { this._worker.terminate(); this._worker = null; } for (const q of this._queue) q.resolve({ out: "", err: "종료됨" }); this._queue = []; }
}
