// pyodideEngineDraft.js - EngineContract 어댑터 초안(probe 전용, 승격 후보).
// Pyodide 인스턴스를 좁은 계약 뒤로 격리한다. 상위(reactive/session/pyProc)는 이 계약만 보고
// _module.HEAPU8, globals, _emscripten_stack_* 같은 엔진 내부를 직접 만지지 않는다.
// 승격 시 위치: src/runtime/engines/pyodideEngine.js. 이 파일은 그 형태의 실측 초안이다.
//
// 설계 의도(엔진 독립): 각 메서드에 "다른 엔진(WASI CPython)이 어떻게 구현하나"를 주석으로 붙여
// 계약이 Pyodide 전용 어휘로 굳지 않게 한다. FFI(프록시)에 기대는 값 다리는 계약상 "직렬화
// 가능 값"이 기본이고, 프록시는 Pyodide 어댑터의 편의(탈출구)로 둔다.

export class PyodideEngine {
  constructor(py) { this._py = py; }

  // 부팅도 계약이다: 엔진 팩토리가 EngineContract를 반환한다.
  // opts는 엔진 중립 키(indexURL/env/snapshot). Pyodide 특유 키(_loadSnapshot 등)로의 번역은 여기서.
  static async boot(loadPyodide, opts = {}) {
    const cfg = { indexURL: opts.indexURL };
    if (opts.env) cfg.env = opts.env;
    if (opts.lockFileURL) cfg.lockFileURL = opts.lockFileURL;
    if (opts.snapshot) cfg._loadSnapshot = opts.snapshot;   // WASI: memory.buffer 주입으로 대응
    if (opts.makeSnapshot) cfg._makeSnapshot = true;
    const py = await loadPyodide(cfg);
    return new PyodideEngine(py);
  }

  // --- 실행 (필수) ---
  // WASI: stdin 프레임 드라이버로 exec(code) 후 결과를 stdout 프로토콜로 회수.
  runSync(code) { return this._py.runPython(code); }
  runAsync(code) { return this._py.runPythonAsync(code); }

  // --- 값 다리 (필수, 값 프로토콜로 강등 가능) ---
  // Pyodide: FFI 프록시. WASI: JSON 직렬화로 전역 딕셔너리에 주입/회수(FFI 없음).
  setGlobal(name, value) { this._py.globals.set(name, value); }
  getGlobal(name) { return this._py.globals.get(name); }

  // --- 선형 메모리 (필수: 체크포인트/델타/fork의 전제) ---
  // exports.memory는 wasm ABI가 강제 = 어떤 엔진이든 있다. Pyodide는 _module.HEAPU8로 노출.
  heapU8() { return this._py._module.HEAPU8; }
  // 스택 포인터: Pyodide는 emscripten_stack_*. WASI 프리빌트는 미노출(자가빌드 export 필요) =
  // null 반환 계약(복원은 스택 되감기 없이도 페이지 델타로 성립, sp는 정합성 강화 옵션).
  stackSave() { const M = this._py._module; return M._emscripten_stack_get_current ? M._emscripten_stack_get_current() : null; }
  stackRestore(sp) { const M = this._py._module; if (sp != null && M._emscripten_stack_restore) { try { M._emscripten_stack_restore(sp); } catch (e) {} } }

  // --- 인터럽트 (선택: 미지원이면 false) ---
  // Pyodide/emscripten: setInterruptBuffer(SAB). upstream CPython emscripten도 동일 메커니즘 내장.
  // WASI 프리빌트: 시그널 없음 -> false(협조적 취소 대신 워커 terminate = 프로세스 kill 의미론).
  setInterruptBuffer(sab) {
    if (!this._py.setInterruptBuffer) return false;
    this._py.setInterruptBuffer(new Uint8Array(sab));
    return true;
  }

  // --- 패키지 (선택) ---
  async loadPackages(pkgs) { return this._py.loadPackage(pkgs); }
  async install(pkg) {
    if (!this._micropip) { await this._py.loadPackage("micropip"); this._micropip = this._py.pyimport("micropip"); }
    return this._micropip.install(pkg);
  }
  async freeze() {
    if (!this._micropip) { await this._py.loadPackage("micropip"); this._micropip = this._py.pyimport("micropip"); }
    return this._micropip.freeze();
  }

  // --- FS (선택) ---
  fs() { return this._py._module.FS || null; }
  async mountDir(path, handle) { const fs = await this._py.mountNativeFS(path, handle); return { path, sync: () => fs.syncfs() }; }

  // --- 스냅샷 (선택) ---
  makeSnapshot() { return this._py.makeMemorySnapshot(); }

  // --- 탈출구 ---
  raw() { return this._py; }
}
