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
function jsModuleRefs(file) {
  const src = readFileSync(file, "utf8");
  const refs = [];
  const add = (kind, match) => refs.push({ kind, spec: match[1] });
  for (const m of src.matchAll(/^\s*(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?["']([^"']+)["']/gm)) add("module", m);
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
for (const [name, kind] of [
  ["getPyProcAssetManifest", "function"], ["verifyPyProcAssetIntegrity", "function"], ["PYPROC_ASSET_MANIFEST_VERSION", "number"],
  ["registerPyProcServiceWorker", "function"],
  ["boot", "function"], ["checkEnvironment", "function"], ["bootEnv", "function"], ["runScript", "function"], ["Runtime", "function"], ["MemoryCapability", "function"],
  ["ReactiveController", "function"], ["SyscallBridge", "function"], ["SocketBridge", "function"], ["AsgiServer", "function"], ["VirtualOrigin", "function"], ["Terminal", "function"], ["DeviceFs", "function"], ["FileSystem", "function"], ["Init", "function"], ["MachineJournal", "function"], ["bootSession", "function"], ["openMachine", "function"], ["createMachineKeyPair", "function"], ["exportMachinePublicKey", "function"], ["fingerprintMachinePublicKey", "function"], ["Session", "function"], ["WheelCache", "function"], ["PyProc", "function"], ["SharedKernel", "function"],
  ["bootWasi", "function"], ["WasiSession", "function"], ["MachineContainer", "function"], ["JobControl", "function"], ["KernelElection", "function"], ["openPersistentMachine", "function"],
  ["GpuCompute", "function"], ["GpuArray", "function"], ["GpuBridge", "function"],
  ["PAGE_SIZE", "number"], ["SIGNAL", "object"],
]) {
  check(`export ${name}:${kind}`, () => {
    if (typeof api[name] !== kind) throw new Error(`got ${typeof api[name]}`);
  });
}
check("PAGE_SIZE === 65536", () => { if (api.PAGE_SIZE !== 65536) throw new Error(String(api.PAGE_SIZE)); });
check("asset manifest 형태", () => {
  const m = api.getPyProcAssetManifest({ baseURL: "https://example.test/pkg/" });
  if (m.version !== api.PYPROC_ASSET_MANIFEST_VERSION) throw new Error("version 불일치");
  if (m.packageRoot !== "https://example.test/pkg/") throw new Error("packageRoot 정규화 실패");
  const relRoot = api.getPyProcAssetManifest({ baseURL: "/vendor/pyproc" });
  if (relRoot.packageRoot !== "/vendor/pyproc/") throw new Error("root-relative baseURL 보존 실패");
  if (!relRoot.assets[0].url.startsWith("/vendor/pyproc/src/")) throw new Error("root-relative asset URL 계산 실패");
  if (!m.policy.sameOriginRequired || !m.policy.preserveRelativeImports || !m.policy.runtimePreflight) throw new Error("policy 불충분");
  const roles = new Set(m.assets.map((a) => a.role));
  for (const role of ["processWorker", "sharedKernelHost", "machineWorker", "wasiWorker", "pyprocServiceWorker"])
    if (!roles.has(role)) throw new Error(`role 누락: ${role}`);
  for (const a of m.assets) {
    if (!a.path.startsWith("src/")) throw new Error(`src 밖 자산: ${a.path}`);
    if (!a.url.startsWith("https://example.test/pkg/src/")) throw new Error(`URL 계산 실패: ${a.url}`);
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
  const r = await api.verifyPyProcAssetIntegrity(manifest, { roles: ["processWorker"], fetch: fetchOk });
  if (r.verified !== 1 || r.bytes !== bytes.byteLength || r.files[0] !== path) throw new Error("검증 결과 형식 오류");
  let rejected = false;
  try {
    await api.verifyPyProcAssetIntegrity({ files: [{ ...manifest.files[0], integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }] }, { roles: ["processWorker"], fetch: fetchOk });
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
  const r = await api.registerPyProcServiceWorker(manifest, {
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
  if (u.pathname !== "/src/capabilities/pyprocSw.js") throw new Error(`register 경로 오류: ${calls[0].url}`);
  if (u.searchParams.get("cache") !== "1" || u.searchParams.get("asgi") !== "/pyproc/") throw new Error(`query 오류: ${u.search}`);
  if (u.searchParams.get("coreIntegrity") !== "/pyodide-integrity.json" || u.searchParams.get("coreRequired") !== "0") throw new Error(`coreIntegrity query 오류: ${u.search}`);
  if (calls[0].options.scope !== "/") throw new Error("scope 전달 누락");
  if (r.file !== path || r.integrity.verified !== 1 || r.url !== calls[0].url) throw new Error("반환값 오류");
});
// checkEnvironment는 표준 전역만 읽어 구조화된 진단을 돌려준다(Node에서도 던지지 않는다).
check("checkEnvironment() 진단 형태", () => {
  const r = api.checkEnvironment();
  for (const k of ["ok", "crossOriginIsolated", "sharedArrayBuffer", "jspi"]) if (typeof r[k] !== "boolean") throw new Error(`${k} 형식`);
  if (!Array.isArray(r.issues)) throw new Error("issues 배열 아님");
  for (const it of r.issues) for (const k of ["code", "need", "why", "fix"]) if (typeof it[k] !== "string") throw new Error(`issue.${k} 형식`);
});
// 자가 호스팅(engine-independence P0)의 핀 정합: fetchEngine이 받는 배포판 버전과
// DEFAULT_INDEX(배포 지점의 유일 정의처)가 같은 값이어야 한다. 버전 변경 = 릴리즈 사유.
check("자가 호스팅 핀 정합(fetchEngine == DEFAULT_INDEX)", () => {
  const fe = readFileSync(join(ROOT, "scripts", "fetchEngine.mjs"), "utf8");
  const m = fe.match(/ENGINE_VERSION = "([^"]+)"/);
  if (!m) throw new Error("scripts/fetchEngine.mjs에서 ENGINE_VERSION을 못 찾음");
  const rt = readFileSync(join(ROOT, "src", "runtime", "runtime.js"), "utf8");
  if (!rt.includes(`/v${m[1]}/`)) throw new Error(`DEFAULT_INDEX에 v${m[1]} 없음(핀 불일치)`);
});

// 2) 능력 계약이 런타임 없이도 형태를 갖추는가(메서드 존재).
console.log("\n[계약]");
check("Runtime 메서드", () => {
  const p = api.Runtime.prototype;
  for (const m of ["run", "runAsync", "install", "loadPackages", "loadPackagesFromImports", "setStdout", "setStderr", "freeze", "mountHome", "enableReactive", "enableSyscallBridge", "enableSocketBridge", "enableAsgiServer", "enableTerminal", "enableWheelCache", "enableDeviceFs", "enableInit"])
    if (typeof p[m] !== "function") throw new Error(`missing ${m}`);
});
check("FileSystem 메서드", () => {
  for (const m of ["writeFile", "readFile", "mkdir", "mkdirTree", "readdir", "stat", "exists", "unlink", "rmdir"])
    if (typeof api.FileSystem.prototype[m] !== "function") throw new Error(`FileSystem.${m}`);
});
check("DeviceFs/Init 메서드", () => {
  for (const m of ["install", "track", "refreshClipboard"]) if (typeof api.DeviceFs.prototype[m] !== "function") throw new Error(`DeviceFs.${m}`);
  for (const m of ["install", "resume", "stop"]) if (typeof api.Init.prototype[m] !== "function") throw new Error(`Init.${m}`);
});
check("MachineJournal 메서드", () => {
  for (const m of ["start", "stop", "commit", "pack", "prune", "recover"])
    if (typeof api.MachineJournal.prototype[m] !== "function") throw new Error(`MachineJournal.${m}`);
});
check("MachineJail 메서드", () => {
  for (const m of ["allows", "connectSrc", "csp", "install"])
    if (typeof api.MachineJail.prototype[m] !== "function") throw new Error(`MachineJail.${m}`);
});
check("SharedKernel 메서드", () => {
  const p = api.SharedKernel.prototype;
  for (const m of ["connect", "run", "runAsync", "setGlobal", "status"])
    if (typeof p[m] !== "function") throw new Error(`missing ${m}`);
});
check("VirtualOrigin 메서드", () => {
  const p = api.VirtualOrigin.prototype;
  for (const m of ["bind", "unbind"])
    if (typeof p[m] !== "function") throw new Error(`missing ${m}`);
});
check("PyProc 메서드", () => {
  const p = api.PyProc.prototype;
  for (const m of ["boot", "map", "mapArray", "matmul", "mapSerial", "ps", "kill", "signal", "interrupt", "fork", "exec", "pipe", "lock", "semaphore", "shm", "terminate"])
    if (typeof p[m] !== "function") throw new Error(`missing ${m}`);
});
check("MachineContainer 메서드", () => {
  const p = api.MachineContainer.prototype;
  for (const m of ["spawn", "kill", "install", "terminate"])
    if (typeof p[m] !== "function") throw new Error(`missing ${m}`);
});
check("KernelElection 메서드", () => {
  const p = api.KernelElection.prototype;
  for (const m of ["join", "run", "commit", "ready", "status", "subscribe", "role", "leave"])
    if (typeof p[m] !== "function") throw new Error(`missing ${m}`);
});
check("JobControl 메서드", () => {
  const p = api.JobControl.prototype;
  for (const m of ["boot", "push", "jobs", "fg", "kill", "terminate"])
    if (typeof p[m] !== "function") throw new Error(`missing ${m}`);
});
check("GpuCompute/GpuArray/GpuBridge 메서드", () => {
  if (typeof api.GpuCompute.create !== "function") throw new Error("GpuCompute.create(static)");
  for (const m of ["array", "destroy"]) if (typeof api.GpuCompute.prototype[m] !== "function") throw new Error(`GpuCompute.${m}`);
  for (const m of ["matmul", "map", "binary", "transpose", "reduce", "toArray", "destroy"]) if (typeof api.GpuArray.prototype[m] !== "function") throw new Error(`GpuArray.${m}`);
  for (const m of ["install", "destroy"]) if (typeof api.GpuBridge.prototype[m] !== "function") throw new Error(`GpuBridge.${m}`);
});
check("Runtime.enableGpu", () => { if (typeof api.Runtime.prototype.enableGpu !== "function") throw new Error("Runtime.enableGpu"); });
check("PyProc.repl/exec 메서드", () => {
  const p = api.PyProc.prototype;
  for (const m of ["repl", "exec"]) if (typeof p[m] !== "function") throw new Error(`missing ${m}`);
});
check("SIGNAL 표(POSIX 번호)", () => {
  const s = api.SIGNAL;
  if (s.INT !== 2 || s.TERM !== 15 || s.USR1 !== 10 || s.USR2 !== 12) throw new Error(JSON.stringify(s));
});
check("ReactiveController 메서드", () => {
  const p = api.ReactiveController.prototype;
  for (const m of ["checkpoint", "restore", "restoreLive", "timeTravel", "tree", "storageMB", "saveBase", "loadBase"])
    if (typeof p[m] !== "function") throw new Error(`missing ${m}`);
});
check("WasiSession 메서드", () => {
  const p = api.WasiSession.prototype;
  for (const m of ["run", "get", "set", "checkpoint", "timeTravel", "installWheel", "terminate"])
    if (typeof p[m] !== "function") throw new Error(`missing ${m}`);
});

// 3) em dash(U+2014) 0 - 훅과 같은 스코프(*.md, *.js).
console.log("\n[em dash]");
const EMDASH = String.fromCharCode(0x2014); // 리터럴로 쓰면 이 게이트가 자기 자신에 걸린다
for (const f of collect(ROOT, [".md", ".js", ".mjs"], [])) {
  check(`no em dash: ${rel(f)}`, () => {
    if (readFileSync(f, "utf8").includes(EMDASH)) throw new Error("U+2014 발견");
  });
}

// 3.4) 문서 주체 가드: 문서·주석의 주체는 나다(1인칭/주어 생략). 나를 3인칭 호칭으로
//      지칭하는 표현을 차단한다(커밋 메시지 주체 중립 규칙의 문서판, 2026-07-12 확정).
//      금칙어는 리터럴로 쓰면 이 게이트가 자기 자신에 걸리므로 조립한다.
console.log("\n[문서 주체]");
const OWNER_WORD = ["소유", "자"].join(""); // "소유" + "자"
for (const f of collect(ROOT, [".md", ".js", ".mjs"], [])) {
  check(`주체 중립: ${rel(f)}`, () => {
    if (readFileSync(f, "utf8").includes(OWNER_WORD)) throw new Error("3인칭 호칭 발견");
  });
}

// 3.5) 네이밍 가드: camelCase는 언어 불문이다(JS 문자열 안의 파이썬 포함).
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

// 3.6) 사이트 크롬: 채널(SNS) 행은 라우트마다 고정이고 정의처는 examples/siteChrome.js 하나다.
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
  const plan = readFileSync(join(ROOT, "mainPlan", "browser-os-north-star", "06-speed-comparison.md"), "utf8");
  const docsMap = readFileSync(join(ROOT, "docs", "README.md"), "utf8");
  const initiativeMap = readFileSync(join(ROOT, "mainPlan", "browser-os-north-star", "README.md"), "utf8");
  const speedLab = readFileSync(join(ROOT, "examples", "speedLab.html"), "utf8");
  const speedBench = readFileSync(join(ROOT, "tests", "browser", "speedBench.mjs"), "utf8");
  const benchArtifact = readFileSync(join(ROOT, "tests", "browser", "benchArtifact.mjs"), "utf8");
  const benchArtifacts = readFileSync(join(ROOT, "tests", "browser", "benchArtifacts.mjs"), "utf8");
  const benchCompare = readFileSync(join(ROOT, "tests", "browser", "benchCompare.mjs"), "utf8");
  const pkgForBench = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  for (const term of ["S0", "S0C", "S1", "S1L", "S2", "S3", "S4", "S5", "median", "p95", "raw output", "WebVM", "JupyterLite", "marimo"]) {
    if (!contract.includes(term)) throw new Error(`benchmarking.md 필수 항목 누락: ${term}`);
    if (!plan.includes(term)) throw new Error(`06-speed-comparison.md 필수 항목 누락: ${term}`);
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
  const artifactDir = join(ROOT, "mainPlan", "browser-os-north-star", "benchmarks");
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

// 3.7) 브랜드: 마크 정본은 assets/logo.svg 하나다. 파비콘·헤더 로고·색이 여기서만 나온다.
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

// 4) 타입 선언: 소비자(TypeScript)용 index.d.ts가 공개 표면을 전부 덮는가.
console.log("\n[타입]");
const dts = readFileSync(join(ROOT, "index.d.ts"), "utf8");
for (const sym of ["getPyProcAssetManifest", "verifyPyProcAssetIntegrity", "registerPyProcServiceWorker", "PYPROC_ASSET_MANIFEST_VERSION", "boot", "bootEnv", "runScript", "Runtime", "MemoryCapability", "FileSystem", "ReactiveController", "SyscallBridge", "SocketBridge", "AsgiServer", "VirtualOrigin", "Terminal", "DeviceFs", "Init", "MachineJournal", "Session", "createMachineKeyPair", "exportMachinePublicKey", "fingerprintMachinePublicKey", "WheelCache", "PyProc", "SIGNAL", "KernelElection", "openPersistentMachine", "SharedKernel", "bootWasi", "WasiSession", "PAGE_SIZE"]) {
  check(`d.ts가 ${sym} 선언`, () => {
    if (!new RegExp(`(export (class|function|const) ${sym}\\b)`).test(dts)) throw new Error("선언 없음");
  });
}
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
check("package.json types -> index.d.ts", () => {
  if (pkg.types !== "./index.d.ts") throw new Error(String(pkg.types));
  if (pkg.exports["."].types !== "./index.d.ts") throw new Error("exports['.'].types 누락");
  if (!pkg.files.includes("index.d.ts")) throw new Error("files에 index.d.ts 누락");
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
  const allowed = new Set([".", "./assets", "./runtime", "./reactive", "./syscall-bridge", "./process-os", "./worker"]);
  const keys = Object.keys(pkg.exports);
  for (const key of keys) {
    if (!allowed.has(key)) throw new Error(`승인 안 된 export key: ${key}`);
    if (key.startsWith("./src/")) throw new Error(`src deep export 금지: ${key}`);
  }
  for (const key of allowed) if (!keys.includes(key)) throw new Error(`export key 누락: ${key}`);
  if (pkg.exports["./runtime"] !== "./src/runtime/runtimeApi.js") throw new Error("pyproc/runtime은 runtimeApi.js를 가리켜야 함");
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
check("랜딩 벤치 메시지가 README 계약형 속도 주장과 정합", () => {
  const readmeEn = readFileSync(join(ROOT, "README.md"), "utf8");
  const readmeKo = readFileSync(join(ROOT, "README.ko.md"), "utf8");
  for (const term of [
    'The headline is contract-specific, not "all Python is faster."',
    "Single-kernel NumPy is still ordinary WebAssembly BLAS.",
    "S1 headline: sharded NumPy",
    "S3 browser server",
    "S4 machine resume",
    "S5 immortal machine",
  ]) {
    if (!readmeEn.includes(term)) throw new Error(`README.md 벤치 메시지 누락: ${term}`);
  }
  for (const term of [
    '속도 간판은 "모든 Python이 빠르다"가 아니라 계약별이다.',
    "단일 커널 NumPy는 여전히 일반 WebAssembly BLAS다.",
    "S1 간판: sharded NumPy",
    "S3 browser server",
    "S4 machine resume",
    "S5 immortal machine",
  ]) {
    if (!readmeKo.includes(term)) throw new Error(`README.ko.md 벤치 메시지 누락: ${term}`);
  }
  for (const term of [
    'Speed is contract-specific, not a blanket "all Python is faster" claim.',
    "Single-kernel NumPy remains ordinary WebAssembly BLAS.",
    "S1 sharded NumPy matmul",
    "S3 fetch() to Python ASGI",
    "S4 signed .pymachine",
    "S4 trusted machine open",
    "S5 leader failover",
    "portable machine image",
    "3.95x",
    "18ms",
    "76ms",
    "2.26s",
    "10.8MB",
    "2.89s",
    "3.03s",
  ]) {
    if (!landing.includes(term)) throw new Error(`examples/index.html 벤치 메시지 누락: ${term}`);
  }
  for (const stale of ["5.28x", "numpy sort", "3.4ms", "13.7MB"]) {
    if (landing.includes(stale)) throw new Error(`examples/index.html 낡은 벤치 숫자 잔존: ${stale}`);
  }
});
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
  for (const name of [
    "boot",
    "bootSession",
    "PyProc",
    "JobControl",
    "MachineContainer",
    "VirtualOrigin",
    "DeviceFs",
    "verifyPyProcAssetIntegrity",
    "registerPyProcServiceWorker",
    "openMachine",
    "createMachineKeyPair",
    "exportMachinePublicKey",
    "fingerprintMachinePublicKey",
    "MachineJournal",
    "MachineJail",
    "getPyProcAssetManifest",
  ]) {
    if (!contract.includes("`" + name)) throw new Error(`contract.md consumer coverage export 누락: ${name}`);
    if (!productConsumer.includes(name)) throw new Error(`productConsumer.mjs export 사용 누락: ${name}`);
  }
  for (const term of [
    "pyproc/assets",
    "pyproc/runtime",
    "RuntimeFromSubpath",
    "bootFromSubpath",
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
  const required = ["boot", "Runtime", "ReactiveController", "PyProc", "AsgiServer", "VirtualOrigin", "bootSession", "openMachine", "MachineJournal", "MachineJail", "SocketBridge", "openPersistentMachine", "KernelElection", "SharedKernel", "bootWasi", "GpuCompute", "getPyProcAssetManifest", "checkEnvironment"];
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
    "../../mainPlan/browser-os-north-star/benchmarks/s1-pyproc-2026-07-15.json",
    "../../mainPlan/browser-os-north-star/benchmarks/s3-pyproc-2026-07-15.json",
    "../../mainPlan/browser-os-north-star/benchmarks/s4-pyproc-2026-07-15.json",
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
check("sharedKernel.js가 같은 폴더 host를 연다", () => {
  const src = readFileSync(join(ROOT, "src", "processOs", "sharedKernel.js"), "utf8");
  if (!src.includes('new URL("./sharedKernelHost.js", import.meta.url)')) throw new Error("호스트 상대경로 계약 위반");
});
check("virtualOrigin.js와 pyprocSw.js가 같은 폴더(자산 경로 계약)", () => {
  if (!existsSync(join(ROOT, "src", "capabilities", "pyprocSw.js"))) throw new Error("pyprocSw.js 없음");
  if (!existsSync(join(ROOT, "src", "capabilities", "virtualOrigin.js"))) throw new Error("virtualOrigin.js 없음");
});
check("asset manifest가 실행 자산 경로와 동기화", () => {
  const manifest = api.getPyProcAssetManifest({ baseURL: "https://example.test/pkg/" });
  const byRole = Object.fromEntries(manifest.assets.map((a) => [a.role, a.path]));
  const expected = {
    processWorker: "src/processOs/worker.js",
    sharedKernelHost: "src/processOs/sharedKernelHost.js",
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
    ["src/processOs/sharedKernel.js", 'new URL("./sharedKernelHost.js", import.meta.url)', expected.sharedKernelHost],
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
check("src 레이어 폴더 고정", () => {
  const allowedLayers = new Set(["runtime", "capabilities", "processOs"]);
  for (const f of collect(join(ROOT, "src"), [".js"], [])) {
    const layer = srcLayerName(rel(f));
    if (!allowedLayers.has(layer)) throw new Error(`승인 안 된 src 레이어: ${rel(f)}`);
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
check("Runtime public wrapper는 capability registry만 import", () => {
  const src = readFileSync(join(ROOT, "src", "runtime", "runtime.js"), "utf8");
  if (src.includes("../capabilities/")) throw new Error("runtime.js가 capabilities를 직접 import함");
  const apiSrc = readFileSync(join(ROOT, "src", "runtime", "runtimeApi.js"), "utf8");
  if (!apiSrc.includes("../capabilities/runtimeBindings.js")) throw new Error("runtimeApi.js가 runtimeBindings registry를 import하지 않음");
  for (const spec of ["reactive", "syscallBridge", "socketBridge", "asgiServer", "wheelCache", "terminal", "deviceFs", "init", "machineJournal", "gpuCompute"]) {
    if (apiSrc.includes(`../capabilities/${spec}.js`)) throw new Error(`runtimeApi.js가 capability class를 직접 import함: ${spec}`);
  }
  const registrySrc = readFileSync(join(ROOT, "src", "capabilities", "runtimeBindings.js"), "utf8");
  for (const term of ["installRuntimeCapabilities", "enableReactive", "enableSyscallBridge", "enableAsgiServer", "enableGpu"]) {
    if (!apiSrc.includes(term) && !registrySrc.includes(term)) throw new Error(`runtime capability binding 누락: ${term}`);
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
check("src layer edge 승인 목록", () => {
  const allowedCrossLayer = new Set([
    "module:processOs->runtime",
    "module:processOs->capabilities",
  ]);
  const exactCrossLayer = new Map([
    ["module:runtime->capabilities", new Set([
      "src/runtime/runtimeApi.js -> src/capabilities/runtimeBindings.js",
    ])],
    ["module:capabilities->runtime", new Set([
      "src/capabilities/envManager.js -> src/runtime/runtimeApi.js",
      "src/capabilities/envManager.js -> src/runtime/engines/pyodideEngine.js",
      "src/capabilities/machineJournal.js -> src/runtime/memoryLayout.js",
      "src/capabilities/reactive.js -> src/runtime/memoryLayout.js",
      "src/capabilities/session.js -> src/runtime/runtimeApi.js",
      "src/capabilities/session.js -> src/runtime/memoryLayout.js",
      "src/capabilities/syscallBridge.js -> src/runtime/assets.js",
    ])],
    ["newURL:capabilities->processOs", new Set([
      "src/capabilities/syscallBridge.js -> src/processOs/worker.js",
    ])],
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
      const key = `${ref.kind}:${fromLayer}->${toLayer}`;
      const pair = `${rel(f)} -> ${targetRel}`;
      if (exactCrossLayer.has(key)) {
        if (!exactCrossLayer.get(key).has(pair)) problems.push(`${pair} (${key}, 정확 승인 목록 밖)`);
        continue;
      }
      if (!allowedCrossLayer.has(key)) problems.push(`${rel(f)} -> ${ref.spec} (${key})`);
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

const webMachineRoot = join(ROOT, "tests", "attempts", "webMachine");
check("Web Machine attempts 레이어 구조 고정", () => {
  const allowedRootEntries = new Set(["README.md", "host", "browser", "adapters", "fixtures", "probes"]);
  const rootEntries = readdirSync(webMachineRoot);
  const unexpected = rootEntries.filter((entry) => !allowedRootEntries.has(entry));
  if (unexpected.length) throw new Error(`root dump 금지: ${unexpected.join(", ")}`);
  for (const entry of allowedRootEntries) {
    if (!rootEntries.includes(entry)) throw new Error(`필수 경계 없음: ${entry}`);
  }
  const requiredHostFiles = ["adapterContract.js", "snapshotEnvelope.js", "webMachineError.js", "webMachineHostDraft.js"];
  for (const file of requiredHostFiles) {
    if (!existsSync(join(webMachineRoot, "host", file))) throw new Error(`host 계약 누락: ${file}`);
  }
  const requiredBrowserDevices = ["memoryBlockDevice.js", "memoryEthernetSwitch.js"];
  for (const file of requiredBrowserDevices) {
    if (!existsSync(join(webMachineRoot, "browser", "devices", file))) throw new Error(`browser device 계약 누락: ${file}`);
  }
  const requiredV86Bridges = ["v86BlockBuffer.js", "v86FileSystemVolume.js", "v86PacketPort.js"];
  for (const file of requiredV86Bridges) {
    if (!existsSync(join(webMachineRoot, "adapters", "v86", file))) throw new Error(`v86 bridge 계약 누락: ${file}`);
  }
  const forbiddenFolderNames = new Set(["utils", "common", "shared", "helpers"]);
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (!statSync(full).isDirectory()) continue;
      if (forbiddenFolderNames.has(entry)) throw new Error(`책임 없는 공유 폴더 금지: ${rel(full)}`);
      walk(full);
    }
  };
  walk(webMachineRoot);
});
check("Web Machine host는 guest와 browser 구현을 모름", () => {
  const hostRoot = join(webMachineRoot, "host");
  const guestTerms = /\b(?:pyproc|pyodide|wasi|v86|x86|linux|buildroot)\b/i;
  const browserTerms = /\b(?:window|document|navigator|location|indexedDB|localStorage|sessionStorage|caches|fetch|XMLHttpRequest|WebSocket|BroadcastChannel|Worker|SharedWorker|MessageChannel|crypto|performance|Date|setTimeout|setInterval)\b/;
  const problems = [];
  for (const file of collect(hostRoot, [".js"], [])) {
    const source = readFileSync(file, "utf8");
    if (guestTerms.test(source)) problems.push(`${rel(file)}: guest/engine 이름`);
    if (browserTerms.test(source)) problems.push(`${rel(file)}: browser 구현 직접 접근`);
    for (const ref of jsModuleRefs(file)) {
      const target = moduleTarget(file, ref.spec);
      if (!target || !rel(target).startsWith("tests/attempts/webMachine/host/")) {
        problems.push(`${rel(file)} -> ${ref.spec}: host 밖 import`);
      }
    }
  }
  if (problems.length) throw new Error(problems.slice(0, 8).join("; "));
});
check("Web Machine adapter 경계와 공개 surface", () => {
  const adapterRoot = join(webMachineRoot, "adapters");
  const problems = [];
  for (const file of collect(adapterRoot, [".js"], [])) {
    const sourceRel = rel(file);
    const sourceName = sourceRel.match(/\/adapters\/([^/]+?)(?:GuestAdapter\.js|\/)/)?.[1] || null;
    for (const ref of jsModuleRefs(file)) {
      const target = moduleTarget(file, ref.spec);
      if (!target) {
        problems.push(`${rel(file)} -> ${ref.spec}: engine은 외부 주입 필요`);
        continue;
      }
      const targetRel = rel(target);
      if (targetRel.startsWith("tests/attempts/webMachine/adapters/")) {
        const targetName = targetRel.match(/\/adapters\/([^/]+?)(?:GuestAdapter\.js|\/)/)?.[1] || null;
        if (!sourceName || sourceName !== targetName) problems.push(`${sourceRel} -> ${targetRel}: adapter 사이 import`);
      }
      else if (targetRel !== "index.js") problems.push(`${rel(file)} -> ${targetRel}: 공개 root 이외 import`);
    }
    if (readFileSync(file, "utf8").includes("/src/")) problems.push(`${rel(file)}: src deep import`);
  }
  if (problems.length) throw new Error(problems.slice(0, 8).join("; "));
});
check("Web Machine browser는 host 방향으로만 의존", () => {
  const browserRoot = join(webMachineRoot, "browser");
  const guestTerms = /\b(?:pyproc|pyodide|wasi|v86|x86|linux|buildroot)\b/i;
  const problems = [];
  for (const file of collect(browserRoot, [".js", ".mjs"], [])) {
    const source = readFileSync(file, "utf8");
    if (guestTerms.test(source)) problems.push(`${rel(file)}: guest/engine 이름`);
    for (const ref of jsModuleRefs(file)) {
      const target = moduleTarget(file, ref.spec);
      if (!target) {
        problems.push(`${rel(file)} -> ${ref.spec}: 외부 import`);
        continue;
      }
      const targetRel = rel(target);
      if (!targetRel.startsWith("tests/attempts/webMachine/browser/") && !targetRel.startsWith("tests/attempts/webMachine/host/")) {
        problems.push(`${rel(file)} -> ${targetRel}: browser 역방향 import`);
      }
    }
  }
  if (problems.length) throw new Error(problems.slice(0, 8).join("; "));
});
check("Web Machine 조립은 probes에만 존재", () => {
  const problems = [];
  for (const file of collect(webMachineRoot, [".js", ".mjs", ".html"], [])) {
    if (rel(file).includes("/fixtures/v86/assets/")) continue;
    const source = readFileSync(file, "utf8");
    if (source.includes(".registerAdapter(") && !rel(file).startsWith("tests/attempts/webMachine/probes/")) {
      problems.push(rel(file));
    }
  }
  if (problems.length) throw new Error(`composition root 밖 adapter 등록: ${problems.join(", ")}`);
});
check("Web Machine source는 named ESM과 명시 확장자", () => {
  const problems = [];
  for (const file of collect(webMachineRoot, [".js", ".mjs", ".html"], [])) {
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
check("Web Machine import graph cycle 없음", () => {
  const files = collect(webMachineRoot, [".js", ".mjs", ".html"], [])
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

console.log(`\n결과: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
