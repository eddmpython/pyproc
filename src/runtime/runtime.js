// runtime.js - Layer 0: Pyodide 엔진 래퍼(boot/Runtime).
// 설계 원칙: 엔진 내부 접근은 memoryCapability.js 계약 뒤에 격리하고, Layer 1 능력은
// enableReactive()/enableSyscallBridge()로 opt-in 등록한다. 빌드 단계 없음(네이티브 ESM).
// 지원: Chromium/Edge (JSPI + SharedArrayBuffer + crossOriginIsolated).
import { MemoryCapability } from "./memoryCapability.js";
import { ReactiveController } from "../capabilities/reactive.js";
import { SyscallBridge } from "../capabilities/syscallBridge.js";
import { AsgiServer } from "../capabilities/asgiServer.js";
import { WheelCache } from "../capabilities/wheelCache.js";
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
  // env: 초기화 전에 CPython 환경변수로 반영된다(예: PYTHONHASHSEED=0 -> 결정적 부팅).
  // undefined로 명시 전달하면 pyodide가 env.HOME 접근에서 죽으므로 있을 때만 싣는다.
  const cfg = { indexURL, stdout: opts.stdout, stderr: opts.stderr };
  if (opts.env) cfg.env = opts.env;
  const py = await loadPyodide(cfg);
  if (opts.packages && opts.packages.length) await py.loadPackage(opts.packages);
  return new Runtime(py);
}

export class Runtime {
  constructor(py) {
    this._py = py;
    this.memory = new MemoryCapability(py);
    this._micropip = null;
    this.execSeq = 0; // 상태 변이 카운터. 리액티브가 실행 경계 위반을 O(1)로 감지하는 근거.
  }
  run(code) { this.execSeq++; return this._py.runPython(code); }
  runAsync(code) { this.execSeq++; return this._py.runPythonAsync(code); }
  setGlobal(name, value) { this.execSeq++; this._py.globals.set(name, value); }
  getGlobal(name) { return this._py.globals.get(name); }
  async install(pkg) {
    this.execSeq++;
    if (!this._micropip) { await this._py.loadPackage("micropip"); this._micropip = this._py.pyimport("micropip"); }
    await this._micropip.install(pkg);
  }
  async loadPackages(pkgs) { this.execSeq++; await this._py.loadPackage(pkgs); }

  // Layer 1 능력 등록(opt-in). 소비자는 능력 계약만 받고 엔진 내부는 만지지 않는다.
  enableReactive() { return new ReactiveController(this); }
  enableSyscallBridge(cfg = {}) { return new SyscallBridge(this, cfg); }
  enableAsgiServer(cfg = {}) { return new AsgiServer(this, cfg); }
  enableTerminal(cfg = {}) { return new Terminal(this, cfg); }
  enableWheelCache(cfg = {}) { return new WheelCache(this, cfg); }

  // 영속 디스크: OPFS 등 디렉터리 핸들을 파이썬 파일시스템 경로로 마운트한다.
  // 파이썬 open()이 진짜 지속 파일을 읽고 쓴다. 변경 반영은 반환된 sync() 호출(핸들은 소비자 제공).
  async mountHome(dirHandle, path = "/home/web") {
    this.execSeq++;
    const fs = await this._py.mountNativeFS(path, dirHandle);
    return { path, sync: () => fs.syncfs() };
  }

  get raw() { return this._py; }  // 탈출구(권장 안 함)
}
