// runtime.js - Layer 0: Pyodide 엔진 래퍼(boot/Runtime).
// 설계 원칙: 엔진 내부 접근은 memoryCapability.js 계약 뒤에 격리하고, Layer 1 능력은
// enableReactive()/enableSyscallBridge()로 opt-in 등록한다. 빌드 단계 없음(네이티브 ESM).
// 지원: Chromium/Edge (JSPI + SharedArrayBuffer + crossOriginIsolated).
import { MemoryCapability } from "./memoryCapability.js";
import { ReactiveController } from "../capabilities/reactive.js";
import { SyscallBridge } from "../capabilities/syscallBridge.js";
import { AsgiServer } from "../capabilities/asgiServer.js";
import { Terminal } from "../capabilities/terminal.js";

export { MemoryCapability, PAGE_SIZE } from "./memoryCapability.js";

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
  enableAsgiServer(cfg = {}) { return new AsgiServer(this, cfg); }
  enableTerminal() { return new Terminal(this); }

  get raw() { return this._py; }  // 탈출구(권장 안 함)
}
