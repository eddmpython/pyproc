// tests/run.mjs - pyproc 구조/린트 게이트. Node 전용, 의존성 0.
// WASM 런타임 진짜 검증은 브라우저에서만 가능(docs/operations/testing.md). 여기서는 브라우저
// 없이 확인 가능한 것만 본다: 공개 표면·타입, em dash 0, 상대 링크 생존, 구조 불변식.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (name) => { passed++; console.log(`  PASS ${name}`); };
const bad = (name, msg) => { failed++; console.log(`  FAIL ${name}: ${msg}`); };
function check(name, fn) { try { fn(); ok(name); } catch (e) { bad(name, e.message); } }

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

console.log("pyproc 게이트\n");

// 1) 공개 표면: index.js가 기대 export를 내는가.
console.log("[표면]");
const api = await import(pathToFileURL(join(ROOT, "index.js")).href);
for (const [name, kind] of [
  ["boot", "function"], ["checkEnvironment", "function"], ["bootEnv", "function"], ["runScript", "function"], ["Runtime", "function"], ["MemoryCapability", "function"],
  ["ReactiveController", "function"], ["SyscallBridge", "function"], ["SocketBridge", "function"], ["AsgiServer", "function"], ["VirtualOrigin", "function"], ["Terminal", "function"], ["DeviceFs", "function"], ["FileSystem", "function"], ["Init", "function"], ["MachineJournal", "function"], ["bootSession", "function"], ["openMachine", "function"], ["Session", "function"], ["WheelCache", "function"], ["PyProc", "function"], ["SharedKernel", "function"],
  ["bootWasi", "function"], ["WasiSession", "function"], ["MachineContainer", "function"], ["JobControl", "function"], ["KernelElection", "function"],
  ["GpuCompute", "function"], ["GpuArray", "function"], ["GpuBridge", "function"],
  ["PAGE_SIZE", "number"], ["SIGNAL", "object"],
]) {
  check(`export ${name}:${kind}`, () => {
    if (typeof api[name] !== kind) throw new Error(`got ${typeof api[name]}`);
  });
}
check("PAGE_SIZE === 65536", () => { if (api.PAGE_SIZE !== 65536) throw new Error(String(api.PAGE_SIZE)); });
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
  for (const m of ["install", "stop"]) if (typeof api.Init.prototype[m] !== "function") throw new Error(`Init.${m}`);
});
check("MachineJournal 메서드", () => {
  for (const m of ["start", "stop", "commit", "recover"])
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
  for (const m of ["join", "run", "commit", "role", "leave"])
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
for (const f of collect(join(ROOT, "examples"), [".html"], [])) {
  check(`채널 행 고정: ${rel(f)}`, () => {
    const html = readFileSync(f, "utf8");
    if (!html.includes("<sns-links></sns-links>")) throw new Error("<sns-links> 없음");
    if (!/<script type="module" src="(examples\/)?siteChrome\.js"><\/script>/.test(html))
      throw new Error("siteChrome.js 모듈 스크립트 없음");
    if (html.includes("snsBtn")) throw new Error("채널 마크업 인라인 복제(SSOT 우회)");
  });
}

// 4) 타입 선언: 소비자(TypeScript)용 index.d.ts가 공개 표면을 전부 덮는가.
console.log("\n[타입]");
const dts = readFileSync(join(ROOT, "index.d.ts"), "utf8");
for (const sym of ["boot", "bootEnv", "runScript", "Runtime", "MemoryCapability", "FileSystem", "ReactiveController", "SyscallBridge", "SocketBridge", "AsgiServer", "VirtualOrigin", "Terminal", "DeviceFs", "Init", "MachineJournal", "Session", "WheelCache", "PyProc", "SIGNAL", "SharedKernel", "bootWasi", "WasiSession", "PAGE_SIZE"]) {
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
check("exports 경로 실존", () => {
  for (const [sub, target] of Object.entries(pkg.exports)) {
    const t = typeof target === "string" ? target : target.default;
    if (!existsSync(join(ROOT, t))) throw new Error(`${sub} -> ${t} 없음`);
  }
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

console.log(`\n결과: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
