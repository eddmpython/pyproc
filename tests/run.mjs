// tests/run.mjs - pyproc 구조/린트 게이트. Node 전용, 의존성 0.
// WASM 런타임 진짜 검증은 브라우저에서만 가능(docs/operations/testing.md). 여기서는 브라우저
// 없이 확인 가능한 것만 본다: 공개 표면·타입, em dash 0, 상대 링크 생존, 구조 불변식.
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (name) => { passed++; console.log(`  PASS ${name}`); };
const bad = (name, msg) => { failed++; console.log(`  FAIL ${name}: ${msg}`); };
function check(name, fn) { try { fn(); ok(name); } catch (e) { bad(name, e.message); } }
async function checkAsync(name, fn) { try { await fn(); ok(name); } catch (e) { bad(name, e.message); } }

// 재귀로 지정 확장자 파일 수집(node_modules 제외).
function collect(dir, exts, acc = []) {
  for (const entry of readdirSync(dir)) {
    // vendor/는 fetchEngine이 받은 서드파티 배포판(gitignore) = 우리 린트 표면이 아니다.
    if (entry === "node_modules" || entry === "vendor" || entry.startsWith(".git")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, exts, acc);
    else if (exts.some((e) => entry.endsWith(e))) acc.push(full);
  }
  return acc;
}
const rel = (f) => f.slice(ROOT.length + 1).replaceAll("\\", "/");
// import 절은 여러 줄에 걸칠 수 있다. 개행을 배제하면 `{ a,\n b } from "x"` 형태가 통째로
// 안 보여서 구조 게이트(참조 실존/순환/레이어) 전부가 부분맹이 된다. scripts/assetManifest.mjs의
// 같은 목적 정규식과 같은 규칙(개행 허용)으로 맞춘다.
function jsModuleRefs(file) {
  const src = readFileSync(file, "utf8");
  const refs = [];
  const add = (kind, match) => refs.push({ kind, spec: match[1] });
  for (const m of src.matchAll(/^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/gm)) add("module", m);
  for (const m of src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) add("dynamic", m);
  for (const m of src.matchAll(/\bimportScripts\s*\(\s*["']([^"']+)["']\s*\)/g)) add("importScripts", m);
  for (const m of src.matchAll(/new\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) add("newURL", m);
  return refs;
}
function moduleTarget(file, spec) {
  const clean = spec.split(/[?#]/)[0];
  if (clean.startsWith("/")) return join(ROOT, clean.slice(1));
  if (clean.startsWith(".")) return resolve(dirname(file), clean);
  return null;
}
function srcLayerName(relPath) {
  const parts = relPath.split("/");
  return parts[0] === "src" ? parts[1] : null;
}
function findCycles(graph) {
  const cycles = [];
  const state = new Map();
  const stack = [];
  const visit = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) || []) {
      if (!graph.has(next)) continue;
      if (!state.has(next)) visit(next);
      else if (state.get(next) === 1) cycles.push(stack.slice(stack.indexOf(next)).concat(next));
    }
    stack.pop();
    state.set(node, 2);
  };
  for (const node of graph.keys()) if (!state.has(node)) visit(node);
  return cycles;
}

console.log("pyproc 게이트\n");

// 1) 공개 표면: index.js가 기대 export를 내는가.
console.log("[표면]");
const api = await import(pathToFileURL(join(ROOT, "index.js")).href);
const benchArtifactContract = await import(pathToFileURL(join(ROOT, "tests", "browser", "benchArtifacts.mjs")).href);
const productConsumerCoverage = await import(pathToFileURL(join(ROOT, "tests", "browser", "productConsumerCoverage.mjs")).href);
const { runMemoryMachineStoreContract } = await import(pathToFileURL(join(ROOT, "tests", "webMachine", "contracts", "machineStoreContract.mjs")).href);
const { runContextSwapContract } = await import(pathToFileURL(join(ROOT, "tests", "webMachine", "contracts", "contextSwapContract.mjs")).href);
// porcelain 일격(state-kernel 7b) 이후 루트는 정확히 6개다: 진입 동사 2(boot,
// createWebComputer) + 부활 동사 1(open) + 진단 1(checkEnvironment) + 오류 계약 2.
// 능력 상세는 핸들(runtime 탈출구)과 subpath(history/machine/worker/assets, 강등 gpu/socket/wasi)로 산다.
const assetsApi = await import(pathToFileURL(join(ROOT, "src", "runtime", "assets.js")).href);
const coreApi = await import(pathToFileURL(join(ROOT, "src", "composition", "runtimeApi.js")).href);
const sessionApi = await import(pathToFileURL(join(ROOT, "src", "session", "session.js")).href);
const electionApi = await import(pathToFileURL(join(ROOT, "src", "session", "kernelElection.js")).href);
const procApi = await import(pathToFileURL(join(ROOT, "src", "processOs", "pyProc.js")).href);
const containerApi = await import(pathToFileURL(join(ROOT, "src", "processOs", "machineContainer.js")).href);
const jobApi = await import(pathToFileURL(join(ROOT, "src", "processOs", "jobControl.js")).href);
const reactiveApi = await import(pathToFileURL(join(ROOT, "src", "capabilities", "reactive.js")).href);
const journalApi = await import(pathToFileURL(join(ROOT, "src", "capabilities", "machineJournal.js")).href);
const jailApi = await import(pathToFileURL(join(ROOT, "src", "capabilities", "machineJail.js")).href);
const deviceFsApi = await import(pathToFileURL(join(ROOT, "src", "capabilities", "deviceFs.js")).href);
const initApi = await import(pathToFileURL(join(ROOT, "src", "capabilities", "init.js")).href);
const virtualOriginApi = await import(pathToFileURL(join(ROOT, "src", "capabilities", "virtualOrigin.js")).href);
const fileSystemApi = await import(pathToFileURL(join(ROOT, "src", "runtime", "fileSystem.js")).href);
const porcelainApi = await import(pathToFileURL(join(ROOT, "src", "machine", "composition", "pyprocMachine.js")).href);
const stateBarrel = await import(pathToFileURL(join(ROOT, "src", "state", "index.js")).href);
const ROOT_EXPORTS = [
  ["boot", "function"], ["open", "function"], ["createWebComputer", "function"],
  ["checkEnvironment", "function"], ["PyProcError", "function"], ["PYPROC_ERROR_CODES", "object"],
];
for (const [name, kind] of ROOT_EXPORTS) {
  check(`export ${name}:${kind}`, () => {
    if (typeof api[name] !== kind) throw new Error(`got ${typeof api[name]}`);
  });
}
check("루트 표면은 정확히 한 자릿수(표류 즉시 RED)", () => {
  const names = Object.keys(api).sort();
  const expected = ROOT_EXPORTS.map(([n]) => n).sort();
  if (names.join(",") !== expected.join(",")) throw new Error("실물: " + names.join(","));
});
// d.ts 1:1 패리티: 실물 값-export와 d.ts 값-선언이 정확히 같아야 한다(표류 전과 8건의 재발 방지).
check("루트 d.ts 값-선언 1:1 패리티", () => {
  const dts = readFileSync(join(ROOT, "index.d.ts"), "utf8");
  const declared = new Set();
  for (const m of dts.matchAll(/^export function (\w+)/gm)) declared.add(m[1]);
  for (const m of dts.matchAll(/^export class (\w+)/gm)) declared.add(m[1]);
  for (const m of dts.matchAll(/^export const (\w+)/gm)) declared.add(m[1]);
  for (const m of dts.matchAll(/^export \{([^}]*)\} from/gm)) {
    for (const raw of m[1].split(",")) {
      const token = raw.trim();
      if (!token || token.startsWith("type ")) continue;
      declared.add(token.split(/\s+as\s+/).pop());
    }
  }
  const real = new Set(Object.keys(api));
  for (const name of real) if (!declared.has(name)) throw new Error("d.ts에 값-선언 없음: " + name);
  for (const name of declared) if (!real.has(name)) throw new Error("실물에 없는 값-선언: " + name);
});
check("PAGE_SIZE === 65536 (pyproc/history 표면)", () => {
  if (coreApi.PAGE_SIZE !== 65536) throw new Error(String(coreApi.PAGE_SIZE));
});
check("asset manifest 형태 (pyproc/assets 표면)", () => {
  const m = assetsApi.getPyProcAssetManifest({ baseURL: "https://example.test/pkg/" });
  if (m.version !== assetsApi.PYPROC_ASSET_MANIFEST_VERSION) throw new Error("version 불일치");
  if (m.packageRoot !== "https://example.test/pkg/") throw new Error("packageRoot 정규화 실패");
  const relRoot = assetsApi.getPyProcAssetManifest({ baseURL: "/vendor/pyproc" });
  if (relRoot.packageRoot !== "/vendor/pyproc/") throw new Error("root-relative baseURL 보존 실패");
  if (!relRoot.assets[0].url.startsWith("/vendor/pyproc/src/")) throw new Error("root-relative asset URL 계산 실패");
  if (!m.policy.sameOriginRequired || !m.policy.preserveRelativeImports || !m.policy.runtimePreflight) throw new Error("policy 불충분");
  const roles = new Set(m.assets.map((a) => a.role));
  for (const role of ["processWorker", "machineWorker", "wasiWorker", "pyprocServiceWorker"])
    if (!roles.has(role)) throw new Error("role 누락: " + role);
  for (const a of m.assets) {
    if (!a.path.startsWith("src/")) throw new Error("src 밖 자산: " + a.path);
    if (!a.url.startsWith("https://example.test/pkg/src/")) throw new Error("URL 계산 실패: " + a.url);
  }
});
await checkAsync("asset integrity preflight가 graph 바이트를 검증", async () => {
  const path = "src/processOs/ipc.js";
  const bytes = readFileSync(join(ROOT, path));
  const integrity = "sha256-" + createHash("sha256").update(bytes).digest("base64");
  const manifest = { files: [{ path, url: "mem://ipc", bytes: bytes.byteLength, integrity, roles: ["processWorker"] }] };
  const fetchOk = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  const r = await assetsApi.verifyPyProcAssetIntegrity(manifest, { roles: ["processWorker"], fetch: fetchOk });
  if (r.verified !== 1 || r.bytes !== bytes.byteLength || r.files[0] !== path) throw new Error("검증 결과 형식 오류");
  let rejected = false;
  try {
    await assetsApi.verifyPyProcAssetIntegrity({ files: [{ ...manifest.files[0], integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }] }, { roles: ["processWorker"], fetch: fetchOk });
  } catch (e) {
    rejected = String(e).includes("해시 불일치");
  }
  if (!rejected) throw new Error("잘못된 SRI를 거부하지 않음");
});
await checkAsync("Service Worker 등록 helper가 검증한 manifest URL만 사용", async () => {
  const path = "src/capabilities/pyprocSw.js";
  const bytes = readFileSync(join(ROOT, path));
  const integrity = "sha256-" + createHash("sha256").update(bytes).digest("base64");
  const manifest = { files: [{ path, url: "/src/capabilities/pyprocSw.js", bytes: bytes.byteLength, integrity, roles: ["pyprocServiceWorker"] }] };
  const calls = [];
  const nav = {
    serviceWorker: {
      register: async (url, options) => {
        calls.push({ url, options });
        return { ok: true, unregister: async () => true };
      },
    },
  };
  const fetchOk = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  const r = await assetsApi.registerPyProcServiceWorker(manifest, {
    navigator: nav,
    fetch: fetchOk,
    cache: true,
    asgi: "/pyproc/",
    coreIntegrity: "/pyodide-integrity.json",
    coreRequired: false,
    scope: "/",
  });
  if (calls.length !== 1) throw new Error("register 호출 수 오류");
  const u = new URL(calls[0].url, "https://example.test/");
  if (u.pathname !== "/src/capabilities/pyprocSw.js") throw new Error("register 경로 오류: " + calls[0].url);
  if (u.searchParams.get("cache") !== "1" || u.searchParams.get("asgi") !== "/pyproc/") throw new Error("query 오류: " + u.search);
  if (u.searchParams.get("coreIntegrity") !== "/pyodide-integrity.json" || u.searchParams.get("coreRequired") !== "0") throw new Error("coreIntegrity query 오류: " + u.search);
  if (calls[0].options.scope !== "/") throw new Error("scope 전달 누락");
  if (r.file !== path || r.integrity.verified !== 1 || r.url !== calls[0].url) throw new Error("반환값 오류");
});
// checkEnvironment는 표준 전역만 읽어 구조화된 진단을 돌려준다(Node에서도 던지지 않는다).
check("checkEnvironment() 진단 형태", () => {
  const r = api.checkEnvironment();
  for (const k of ["ok", "crossOriginIsolated", "sharedArrayBuffer", "jspi"]) if (typeof r[k] !== "boolean") throw new Error(k + " 형식");
  if (!Array.isArray(r.issues)) throw new Error("issues 배열 아님");
  for (const it of r.issues) for (const k of ["code", "need", "why", "fix"]) if (typeof it[k] !== "string") throw new Error("issue." + k + " 형식");
});
// 자가 호스팅(engine-independence P0)의 핀 정합: fetchEngine이 받는 배포판 버전과
// DEFAULT_INDEX(배포 지점의 유일 정의처)가 같은 값이어야 한다. 버전 변경 = 릴리즈 사유.
check("자가 호스팅 핀 정합(fetchEngine == DEFAULT_INDEX)", () => {
  const fe = readFileSync(join(ROOT, "scripts", "fetchEngine.mjs"), "utf8");
  const m = fe.match(/ENGINE_VERSION = "([^"]+)"/);
  if (!m) throw new Error("scripts/fetchEngine.mjs에서 ENGINE_VERSION을 못 찾음");
  const rt = readFileSync(join(ROOT, "src", "runtime", "runtime.js"), "utf8");
  if (!rt.includes("/v" + m[1] + "/")) throw new Error("DEFAULT_INDEX에 v" + m[1] + " 없음(핀 불일치)");
});

// 2) 능력 계약이 런타임 없이도 형태를 갖추는가(메서드 존재). 소스는 내부 모듈이다:
// 계약의 목적은 "메서드가 사라지는 회귀"의 조기 발견이고, 도달 경로(핸들/탈출구)는 브라우저 게이트가 문다.
console.log("\n[계약]");
check("porcelain 계약: PyprocMachine 어휘", () => {
  const p = porcelainApi.PyprocMachine.prototype;
  for (const m of ["run", "runAsync", "term", "proc"]) if (typeof p[m] !== "function") throw new Error("missing " + m);
  for (const g of ["runtime", "deterministic", "fs"]) {
    if (!Object.getOwnPropertyDescriptor(p, g)?.get) throw new Error("getter 없음: " + g);
  }
  if (typeof porcelainApi.boot !== "function" || typeof porcelainApi.open !== "function") throw new Error("boot/open 없음");
});
check("Runtime 메서드", () => {
  const p = coreApi.Runtime.prototype;
  for (const m of ["run", "runAsync", "install", "loadPackages", "loadPackagesFromImports", "setStdout", "setStderr", "freeze", "mountHome", "noteStateMutation", "enableReactive", "enableSyscallBridge", "enableAsgiServer", "enableTerminal", "enableWheelCache", "enableDeviceFs", "enableInit", "enableJournal"])
    if (typeof p[m] !== "function") throw new Error("missing " + m);
});
check("FileSystem 메서드", () => {
  for (const m of ["writeFile", "readFile", "mkdir", "mkdirTree", "readdir", "stat", "exists", "unlink", "rmdir"])
    if (typeof fileSystemApi.FileSystem.prototype[m] !== "function") throw new Error("FileSystem." + m);
});
check("DeviceFs/Init 메서드", () => {
  for (const m of ["install", "track", "refreshClipboard"]) if (typeof deviceFsApi.DeviceFs.prototype[m] !== "function") throw new Error("DeviceFs." + m);
  for (const m of ["install", "resume", "stop"]) if (typeof initApi.Init.prototype[m] !== "function") throw new Error("Init." + m);
});
check("MachineJournal 메서드", () => {
  for (const m of ["start", "stop", "commit", "pack", "prune", "recover"])
    if (typeof journalApi.MachineJournal.prototype[m] !== "function") throw new Error("MachineJournal." + m);
});
check("MachineJail 메서드", () => {
  for (const m of ["allows", "connectSrc", "csp", "install"])
    if (typeof jailApi.MachineJail.prototype[m] !== "function") throw new Error("MachineJail." + m);
});
check("VirtualOrigin 메서드", () => {
  const p = virtualOriginApi.VirtualOrigin.prototype;
  for (const m of ["bind", "unbind"])
    if (typeof p[m] !== "function") throw new Error("missing " + m);
});
check("PyProc 메서드", () => {
  const p = procApi.PyProc.prototype;
  for (const m of ["boot", "map", "mapArray", "matmul", "ps", "kill", "signal", "respawn", "fork", "forkMany", "exec", "pipe", "lock", "semaphore", "shm", "terminate", "repl"])
    if (typeof p[m] !== "function") throw new Error("missing " + m);
  if (procApi.PyProc.SIGNAL !== procApi.SIGNAL) throw new Error("PyProc.SIGNAL 정적 상수 누락");
});
check("MachineContainer 메서드", () => {
  const p = containerApi.MachineContainer.prototype;
  for (const m of ["spawn", "kill", "install", "terminate"])
    if (typeof p[m] !== "function") throw new Error("missing " + m);
});
check("KernelElection 메서드", () => {
  const p = electionApi.KernelElection.prototype;
  for (const m of ["join", "run", "commit", "ready", "status", "subscribe", "role", "leave"])
    if (typeof p[m] !== "function") throw new Error("missing " + m);
  if (typeof electionApi.openPersistentMachine !== "function") throw new Error("openPersistentMachine");
});
check("JobControl 메서드", () => {
  const p = jobApi.JobControl.prototype;
  for (const m of ["boot", "push", "jobs", "fg", "kill", "terminate"])
    if (typeof p[m] !== "function") throw new Error("missing " + m);
});
check("Session/bootSession/openMachine 계약(내부 표면, porcelain의 발밑)", () => {
  for (const m of ["save", "load", "exportImage"]) if (typeof sessionApi.Session.prototype[m] !== "function") throw new Error("Session." + m);
  for (const fn of ["bootSession", "openMachine"]) if (typeof sessionApi[fn] !== "function") throw new Error(fn);
});
check("SIGNAL 표(POSIX 번호)", () => {
  const sig = procApi.SIGNAL;
  if (sig.INT !== 2 || sig.TERM !== 15 || sig.USR1 !== 10 || sig.USR2 !== 12) throw new Error(JSON.stringify(sig));
});
check("ReactiveController 메서드", () => {
  const p = reactiveApi.ReactiveController.prototype;
  for (const m of ["checkpoint", "restore", "restoreLive", "collectDelta", "markDirty", "pruneTo", "dispose", "tree", "storageMB", "saveBase", "loadBase"])
    if (typeof p[m] !== "function") throw new Error("missing " + m);
});
// 강등 표면(pyproc/gpu, pyproc/socket, pyproc/wasi): 루트 밖이지만 subpath 계약은 유지된다.
const gpuApi = await import(pathToFileURL(join(ROOT, "src", "capabilities", "gpuCompute.js")).href);
const socketApi = await import(pathToFileURL(join(ROOT, "src", "capabilities", "socketBridge.js")).href);
const wasiApi = await import(pathToFileURL(join(ROOT, "src", "runtime", "engines", "wasi", "wasiSession.js")).href);
check("pyproc/gpu: GpuCompute/GpuArray/GpuBridge 메서드", () => {
  if (typeof gpuApi.GpuCompute.create !== "function") throw new Error("GpuCompute.create(static)");
  for (const m of ["array", "destroy"]) if (typeof gpuApi.GpuCompute.prototype[m] !== "function") throw new Error("GpuCompute." + m);
  for (const m of ["matmul", "map", "binary", "transpose", "reduce", "toArray", "destroy"]) if (typeof gpuApi.GpuArray.prototype[m] !== "function") throw new Error("GpuArray." + m);
  for (const m of ["install", "destroy"]) if (typeof gpuApi.GpuBridge.prototype[m] !== "function") throw new Error("GpuBridge." + m);
});
check("pyproc/socket: SocketBridge 메서드", () => {
  if (typeof socketApi.SocketBridge.prototype.install !== "function") throw new Error("SocketBridge.install");
});
check("pyproc/wasi: bootWasi/WasiSession 메서드", () => {
  if (typeof wasiApi.bootWasi !== "function") throw new Error("bootWasi");
  const p = wasiApi.WasiSession.prototype;
  for (const m of ["run", "get", "set", "checkpoint", "timeTravel", "installWheel", "terminate"])
    if (typeof p[m] !== "function") throw new Error("missing " + m);
});
check("pyproc/history: 커널 계약 표면", () => {
  // 위 [state 커널] 절이 프로토콜 실동작을 물었다. 여기는 subpath 배럴의 형태만 잠근다.
  for (const fn of ["commitState", "openState", "encodeStateBundle", "decodeStateBundle", "signStateTag", "verifyStateTag", "parseSha256Address"])
    if (typeof stateBarrel[fn] !== "function") throw new Error("history." + fn);
  for (const cls of ["MemoryStateStore", "OpfsStateStore"]) if (typeof stateBarrel[cls] !== "function") throw new Error("history." + cls);
  if (stateBarrel.PAGE_SIZE !== 65536) throw new Error("history.PAGE_SIZE");
});

// 3) em dash(U+2014) 0 - 훅과 같은 스코프(*.md, *.js).
console.log("\n[em dash]");
const EMDASH = String.fromCharCode(0x2014); // 리터럴로 쓰면 이 게이트가 자기 자신에 걸린다
for (const f of collect(ROOT, [".md", ".js", ".mjs"], [])) {
  check(`no em dash: ${rel(f)}`, () => {
    if (readFileSync(f, "utf8").includes(EMDASH)) throw new Error("U+2014 발견");
  });
}

// 3.1) 문서 주체 가드: 문서·주석의 주체는 나다(1인칭/주어 생략). 나를 3인칭 호칭으로
//      지칭하는 표현을 차단한다(커밋 메시지 주체 중립 규칙의 문서판, 2026-07-12 확정).
//      금칙어는 리터럴로 쓰면 이 게이트가 자기 자신에 걸리므로 조립한다.
console.log("\n[문서 주체]");
const OWNER_WORD = ["소유", "자"].join(""); // "소유" + "자"
for (const f of collect(ROOT, [".md", ".js", ".mjs"], [])) {
  check(`주체 중립: ${rel(f)}`, () => {
    if (readFileSync(f, "utf8").includes(OWNER_WORD)) throw new Error("3인칭 호칭 발견");
  });
}

// 3.2) 네이밍 가드: camelCase는 언어 불문이다(JS 문자열 안의 파이썬 포함).
//      우리 접두(_pyproc*) 스네이크와, 우리가 정의하는 파이썬 함수명의 스네이크를 차단한다.
//      외부 기술 명칭(ASGI 키 문자열, pyodide.ffi.run_sync, API kwarg 등)은 정의가 아니라 안 걸린다.
console.log("\n[네이밍]");
for (const scope of ["src", "examples", "tests"]) {
  for (const f of collect(join(ROOT, scope), [".js", ".mjs", ".html"], [])) {
    check(`camelCase: ${rel(f)}`, () => {
      const src = readFileSync(f, "utf8");
      const bad = new Set();
      for (const m of src.matchAll(/_pyproc_[a-z0-9]\w*/g)) bad.add(m[0]);
      for (const m of src.matchAll(/def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
        if (/[a-z0-9]_[a-z]/.test(m[1])) bad.add("def " + m[1]);
      }
      if (bad.size) throw new Error("스네이크 식별자: " + [...bad].slice(0, 5).join(", "));
    });
  }
}

// 3.3) 성능 주장 가드: 공개 표면에 숫자 간판을 걸지 않는다(2026-07-17 확정).
//      숫자를 간판으로 걸면 그 숫자를 영원히 방어할 의무가 생기고, 그 의무가 제품 방향을
//      벤치에 종속시킨다. 실측은 계속하되(개발 원칙 4) 측정치는 mainPlan/tests 기록과
//      benchmark artifact에만 산다. 스코프 밖 둘: docs/operations의 게이트 임계값은 자랑이
//      아니라 계약이고, examples/의 Speed Lab은 사용자가 자기 기계에서 직접 재는 도구다.
console.log("\n[성능 주장]");
const BRAG = [
  [/\d+(?:\.\d+)?\s*(?:x|×)\s*(?:faster|speedup)/i, "속도 배수 자랑"],
  [/\d+(?:\.\d+)?\s*(?:x|×)\s+median\s+speedup/i, "속도 배수 자랑"],
  [/\d+(?:\.\d+)?\s*배\s*(?:빠|더\s*빠)/, "속도 배수 자랑"],
  [/\d+(?:\.\d+)?\s*ms\b/, "측정치 게시"],
  [/\bfastest\b|blazing|가장\s*빠른|초고속/i, "최상급 속도 주장"],
  // 숫자를 artifact 링크 뒤에 숨겨도 경쟁 비교 게시는 게시다.
  [/(?:WebVM|JupyterLite|marimo)[^\n]*(?:artifact|측정됨|N\/A)/i, "경쟁 비교 게시"],
];
const BRAG_SURFACE = [
  join(ROOT, "README.md"), join(ROOT, "README.ko.md"), join(ROOT, "CHANGELOG.md"),
  // 랜딩은 자랑 표면의 한복판이다. examples/의 나머지(Speed Lab 등)는 실측 도구라 스코프 밖.
  join(ROOT, "examples", "index.html"),
  ...collect(join(ROOT, "docs", "product"), [".md"]),
  ...collect(join(ROOT, "docs", "reference"), [".md"]),
];
for (const f of BRAG_SURFACE) {
  check(`숫자 자랑 0: ${rel(f)}`, () => {
    const hits = [];
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      for (const [re, why] of BRAG) if (re.test(line)) hits.push(`L${i + 1} ${why}`);
    });
    if (hits.length) throw new Error(hits.slice(0, 5).join("; "));
  });
}
// 3.4) digest 법 가드(state-kernel 1단계): sha256 계산과 주소 형식 조립의 소스를 좁힌다.
//      raw subtle.digest는 코어 2곳(contentDigest = 정본, generationIntegrity = machine 경계의
//      주입식 사본으로 coordinator 커널 위임 시 소멸 예정)과 pyprocSw(import 0 계약 의도 중복)만.
//      "sha256:" 주소 문자열 조립도 같은 두 코어만. 나머지 파일에서 발견 = 판정/형식의 새 사본.
console.log("\n[digest 법]");
{
  // 7a에서 machine의 주입식 사본(generationIntegrity의 자체 subtle/hex)이 소멸했다:
  // 이제 raw digest는 정본 코어와 pyprocSw(import 0 계약의 의도 중복)에만 산다.
  const DIGEST_CORE = new Set([
    "src/runtime/contentDigest.js",
    "src/capabilities/pyprocSw.js",
  ]);
  const ADDRESS_CORE = new Set([
    "src/runtime/contentDigest.js",
  ]);
  const rawDigest = /\.digest\(\s*["']SHA-256["']/;
  const addressBuild = /["'`]sha256:(?![0-9a-f]{64})/; // 리터럴 상수 표기(테스트 기대값)는 스코프 밖
  for (const f of collect(join(ROOT, "src"), [".js"])) {
    const relPath = rel(f);
    const text = readFileSync(f, "utf8");
    check(`digest 법: ${relPath}`, () => {
      if (rawDigest.test(text) && !DIGEST_CORE.has(relPath)) throw new Error("raw subtle.digest는 digest 코어에만 산다(contentDigest 경유)");
      if (addressBuild.test(text) && !ADDRESS_CORE.has(relPath)) throw new Error('"sha256:" 주소 조립은 코어에만 산다(sha256Address/parseSha256Address 경유)');
    });
  }
}

// 3.5) state 커널 게이트(state-kernel 2단계): 순수 집합 + ref CAS 프로토콜 음성 시험.
//      실측 원형은 tests/attempts/stateKernel(0단계 probe GREEN). 여기서는 src 실물이
//      같은 위반들을 무는지 매 커밋 확인한다(안 무는 게이트는 없는 게이트보다 나쁘다).
console.log("\n[state 커널]");
{
  // 순수 집합: 커널은 브라우저 저장·전역 관심사를 모른다. backend(OPFS/IndexedDB)와 정책은
  // 전부 위에서 주입된다. 이 불변식이 무너지면 통합이 결합으로 역전된다(god layer).
  const PURE_STATE = ["objectModel.js", "refProtocol.js", "signedTag.js", "memoryStateStore.js"];
  const BROWSER_GLOBAL = /\b(navigator|window|document|indexedDB|localStorage|sessionStorage|crossOriginIsolated)\b|globalThis\.crypto|\bfetch\s*\(/;
  for (const name of PURE_STATE) {
    check(`state 순수 집합: ${name} 브라우저 전역 0`, () => {
      const text = readFileSync(join(ROOT, "src", "state", name), "utf8");
      const hit = text.split("\n").findIndex((line) => BROWSER_GLOBAL.test(line));
      if (hit >= 0) throw new Error(`L${hit + 1}: 브라우저 전역/저장 접근`);
    });
  }
  const state = await import(pathToFileURL(join(ROOT, "src", "state", "refProtocol.js")).href);
  const { MemoryStateStore } = await import(pathToFileURL(join(ROOT, "src", "state", "memoryStateStore.js")).href);
  const model = await import(pathToFileURL(join(ROOT, "src", "state", "objectModel.js")).href);
  const tags = await import(pathToFileURL(join(ROOT, "src", "state", "signedTag.js")).href);
  const provider = globalThis.crypto;
  const statePage = (fill) => new Uint8Array(1024).fill(fill);
  const stateInput = (n, extra = {}) => ({
    pages: [[0, statePage(n)], [1, statePage(n + 1)]],
    pageSize: 1024, heapLen: 2048, sp: 64, env: { h0: "h0-real" }, ...extra,
  });
  await checkAsync("state 프로토콜: 정상 왕복 + dedupe", async () => {
    const store = new MemoryStateStore();
    await state.commitState(provider, store, stateInput(10));
    const second = await state.commitState(provider, store, stateInput(10, { env: { h0: "h0-real" } }));
    if (second.wrote !== 0 || second.deduped < 2) throw new Error(`같은 상태 재커밋이 dedupe되지 않음(wrote ${second.wrote})`);
    const opened = await state.openState(provider, store, { expectH0: "h0-real" });
    if (opened.generation !== "head" || opened.pages.get(0)[0] !== 10) throw new Error("HEAD 세대 부활 실패");
  });
  await checkAsync("state 프로토콜: 쓰기 순서 법(지점별 크래시에 구 HEAD 무결)", async () => {
    const store = new MemoryStateStore();
    await state.commitState(provider, store, stateInput(10));
    const base = await state.commitState(provider, store, stateInput(20));
    // 반복마다 고유 페이지라 dedupe 없이 쓰기 순서 고정: blob 2 + tree + commit + PREV + HEAD = 6지점.
    for (let crashAfter = 0; crashAfter < 6; crashAfter++) {
      let left = crashAfter;
      const crashing = Object.create(store);
      crashing.writeObject = async (a, b) => { if (--left < 0) throw new Error("CRASH"); return store.writeObject(a, b); };
      crashing.writeRef = async (n, r) => { if (--left < 0) throw new Error("CRASH"); return store.writeRef(n, r); };
      let crashed = false;
      try { await state.commitState(provider, crashing, stateInput(100 + crashAfter * 2)); }
      catch (e) { crashed = e.message === "CRASH"; }
      if (!crashed) throw new Error(`지점 ${crashAfter}: 6지점 안에서 커밋 성공(쓰기 순서 가정 파손)`);
      const r = await state.openState(provider, store, { expectH0: "h0-real" });
      if (!r || r.pages.get(0)[0] !== 20) throw new Error(`지점 ${crashAfter}: 구 HEAD 오염`);
    }
    const headRef = await store.readRef("HEAD");
    if (headRef.ref.commit !== base.commitAddress) throw new Error("HEAD가 크래시 잔해로 이동함");
  });
  await checkAsync("state 프로토콜: corruption은 PREV 후퇴, 둘 다 파손은 명시 예외", async () => {
    const store = new MemoryStateStore();
    await state.commitState(provider, store, stateInput(30));
    const last = await state.commitState(provider, store, stateInput(40));
    // HEAD 세대의 tree가 가리키는 첫 페이지 blob을 변조 -> verify-on-read 적발 -> PREV 후퇴.
    const treeBytes = await store.readObject(last.treeAddress);
    const tampered = model.decodeStateObject(treeBytes).pages[0][1];
    store.tamperObject(tampered, statePage(99));
    const fb = await state.openState(provider, store, { expectH0: "h0-real" });
    if (fb.generation !== "prev" || fb.fallback !== true || fb.pages.get(0)[0] !== 30) throw new Error("PREV 후퇴 실패");
    // PREV까지 지우고 HEAD를 파손시키면 첫 부팅 위장 없이 명시 예외.
    store.deleteRef("PREV");
    store.corruptRef("HEAD");
    let code = null;
    try { await state.openState(provider, store, {}); } catch (e) { code = e.code; }
    if (code !== "PYPROC_STATE_CORRUPT") throw new Error(`명시 예외 아님(${code})`);
  });
  await checkAsync("state 프로토콜: env(h0) 불일치는 PREV 후퇴 없이 즉시 예외", async () => {
    const store = new MemoryStateStore();
    await state.commitState(provider, store, stateInput(50));
    await state.commitState(provider, store, stateInput(60));
    let code = null;
    try { await state.openState(provider, store, { expectH0: "h0-other" }); } catch (e) { code = e.code; }
    if (code !== "PYPROC_REPLAY_MISMATCH") throw new Error(`즉시 예외 아님(${code})`);
  });
  await checkAsync("state 프로토콜: stale fence 거부 + HEAD 불변", async () => {
    const store = new MemoryStateStore();
    const tokenA = await store.claimOwner("tabA");
    await state.commitState(provider, store, stateInput(70, { fence: tokenA }));
    const before = (await store.readRef("HEAD")).ref.commit;
    await store.claimOwner("tabB");
    let code = null;
    try { await state.commitState(provider, store, stateInput(80, { fence: tokenA })); } catch (e) { code = e.code; }
    if (code !== "PYPROC_STATE_FENCE_STALE") throw new Error(`fence 거부 아님(${code})`);
    if ((await store.readRef("HEAD")).ref.commit !== before) throw new Error("stale fence가 HEAD를 움직임");
  });
  await checkAsync("machine 암호 주입: 맨 Crypto는 생성자에서 거부(코어 한 벌 강제)", async () => {
    const machineBarrel = await import(pathToFileURL(join(ROOT, "src", "machine", "index.js")).href);
    let commitCode = null;
    try { new machineBarrel.MachineCommitCoordinator({ store: {}, cryptoProvider: globalThis.crypto, idFactory: () => "x", nowFactory: () => 1 }); }
    catch (e) { commitCode = e.constructor.name; }
    if (commitCode !== "TypeError") throw new Error(`commit coordinator가 맨 Crypto를 받음(${commitCode})`);
    let envelopeCode = null;
    try { new machineBarrel.MachineEnvelopeCoordinator({ cryptoProvider: globalThis.crypto, nowFactory: () => 1 }); }
    catch (e) { envelopeCode = e.constructor.name; }
    if (envelopeCode !== "TypeError") throw new Error(`envelope coordinator가 맨 Crypto를 받음(${envelopeCode})`);
    // 주입 provider는 통과 + digest가 코어 주소 형식을 낸다.
    const wrapped = machineBarrel.createMachineCryptoProvider(globalThis.crypto);
    const digest = await wrapped.digestBytes(new Uint8Array([1, 2, 3]));
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new Error(`주입 digest 형식 위반(${digest})`);
  });
  await checkAsync("state bundle: 왕복 + 레이아웃 문서 동기 + 변조 음성 3종", async () => {
    const bundle = await import(pathToFileURL(join(ROOT, "src", "state", "bundleFormat.js")).href);
    const doc = readFileSync(join(ROOT, "docs", "reference", "bundleFormat.md"), "utf8");
    // 문서와 코드 상수의 동기: 매직/버전/헤더 상한이 표류하면 레이아웃 계약이 거짓이 된다.
    if (!doc.includes("PYBUNDLE1")) throw new Error("문서에 매직 누락");
    if (!doc.includes(`"version": ${bundle.STATE_BUNDLE_VERSION}`)) throw new Error("문서 버전 표류");
    if (!doc.includes("1 MiB") || bundle.STATE_BUNDLE_HEAD_MAX_BYTES !== 1024 * 1024) throw new Error("헤더 상한 표류");
    const store2 = new MemoryStateStore();
    const committed = await state.commitState(provider, store2, stateInput(90));
    const objects = store2.entries();
    const meta2 = { manifest: "{}" };
    const keyPair = await tags.createStateKeyPair(provider);
    const unsigned = await bundle.unsignedStateBundleDigest(provider, { commit: committed.commitAddress, meta: meta2, objects });
    const tag = await tags.signStateTag(provider, keyPair, unsigned);
    const bytes = await bundle.encodeStateBundle(provider, { commit: committed.commitAddress, meta: meta2, objects, tag });
    const decoded = await bundle.decodeStateBundle(provider, bytes);
    if (decoded.commit !== committed.commitAddress || decoded.objects.size !== objects.length) throw new Error("왕복 불일치");
    if (decoded.unsignedDigest !== unsigned || decoded.tag.target !== unsigned) throw new Error("unsigned 다이제스트 불일치");
    const jwk = await tags.exportStatePublicKey(provider, keyPair.publicKey);
    const good = await tags.verifyStateTag(provider, decoded.tag, decoded.unsignedDigest, { trustedPublicKeys: [jwk] });
    if (!good.valid || !good.trusted) throw new Error("서명 신뢰 경로 실패");
    // 변조 1: 바이트 뒤집기 -> 봉투 무결성 거부
    const flipped = bytes.slice(); flipped[flipped.length - 1] ^= 0xff;
    let flipCode = null;
    try { await bundle.decodeStateBundle(provider, flipped); } catch (e) { flipCode = e.code; }
    if (flipCode !== "PYPROC_MACHINE_INTEGRITY") throw new Error(`바이트 변조 미적발(${flipCode})`);
    // 변조 2: 서명 제거 재봉투 -> 무결성은 통과하되 tag 부재(신뢰 게이트가 거부할 상태)
    const stripped = await bundle.decodeStateBundle(provider, await bundle.encodeStateBundle(provider, { commit: committed.commitAddress, meta: meta2, objects, tag: null }));
    if (stripped.tag !== null) throw new Error("tag 제거 실패");
    // 변조 3: 다른 키 서명 -> valid하되 trusted 아님
    const otherTag = await tags.signStateTag(provider, await tags.createStateKeyPair(provider), unsigned);
    const other = await tags.verifyStateTag(provider, otherTag, unsigned, { trustedPublicKeys: [jwk] });
    if (!other.valid || other.trusted) throw new Error("잘못된 키가 trusted로 통과");
  });
  await checkAsync("state 서명: signedTag 서명·검증·변조 적발", async () => {
    const keyPair = await tags.createStateKeyPair(provider);
    const tag = await tags.signStateTag(provider, keyPair, "sha256:" + "ab".repeat(32));
    const jwk = await tags.exportStatePublicKey(provider, keyPair.publicKey);
    const good = await tags.verifyStateTag(provider, tag, tag.target, { trustedPublicKeys: [jwk] });
    if (!good.valid || !good.trusted) throw new Error("정상 tag 검증 실패");
    const stranger = await tags.verifyStateTag(provider, tag, tag.target, { trustedPublicKeys: [] });
    if (!stranger.valid || stranger.trusted) throw new Error("신뢰 목록 밖 키가 trusted로 통과");
    const forged = { ...tag, target: "sha256:" + "cd".repeat(32) };
    const bad = await tags.verifyStateTag(provider, forged, forged.target, { trustedPublicKeys: [jwk] });
    if (bad.valid) throw new Error("target 바꿔치기가 검증을 통과");
    const wrongTarget = await tags.verifyStateTag(provider, tag, "sha256:" + "ef".repeat(32), { trustedPublicKeys: [jwk] });
    if (wrongTarget.valid) throw new Error("기대 target 불일치가 통과");
  });
}

// 파일/폴더 이름도 camelCase다. 위 검사는 파일 "내용"의 식별자만 봐서 이름 규칙은 기계 검사가
// 0이었다. mainPlan은 kebab-case 번호 문서라 예외(dartlab 관례), 검증 데이터/픽스처도 제외.
check("파일과 폴더 이름 camelCase", () => {
  const CAMEL = /^[a-z][A-Za-z0-9]*$/;
  const exempt = new Set(["_done", "web-machine", "guest-pyproc", "guest-v86"]);
  const bad = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".") || entry === "node_modules") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (!exempt.has(entry) && !CAMEL.test(entry)) bad.push(`${rel(full)}/ (폴더)`);
        walk(full);
        continue;
      }
      const stem = entry.replace(/\.(js|mjs|html|css|json|d\.ts)$/, "");
      if (stem === entry) continue; // 검사 대상 확장자가 아니다
      if (!CAMEL.test(stem) && !exempt.has(stem)) bad.push(rel(full));
    }
  };
  for (const scope of ["src", "scripts"]) walk(join(ROOT, scope));
  if (bad.length) throw new Error("camelCase 아님: " + bad.slice(0, 8).join(", "));
});

// 3.3) 오류 계약 가드: src의 모든 오류 생성은 PyProcError다(코드 없는 Error 금지).
//      계약의 축은 message가 아니라 code이므로, 코드 없는 오류가 하나라도 생기면 소비자의
//      프로그램적 분기가 다시 문자열 매칭으로 퇴행한다. 예외: pyprocSw.js는 SW 자기충족
//      파일(모듈 import 금지 계약)이라 로컬 swError 헬퍼의 new Error 1곳만 허용한다.
console.log("\n[오류 계약]");
// machine 층은 자기 오류 계약을 갖는다(web-machine 클린 아키텍처 기록): 상태 오류 =
// WebMachineError(코드), 인자 계약 위반 = TypeError. 그래서 machine에선 TypeError를 세지 않는다.
// packages/ 시절 게이트 밖에 쌓였던 무코드 new Error 80건은 전부 코드를 얻었다(감소 전용
// 예산 80 -> 0). 무코드 오류는 이제 어느 층에서도 0이다.
for (const f of collect(join(ROOT, "src"), [".js"], [])) {
  check(`PyProcError only: ${rel(f)}`, () => {
    const src = readFileSync(f, "utf8");
    const relPath = rel(f);
    if (relPath.startsWith("src/machine/")) {
      const hits = [...src.matchAll(/new (Error|RangeError|SyntaxError)\(/g)];
      if (hits.length > 0) {
        throw new Error(`machine 오류 계약 위반: 무코드 오류 ${hits.length}건. WebMachineError(code) 또는 TypeError(인자 계약)만`);
      }
      return;
    }
    const hits = [...src.matchAll(/new (Error|TypeError|RangeError|SyntaxError)\(/g)];
    const allowed = relPath === "src/capabilities/pyprocSw.js" ? 1 : 0;
    if (hits.length > allowed) throw new Error(`코드 없는 오류 생성 ${hits.length}건(허용 ${allowed})`);
  });
}
check("PyProcError 코드 카탈로그 = d.ts union (삼자 일치)", () => {
  const catalog = api.PYPROC_ERROR_CODES;
  if (!Array.isArray(catalog) || !catalog.length) throw new Error("PYPROC_ERROR_CODES export 없음");
  const dtsSrc = readFileSync(join(ROOT, "index.d.ts"), "utf8");
  const unionBlock = /export type PyProcErrorCode =([\s\S]*?);/.exec(dtsSrc);
  if (!unionBlock) throw new Error("index.d.ts에 PyProcErrorCode union 없음");
  const dtsCodes = new Set([...unionBlock[1].matchAll(/"(PYPROC_[A-Z_]+)"/g)].map((m) => m[1]));
  for (const code of catalog) if (!dtsCodes.has(code)) throw new Error(`d.ts union에 없음: ${code}`);
  for (const code of dtsCodes) if (!catalog.includes(code)) throw new Error(`카탈로그에 없음: ${code}`);
});

// 3.4) 영문 API 레퍼런스 동기화: 루트 export 전수가 docs/reference/api.md에 등장해야 한다.
//      index.js 헤더 주석 목록의 표류(8개 어긋난 채 방치)를 반복하지 않는 기계 장치다.
console.log("\n[API 레퍼런스]");
check("api.md가 루트 export 전수를 다룬다", () => {
  const apiDoc = readFileSync(join(ROOT, "docs", "reference", "api.md"), "utf8");
  const missing = Object.keys(api).filter((name) => !apiDoc.includes("`" + name));
  if (missing.length) throw new Error(`api.md 누락: ${missing.join(", ")}`);
});
check("Stable 라벨 = 승격 원장 정합(근거 없는 라벨 상승 차단)", () => {
  const matrix = readFileSync(join(ROOT, "docs", "consuming", "capabilityMatrix.md"), "utf8");
  if (!matrix.includes("## 상태 라벨 승격 기준")) throw new Error("승격 기준 절 없음");
  const ledgerStart = matrix.indexOf("### 승격 원장");
  if (ledgerStart < 0) throw new Error("승격 원장 절 없음");
  const ledgerBlock = matrix.slice(ledgerStart, matrix.indexOf("승격 대기 시계", ledgerStart));
  const ledgerRows = [...ledgerBlock.matchAll(/^\| [^|]+ \| 20\d\d-/gm)].length;
  // 능력 표의 상태 셀만 센다(라인 중간의 "| Stable |"). 승격 기준 표의 라벨 열은
  // 라인 시작이라 제외된다.
  const stableRows = [...matrix.matchAll(/[^\n]\| Stable \|/g)].length;
  if (stableRows !== ledgerRows) throw new Error(`Stable 라벨 ${stableRows}행 != 승격 원장 ${ledgerRows}행`);
});
// 영문 비교 페이지 게이트는 제거했다(2026-07-17). 그 게이트는 경쟁 비교 게시를 강제해
// 숫자 자랑 금지 규칙과 정면으로 충돌했다. 지난 비교는 mainPlan/_done 원장에 기록으로 남는다.
check("공개 문서 인프라 존재(CHANGELOG/SECURITY/glossary)", () => {
  for (const f of ["CHANGELOG.md", "SECURITY.md", join("docs", "product", "glossary.md")]) {
    if (!existsSync(join(ROOT, f))) throw new Error(`${f} 없음`);
  }
  const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  if (!changelog.includes("## Unreleased")) throw new Error("CHANGELOG에 Unreleased 절 없음");
});

// 3.5) 사이트 크롬: 채널(SNS) 행은 라우트마다 고정이고 정의처는 examples/siteChrome.js 하나다.
//      라우트가 늘 때 채널을 빠뜨리거나 마크업을 다시 인라인으로 복제하는 드리프트를 차단한다.
console.log("\n[사이트 크롬]");
const chromeSrc = readFileSync(join(ROOT, "examples", "siteChrome.js"), "utf8");
check("siteChrome.js가 sns-links를 정의", () => {
  if (!chromeSrc.includes('customElements.define("sns-links"')) throw new Error("정의 없음");
  if (!/export const channels\s*=\s*\[/.test(chromeSrc)) throw new Error("channels export 없음");
});
check("Speed Lab 반복 벤치 통계 helper 공유", () => {
  const helper = readFileSync(join(ROOT, "examples", "benchStats.js"), "utf8");
  const speedLab = readFileSync(join(ROOT, "examples", "speedLab.html"), "utf8");
  const matmulProbe = readFileSync(join(ROOT, "tests", "attempts", "numericShard", "matmulSurfaceProbe.html"), "utf8");
  for (const sym of ["percentile", "median", "summarizePairedLatencyBench", "isShardedSpeedBenchGreen", "isProcessMapBenchGreen", "summarizeLatencyBench", "isLatencyBenchGreen", "summarizeMachineResumeBench", "isMachineResumeBenchGreen", "summarizeImmortalMachineBench", "isImmortalMachineBenchGreen"]) {
    if (!helper.includes(`export function ${sym}`)) throw new Error(`benchStats.${sym} 누락`);
  }
  if (!speedLab.includes('from "./benchStats.js"')) throw new Error("Speed Lab이 benchStats.js를 쓰지 않음");
  if (!matmulProbe.includes('from "../../../examples/benchStats.js"')) throw new Error("matmulSurfaceProbe가 benchStats.js를 쓰지 않음");
});
check("속도 비교 벤치 계약 고정", () => {
  const contract = readFileSync(join(ROOT, "docs", "operations", "benchmarking.md"), "utf8");
  const plan = readFileSync(join(ROOT, "mainPlan", "_done", "browser-os-north-star", "06-speed-comparison.md"), "utf8");
  const docsMap = readFileSync(join(ROOT, "docs", "README.md"), "utf8");
  const initiativeMap = readFileSync(join(ROOT, "mainPlan", "_done", "browser-os-north-star", "README.md"), "utf8");
  const speedLab = readFileSync(join(ROOT, "examples", "speedLab.html"), "utf8");
  const speedBench = readFileSync(join(ROOT, "tests", "browser", "speedBench.mjs"), "utf8");
  const benchArtifact = readFileSync(join(ROOT, "tests", "browser", "benchArtifact.mjs"), "utf8");
  const benchArtifacts = readFileSync(join(ROOT, "tests", "browser", "benchArtifacts.mjs"), "utf8");
  const benchCompare = readFileSync(join(ROOT, "tests", "browser", "benchCompare.mjs"), "utf8");
  const pkgForBench = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  // 후보 이름(WebVM/JupyterLite/marimo)은 더 이상 benchmarking.md의 필수 항목이 아니다.
  // 경쟁 비교는 게시물이 아니라 원장 기록이므로 mainPlan/_done 계약에서만 요구한다.
  for (const term of ["S0", "S0C", "S1", "S1L", "S2", "S3", "S4", "S5", "median", "p95", "raw output"]) {
    if (!contract.includes(term)) throw new Error(`benchmarking.md 필수 항목 누락: ${term}`);
    if (!plan.includes(term)) throw new Error(`06-speed-comparison.md 필수 항목 누락: ${term}`);
  }
  for (const name of ["WebVM", "JupyterLite", "marimo"]) {
    if (!plan.includes(name)) throw new Error(`06-speed-comparison.md 후보 누락: ${name}`);
  }
  for (const term of ["schema v2", "schemaVersion", "scenarioDefinition", "measurement", "environment", "evidence", "commit", "command", "browser", "engine", "samples", "metrics"]) {
    if (!contract.includes(term)) throw new Error(`실측 봉투 필드 누락: ${term}`);
  }
  if (!docsMap.includes("operations/benchmarking.md")) throw new Error("docs 지도에 benchmarking.md 없음");
  if (!initiativeMap.includes("06-speed-comparison.md")) throw new Error("이니셔티브 지도에 06-speed-comparison.md 없음");
  if (pkgForBench.scripts?.["bench:speed"] !== "node tests/browser/speedBench.mjs") throw new Error("bench:speed 스크립트 없음");
  if (pkgForBench.scripts?.["bench:artifact"] !== "node tests/browser/benchArtifact.mjs") throw new Error("bench:artifact 스크립트 없음");
  if (pkgForBench.scripts?.["bench:compare"] !== "node tests/browser/benchCompare.mjs") throw new Error("bench:compare 스크립트 없음");
  if (!speedLab.includes('scenario: "S1"') || !speedLab.includes("bench,")) throw new Error("Speed Lab gate report가 S1 bench JSON을 싣지 않음");
  for (const term of ['readIntParam("size"', 'readIntParam("workers"', 'readIntParam("samples"']) {
    if (!speedLab.includes(term)) throw new Error(`Speed Lab query 계약 누락: ${term}`);
  }
  for (const term of ["PYPROC_BENCH_OUT", "PYPROC_BENCH_SIZE", '"--size"', "DEFAULT_SIZE = 1024", "BENCH_ARTIFACT_SCHEMA_VERSION", "scenarioDefinition", "measurement", "environment", "evidence", "schemaVersion", 'scenario: S1_SCENARIO', 'candidate: "pyproc"', "metrics", "runner", "browserVersion", "normalizeBenchArtifact"]) {
    if (!speedBench.includes(term)) throw new Error(`speedBench.mjs 필수 항목 누락: ${term}`);
  }
  for (const term of ["BENCH_ARTIFACT_SCHEMA_VERSION", "SCENARIO_DEFINITIONS", "scenarioDefinitionFor", "RAW_OUTPUT_EMBEDDED_REPORT", "RAW_OUTPUT_FILE_PREFIX", "rawOutputPathForArtifact", "assertV2Envelope", "sampleSchema", "measurement", "environment", "evidence", "rawOutput", "browser server roundtrip", "machine resume", "immortal multi-tab machine", "S0_SCENARIO", "S0C_SCENARIO", "S1L_SCENARIO", "S2_SCENARIO", "S3_SCENARIO", "S4_SCENARIO", "S5_SCENARIO", "SUPPORTED_SCENARIOS", "normalizeBenchArtifact", "renderBenchCompareMarkdown", "notApplicableReason", "medianSpeedup", "medianMs", "openMedianMs", "failoverP95Ms"]) {
    if (!benchArtifacts.includes(term)) throw new Error(`benchArtifacts.mjs 필수 항목 누락: ${term}`);
  }
  for (const term of ["--candidate", "--scenario", "--sample", "--command", "--source", "--raw-output", "--raw-output-file", "--profile", "--warmup-count", "--browser-headless", "--na", "scenarioDefinition", "measurement", "environment", "evidence", "rawOutputSidecar", "summarizePairedLatencyBench", "isProcessMapBenchGreen", "summarizeLatencyBench", "parseLatencySample", "parseMachineResumeSample", "summarizeMachineResumeBench", "isMachineResumeBenchGreen", "parseImmortalMachineSample", "summarizeImmortalMachineBench", "isImmortalMachineBenchGreen", "normalizeBenchArtifact"]) {
    if (!benchArtifact.includes(term)) throw new Error(`benchArtifact.mjs 필수 항목 누락: ${term}`);
  }
  const artifactDir = join(ROOT, "mainPlan", "_done", "browser-os-north-star", "benchmarks");
  const artifactFiles = readdirSync(artifactDir).filter((name) => name.endsWith(".json")).sort();
  if (!artifactFiles.length) throw new Error("benchmark JSON artifact 없음");
  for (const name of artifactFiles) {
    const file = join(artifactDir, name);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (raw.schemaVersion !== benchArtifactContract.BENCH_ARTIFACT_SCHEMA_VERSION) throw new Error(`${name}: schemaVersion v2 아님`);
    if (!raw.scenarioDefinition || !raw.measurement || !raw.environment || !raw.evidence) throw new Error(`${name}: v2 봉투 누락`);
    benchArtifactContract.normalizeBenchArtifactFile(file);
    const rawOutputPath = benchArtifactContract.rawOutputPathForArtifact(raw, file);
    if (rawOutputPath) {
      const relativeRawOutput = rel(rawOutputPath);
      const tracked = spawnSync("git", ["ls-files", "--error-unmatch", relativeRawOutput], { cwd: ROOT, encoding: "utf8", timeout: 5000 });
      if (tracked.status !== 0) throw new Error(`${name}: rawOutput file git 미추적: ${relativeRawOutput}`);
      if (!readFileSync(rawOutputPath, "utf8").trim()) throw new Error(`${name}: rawOutput file 비어 있음`);
    } else if (raw.evidence.rawOutput !== benchArtifactContract.RAW_OUTPUT_EMBEDDED_REPORT) {
      throw new Error(`${name}: rawOutput reference 형식 불명`);
    }
  }
  const productConsumer = readFileSync(join(ROOT, "tests", "browser", "productConsumer.mjs"), "utf8");
  const immortalProductGate = readFileSync(join(ROOT, "tests", "browser", "immortalProductGate.js"), "utf8");
  for (const term of ["machineExportMs", "machineOpenMs", "machineMB", "machineResumeRows"]) {
    if (!productConsumer.includes(term)) throw new Error(`productConsumer.mjs S4 timing 누락: ${term}`);
  }
  for (const term of ["immortalInitialReadyMs", "immortalRpcP50Ms", "immortalRpcP90Ms", "immortalFailoverMs", "immortalRecoveryMs", "immortalColdReopenMs"]) {
    if (!immortalProductGate.includes(term)) throw new Error(`immortalProductGate.js S5 timing 누락: ${term}`);
  }
  for (const term of ["normalizeBenchArtifactFile", "renderBenchCompareMarkdown"]) {
    if (!benchCompare.includes(term)) throw new Error(`benchCompare.mjs 필수 항목 누락: ${term}`);
  }
});
for (const f of collect(join(ROOT, "examples"), [".html"], [])) {
  check(`채널 행 고정: ${rel(f)}`, () => {
    const html = readFileSync(f, "utf8");
    if (!html.includes("<sns-links></sns-links>")) throw new Error("<sns-links> 없음");
    if (!/<script type="module" src="(examples\/)?siteChrome\.js"><\/script>/.test(html))
      throw new Error("siteChrome.js 모듈 스크립트 없음");
    if (html.includes("snsBtn")) throw new Error("채널 마크업 인라인 복제(SSOT 우회)");
  });
}

// 3.6) 브랜드: 마크 정본은 assets/logo.svg 하나다. 파비콘·헤더 로고·색이 여기서만 나온다.
//      마크를 인라인으로 복제하거나(6쪽이 갈라진다), 마크와 CSS 색이 어긋나는 드리프트를 차단한다.
console.log("\n[브랜드]");
const logoSvg = readFileSync(join(ROOT, "assets", "logo.svg"), "utf8");
const cssSrc = readFileSync(join(ROOT, "examples", "demo.css"), "utf8");
const markColors = {
  // 마크의 그라디언트 양 끝과 터미널 패널 색 = 브랜드 색의 출처.
  markFrom: logoSvg.match(/<stop offset="0%" stop-color="(#[0-9a-f]{6})"\/>/)?.[1],
  markTo: logoSvg.match(/<stop offset="100%" stop-color="(#[0-9a-f]{6})"\/>\s*<\/linearGradient>/)?.[1],
  ink: logoSvg.match(/<path [^>]*fill="(#[0-9a-f]{6})"\/>/g)?.map((m) => m.match(/fill="(#[0-9a-f]{6})"/)[1])[0],
};
for (const [name, color] of Object.entries(markColors)) {
  check(`demo.css --${name}이 마크 실측색(${color})과 일치`, () => {
    if (!color) throw new Error("logo.svg에서 색을 못 읽음(마크 구조 변경?)");
    const declared = cssSrc.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`))?.[1];
    if (declared !== color) throw new Error(`demo.css는 ${declared}, 마크는 ${color}`);
  });
}
const landing = readFileSync(join(ROOT, "examples", "index.html"), "utf8");
for (const f of collect(join(ROOT, "examples"), [".html"], [])) {
  const html = readFileSync(f, "utf8");
  const prefix = html === landing ? "assets/" : "../assets/"; // 랜딩만 배포 루트로 승격된다
  check(`마크 참조 고정: ${rel(f)}`, () => {
    if (!html.includes(`<link rel="icon" href="${prefix}logo.svg">`)) throw new Error("파비콘이 마크 정본을 안 씀");
    if (!html.includes(`<img class="logoMark" src="${prefix}logo.svg"`)) throw new Error("헤더 로고가 마크 정본을 안 씀");
    if (/<svg[^>]*class="logoMark"/.test(html)) throw new Error("마크 인라인 복제(SSOT 우회)");
    if (/rel="icon" href="data:/.test(html)) throw new Error("파비콘 data URI 복제(SSOT 우회)");
  });
}
check("pages.yml이 assets를 배포(안 그러면 파비콘·로고가 404)", () => {
  const pages = readFileSync(join(ROOT, ".github", "workflows", "pages.yml"), "utf8");
  if (!/cp -r [^\n]*\bassets\b/.test(pages)) throw new Error("assets 복사 없음");
});
// SVG는 XML이다: 주석 안의 연속 하이픈은 XML이 금지한다. 어기면 마크가 파싱 불가가 되어
// 브라우저가 에러 한 줄 없이 이미지를 통째로 버린다(파비콘·헤더 로고가 동시에 사라진다).
check("logo.svg 주석에 연속 하이픈 없음(XML 위반 = 마크 소멸)", () => {
  for (const c of logoSvg.match(/<!--[\s\S]*?-->/g) || []) {
    if (c.slice(4, -3).includes("--")) throw new Error("주석 본문에 연속 하이픈: XML 파싱 불가");
  }
});
// 주석 본문에 종료 기호가 섞이면 주석이 거기서 닫히고, 뒤따르는 문장이 선택자로 먹혀
// :root 블록이 통째로 무효가 된다(색이 전부 사라지는데 에러는 없다). CSS 파서와 같은 방식으로
// (여는 기호부터 첫 종료 기호까지) 주석을 걷어낸 뒤, 코드에 종료 기호가 남으면 조기 종료다.
check("demo.css 주석 무결성(조기 종료가 시트를 무력화)", () => {
  const code = cssSrc.replace(/\/\*[\s\S]*?\*\//g, "");
  if (code.includes("*/")) throw new Error("주석 밖에 종료 기호가 남음: 주석 본문이 주석을 조기에 닫았다");
  if (code.includes("/*")) throw new Error("닫히지 않은 주석");
});
// 이름을 바꾼 변수를 어딘가 놓치면 그 자리만 색이 사라진다(계산 시점 무효 -> 초기값). 참조는 전부 해석돼야 한다.
check("demo.css의 var(--x) 참조가 전부 선언과 짝", () => {
  const declared = new Set([...cssSrc.matchAll(/(--[a-zA-Z][\w-]*)\s*:/g)].map((m) => m[1]));
  const missing = [...new Set([...cssSrc.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))].filter((v) => !declared.has(v));
  if (missing.length) throw new Error("선언 없는 변수 참조: " + missing.join(", "));
});

// 4) 타입 선언: 게시되는 타입 표면이 공개 표면을 전부 덮는가.
//    루트 index.d.ts + 강등 subpath의 형제 d.ts를 함께 본다. 강등 표면은 루트에서 export되지
//    않으므로(그래서 강등이다) 자기 .js 옆의 d.ts가 유일한 타입 출처다.
console.log("\n[타입]");
const SUBPATH_DTS = [
  "src/state/index.d.ts",
  "src/machine/index.d.ts",
  "src/runtime/assets.d.ts",
  "src/capabilities/gpuCompute.d.ts",
  "src/capabilities/socketBridge.d.ts",
  "src/runtime/engines/wasi/wasiSession.d.ts",
];
const dts = [join(ROOT, "index.d.ts"), ...SUBPATH_DTS.map((p) => join(ROOT, p))]
  .map((f) => readFileSync(f, "utf8")).join("\n");
for (const sym of ["boot", "open", "checkEnvironment"]) {
  check(`d.ts가 ${sym} 선언`, () => {
    if (!new RegExp(`export function ${sym}\\b`).test(dts)) throw new Error("선언 없음");
  });
}
check("d.ts가 PyProcError/PYPROC_ERROR_CODES 선언", () => {
  if (!/export class PyProcError/.test(dts)) throw new Error("PyProcError");
  if (!/export const PYPROC_ERROR_CODES/.test(dts)) throw new Error("PYPROC_ERROR_CODES");
});
// 값-export가 아니게 된 핸들·탈출구 타입은 declare + export type으로 산다(1:1 패리티 게이트와 짝).
for (const sym of ["Runtime", "MemoryCapability", "FileSystem", "ReactiveController", "SyscallBridge", "AsgiServer", "VirtualOrigin", "Terminal", "DeviceFs", "Init", "MachineJournal", "Session", "WheelCache", "PyProc", "KernelElection", "PyprocMachine", "PyprocHistory"]) {
  check(`d.ts가 ${sym} 타입 선언(declare)`, () => {
    if (!new RegExp(`declare class ${sym}\\b`).test(dts)) throw new Error("declare 없음");
  });
}
check("d.ts subpath 값 선언(assets/history)", () => {
  const assetsDts = readFileSync(join(ROOT, "src", "runtime", "assets.d.ts"), "utf8");
  for (const sym of ["getPyProcAssetManifest", "verifyPyProcAssetIntegrity", "registerPyProcServiceWorker", "PYPROC_ASSET_MANIFEST_VERSION"]) {
    if (!new RegExp(`export (function|const) ${sym}\\b`).test(assetsDts)) throw new Error(`assets.d.ts: ${sym}`);
  }
  const stateDts = readFileSync(join(ROOT, "src", "state", "index.d.ts"), "utf8");
  for (const sym of ["commitState", "openState", "encodeStateBundle", "decodeStateBundle", "PAGE_SIZE"]) {
    if (!new RegExp(`export (function|const|declare)?\s*(function|const)? ?${sym}\\b`).test(stateDts) && !stateDts.includes(sym)) throw new Error(`state/index.d.ts: ${sym}`);
  }
});
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
check("package.json types -> index.d.ts", () => {
  if (pkg.types !== "./index.d.ts") throw new Error(String(pkg.types));
  if (pkg.exports["."].types !== "./index.d.ts") throw new Error("exports['.'].types 누락");
  if (!pkg.files.includes("index.d.ts")) throw new Error("files에 index.d.ts 누락");
});
// 강등 subpath의 타입은 자기 .js 옆의 d.ts로만 성립한다. index.d.ts 안의
// `declare module "pyproc/gpu"` 블록은 이 자리를 대신하지 못했다: 모듈이 untyped .js로
// 해석되면 TypeScript가 증강을 거부한다(TS2665). 타입체크 게이트가 붙고서야 드러난 사실이라
// 위치를 계약으로 고정한다.
check("강등 subpath 타입은 자기 .js 옆에", () => {
  for (const rel of SUBPATH_DTS) {
    if (!existsSync(join(ROOT, rel))) throw new Error(`${rel} 없음`);
    const js = rel.replace(/\.d\.ts$/, ".js");
    if (!existsSync(join(ROOT, js))) throw new Error(`${js} 없음(d.ts가 짝 없이 떠 있다)`);
    const target = Object.values(pkg.exports).find((t) => typeof t === "string" && t === "./" + js);
    if (!target) throw new Error(`${js}가 exports subpath가 아니다`);
  }
  if (readFileSync(join(ROOT, "index.d.ts"), "utf8").includes('declare module "pyproc/')) {
    throw new Error("index.d.ts의 declare module 블록: 형제 d.ts로 옮겨야 한다(TS2665)");
  }
});
check("타입 계약 게이트 배선", () => {
  if (pkg.scripts?.["test:types"] !== "npx -y -p typescript@5 tsc -p tests/tsconfig.json") throw new Error("test:types 누락");
  const cfg = JSON.parse(readFileSync(join(ROOT, "tests", "tsconfig.json"), "utf8"));
  // skipLibCheck는 .d.ts 검사 자체를 건너뛴다. 켜지면 게이트가 조용히 통과한다.
  if (cfg.compilerOptions?.skipLibCheck !== false) throw new Error("skipLibCheck가 false가 아니다(게이트가 조용히 통과한다)");
  if (cfg.compilerOptions?.strict !== true) throw new Error("strict 필요");
  for (const rel of ["../index.d.ts", ...SUBPATH_DTS.map((p) => "../" + p)]) {
    if (!cfg.files.includes(rel)) throw new Error(`tsconfig files에 ${rel} 누락`);
  }
});
check("package.json bin -> assetManifest CLI", () => {
  if (pkg.bin?.["pyproc-assets"] !== "./scripts/assetManifest.mjs") throw new Error("pyproc-assets bin 누락");
  if (!pkg.files.includes("scripts/assetManifest.mjs")) throw new Error("files에 assetManifest.mjs 누락");
});
check("package.json 소비자 게이트 스크립트", () => {
  if (pkg.scripts?.["test:package"] !== "node tests/packageConsumer.mjs") throw new Error("test:package 누락");
  if (pkg.scripts?.["test:consumer"] !== "node tests/browser/productConsumer.mjs") throw new Error("test:consumer 누락");
});
check("d.ts가 PyProc 샤딩 옵션 계약을 선언", () => {
  if (!dts.includes("export interface PyProcShardOptions extends PyProcMapOptions")) throw new Error("PyProcShardOptions 누락");
  if (!dts.includes("export interface PyProcMatmulOptions extends PyProcShardOptions")) throw new Error("PyProcMatmulOptions 누락");
  if (!dts.includes("mapArray(fnSrc: string, typed: ArrayBufferView, opts?: PyProcShardOptions): Promise<unknown[]>;")) throw new Error("mapArray parts 타입 누락");
  if (!dts.includes("matmul(a: Matrix, b: Matrix, opts?: PyProcMatmulOptions): Promise<Matrix>;")) throw new Error("matmul parts 타입 누락");
});
check("exports 경로 실존", () => {
  for (const [sub, target] of Object.entries(pkg.exports)) {
    const t = typeof target === "string" ? target : target.default;
    if (!existsSync(join(ROOT, t))) throw new Error(`${sub} -> ${t} 없음`);
  }
});
check("exports 안정 subpath 고정", () => {
  const allowed = new Set([".", "./history", "./machine", "./worker", "./assets", "./gpu", "./socket", "./wasi"]);
  const keys = Object.keys(pkg.exports);
  for (const key of keys) {
    if (!allowed.has(key)) throw new Error(`승인 안 된 export key: ${key}`);
    if (key.startsWith("./src/")) throw new Error(`src deep export 금지: ${key}`);
  }
  for (const key of allowed) if (!keys.includes(key)) throw new Error(`export key 누락: ${key}`);
  if (pkg.exports["./history"] !== "./src/state/index.js") throw new Error("pyproc/history는 state 배럴을 가리켜야 함");
});

// 4.5) README 표면 동기화: index.js의 모든 export가 양쪽 README에 등장해야 한다.
//      승격이 문서를 앞지르는 드리프트를 차단한다(계약 실태 표의 부채 해소, 2026-07-12).
console.log("\n[README 표면]");
for (const readme of ["README.md", "README.ko.md"]) {
  check(`${readme}가 공개 표면 전부 언급`, () => {
    const text = readFileSync(join(ROOT, readme), "utf8");
    const missing = Object.keys(api).filter((name) => !text.includes("`" + name));
    if (missing.length) throw new Error(`표면 누락: ${missing.join(", ")}`);
  });
}
check("README 공개 표면은 작업별 지도 형태", () => {
  const readmeEn = readFileSync(join(ROOT, "README.md"), "utf8");
  const readmeKo = readFileSync(join(ROOT, "README.ko.md"), "utf8");
  if (!readmeEn.includes("| Need | Public exports | Runnable proof |")) throw new Error("README.md 공개 표면 지도 헤더 누락");
  if (!readmeKo.includes("| 필요한 것 | 공개 export | 실행 증거 |")) throw new Error("README.ko.md 공개 표면 지도 헤더 누락");
  if (readmeEn.includes("| Export | What |")) throw new Error("README.md가 장황한 export 설명표로 회귀");
  if (readmeKo.includes("| Export | 무엇 |")) throw new Error("README.ko.md가 장황한 export 설명표로 회귀");
});
// 랜딩 벤치 메시지 게이트는 제거했다(2026-07-17). 이 게이트는 랜딩에 박힌 측정치(3.95x, 18ms,
// 76ms, 10.8MB ...)를 필수로 강제하고 '낡은 벤치 숫자' 목록까지 따로 관리했다. 숫자를 간판으로
// 걸면 그 숫자를 영원히 방어해야 한다는 규칙의 근거가 바로 이 게이트였다. 성능 주장 가드가 대신한다.
check("랜딩이 라이브러리 소비 판단 경로를 직접 노출", () => {
  for (const term of [
    '<a href="#build">Build</a>',
    '<h2 id="build">Build with pyproc as a library</h2>',
    "Product code should consume root exports, stable subpaths, and documented execution assets, never engine internals.",
    "Public surface map",
    "Capability matrix",
    "Consumer contract",
    "Benchmark contract",
    "Pin an exact npm version for product use.",
  ]) {
    if (!landing.includes(term)) throw new Error(`examples/index.html 라이브러리 소비 경로 누락: ${term}`);
  }
  for (const url of [
    "https://github.com/eddmpython/pyproc#public-surface",
    "https://github.com/eddmpython/pyproc/blob/main/docs/consuming/capabilityMatrix.md",
    "https://github.com/eddmpython/pyproc/blob/main/docs/consuming/contract.md",
    "https://github.com/eddmpython/pyproc/blob/main/docs/operations/benchmarking.md",
  ]) {
    if (!landing.includes(`href="${url}"`)) throw new Error(`examples/index.html GitHub 문서 링크 누락: ${url}`);
  }
  if (/href="docs\//.test(landing)) throw new Error("Pages 배포에서 깨질 로컬 docs 링크 사용");
});
check("소비 문서 역할 분리", () => {
  const contract = readFileSync(join(ROOT, "docs", "consuming", "contract.md"), "utf8");
  const docsMap = readFileSync(join(ROOT, "docs", "README.md"), "utf8");
  if (!contract.includes("역할은 분리한다.")) throw new Error("contract.md 역할 분리 선언 누락");
  if (!contract.includes("## 공개 import 경계")) throw new Error("contract.md import 경계 절 누락");
  if (!contract.includes("## 실행 자산 배포 계약")) throw new Error("contract.md 실행 자산 배포 절 누락");
  if (!contract.includes("## 계약 검증")) throw new Error("contract.md 계약 검증 절 누락");
  if (!contract.includes("### 설치 패키지 consumer gate coverage")) throw new Error("contract.md 설치 패키지 consumer gate coverage 절 누락");
  if (!contract.includes("[capabilityMatrix.md](capabilityMatrix.md): capability별 제품 가치")) throw new Error("contract.md가 capability matrix 역할을 위임하지 않음");
  if (contract.includes("| export | 무엇 |")) throw new Error("contract.md가 capability별 export 설명표로 회귀");
  if (!docsMap.includes("설치, 버전 핀, import 경계, 실행 자산 배포")) throw new Error("docs/README.md contract 역할 설명이 낡음");
});
check("설치 패키지 consumer gate coverage가 실제 게이트와 정합", () => {
  const contract = readFileSync(join(ROOT, "docs", "consuming", "contract.md"), "utf8");
  const testing = readFileSync(join(ROOT, "docs", "operations", "testing.md"), "utf8");
  const packageConsumer = readFileSync(join(ROOT, "tests", "packageConsumer.mjs"), "utf8");
  const productConsumer = readFileSync(join(ROOT, "tests", "browser", "productConsumer.mjs"), "utf8");
  const immortalGate = readFileSync(join(ROOT, "tests", "browser", "immortalProductGate.js"), "utf8");
  const immortalParticipant = readFileSync(join(ROOT, "tests", "browser", "immortalProductParticipant.html"), "utf8");
  const expectedTable = productConsumerCoverage.renderProductConsumerCoverageMarkdown();
  if (!contract.includes(expectedTable)) throw new Error("contract.md consumer coverage 표가 productConsumerCoverage.mjs 렌더링과 불일치");
  if (!productConsumer.includes("productConsumerCoverageManifest")) throw new Error("productConsumer.mjs가 coverage manifest SSOT를 import하지 않음");
  if (!productConsumer.includes("coverageManifest")) throw new Error("productConsumer.mjs가 coverage manifest를 report하지 않음");
  if (!productConsumer.includes("product consumer coverage manifest")) throw new Error("productConsumer.mjs가 coverage manifest report 검증을 출력하지 않음");
  // state-kernel 7b 표면: 루트 porcelain + 핸들 어휘 + pyproc/history 서명 코어.
  for (const name of [
    "boot",
    "open",
    "createWebComputer",
    "createStateKeyPair",
    "exportStatePublicKey",
    "fingerprintStatePublicKey",
    "verifyPyProcAssetIntegrity",
    "registerPyProcServiceWorker",
    "getPyProcAssetManifest",
    "enableAsgiServer",
    "enableDeviceFs",
    "enableInit",
    "deterministic",
    "history",
    "proc",
  ]) {
    if (!contract.includes("`" + name)) throw new Error(`contract.md consumer coverage export 누락: ${name}`);
    if (!productConsumer.includes(name)) throw new Error(`productConsumer.mjs export 사용 누락: ${name}`);
  }
  for (const term of [
    "pyproc/assets",
    "pyproc/history",
    "pyproc/machine",
    "commitState",
    "pyproc-assets",
    "--copy-to",
  ]) {
    if (!packageConsumer.includes(term)) throw new Error(`packageConsumer.mjs 설치 패키지 표면 검사 누락: ${term}`);
  }
  for (const term of [
    "installed worker graph SRI verifies",
    "installed package SW registers from manifest URL",
    "VirtualOrigin fetch reaches Python server from installed package",
    "DeviceFs exposes installed product devices as Python files",
    "MachineJail enforces installed product permission manifest",
    "PyProc worker runs from installed package",
    "JobControl runs installed product shell jobs",
    "MachineContainer runs installed product child machine",
    "MachineJournal recovers installed product state after crash boundary",
    "installed product exports signed .pymachine with home",
    "installed product opens trusted .pymachine and resumes resources",
  ]) {
    if (!productConsumer.includes(term)) throw new Error(`productConsumer.mjs coverage check 누락: ${term}`);
  }
  for (const term of [
    "openPersistentMachine",
    "installed machine elects exactly one leader across browsing contexts",
    "installed machine survives forced leader context removal",
    "installed timeout/failover RPC rejects unknown outcome, ignores late response and never replays",
    "collision-free request IDs",
    "installed machine cold-reopens committed heap and home after all participants close",
    "prepared environment",
    "productPrepared",
    "PYPROC_RPC_OUTCOME_UNKNOWN",
  ]) {
    if (!immortalGate.includes(term) && !immortalParticipant.includes(term)) throw new Error(`immortal product consumer coverage 누락: ${term}`);
  }
  if (!productConsumer.includes("runImmortalProductGate")) throw new Error("productConsumer.mjs가 immortal product gate를 실행하지 않음");
  if (!immortalParticipant.includes('from "pyproc"')) throw new Error("immortal participant가 설치 패키지 root export를 쓰지 않음");
  if (!testing.includes("설치 패키지 consumer gate coverage 표")) throw new Error("testing.md consumer coverage 표 포인터 누락");
  if (contract.includes("왕복 3.4ms")) throw new Error("contract.md에 낡은 S3 3.4ms 수치 잔존");
});
check("능력 매트릭스가 제품 판단 표면을 고정", () => {
  const matrixPath = join(ROOT, "docs", "consuming", "capabilityMatrix.md");
  if (!existsSync(matrixPath)) throw new Error("capabilityMatrix.md 없음");
  const matrix = readFileSync(matrixPath, "utf8");
  const docsMap = readFileSync(join(ROOT, "docs", "README.md"), "utf8");
  const readmeEn = readFileSync(join(ROOT, "README.md"), "utf8");
  const readmeKo = readFileSync(join(ROOT, "README.ko.md"), "utf8");
  for (const text of [docsMap, readmeEn, readmeKo]) {
    if (!text.includes("capabilityMatrix.md")) throw new Error("능력 매트릭스 링크 누락");
  }
  for (const term of ["제품 가치", "공개 표면", "상태", "필수 조건", "실행 표면", "검증", "경계"]) {
    if (!matrix.includes(term)) throw new Error(`능력 매트릭스 필드 누락: ${term}`);
  }
  for (const term of ["Stable", "Beta", "Experimental", "Research preview"]) {
    if (!matrix.includes(term)) throw new Error(`능력 매트릭스 상태 누락: ${term}`);
  }
  const required = ["boot", "Runtime", "ReactiveController", "PyProc", "AsgiServer", "VirtualOrigin", "bootSession", "openMachine", "MachineJournal", "MachineJail", "SocketBridge", "openPersistentMachine", "KernelElection", "bootWasi", "GpuCompute", "getPyProcAssetManifest", "checkEnvironment"];
  const missing = required.filter((name) => !matrix.includes("`" + name));
  if (missing.length) throw new Error(`능력 매트릭스 공개 표면 누락: ${missing.join(", ")}`);
  const runnableLinks = [
    "../../examples/basic.html",
    "../../examples/processOs.html",
    "../../examples/speedLab.html",
    "../../examples/serverDev.html",
    "../../examples/terminal.html",
    "../../examples/machine.html",
    "../../examples/immortal.html",
    "../../tests/browser/productConsumer.mjs",
    "../../mainPlan/_done/browser-os-north-star/benchmarks/s1-pyproc-2026-07-15.json",
    "../../mainPlan/_done/browser-os-north-star/benchmarks/s3-pyproc-2026-07-15.json",
    "../../mainPlan/_done/browser-os-north-star/benchmarks/s4-pyproc-2026-07-15.json",
  ];
  for (const target of runnableLinks) {
    if (!matrix.includes(`](${target})`)) throw new Error(`능력 매트릭스 실행 표면 링크 누락: ${target}`);
  }
  const statusLabels = new Set(["Stable", "Beta", "Experimental", "Research preview"]);
  const rows = matrix.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| ---") && !line.startsWith("| 능력"));
  let checkedRows = 0;
  for (const row of rows) {
    const cols = row.split("|").slice(1, -1).map((s) => s.trim());
    if (cols.length !== 8 || !statusLabels.has(cols[3])) continue;
    checkedRows++;
    if (!/\[[^\]]+\]\([^)]+\)/.test(cols[5])) throw new Error(`능력 매트릭스 실행 표면 링크 누락: ${cols[0]}`);
  }
  if (checkedRows < 10) throw new Error(`능력 매트릭스 행 파싱 실패: ${checkedRows}`);
});
// 소비 계약 문서가 게시하는 자산 경로 목록이 실제 매니페스트와 같은가.
// 링크 게이트는 마크다운 링크만 보고 코드블록 산문은 아무도 안 봤다. 그 사이 이 목록은
// 이미 표류해서, 삭제된 파일(sharedKernelHost)을 소비자에게 계약으로 게시하고 있었다.
check("소비 계약 문서의 자산 목록 = 실제 매니페스트", () => {
  const doc = readFileSync(join(ROOT, "docs", "consuming", "contract.md"), "utf8");
  const block = doc.slice(doc.indexOf("// manifest.assets:"));
  const listed = [...block.matchAll(/^\/\/ - (\w+)\s+(\S+)$/gm)].map((m) => ({ role: m[1], path: m[2] }));
  if (!listed.length) throw new Error("문서에서 자산 목록 블록을 못 찾음");
  const actual = assetsApi.getPyProcAssetManifest({ baseURL: "/x/" }).assets.map((a) => ({ role: a.role, path: a.path }));
  const fmt = (xs) => xs.map((x) => `${x.role}=${x.path}`).sort().join(", ");
  if (fmt(listed) !== fmt(actual)) throw new Error(`문서 [${fmt(listed)}] != 실제 [${fmt(actual)}]`);
});

// 5) worker 계약: Node import 불가(onmessage 전역)라 텍스트로 확인.
//    worker.js는 pyProc.js와 같은 폴더 = new URL 상대경로(번들러 워커 emit) 계약.
console.log("\n[worker]");
check("worker.js가 boot/task 처리", () => {
  const src = readFileSync(join(ROOT, "src", "processOs", "worker.js"), "utf8");
  if (!src.includes("onmessage")) throw new Error("onmessage 핸들러 없음");
  if (!src.includes('"boot"') || !src.includes('"task"')) throw new Error("boot/task 분기 없음");
});
check("pyProc.js가 같은 폴더 worker를 spawn", () => {
  const src = readFileSync(join(ROOT, "src", "processOs", "pyProc.js"), "utf8");
  if (!src.includes('new URL("./worker.js", import.meta.url)')) throw new Error("워커 상대경로 계약 위반");
});
check("virtualOrigin.js와 pyprocSw.js가 같은 폴더(자산 경로 계약)", () => {
  if (!existsSync(join(ROOT, "src", "capabilities", "pyprocSw.js"))) throw new Error("pyprocSw.js 없음");
  if (!existsSync(join(ROOT, "src", "capabilities", "virtualOrigin.js"))) throw new Error("virtualOrigin.js 없음");
});
check("asset manifest가 실행 자산 경로와 동기화", () => {
  const manifest = assetsApi.getPyProcAssetManifest({ baseURL: "https://example.test/pkg/" });
  const byRole = Object.fromEntries(manifest.assets.map((a) => [a.role, a.path]));
  const expected = {
    processWorker: "src/processOs/worker.js",
    machineWorker: "src/processOs/machineWorker.js",
    wasiWorker: "src/runtime/engines/wasi/wasiWorker.js",
    pyprocServiceWorker: "src/capabilities/pyprocSw.js",
  };
  for (const [role, path] of Object.entries(expected)) {
    if (byRole[role] !== path) throw new Error(`${role}: ${byRole[role]} != ${path}`);
    if (!existsSync(join(ROOT, path))) throw new Error(`manifest 자산 없음: ${path}`);
  }
  const checks = [
    ["src/processOs/pyProc.js", 'new URL("./worker.js", import.meta.url)', expected.processWorker],
    ["src/capabilities/syscallBridge.js", 'new URL("../processOs/worker.js", import.meta.url)', expected.processWorker],
    ["src/processOs/machineContainer.js", 'new URL("./machineWorker.js", import.meta.url)', expected.machineWorker],
    ["src/processOs/machineWorker.js", 'new URL("./machineWorker.js", import.meta.url)', expected.machineWorker],
    ["src/runtime/engines/wasi/wasiSession.js", 'new URL("./wasiWorker.js", import.meta.url)', expected.wasiWorker],
  ];
  for (const [file, needle] of checks) {
    const src = readFileSync(join(ROOT, file), "utf8");
    if (!src.includes(needle)) throw new Error(`${file}의 worker 경로가 manifest 계약과 어긋남`);
  }
});
check("assetManifest CLI가 graph SRI manifest 생성", () => {
  const r = spawnSync(process.execPath, ["scripts/assetManifest.mjs", "--baseURL", "/vendor/pyproc/"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  const m = JSON.parse(r.stdout);
  if (m.packageRoot !== "/vendor/pyproc/") throw new Error("baseURL 반영 실패");
  if (!Array.isArray(m.entrypoints) || !Array.isArray(m.files)) throw new Error("entrypoints/files 없음");
  const byPath = new Map(m.files.map((f) => [f.path, f]));
  for (const p of ["src/processOs/worker.js", "src/processOs/ipc.js", "src/runtime/runtime.js", "src/runtime/engines/wasi/wasiProtocol.js", "src/capabilities/pyprocSw.js"]) {
    const f = byPath.get(p);
    if (!f) throw new Error(`graph 파일 누락: ${p}`);
    if (!/^sha256-[A-Za-z0-9+/]+=*$/.test(f.integrity)) throw new Error(`SRI 형식 오류: ${p}`);
    if (!(f.bytes > 0)) throw new Error(`bytes 오류: ${p}`);
  }
  const processEntry = m.entrypoints.find((e) => e.role === "processWorker");
  if (!processEntry?.graph.includes("src/processOs/ipc.js")) throw new Error("processWorker graph가 ipc.js를 포함하지 않음");
  const tmp = mkdtempSync(join(tmpdir(), "pyprocAssets-"));
  try {
    const c = spawnSync(process.execPath, ["scripts/assetManifest.mjs", "--baseURL", "/vendor/pyproc/", "--copy-to", tmp], { cwd: ROOT, encoding: "utf8" });
    if (c.status !== 0) throw new Error(c.stderr || c.stdout);
    if (!existsSync(join(tmp, "src", "processOs", "worker.js"))) throw new Error("copy-to가 worker.js를 복사하지 않음");
    if (!existsSync(join(tmp, "src", "runtime", "runtime.js"))) throw new Error("copy-to가 import graph를 복사하지 않음");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
check("브라우저 게이트가 CLI asset manifest를 소비", () => {
  const runSrc = readFileSync(join(ROOT, "tests", "browser", "run.mjs"), "utf8");
  const gateSrc = readFileSync(join(ROOT, "tests", "browser", "gate.html"), "utf8");
  const ciSrc = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  if (!runSrc.includes('"scripts/assetManifest.mjs", "--baseURL", "/"')) throw new Error("run.mjs가 pyproc-assets CLI를 실행하지 않음");
  if (!runSrc.includes('"/pyproc-assets.json"')) throw new Error("run.mjs가 asset manifest endpoint를 제공하지 않음");
  if (!gateSrc.includes('fetch("/pyproc-assets.json"')) throw new Error("gate.html이 CLI 산출 manifest를 fetch하지 않음");
  if (!gateSrc.includes('assetOk.verified > 1') || !gateSrc.includes('"src/processOs/ipc.js"')) throw new Error("gate.html이 graph 단위 preflight를 검증하지 않음");
  if (!gateSrc.includes("registerPyProcServiceWorker") || !gateSrc.includes("coreIntegrity=/pyproc-assets.json"))
    throw new Error("gate.html이 Service Worker 등록 경로와 SW coreIntegrity를 검증하지 않음");
  if (!gateSrc.includes("Runtime -> SyscallBridge 상속 거부") || !gateSrc.includes("assetIntegrity 상속 childWorker"))
    throw new Error("gate.html이 Runtime assetIntegrity 상속 경로를 검증하지 않음");
  if (!ciSrc.includes("npm run test:consumer")) throw new Error("CI가 제품 소비자 브라우저 게이트를 실행하지 않음");
});
check("패키지 소비자가 공개 표면과 설치된 pyproc-assets를 사용", () => {
  const r = spawnSync(process.execPath, ["tests/packageConsumer.mjs"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim().slice(-4000));
  if (!r.stdout.includes("package consumer ok:")) throw new Error("package consumer 완료 신호 없음");
});

// 6) 상대 링크 생존: 모든 *.md의 상대 링크가 "git 추적" 경로를 가리키는가.
//    존재 검사만으로는 부족하다: 로컬에만 있는 미추적 파일(로컬 규칙 문서 등)을 가리키면
//    로컬은 green인데 CI 러너는 red가 된다(2026-07-12 실제 사고: CI 전 이력 적색의 원인).
//    추적 집합이 기준이면 로컬 게이트 = CI 게이트다. 대소문자 불일치(Windows 관용)도 잡힌다.
//    코드 펜스 안은 예제라 제외. http(s)/mailto/앵커 전용 링크 제외.
console.log("\n[링크]");
const trackedFiles = new Set(
  spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .stdout.split("\n").map((p) => p.trim()).filter(Boolean)
);
const isTracked = (absPath) => {
  const relPath = absPath.slice(ROOT.length + 1).replaceAll("\\", "/");
  if (trackedFiles.has(relPath)) return true;
  const prefix = relPath + "/"; // 디렉터리 링크: 그 아래 추적 파일이 하나라도 있으면 유효
  for (const t of trackedFiles) if (t.startsWith(prefix)) return true;
  return false;
};
for (const f of collect(ROOT, [".md"], [])) {
  check(`links ok: ${rel(f)}`, () => {
    const text = readFileSync(f, "utf8").replace(/```[\s\S]*?```/g, "");
    // 추적 문서의 링크만 추적 대상을 강제한다. 로컬 전용 문서(AGENTS.md 등, 미추적)는
    // CI에 아예 없으므로 존재 검사로 충분하다.
    const srcTracked = trackedFiles.has(rel(f));
    const dead = [];
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const path = resolve(dirname(f), decodeURIComponent(target.split("#")[0]));
      if (!existsSync(path)) dead.push(target);
      else if (srcTracked && !isTracked(path)) dead.push(`${target} (git 미추적: CI에서 죽는 링크)`);
    }
    if (dead.length) throw new Error(`죽은 링크: ${dead.join(", ")}`);
  });
}

// 7) 구조 불변식: attempts 카테고리와 mainPlan 이니셔티브의 README 의무.
console.log("\n[구조]");
// 레이어 = 폴더. 순위가 작을수록 바닥이고, import는 아래로만 흐른다(큰 쪽 -> 작은 쪽).
// 같은 순위끼리의 교차도 금지다(같은 층은 서로를 몰라야 한다).
// 이 규칙이 성립하면 폴더 순환은 수학적으로 불가능하다: 순환은 출발 폴더로 돌아와야 하는데
// 모든 edge가 순위를 엄격히 낮추므로 돌아올 길이 없다. 그래서 방향 목록을 열거하지 않는다.
const LAYER_RANK = new Map([
  ["runtime", 0],       // 엔진 core + 교차 관심사. 다른 레이어를 모르는 바닥
  ["state", 1],         // 이중 구역 상태 커널의 내구 구역(오브젝트 모델 + ref 프로토콜 + 서명 코어)
  ["capabilities", 2],  // (rt, cfg)를 받아 런타임에 얹히는 능력
  ["composition", 3],   // 조립: core에 능력 registry를 설치하고 public 표면을 낸다
  ["session", 4],       // 조립된 런타임을 부팅해 머신 하나의 수명주기와 단독 소유권을 만든다
  ["processOs", 4],     // 워커 = 프로세스, 스냅샷 = 프로세스 이미지
  ["machine", 5],       // 브라우저를 여러 guest OS가 올라가는 컴퓨터로. pyproc의 최상층
]);
check("src 레이어 폴더 고정", () => {
  for (const f of collect(join(ROOT, "src"), [".js"], [])) {
    const layer = srcLayerName(rel(f));
    if (!LAYER_RANK.has(layer)) throw new Error(`승인 안 된 src 레이어: ${rel(f)}`);
  }
});
check("src module 참조 실존", () => {
  const srcRoot = join(ROOT, "src");
  const problems = [];
  for (const f of collect(srcRoot, [".js"], [])) {
    for (const ref of jsModuleRefs(f)) {
      const target = moduleTarget(f, ref.spec);
      if (!target) continue;
      const targetRel = rel(target);
      if (!ref.spec.split(/[?#]/)[0].endsWith(".js")) problems.push(`${rel(f)} -> ${ref.spec}: .js 확장자 필요`);
      if (!existsSync(target)) problems.push(`${rel(f)} -> ${ref.spec}: 파일 없음`);
      else if (!targetRel.startsWith("src/")) problems.push(`${rel(f)} -> ${ref.spec}: src 밖 참조`);
    }
  }
  if (problems.length) throw new Error(problems.slice(0, 8).join("; "));
});
check("합성 루트만 core와 능력을 함께 안다", () => {
  // core Runtime(L0)은 자기 레이어 밖을 모른다. 위 rank 규칙과 겹치지만 오류 문장이 구체적이라 남긴다.
  const src = readFileSync(join(ROOT, "src", "runtime", "runtime.js"), "utf8");
  for (const ref of jsModuleRefs(join(ROOT, "src", "runtime", "runtime.js"))) {
    if (ref.spec.startsWith("../")) throw new Error(`runtime.js가 자기 레이어 밖을 import함: ${ref.spec}`);
  }
  if (src.includes("../capabilities/")) throw new Error("runtime.js가 capabilities를 직접 import함");
  // runtimeApi(합성 루트)는 registry 하나만 알고, 능력 class 목록은 registry가 안다.
  const apiSrc = readFileSync(join(ROOT, "src", "composition", "runtimeApi.js"), "utf8");
  if (!apiSrc.includes("./runtimeBindings.js")) throw new Error("runtimeApi.js가 runtimeBindings registry를 import하지 않음");
  for (const spec of ["reactive", "syscallBridge", "socketBridge", "asgiServer", "wheelCache", "terminal", "deviceFs", "init", "machineJournal", "gpuCompute"]) {
    if (apiSrc.includes(`../capabilities/${spec}.js`)) throw new Error(`runtimeApi.js가 capability class를 직접 import함: ${spec}`);
  }
  const registrySrc = readFileSync(join(ROOT, "src", "composition", "runtimeBindings.js"), "utf8");
  for (const term of ["installRuntimeCapabilities", "enableReactive", "enableSyscallBridge", "enableAsgiServer", "enableJournal"]) {
    if (!apiSrc.includes(term) && !registrySrc.includes(term)) throw new Error(`runtime capability binding 누락: ${term}`);
  }
  // 합성 루트는 아무도 import하지 않는 꼭대기여야 한다. 아래층이 이걸 부르면 폴더 순환이 된다.
  for (const f of collect(join(ROOT, "src"), [".js"], [])) {
    if (srcLayerName(rel(f)) === "composition") continue;
    for (const ref of jsModuleRefs(f)) {
      const target = moduleTarget(f, ref.spec);
      if (target && rel(target) === "src/composition/runtimeApi.js" && LAYER_RANK.get(srcLayerName(rel(f))) < LAYER_RANK.get("composition")) {
        throw new Error(`${rel(f)}가 합성 루트를 import함(아래층 -> 조립 = 순환)`);
      }
    }
  }
});
check("src ESM import graph cycle 없음", () => {
  const files = collect(join(ROOT, "src"), [".js"], []);
  const byRel = new Set(files.map(rel));
  const graph = new Map(files.map((f) => [rel(f), []]));
  for (const f of files) {
    for (const ref of jsModuleRefs(f)) {
      if (ref.kind !== "module" && ref.kind !== "dynamic") continue;
      const target = moduleTarget(f, ref.spec);
      if (!target) continue;
      const targetRel = rel(target);
      if (byRel.has(targetRel)) graph.get(rel(f)).push(targetRel);
    }
  }
  const cycles = findCycles(graph);
  if (cycles.length) throw new Error(cycles.slice(0, 4).map((c) => c.join(" -> ")).join("; "));
});
check("src layer edge는 아래로만", () => {
  // 위로 향하는 유일한 edge. ESM import가 아니라 Worker 자산 URL이라 모듈 그래프에 없다
  // (위 cycle 검사도 kind로 배제한다). 워커를 스폰하는 쪽이 워커 파일 위치를 알아야 성립하고,
  // 자산 매니페스트(assets.js)가 이 경로를 공개 계약으로 게시한다.
  const assetUpward = new Set([
    "newURL src/capabilities/syscallBridge.js -> src/processOs/worker.js",
  ]);
  // coupling budget. 방향(L1 -> L0)은 합법이지만, 능력이 런타임 내부에 새로 손대는 것은
  // 매번 심사에 건다. 예외 목록이 아니라 예산이다: 늘리려면 이 줄을 고치는 것이 곧 리뷰 지점.
  // errors.js는 전 레이어 공용 오류 계약이라 예산 밖이다(파일 열거가 무의미).
  const capabilityToRuntimeBudget = new Set([
    "src/capabilities/envManager.js -> src/runtime/runtime.js",
    "src/capabilities/envManager.js -> src/runtime/engines/pyodideEngine.js",
    "src/capabilities/envManager.js -> src/runtime/contentDigest.js",
    "src/capabilities/journalBlobStore.js -> src/runtime/contentDigest.js",
    "src/capabilities/journalKernelStore.js -> src/runtime/contentDigest.js",
    "src/capabilities/machineJournal.js -> src/runtime/contentDigest.js",
    "src/capabilities/machineJournal.js -> src/runtime/heapGrow.js",
    "src/capabilities/machineJournal.js -> src/runtime/memoryLayout.js",
    "src/capabilities/reactive.js -> src/runtime/memoryLayout.js",
    "src/capabilities/reactive.js -> src/runtime/heapDelta.js",
    "src/capabilities/wheelCache.js -> src/runtime/globalPatch.js",
    "src/capabilities/syscallBridge.js -> src/runtime/assets.js",
    "src/capabilities/syscallBridge.js -> src/runtime/rpcChannel.js",
  ]);
  const problems = [];
  for (const f of collect(join(ROOT, "src"), [".js"], [])) {
    for (const ref of jsModuleRefs(f)) {
      const target = moduleTarget(f, ref.spec);
      if (!target || !existsSync(target)) continue;
      const fromLayer = srcLayerName(rel(f));
      const targetRel = rel(target);
      const toLayer = srcLayerName(targetRel);
      if (!fromLayer || !toLayer || fromLayer === toLayer) continue;
      const pair = `${rel(f)} -> ${targetRel}`;
      if (ref.kind === "newURL") {
        if (!assetUpward.has(`newURL ${pair}`)) problems.push(`${pair} (자산 URL 승인 목록 밖)`);
        continue;
      }
      const fromRank = LAYER_RANK.get(fromLayer), toRank = LAYER_RANK.get(toLayer);
      if (!(fromRank > toRank)) problems.push(`${pair} (${fromLayer}(${fromRank}) -> ${toLayer}(${toRank}): import는 아래로만)`);
      else if (fromLayer === "capabilities" && toLayer === "runtime" && targetRel !== "src/runtime/errors.js"
        && !capabilityToRuntimeBudget.has(pair)) problems.push(`${pair} (능력 -> 런타임 coupling budget 밖)`);
    }
  }
  if (problems.length) throw new Error([...new Set(problems)].slice(0, 8).join("; "));
});
check("examples는 공개 표면으로만 pyproc 소비", () => {
  const examplesRoot = join(ROOT, "examples");
  const allowedStaticAssets = new Set(["examples/serverDevSw.js -> ../src/capabilities/pyprocSw.js"]);
  const problems = [];
  for (const f of collect(examplesRoot, [".js", ".html"], [])) {
    for (const ref of jsModuleRefs(f)) {
      const target = moduleTarget(f, ref.spec);
      const pair = `${rel(f)} -> ${ref.spec}`;
      if (allowedStaticAssets.has(pair) && ref.kind === "importScripts") continue;
      if (target && rel(target).startsWith("src/")) problems.push(pair);
      if (/^(\.\.\/)+src\//.test(ref.spec) || ref.spec.startsWith("/src/")) problems.push(pair);
    }
  }
  if (problems.length) throw new Error([...new Set(problems)].slice(0, 8).join("; "));
});
check("tests/attempts/README.md 존재(운영 규칙 SSOT)", () => {
  if (!existsSync(join(ROOT, "tests", "attempts", "README.md"))) throw new Error("없음");
});
check("attempts 카테고리마다 README + 졸업 게이트 절", () => {
  const dir = join(ROOT, "tests", "attempts");
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    const readme = join(full, "README.md");
    if (!existsSync(readme)) throw new Error(`${entry}: README.md 없음`);
    if (!readFileSync(readme, "utf8").includes("졸업 게이트")) throw new Error(`${entry}: 졸업 게이트 절 없음`);
  }
});
check("mainPlan 이니셔티브마다 README", () => {
  const dir = join(ROOT, "mainPlan");
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (!statSync(full).isDirectory()) continue;
      if (!existsSync(join(full, "README.md"))) throw new Error(`${rel(full)}: README.md 없음`);
    }
  };
  walk(dir); if (existsSync(join(dir, "_done"))) walk(join(dir, "_done"));
});
// mainPlan 수명주기 강제: "완료는 폴더째 _done 이관"이 사람 기억이 아니라 기계 가드다.
// 실제 사고(2026-07-18): 이니셔티브를 완료로 선언·보고하고도 활성 폴더에 방치했다.
// 규칙 문면이 있어도 게이트가 없으면 안 지켜진다는 실증이라 즉시 기계화한다.
check("mainPlan 수명주기: 완료 선언 = _done 이관 동시", () => {
  const dir = join(ROOT, "mainPlan");
  const doneDir = join(dir, "_done");
  const problems = [];
  // (a) 활성 이니셔티브는 완료를 선언할 수 없다(단계 완료 기록은 허용, 이니셔티브 완결 선언만 차단).
  const DONE_MARKERS = ["실질 완료", "완료 이관", "✅ 완료", "이니셔티브 완결"];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory() || entry === "_done") continue;
    for (const f of collect(full, [".md"], [])) {
      const text = readFileSync(f, "utf8");
      for (const marker of DONE_MARKERS) {
        if (text.includes(marker)) problems.push(`${rel(f)}: 활성 이니셔티브가 "${marker}" 선언(완료면 폴더째 _done 이관이 규칙)`);
      }
    }
  }
  // (b) _done 이니셔티브는 배너(상태 이모지 + 날짜)와 보관 목록 행을 가져야 한다.
  const doneIndex = readFileSync(join(doneDir, "README.md"), "utf8");
  for (const entry of readdirSync(doneDir)) {
    const full = join(doneDir, entry);
    if (!statSync(full).isDirectory()) continue;
    const readme = readFileSync(join(full, "README.md"), "utf8");
    if (!/[✅🚫🔀][^\n]*\(\d{4}-\d{2}-\d{2}[^)]*\)/u.test(readme)) problems.push(`_done/${entry}: 완료·폐기 배너(이모지 + 날짜) 없음`);
    if (!doneIndex.includes(`[${entry}/](${entry}/)`)) problems.push(`_done/README.md 보관 목록에 ${entry} 행 없음`);
  }
  // (c) 활성 목록 동기: mainPlan/README.md의 활성 절이 실제 활성 폴더와 1:1이어야 한다.
  const mainIndex = readFileSync(join(dir, "README.md"), "utf8");
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory() || entry === "_done") continue;
    if (!mainIndex.includes(`[${entry}](${entry}/README.md)`)) problems.push(`mainPlan/README.md 활성 목록에 ${entry} 없음`);
  }
  if (problems.length) throw new Error(problems.slice(0, 6).join("; "));
});

const machineRoot = join(ROOT, "src", "machine");
const webMachineTestRoot = join(ROOT, "tests", "webMachine");
const webMachineSourceRoots = [machineRoot, webMachineTestRoot];
// 엔진·브라우저를 모르는 순수 집합. 옛 @web-machine/core의 경계가 파일 불변식으로 남는다
// (폴더가 아니라 파일인 이유: snapshotEnvelope/machineManifest는 image/에 살지만 계약 층이다.
//  contracts와 host가 이 둘을 import하는 것이 실측 edge라 폴더 단위 rank는 성립하지 않는다).
const machinePureFiles = new Set([
  "src/machine/contracts/adapterContract.js",
  "src/machine/contracts/operationControl.js",
  "src/machine/contracts/webMachineError.js",
  "src/machine/host/commandQueue.js",
  "src/machine/host/machineHandle.js",
  "src/machine/host/webMachineHost.js",
  "src/machine/image/machineManifest.js",
  "src/machine/image/snapshotEnvelope.js",
]);
// 층위 = 옛 package 소속. pure(0: 옛 core) <- platform(1: 옛 browser) <- guests(2) <- composition(3).
const machineFileRank = (relPath) => {
  if (machinePureFiles.has(relPath)) return 0;
  const folder = relPath.split("/")[2];
  if (folder === "guests") return 2;
  if (folder === "composition") return 3;
  return 1;
};

check("Web Machine 층과 검증 트리 구조 고정", () => {
  // packages/ 감옥은 철거됐다. 플랫폼은 pyproc의 machine 층이다.
  if (existsSync(join(ROOT, "packages"))) throw new Error("packages/ 잔존: Web Machine은 src/machine 층이다");
  const entries = readdirSync(machineRoot).sort();
  const expected = ["composition", "contracts", "coordination", "devices", "guests", "host", "image", "index.d.ts", "index.js", "persistence"];
  if (entries.join("\n") !== expected.join("\n")) throw new Error(`machine 층 경계 불일치: ${entries.join(", ")}`);
  const testEntries = readdirSync(webMachineTestRoot).sort();
  const expectedTestEntries = ["README.md", "browser", "contracts", "fixtures"];
  if (testEntries.join("\n") !== expectedTestEntries.join("\n")) throw new Error(`검증 경계 불일치: ${testEntries.join(", ")}`);
  if (readdirSync(join(webMachineTestRoot, "browser")).join("\n") !== "probes") {
    throw new Error("tests/webMachine/browser에는 probes만 둔다");
  }
  const requiredFiles = [
    "tests/webMachine/fixtures/v86/prepareAssets.mjs",
  ];
  const missing = requiredFiles.filter((file) => !existsSync(join(ROOT, file)));
  if (missing.length) throw new Error(`필수 경계 누락: ${missing.join(", ")}`);

  const forbiddenFolderNames = new Set(["utils", "common", "shared", "helpers"]);
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      if (forbiddenFolderNames.has(entry)) throw new Error(`책임 없는 공유 폴더 금지: ${rel(full)}`);
      walk(full);
    }
  };
  for (const root of webMachineSourceRoots) walk(root);
});

check("Web Machine public 표면은 machine 배럴 하나", () => {
  const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  if (rootPackage.workspaces) throw new Error("workspaces 잔존: pyproc은 단일 package다");
  if (rootPackage.exports?.["./machine"] !== "./src/machine/index.js") {
    throw new Error("pyproc/machine subpath가 machine 배럴을 가리켜야 한다");
  }
  const barrelPath = join(machineRoot, "index.js");
  const barrelSource = readFileSync(barrelPath, "utf8");
  if (!barrelSource.trim()) throw new Error("machine 배럴이 비어 있음");
  for (const ref of jsModuleRefs(barrelPath)) {
    if (!ref.spec.startsWith("./") || !ref.spec.endsWith(".js")) throw new Error(`machine 배럴은 자기 층만 export해야 한다: ${ref.spec}`);
    const target = moduleTarget(barrelPath, ref.spec);
    if (!target || !existsSync(target)) throw new Error(`machine 배럴 export 대상 없음: ${ref.spec}`);
  }
  const typesSource = readFileSync(join(machineRoot, "index.d.ts"), "utf8");
  if (!typesSource.trim()) throw new Error("machine type 표면이 비어 있음");
  // 루트 표면: 컴퓨터 진입점 하나를 게시한다
  const rootIndex = readFileSync(join(ROOT, "index.js"), "utf8");
  if (!rootIndex.includes("createWebComputer")) throw new Error("루트 표면에 createWebComputer가 없음");
});
await checkAsync("Web Machine memory MachineStore contract", runMemoryMachineStoreContract);
await checkAsync("Web Computer context swap rollback matrix", runContextSwapContract);
check("Web Machine public type와 runtime store 의미 일치", () => {
  const source = readFileSync(join(machineRoot, "index.d.ts"), "utf8");
  for (const required of [
    "interface GenerationHead",
    "prev: string | null",
    "ownerEpoch: number",
    "class MemoryMachineStore",
    "class IndexedDbMachineStore",
    "Promise<Uint8Array>",
    "WEB_MACHINE_OWNER_STALE",
  ]) {
    if (!source.includes(required) && required !== "WEB_MACHINE_OWNER_STALE") throw new Error(`type contract 누락: ${required}`);
  }
  if (/\bprevious\s*:/.test(source)) throw new Error("GenerationHead previous key 재등장");
  for (const removed of ["MemoryGenerationStore", "IndexedDbGenerationStore", "IndexedDbOwnerEpochStore"]) {
    if (source.includes(removed)) throw new Error(`흡수된 public type 잔존: ${removed}`);
  }
  const memorySource = readFileSync(join(machineRoot, "persistence", "memoryMachineStore.js"), "utf8");
  const indexedSource = readFileSync(join(machineRoot, "persistence", "indexedDbMachineStore.js"), "utf8");
  if (!memorySource.includes("WEB_MACHINE_OWNER_STALE") || !indexedSource.includes("WEB_MACHINE_OWNER_STALE")) {
    throw new Error("MachineStore stale owner runtime contract 누락");
  }
});

check("Web Machine third-party fixture는 미번들 provenance/SBOM 고정", () => {
  const fixtureRoot = join(webMachineTestRoot, "fixtures", "v86");
  const audit = spawnSync(process.execPath, [join(ROOT, "scripts", "assetProvenance.mjs"), "--check"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10000,
  });
  if (audit.status !== 0) throw new Error(audit.stderr || audit.stdout || "fixture SBOM audit 실패");
  const catalog = JSON.parse(readFileSync(join(ROOT, "scripts", "assetCatalog.json"), "utf8"));
  if (catalog.packagePolicy?.thirdPartyBinaryBundling !== "forbidden") throw new Error("third-party binary bundling 금지 정책 없음");
  if (catalog.assets.some((asset) => asset.distribution !== "local-test-only" || !asset.bundleBlockers?.length)) {
    throw new Error("모든 fixture는 local-test-only이고 bundle blocker가 있어야 한다");
  }
  const opaqueGuestAssets = catalog.assets.filter((asset) => asset.role === "guest-image");
  if (!opaqueGuestAssets.length || opaqueGuestAssets.some((asset) => asset.licenseConcluded !== "NOASSERTION")) {
    throw new Error("opaque guest image license를 추정으로 확정하면 안 된다");
  }
  const prepareSource = readFileSync(join(fixtureRoot, "prepareAssets.mjs"), "utf8");
  if (prepareSource.includes("https://") || /[0-9a-f]{64}/.test(prepareSource)) {
    throw new Error("prepareAssets에 URL/hash 중복 금지, assetCatalog가 SSOT");
  }
  const trackedAssets = spawnSync("git", ["ls-files", "tests/webMachine/fixtures/v86/assets"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 5000,
  });
  if (trackedAssets.status !== 0 || trackedAssets.stdout.trim()) throw new Error("third-party fixture binary가 git에 포함됨");
});
check("Web Machine clock/entropy 공급원은 생성자 주입", () => {
  const deviceRoot = join(machineRoot, "devices");
  const clockSource = readFileSync(join(deviceRoot, "browserClockDevice.js"), "utf8");
  const entropySource = readFileSync(join(deviceRoot, "browserEntropyDevice.js"), "utf8");
  if (/\b(?:Date|performance)\s*\.|\b(?:setTimeout|clearTimeout|setInterval|clearInterval)\s*\(/.test(clockSource)) {
    throw new Error("browserClockDevice가 ambient 시간원 또는 scheduler에 직접 접근");
  }
  if (/\b(?:crypto|globalThis|window)\b/.test(entropySource)) {
    throw new Error("browserEntropyDevice가 ambient entropy source에 직접 접근");
  }
});
check("Web Machine host는 guest와 browser 구현을 모름", () => {
  // 옛 @web-machine/core의 경계. 순수 집합(contracts/host + 순수 image 2파일)은
  // 엔진 이름도 브라우저 전역도 모르고, 자기들끼리만 import한다.
  const guestTerms = /\b(?:pyproc|pyodide|wasi|v86|x86|linux|buildroot)\b/i;
  const browserTerms = /\b(?:window|document|navigator|location|indexedDB|localStorage|sessionStorage|caches|fetch|XMLHttpRequest|WebSocket|BroadcastChannel|Worker|SharedWorker|MessageChannel|crypto|performance|Date|setTimeout|setInterval)\b/;
  const problems = [];
  for (const relPath of machinePureFiles) {
    const file = join(ROOT, relPath);
    const source = readFileSync(file, "utf8");
    if (guestTerms.test(source)) problems.push(`${relPath}: guest/engine 이름`);
    if (browserTerms.test(source)) problems.push(`${relPath}: browser 구현 직접 접근`);
    for (const ref of jsModuleRefs(file)) {
      const target = moduleTarget(file, ref.spec);
      if (!target || !machinePureFiles.has(rel(target))) {
        problems.push(`${relPath} -> ${ref.spec}: 순수 집합 밖 import`);
      }
    }
  }
  if (problems.length) throw new Error(problems.slice(0, 8).join("; "));
});
check("Web Machine 층 내부 import는 아래로만", () => {
  // 옛 3개 package 경계가 파일 rank로 남는다: pure(0) <- platform(1) <- guests(2) <- composition(3).
  // 두 강화 조항이 옛 감옥의 실제 규칙이다:
  //  - guests는 pure만 소비한다(옛 guest package는 core barrel만 알았다). platform 직접 접근 금지.
  //  - machine 밖(src/session 등)으로 나가는 것은 조립 지점 composition만 허용된다.
  const problems = [];
  for (const file of collect(machineRoot, [".js"], [])) {
    const fromRel = rel(file);
    if (fromRel === "src/machine/index.js") continue; // 배럴은 표면 게이트가 본다
    const fromRank = machineFileRank(fromRel);
    for (const ref of jsModuleRefs(file)) {
      const target = moduleTarget(file, ref.spec);
      if (!target) { problems.push(`${fromRel} -> ${ref.spec}: bare import 금지`); continue; }
      const targetRel = rel(target);
      if (!targetRel.startsWith("src/machine/")) {
        if (fromRank !== 3) problems.push(`${fromRel} -> ${targetRel}: machine 밖 import는 composition만`);
        continue;
      }
      const toRank = machineFileRank(targetRel);
      if (toRank > fromRank) problems.push(`${fromRel} -> ${targetRel}: rank ${fromRank} -> ${toRank} 위로 향함`);
      else if (fromRank === 2 && toRank === 1) problems.push(`${fromRel} -> ${targetRel}: guest가 platform 직접 소비(pure 계약만 허용)`);
    }
  }
  if (problems.length) throw new Error(problems.slice(0, 8).join("; "));
});
check("Web Machine 장치·지속층은 guest를 모름", () => {
  // 옛 @web-machine/browser의 경계: 장치/지속성/조율은 어떤 게스트 이름도 모른다.
  const guestTerms = /\b(?:pyodide|wasi|v86|x86|buildroot)\b/i;
  const problems = [];
  for (const folder of ["devices", "persistence", "coordination"]) {
    for (const file of collect(join(machineRoot, folder), [".js"], [])) {
      if (guestTerms.test(readFileSync(file, "utf8"))) problems.push(`${rel(file)}: guest/engine 이름`);
    }
  }
  if (problems.length) throw new Error(problems.slice(0, 8).join("; "));
});
check("Web Machine 조립은 composition과 probes에만 존재", () => {
  const problems = [];
  for (const root of webMachineSourceRoots) for (const file of collect(root, [".js", ".mjs", ".html"], [])) {
    if (rel(file).includes("/fixtures/v86/assets/")) continue;
    const source = readFileSync(file, "utf8");
    const fileRel = rel(file);
    if (source.includes(".registerAdapter(")
      && !fileRel.startsWith("tests/webMachine/browser/probes/")
      && !fileRel.startsWith("src/machine/composition/")
      && fileRel !== "src/machine/host/webMachineHost.js") {
      problems.push(fileRel);
    }
  }
  if (problems.length) throw new Error(`composition root 밖 adapter 등록: ${problems.join(", ")}`);
});
check("Web Machine source는 named ESM과 명시 확장자", () => {
  const problems = [];
  for (const root of webMachineSourceRoots) for (const file of collect(root, [".js", ".mjs", ".html"], [])) {
    if (rel(file).includes("/fixtures/v86/assets/")) continue;
    const source = readFileSync(file, "utf8");
    if (/\bexport\s+default\b/.test(source)) problems.push(`${rel(file)}: default export`);
    for (const ref of jsModuleRefs(file)) {
      if (!ref.spec.startsWith(".")) continue;
      const clean = ref.spec.split(/[?#]/)[0];
      if (!/\.(?:js|mjs)$/.test(clean)) problems.push(`${rel(file)} -> ${ref.spec}: 명시 확장자 없음`);
    }
  }
  if (problems.length) throw new Error(problems.slice(0, 8).join("; "));
});
check("Web Machine 검증은 machine 배럴만 소비", () => {
  const problems = [];
  for (const file of collect(webMachineTestRoot, [".js", ".mjs", ".html"], [])) {
    if (rel(file).includes("/fixtures/v86/assets/")) continue;
    for (const ref of jsModuleRefs(file)) {
      const target = moduleTarget(file, ref.spec);
      if (!target) continue;
      const targetRel = rel(target);
      if (targetRel.startsWith("src/machine/") && targetRel !== "src/machine/index.js") {
        problems.push(`${rel(file)} -> ${targetRel}: machine 배럴 밖 deep import`);
      }
    }
  }
  if (problems.length) throw new Error(problems.slice(0, 8).join("; "));
});
check("Web Machine import graph cycle 없음", () => {
  const files = webMachineSourceRoots.flatMap((root) => collect(root, [".js", ".mjs", ".html"], []))
    .filter((file) => !rel(file).includes("/fixtures/v86/assets/"));
  const byRel = new Set(files.map(rel));
  const graph = new Map(files.map((file) => [rel(file), []]));
  for (const file of files) {
    for (const ref of jsModuleRefs(file)) {
      const target = moduleTarget(file, ref.spec);
      if (!target) continue;
      const targetRel = rel(target);
      if (byRel.has(targetRel)) graph.get(rel(file)).push(targetRel);
    }
  }
  const cycles = findCycles(graph);
  if (cycles.length) throw new Error(cycles.slice(0, 4).map((cycle) => cycle.join(" -> ")).join("; "));
});

const webComputerRoot = join(ROOT, "apps", "webComputer");
check("Web Computer 제품 composition root 고정", () => {
  const requiredFiles = [
    "index.html",
    "styles.css",
    "app.js",
    "webComputerRuntime.js",
    "webComputerContext.js",
    "webComputerContextSwap.js",
    "webComputerPersistence.js",
    "machineConfig.js",
    "identityStore.js",
    "imageTrust.js",
    "ps2Keyboard.js",
    "gate.js",
    "assetCatalog.json",
  ];
  const missing = requiredFiles.filter((file) => !existsSync(join(webComputerRoot, file)));
  if (missing.length) throw new Error(`제품 파일 누락: ${missing.join(", ")}`);
  const html = readFileSync(join(webComputerRoot, "index.html"), "utf8");
  for (const id of ["saveButton", "exportButton", "importButton", "pythonCode", "linuxCommand", "linuxDisplay", "trustDialog"]) {
    if (!html.includes(`id="${id}"`)) throw new Error(`제품 UI 누락: ${id}`);
  }
  if (html.includes("importmap") || html.includes("@web-machine")) throw new Error("제품에 죽은 import map 잔존: 공개 표면은 /index.js 하나다");
});

check("Web Computer 제품은 공개 package root만 소비", () => {
  const allowedTargets = new Set([
    "index.js",
    "src/machine/index.js",
  ]);
  const files = collect(webComputerRoot, [".js"], []).filter((file) => !rel(file).includes("/assets/"));
  const problems = [];
  for (const file of files) {
    for (const ref of jsModuleRefs(file)) {
      const target = moduleTarget(file, ref.spec);
      if (!target) {
        problems.push(`${rel(file)} -> ${ref.spec}: 승인되지 않은 bare import`);
        continue;
      }
      const targetRel = rel(target);
      if (targetRel.startsWith("apps/webComputer/")) continue;
      if (!allowedTargets.has(targetRel)) problems.push(`${rel(file)} -> ${targetRel}: 제품 경계 밖 또는 deep import`);
    }
    const source = readFileSync(file, "utf8");
    if (/\btests[\\/]/.test(source)) problems.push(`${rel(file)}: tests 경로 소비`);
  }
  if (problems.length) throw new Error(problems.slice(0, 8).join("; "));
});

// 봉투는 판정이 아니라 출처를 나른다.
//
// guestManifest는 열린 JSON 서브트리라 재귀 정규화 + canonical JSON + contentDigest + 서명을
// 받는다(getWebMachineManifestContent가 machines를 통째로 싣는다). 그래서 provenance는 서명
// 대상이고 변조하면 digest가 어긋난다.
//
// channel은 싣지 않는다. 수신자는 catalog도 자산도 없어서 재계산할 수 없고, 재계산 불가능한
// 판정은 계산이 아니라 선언이다. 게다가 imageTrust가 서명 검증 "전에" manifest를 파싱해
// 신뢰 화면에 쓰므로(gate.js가 소비), 봉투의 channel을 띄우면 공격자 제어 문자열을 제품
// 판정으로 표시하게 된다. 정책: trusted signature는 출처 identity를 증명할 뿐 license
// compliance를 대신하지 않는다.
check("봉투는 출처를 나르고 채널 판정은 나르지 않는다", () => {
  const provenance = readFileSync(join(webComputerRoot, "assetProvenance.js"), "utf8");
  for (const field of ["policyVersion", "catalogId", "sbomDigest"]) {
    if (!provenance.includes(`${field}:`)) throw new Error(`assetProvenance.js: ${field} 누락`);
  }
  if (/\bchannel\s*:/.test(provenance)) throw new Error("assetProvenance.js가 channel 판정을 싣는다(재계산 불가능한 선언 금지)");
  // 게스트 manifest를 만드는 곳들이 채널을 주장하지 않는가. 예전엔 machineConfig가
  // product.channel = "development"를 서명 봉투에 실었고 아무도 안 잡았다.
  for (const file of ["machineConfig.js", "webComputerContext.js"]) {
    const src = readFileSync(join(webComputerRoot, file), "utf8");
    if (/\bchannel\s*:\s*"/.test(src)) throw new Error(`${file}: 게스트 manifest에 channel 주장이 재등장했다`);
  }
  // 두 게스트가 모두 출처를 밝히는가. 침묵하면 증거 없음이 문제 없음으로 읽힌다:
  // pyproc 게스트의 자산은 아직 어떤 catalog도 기술하지 않으므로 부재를 명시로 싣는다.
  const context = readFileSync(join(webComputerRoot, "webComputerContext.js"), "utf8");
  if (!context.includes("UNDESCRIBED_ASSET_PROVENANCE")) throw new Error("pythonOs가 자산 출처를 밝히지 않는다(증거 부재의 침묵 금지)");
  if (!readFileSync(join(webComputerRoot, "machineConfig.js"), "utf8").includes("WEB_COMPUTER_ASSET_PROVENANCE")) {
    throw new Error("linuxOs가 자산 출처를 밝히지 않는다");
  }
  // provenance가 서명 대상 안에 있다는 구조 사실: content가 machines를 통째로 싣는다.
  const manifestSrc = readFileSync(join(machineRoot, "image", "machineManifest.js"), "utf8");
  if (!/machines:\s*normalized\.machines/.test(manifestSrc)) {
    throw new Error("machineManifest: content가 machines를 싣지 않는다(guestManifest.provenance가 서명 밖으로 샌다)");
  }
});

// 지속 정책은 _done 아카이브가 아니라 docs/에 산다(정보 구조 규칙). 그리고 봉투가 나르는
// policyVersion은 그 문서의 버전이어야 한다: 값이 어긋나면 봉투가 없는 정책을 가리킨다.
check("정책 문서의 policyVersion과 봉투가 나르는 값이 같다", () => {
  const policy = readFileSync(join(ROOT, "docs", "operations", "assetProvenance.md"), "utf8");
  const declared = /\*\*policyVersion:\s*(\d+)\.\*\*/.exec(policy);
  if (!declared) throw new Error("docs/operations/assetProvenance.md: policyVersion 선언 없음");
  const catalog = JSON.parse(readFileSync(join(ROOT, "scripts", "assetCatalog.json"), "utf8"));
  if (catalog.webComputer.policyVersion !== Number(declared[1])) {
    throw new Error(`policyVersion 불일치: 문서 ${declared[1]} vs catalog ${catalog.webComputer.policyVersion}`);
  }
  const carried = /policyVersion:\s*(\d+)/.exec(readFileSync(join(webComputerRoot, "assetProvenance.js"), "utf8"));
  if (!carried || Number(carried[1]) !== Number(declared[1])) {
    throw new Error(`봉투가 나르는 policyVersion 불일치: 문서 ${declared[1]} vs 봉투 ${carried && carried[1]}`);
  }
});

check("Web Computer 실행 자산은 검증된 development channel", () => {
  const catalog = JSON.parse(readFileSync(join(webComputerRoot, "assetCatalog.json"), "utf8"));
  if (catalog.schemaVersion !== 1 || catalog.channel !== "development" || catalog.redistribution !== "disabled") {
    throw new Error("제품 asset channel 또는 재배포 정책 불일치");
  }
  const requiredRoles = new Set(["engine-module", "engine-binary", "firmware", "guest-image"]);
  for (const asset of catalog.assets || []) {
    requiredRoles.delete(asset.role);
    if (!/^[0-9a-f]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1) {
      throw new Error(`${asset.name}: hash 또는 byteLength 불일치`);
    }
    if (!asset.licenseConcluded || !asset.provenanceStatus) throw new Error(`${asset.name}: compliance 필드 누락`);
  }
  if (requiredRoles.size) throw new Error(`asset role 누락: ${[...requiredRoles].join(", ")}`);
  const trackedAssets = spawnSync("git", ["ls-files", "apps/webComputer/assets"], { cwd: ROOT, encoding: "utf8", timeout: 5000 });
  if (trackedAssets.status !== 0 || trackedAssets.stdout.trim()) throw new Error("Web Computer binary가 git에 포함됨");
  const packageManifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  if (!packageManifest.scripts?.["assets:web-computer"]?.includes("prepareWebComputerAssets.mjs")) throw new Error("제품 asset 준비 script 누락");
  if (!packageManifest.scripts?.["test:web-computer"]?.includes("webComputerProduct.mjs")) throw new Error("제품 browser E2E script 누락");
});

console.log(`\n결과: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
