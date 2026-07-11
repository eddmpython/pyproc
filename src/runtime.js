// runtime.js - Layer 0: Pyodide 엔진 래퍼 + 능력 계약.
// 설계 원칙: 교차 관심사(HEAPU8 접근·스택포인터)를 MemoryCapability 계약 뒤에 캡슐화.
// 소비자는 깨끗한 메서드만 쓴다. 빌드 단계 없음(네이티브 ESM). Chromium/Edge.
// reactive.js와 순환 import이지만 두 바인딩 모두 호출 시점에만 참조하므로 안전(ESM live binding).
import { ReactiveController } from "./reactive.js";
import { SyscallBridge } from "./syscallBridge.js";

const PAGE = 65536;
const DEFAULT_INDEX = "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/";

export async function boot(opts = {}) {
  const indexURL = opts.indexURL || DEFAULT_INDEX;
  if (!globalThis.loadPyodide) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = indexURL + "pyodide.js";
      s.onload = res;
      s.onerror = () => rej(new Error("pyodide.js 로드 실패: " + indexURL));
      document.head.appendChild(s);
    });
  }
  const py = await loadPyodide({ indexURL, stdout: opts.stdout, stderr: opts.stderr });
  if (opts.packages && opts.packages.length) await py.loadPackage(opts.packages);
  return new Runtime(py);
}

export class Runtime {
  constructor(py) {
    this._py = py;
    this.memory = new MemoryCapability(py);
    this._micropip = null;
  }
  run(code) { return this._py.runPython(code); }
  runAsync(code) { return this._py.runPythonAsync(code); }
  setGlobal(name, value) { this._py.globals.set(name, value); }
  getGlobal(name) { return this._py.globals.get(name); }
  async install(pkg) {
    if (!this._micropip) { await this._py.loadPackage("micropip"); this._micropip = this._py.pyimport("micropip"); }
    await this._micropip.install(pkg);
  }
  async loadPackages(pkgs) { await this._py.loadPackage(pkgs); }

  // Layer 1 능력 등록(opt-in). 소비자는 능력 계약만 받고 엔진 내부는 만지지 않는다.
  enableReactive() { return new ReactiveController(this); }
  enableSyscallBridge(cfg = {}) { return new SyscallBridge(this, cfg); }

  get raw() { return this._py; }  // 탈출구(권장 안 함)
}

// 능력 계약: 엔진 내부(WASM 메모리) 접근을 여기로 격리. ReactiveController가 소비.
// 완전 해시(Uint32 워드)는 sound의 열쇠 - 샘플링 금지(불완전 델타 -> 복원 크래시).
export class MemoryCapability {
  constructor(py) { this._py = py; }
  heap() { return this._py._module.HEAPU8; }              // 항상 최신 뷰(성장 후 detach 대응)
  byteLength() { return this._py._module.HEAPU8.length; }
  stackSave() { const M = this._py._module; return M._emscripten_stack_get_current ? M._emscripten_stack_get_current() : null; }
  stackRestore(sp) { const M = this._py._module; if (sp != null && M._emscripten_stack_restore) { try { M._emscripten_stack_restore(sp); } catch (e) {} } }
  pageHashes() {
    const buf = this.heap().buffer, len = this.byteLength();
    const words = new Uint32Array(buf, 0, (len - (len % 4)) / 4);
    const wpp = PAGE / 4, n = Math.ceil(len / PAGE), digs = new Uint32Array(n);
    for (let p = 0; p < n; p++) {
      let acc = 2166136261 >>> 0;
      const s = p * wpp, e = Math.min(s + wpp, words.length);
      for (let i = s; i < e; i++) { acc = (acc ^ words[i]) >>> 0; acc = Math.imul(acc, 16777619) >>> 0; }
      digs[p] = acc;
    }
    return digs;
  }
  slicePage(p) { const h = this.heap(); return h.slice(p * PAGE, Math.min((p + 1) * PAGE, h.length)); }
  sliceAll() { const h = this.heap(); return h.slice(0, h.length); }
  writePage(p, bytes) { this.heap().set(bytes, p * PAGE); }
  writeBase(base) { const h = this.heap(); h.set(base.subarray(0, Math.min(base.length, h.length))); }
}

export const PAGE_SIZE = PAGE;
