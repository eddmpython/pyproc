// unMachine.js - 통합 Machine 진입점: 하나의 import로 모든 능력을 구성하고 실행한다.
//
// pyproc의 새로운 최상위 제품 표면. Builder + Fluent API 패턴으로 Machine을 선언적으로
// 구성하고, launch()로 실행한다. 능력은 JIT(Just-in-Time)으로 활성화되어 필요 시점까지
// 리소스를 절약한다.
//
// Phase 2-6 통합: Blueprint 파일 로딩, JIT Cascade 완전 자동화, 레시피 생태계,
// Auto-Optimization Pipeline, 프리셋 확장, 오류 메시지 가이드.
//
// 이 파일은 패키지 루트에 위치하며, src/ 레이어 시스템 밖에서 하위 계층을 조립한다.
// 기존 open() / boot() / createWebComputer() / open(blob) 분기 진입점은
// 하위 호환성을 유지한다.

import { PyProcError } from "./src/runtime/errors.js";
import { checkEnvironment } from "./src/composition/runtimeApi.js";

const DEFAULT_PROC_LANES = 2;

// ── Blueprint 검증 (인라인) ─────────────────────────────────────

const VALID_MODES = Object.freeze(["durable", "transient", "portable"]);
const VALID_NETWORK_POLICIES = Object.freeze(["fail-closed", "fail-open"]);

function validateBlueprint(blueprint) {
  if (!blueprint || typeof blueprint !== "object") {
    throw new PyProcError("PYPROC_INPUT_INVALID",
      "Blueprint must be an object. Pass {} for defaults, a structured config, or use Machine.fromPreset(name).");
  }
  const out = { ...blueprint };
  if (out.mode && !VALID_MODES.includes(out.mode)) {
    throw new PyProcError("PYPROC_INPUT_INVALID",
      `mode must be one of: ${VALID_MODES.join(", ")}. Got "${out.mode}". Use Machine.fromPreset(name) for common configs.`);
  }
  out.mode = out.mode || "durable";
  if (out.python) {
    const p = out.python;
    if (p.indexURL && typeof p.indexURL !== "string")
      throw new PyProcError("PYPROC_INPUT_INVALID", "python.indexURL must be a string.");
    if (p.packages && !Array.isArray(p.packages))
      throw new PyProcError("PYPROC_INPUT_INVALID", "python.packages must be an array of strings, e.g. ['numpy', 'pandas'].");
    if (p.deterministic !== undefined && typeof p.deterministic !== "boolean")
      throw new PyProcError("PYPROC_INPUT_INVALID", "python.deterministic must be a boolean (true or false).");
  }
  if (out.processes) {
    if (out.processes.lanes !== undefined && (!Number.isInteger(out.processes.lanes) || out.processes.lanes < 1)) {
      throw new PyProcError("PYPROC_INPUT_INVALID",
        "processes.lanes must be a positive integer (e.g. 4). Use 0 or autoOptimize: true for automatic detection.");
    }
  }
  if (out.network && out.network.policy && !VALID_NETWORK_POLICIES.includes(out.network.policy)) {
    throw new PyProcError("PYPROC_INPUT_INVALID",
      `network.policy must be "fail-closed" or "fail-open". Got "${out.network.policy}".`);
  }
  return out;
}

// ── 레시피 레지스트리 (Phase 5) ─────────────────────────────────

/** @type {Map<string, import("./unMachine.js").MachineBlueprint>} */
const _recipeRegistry = new Map();

// ── Blueprint 프리셋 (Phase 5 확장) ────────────────────────────

const BLUEPRINT_PRESETS = Object.freeze({
  "data-science": Object.freeze({
    name: "data-science-lab",
    python: Object.freeze({ packages: Object.freeze(["numpy", "pandas", "matplotlib"]) }),
    processes: Object.freeze({ lanes: 4, useSnapshot: true }),
    network: Object.freeze({ policy: "fail-closed" }),
  }),
  "ai-sandbox": Object.freeze({
    mode: "transient",
    python: Object.freeze({ deterministic: true }),
    network: Object.freeze({ policy: "fail-closed" }),
    history: Object.freeze({ journal: false }),
  }),
  "repl": Object.freeze({ mode: "transient", processes: Object.freeze({ lanes: 1 }) }),
  "max-performance": Object.freeze({ autoOptimize: true, processes: Object.freeze({ lanes: 0 }) }),
  "web-server": Object.freeze({
    name: "web-server",
    mode: "transient",
    python: Object.freeze({ deterministic: true }),
    network: Object.freeze({ policy: "fail-closed", allowHosts: Object.freeze(["self"]) }),
  }),
  "ml-training": Object.freeze({
    name: "ml-training",
    python: Object.freeze({ packages: Object.freeze(["numpy", "pandas", "scikit-learn", "scipy"]) }),
    processes: Object.freeze({ lanes: 0, useSnapshot: true }),
    network: Object.freeze({ policy: "fail-closed" }),
    autoOptimize: true,
  }),
  "etl-pipeline": Object.freeze({
    name: "etl-pipeline",
    python: Object.freeze({ packages: Object.freeze(["numpy", "pandas"]) }),
    processes: Object.freeze({ lanes: 4, useSnapshot: true }),
    network: Object.freeze({ policy: "fail-closed" }),
    filesystem: Object.freeze({ persist: true }),
  }),
  "education": Object.freeze({
    name: "python-classroom",
    mode: "transient",
    python: Object.freeze({ deterministic: true }),
    network: Object.freeze({ policy: "fail-closed" }),
    terminal: Object.freeze({ timeTravel: true }),
  }),
  "dev-server": Object.freeze({
    name: "dev-server",
    mode: "transient",
    python: Object.freeze({ deterministic: true }),
    network: Object.freeze({ policy: "fail-closed" }),
    processes: Object.freeze({ lanes: 2 }),
  }),
  "default": Object.freeze({ mode: "durable" }),
});

// ── Auto-Optimizer (Phase 4) ────────────────────────────────────

function autoOptimize(config) {
  if (!config.autoOptimize) return config;
  const out = { ...config };
  if (!out.processes) out.processes = {};
  if (!out.processes.lanes || out.processes.lanes === 0) {
    out.processes.lanes = Math.max(1, (typeof navigator !== "undefined"
      ? (navigator.hardwareConcurrency || 4) - 1 : 3));
  }
  if (out.processes.lanes > 4 && !out.python?.coreCacheDir) {
    out._warnings = out._warnings || [];
    out._warnings.push("[Auto-optimize] Consider setting python.coreCacheDir for faster cold boots with many workers.");
  }
  return out;
}

// ── Machine (static factory) ────────────────────────────────────

export class Machine {
  // ── 진입점 ──────────────────────────────────────────────────
  static create(blueprint) {
    if (!blueprint) return new MachineBuilder({ mode: "durable" });
    if (blueprint && typeof blueprint === "object" && !Array.isArray(blueprint)) {
      return new MachineBuilder(validateBlueprint(blueprint));
    }
    throw new PyProcError("PYPROC_INPUT_INVALID",
      "Machine.create: pass nothing (default durable), a blueprint object, or use Machine.fromPreset(name).");
  }

  /** 프리셋 이름으로 즉시 머신 생성 */
  static fromPreset(name) {
    const preset = BLUEPRINT_PRESETS[name] || _recipeRegistry.get(name);
    if (!preset) throw new PyProcError("PYPROC_INPUT_INVALID",
      `Unknown preset: "${name}". Available presets: ${Machine.listPresets().join(", ")}. ` +
      `Register your own with Machine.registerRecipe(name, blueprint).`);
    return new MachineBuilder({ ...preset });
  }

  /** 사용 가능한 프리셋 + 레시피 목록 */
  static listPresets() {
    const builtin = Object.keys(BLUEPRINT_PRESETS);
    const custom = [..._recipeRegistry.keys()].filter(k => !builtin.includes(k));
    return [...builtin, ...custom];
  }

  // ── 레시피 시스템 (Phase 5) ─────────────────────────────────
  /**
   * 사용자 정의 레시피를 등록한다. 등록 후 Machine.fromPreset(name)으로 사용 가능.
   * @param {string} name
   * @param {import("./unMachine.js").MachineBlueprint} blueprint
   */
  static registerRecipe(name, blueprint) {
    if (!name || typeof name !== "string") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Recipe name must be a non-empty string.");
    }
    if (BLUEPRINT_PRESETS[name]) {
      throw new PyProcError("PYPROC_INPUT_INVALID",
        `"${name}" is a built-in preset and cannot be overwritten. Choose a different name.`);
    }
    _recipeRegistry.set(name, validateBlueprint(blueprint));
  }

  /** 등록된 레시피 제거 */
  static unregisterRecipe(name) {
    if (BLUEPRINT_PRESETS[name]) {
      throw new PyProcError("PYPROC_INPUT_INVALID", `"${name}" is a built-in preset and cannot be removed.`);
    }
    return _recipeRegistry.delete(name);
  }

  /** 모든 등록된 레시피 목록 (빌트인 제외) */
  static listRecipes() { return [..._recipeRegistry.keys()]; }

  // ── 파일 로딩 (Phase 2) ─────────────────────────────────────
  /**
   * URL에서 블루프린트 JSON을 로드하여 머신 빌더를 반환한다.
   * @param {string} url - 블루프린트 JSON URL
   * @returns {Promise<MachineBuilder>}
   */
  static async fromFile(url) {
    let response;
    try {
      response = await fetch(url);
    } catch (e) {
      throw new PyProcError("PYPROC_INPUT_INVALID",
        `Cannot fetch blueprint from "${url}": ${e.message}. ` +
        `Ensure the file is accessible from your origin or use Machine.create(blueprintObject).`);
    }
    if (!response.ok) {
      throw new PyProcError("PYPROC_INPUT_INVALID",
        `Blueprint fetch failed: ${response.status} ${response.statusText}. ` +
        `Check that the file exists at "${url}".`);
    }
    let parsed;
    try {
      parsed = await response.json();
    } catch (e) {
      throw new PyProcError("PYPROC_INPUT_INVALID",
        `Invalid JSON in blueprint file: ${e.message}. ` +
        `Blueprint files must be valid JSON. Use Machine.stringify() to generate one.`);
    }
    return new MachineBuilder(validateBlueprint(parsed));
  }

  // ── 단축 경로 ───────────────────────────────────────────────
  static async launch(blueprint) { return Machine.create(blueprint).launch(); }
  static checkEnvironment() { return checkEnvironment(); }

  // ── 유틸리티 ────────────────────────────────────────────────
  /** @param {MachineHandle} left @param {MachineHandle} right */
  static compare(left, right) { return _diffConfigs(left._config, right._config); }

  /**
   * 블루프린트를 JSON 문자열로 직렬화한다.
   * @param {import("./unMachine.js").MachineBlueprint} blueprint
   */
  static stringify(blueprint) {
    const cleaned = {};
    for (const [key, value] of Object.entries(blueprint || {})) {
      if (value === undefined || value === null) continue;
      if (typeof value === "function" || value instanceof FileSystemDirectoryHandle) continue;
      if (value instanceof CryptoKey || value instanceof CryptoKeyPair) continue;
      if (typeof value === "object" && !Array.isArray(value)) {
        const sub = {};
        let has = false;
        for (const [sk, sv] of Object.entries(value)) {
          if (sv === undefined || sv === null) continue;
          if (typeof sv === "function" || sv instanceof FileSystemDirectoryHandle) continue;
          if (sv instanceof CryptoKey || sv instanceof CryptoKeyPair) continue;
          sub[sk] = sv; has = true;
        }
        if (has) cleaned[key] = sub;
      } else { cleaned[key] = value; }
    }
    return JSON.stringify(cleaned, null, 2);
  }

  /** @param {import("./unMachine.js").MachineBlueprint} blueprint @returns {string[]} */
  static lint(blueprint) {
    const warnings = [];
    if (blueprint?.processes?.lanes > 16) warnings.push("processes.lanes > 16: 대부분의 기기에서 오버헤드가 이득보다 큽니다. 4~8을 권장합니다.");
    if (blueprint?.python?.deterministic && !blueprint?.python?.env?.PYTHONHASHSEED)
      warnings.push("deterministic: true이지만 PYTHONHASHSEED 미설정. python.env.PYTHONHASHSEED: \"0\"을 추가하세요.");
    if (blueprint?.mode === "durable" && !blueprint?.name)
      warnings.push("durable 모드지만 name이 없습니다. name: \"my-workspace\"를 추가하세요. OPFS 키 'default'가 사용됩니다.");
    if (blueprint?.network?.policy === "fail-open")
      warnings.push("fail-open: 모든 외부 연결을 허용합니다. 신뢰할 수 없는 코드에는 fail-closed를 권장합니다.");
    return warnings;
  }
}

function _diffConfigs(left, right) {
  const added = []; const removed = []; const changed = [];
  const allKeys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  for (const key of allKeys) {
    const lv = (left || {})[key]; const rv = (right || {})[key];
    if (lv === undefined && rv !== undefined) added.push(key);
    else if (lv !== undefined && rv === undefined) removed.push(key);
    else if (JSON.stringify(lv) !== JSON.stringify(rv)) changed.push({ key, from: lv, to: rv });
  }
  return { added, removed, changed };
}

// ── MachineBuilder ───────────────────────────────────────────────

export class MachineBuilder {
  _config;

  constructor(blueprint) {
    if (!blueprint) { this._config = { mode: "durable" }; return; }
    if (typeof blueprint === "string") {
      try { blueprint = JSON.parse(blueprint); } catch (e) {
        throw new PyProcError("PYPROC_INPUT_INVALID",
          "Machine.create(string): invalid JSON blueprint. " + e.message + ". Use Machine.fromFile(url) to load from a file.");
      }
    }
    this._config = validateBlueprint(blueprint);
    if (this._config.autoOptimize) { this._config = autoOptimize(this._config); }
  }

  withPython(options = {}) { this._config.python = { ...this._config.python, ...options }; return this; }
  withPackages(...packages) {
    if (!this._config.python) this._config.python = {};
    this._config.python.packages = [...(this._config.python.packages || []), ...packages];
    return this;
  }
  withProcesses(options = {}) { this._config.processes = { ...this._config.processes, ...options }; return this; }
  withNetwork(options = {}) { this._config.network = { ...this._config.network, ...options }; return this; }
  withHistory(options = {}) { this._config.history = { ...this._config.history, ...options }; return this; }
  withImage(options = {}) { this._config.image = { ...this._config.image, ...options }; return this; }
  withFilesystem(options = {}) { this._config.filesystem = { ...this._config.filesystem, ...options }; return this; }
  withTerminal(options = {}) { this._config.terminal = { ...this._config.terminal, ...options }; return this; }
  withAutoOptimize(options = true) { this._config.autoOptimize = options; return this; }

  // ── JIT Auto-Discovery (Phase 3) ──────────────────────────────
  /**
   * 머신이 코드를 실행하면서 필요한 능력을 자동으로 감지하고 활성화한다.
   * Python 코드에서 import, network, subprocess 등 패턴을 감지한다.
   */
  withAutoDiscover(enabled = true) { this._config.autoDiscover = enabled; return this; }

  /** 현재 구성된 블루프린트를 반환한다 (디버깅/저장용). */
  toBlueprint() { return { ...this._config }; }

  async launch() {
    const config = this._config;
    const config2 = config.autoOptimize ? autoOptimize(config) : config;

    let pyprocMachine = null;
    const pythonOpts = config2.python || {};
    const bootOpts = {
      indexURL: pythonOpts.indexURL, packages: pythonOpts.packages,
      env: pythonOpts.env, setup: pythonOpts.setup, deterministic: pythonOpts.deterministic,
      engineScriptIntegrity: pythonOpts.engineScriptIntegrity, coreIntegrity: pythonOpts.coreIntegrity,
      coreCacheDir: pythonOpts.coreCacheDir, wheelDir: pythonOpts.wheelDir,
    };
    if (config2.mode === "transient" || bootOpts.deterministic) {
      const { boot } = await import("./src/machine/composition/pyprocMachine.js");
      pyprocMachine = await boot(bootOpts);
    } else {
      const { openDurableMachine } = await import("./src/session/kernelElection.js");
      pyprocMachine = await this._bootDurable(config2, bootOpts, openDurableMachine);
    }
    const handle = new MachineHandle(pyprocMachine, config2);
    if (config2._warnings?.length) {
      for (const w of config2._warnings) console.info("[pyproc Machine]", w);
    }
    return handle;
  }

  async _bootDurable(config, bootOpts, openDurableMachine) {
    const name = config.name || "default";
    if (config.history?.journalDir) {
      return openDurableMachine({ name, journalDir: config.history.journalDir,
        manifest: { indexURL: bootOpts.indexURL, packages: bootOpts.packages, env: bootOpts.env, setup: bootOpts.setup } });
    }
    const result = await openDurableMachine({ name });
    if (bootOpts.packages?.length) await result.loadPackages(bootOpts.packages);
    if (bootOpts.setup) await result.run(bootOpts.setup);
    return result;
  }
}

// ── MachineHandle (JIT Capability Cascade + Auto-Discovery) ──────

export class MachineHandle {
  _machine; _config;
  _procPool = null; _jobControl = null; _containers = null; _history = null;
  _jail = null; _syscall = null; _asgi = null; _virtualOrigin = null;
  _deviceFs = null; _init = null; _wheelCache = null;

  constructor(pyprocMachine, config) { this._machine = pyprocMachine; this._config = config; }

  // ── Auto-Discovery (Phase 3 핵심) ────────────────────────────
  /**
   * Python 코드를 실행하면서 import/network/subprocess 패턴을 감지하고
   * 필요한 능력을 자동 활성화한다.
   * @param {string} code
   * @returns {Promise<unknown>}
   */
  async runWithDiscovery(code) {
    // import 패턴 감지
    const imports = code.matchAll(/^\s*(?:import\s+(\w+)|from\s+(\w+)\s+import)/gm);
    const modules = new Set();
    for (const m of imports) modules.add(m[1] || m[2]);

    // 알려진 패키지 -> 자동 loadPackages
    const knownModules = new Set(["numpy", "pandas", "matplotlib", "scipy", "scikit-learn", "requests", "fastapi", "starlette"]);
    const toLoad = [...modules].filter(m => knownModules.has(m));
    if (toLoad.length && typeof this._machine.loadPackages === "function") {
      try { await this._machine.loadPackages(toLoad); } catch {}
    }

    // network 패턴 감지 (urllib, requests, fetch)
    if (/urllib|requests|http\.client|socket\./.test(code)) {
      try { await this.enableNetwork(); } catch {}
    }

    // subprocess 패턴
    if (/subprocess|os\.system/.test(code)) {
      try { await this.enableNetwork(); } catch {}
    }

    return this._machine.runAsync ? this._machine.runAsync(code) : this._machine.run(code);
  }

  // ── 기본 실행 ──────────────────────────────────────────────
  run(code) {
    if (this._config.autoDiscover) return this.runWithDiscovery(code);
    return this._machine.run(code);
  }
  async runAsync(code) {
    if (this._config.autoDiscover) return this.runWithDiscovery(code);
    if (typeof this._machine.runAsync === "function") return this._machine.runAsync(code);
    return this._machine.run(code);
  }
  loadPackages(packages) {
    if (typeof this._machine.loadPackages === "function") return this._machine.loadPackages(packages);
    return this._machine.runtime?.loadPackages(packages);
  }

  // ── 파일시스템 (JIT) ───────────────────────────────────────
  get fs() {
    if (!this._fs) {
      const m = this._machine;
      if (m.fs) this._fs = m.fs;
      else if (m.runtime?.fs) this._fs = m.runtime.fs;
      else throw new PyProcError("PYPROC_INPUT_INVALID",
        "Filesystem is not available on this machine. The engine may not support Emscripten FS.");
    }
    return this._fs;
  }

  // ── 프로세스 풀 (JIT) ──────────────────────────────────────
  async proc(options = {}) {
    if (this._procPool) return this._procPool;
    const procConfig = { ...this._config.processes, ...options };
    const lanes = procConfig.lanes || DEFAULT_PROC_LANES;
    this._procPool = (async () => {
      if (typeof this._machine.proc === "function") return this._machine.proc({ lanes, ...procConfig });
      throw new PyProcError("PYPROC_INPUT_INVALID",
        "Process pool is not available on a durable multi-tab machine. Use Machine.create({ mode: 'transient' }).");
    })();
    try { return await this._procPool; } catch (e) { this._procPool = null; throw e; }
  }

  // ── 터미널 (JIT) ───────────────────────────────────────────
  async term(options = {}) {
    const tc = { ...this._config.terminal, ...options };
    if (typeof this._machine.term === "function") return this._machine.term(tc);
    if (this._machine.runtime?.enableTerminal) return this._machine.runtime.enableTerminal(tc);
    throw new PyProcError("PYPROC_INPUT_INVALID",
      "Terminal is not available on this machine. Use a transient or deterministic machine.");
  }

  // ── 네트워크 (JIT) ─────────────────────────────────────────
  async enableNetwork(options = {}) {
    if (this._syscall) return this._syscall;
    const nc = { ...this._config.network, ...options };
    const rt = this._machine.runtime || this._machine;
    if (typeof rt.enableSyscallBridge !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID",
        "Network (syscall bridge) is not available. Boot with crossOriginIsolated headers (COOP/COEP) and JSPI.");
    }
    this._syscall = rt.enableSyscallBridge({ proxyUrl: nc.proxyUrl, requests: nc.requests ?? true });
    return this._syscall;
  }

  async enableAsgi(options = {}) {
    if (this._asgi) return this._asgi;
    const rt = this._machine.runtime || this._machine;
    if (typeof rt.enableAsgiServer !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "ASGI server is not available on this machine.");
    }
    this._asgi = rt.enableAsgiServer(options);
    return this._asgi;
  }

  async enableVirtualOrigin(options = {}) {
    if (this._virtualOrigin) return this._virtualOrigin;
    const rt = this._machine.runtime || this._machine;
    if (typeof rt.enableVirtualOrigin !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID",
        "Virtual origin is not available. Call enableAsgi() first to set up the ASGI server.");
    }
    const asgi = this._asgi || await this.enableAsgi(options);
    this._virtualOrigin = rt.enableVirtualOrigin(asgi, options);
    return this._virtualOrigin;
  }

  // ── 권한 감옥 (JIT) ───────────────────────────────────────
  async enableJail(permissions = {}) {
    if (this._jail) return this._jail;
    const rt = this._machine.runtime || this._machine;
    if (typeof rt.enableJail !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Permission jail is not available on this machine.");
    }
    this._jail = rt.enableJail(permissions);
    return this._jail;
  }

  // ── Device FS (JIT) ────────────────────────────────────────
  async enableDeviceFs(options = {}) {
    if (this._deviceFs) return this._deviceFs;
    const rt = this._machine.runtime || this._machine;
    if (typeof rt.enableDeviceFs !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Device FS is not available on this machine.");
    }
    this._deviceFs = rt.enableDeviceFs(options);
    return this._deviceFs;
  }

  // ── Wheel Cache (JIT) ──────────────────────────────────────
  async enableWheelCache(options) {
    if (this._wheelCache) return this._wheelCache;
    const rt = this._machine.runtime || this._machine;
    if (typeof rt.enableWheelCache !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Wheel cache is not available. Pass { dir: FileSystemDirectoryHandle }.");
    }
    this._wheelCache = rt.enableWheelCache(options);
    return this._wheelCache;
  }

  // ── 빠른 서버 부팅 (Phase 6 통합) ─────────────────────────
  /**
   * 머신을 완전한 웹 서버로 즉시 구성한다. ASGI + VirtualOrigin + Network + Jail을 한 번에.
   * @returns {Promise<{asgi: AsgiServer, virtualOrigin: VirtualOrigin, syscall: SyscallBridge}>}
   */
  async asServer(options = {}) {
    const asgi = await this.enableAsgi(options);
    const virtualOrigin = await this.enableVirtualOrigin(options);
    let syscall = null;
    try { syscall = await this.enableNetwork(options); } catch {}
    return { asgi, virtualOrigin, syscall };
  }

  // ── 히스토리 ───────────────────────────────────────────────
  get history() {
    if (!this._history) {
      if (this._machine.history) this._history = this._machine.history;
      else throw new PyProcError("PYPROC_INPUT_INVALID",
        "History is not available on this machine. Use a transient or deterministic machine.");
    }
    return this._history;
  }

  // ── 정보 ───────────────────────────────────────────────────
  get deterministic() { return this._machine.deterministic || false; }
  get runtime() { return this._machine.runtime || this._machine; }
  status() {
    return {
      mode: this._config.mode || "durable", deterministic: this.deterministic,
      packages: this._config.python?.packages || [],
      processes: this._config.processes?.lanes || null,
      network: this._config.network?.policy || "fail-closed",
      jail: this._jail ? "active" : null,
      asgi: this._asgi ? "active" : null,
      autoDiscover: this._config.autoDiscover || false,
    };
  }

  // ── 이미지 내보내기 ───────────────────────────────────────
  async exportImage(options = {}) {
    const ic = { ...this._config.image, ...options };
    if (typeof this._machine.history?.export === "function") return this._machine.history.export(ic);
    throw new PyProcError("PYPROC_INPUT_INVALID",
      "Image export is only available on deterministic machines. Use Machine.create({ python: { deterministic: true } }).");
  }

  // ── 정리 ───────────────────────────────────────────────────
  async dispose() {
    if (this._procPool) {
      try { const pool = await this._procPool; if (pool?.terminate) pool.terminate(); } catch {}
      this._procPool = null;
    }
    if (this._jobControl) {
      try { const jc = await this._jobControl; if (jc?.terminate) jc.terminate(); } catch {}
      this._jobControl = null;
    }
    if (typeof this._machine.dispose === "function") await this._machine.dispose();
    if (typeof this._machine.leave === "function") this._machine.leave();
  }

  markDirty() { if (typeof this._machine.markDirty === "function") return this._machine.markDirty(); }

  // ── 잡 컨트롤 (JIT) ───────────────────────────────────────
  async jobs(options = {}) {
    if (this._jobControl) return this._jobControl;
    this._jobControl = (async () => {
      if (typeof this._machine.jobs === "function") return this._machine.jobs(options);
      throw new PyProcError("PYPROC_INPUT_INVALID",
        "Job control is only available on transient machines. Use Machine.create({ mode: 'transient' }).");
    })();
    try { return await this._jobControl; } catch (e) { this._jobControl = null; throw e; }
  }

  // ── 컨테이너 (JIT) ────────────────────────────────────────
  async containers(options = {}) {
    if (this._containers) return this._containers;
    this._containers = (async () => {
      if (typeof this._machine.containers === "function") return this._machine.containers(options);
      throw new PyProcError("PYPROC_INPUT_INVALID",
        "Containers are only available on transient machines.");
    })();
    try { return await this._containers; } catch (e) { this._containers = null; throw e; }
  }

  // ── Init (JIT) ────────────────────────────────────────────
  async enableInit(options = {}) {
    if (this._init) return this._init;
    const rt = this._machine.runtime || this._machine;
    if (typeof rt.enableInit !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "Init is not available on this machine.");
    }
    this._init = rt.enableInit(options);
    return this._init;
  }
}