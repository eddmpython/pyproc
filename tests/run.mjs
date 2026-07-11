// tests/run.mjs - pyproc 구조/린트 게이트. Node 전용, 의존성 0.
// WASM 런타임 진짜 검증은 브라우저에서만 가능(docs/operations/testing.md). 여기서는 브라우저
// 없이 확인 가능한 것만 본다: 공개 표면·타입, em dash 0, 상대 링크 생존, 구조 불변식.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (name) => { passed++; console.log(`  PASS ${name}`); };
const bad = (name, msg) => { failed++; console.log(`  FAIL ${name}: ${msg}`); };
function check(name, fn) { try { fn(); ok(name); } catch (e) { bad(name, e.message); } }

// 재귀로 지정 확장자 파일 수집(node_modules 제외).
function collect(dir, exts, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".git")) continue;
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
  ["boot", "function"], ["Runtime", "function"], ["MemoryCapability", "function"],
  ["ReactiveController", "function"], ["SyscallBridge", "function"], ["AsgiServer", "function"], ["Terminal", "function"], ["bootSession", "function"], ["Session", "function"], ["WheelCache", "function"], ["PyProc", "function"],
  ["PAGE_SIZE", "number"],
]) {
  check(`export ${name}:${kind}`, () => {
    if (typeof api[name] !== kind) throw new Error(`got ${typeof api[name]}`);
  });
}
check("PAGE_SIZE === 65536", () => { if (api.PAGE_SIZE !== 65536) throw new Error(String(api.PAGE_SIZE)); });

// 2) 능력 계약이 런타임 없이도 형태를 갖추는가(메서드 존재).
console.log("\n[계약]");
check("Runtime 메서드", () => {
  const p = api.Runtime.prototype;
  for (const m of ["run", "runAsync", "install", "loadPackages", "enableReactive", "enableSyscallBridge", "enableAsgiServer", "enableTerminal", "enableWheelCache"])
    if (typeof p[m] !== "function") throw new Error(`missing ${m}`);
});
check("PyProc 메서드", () => {
  const p = api.PyProc.prototype;
  for (const m of ["boot", "map", "mapSerial", "ps", "kill", "interrupt", "terminate"])
    if (typeof p[m] !== "function") throw new Error(`missing ${m}`);
});
check("ReactiveController 메서드", () => {
  const p = api.ReactiveController.prototype;
  for (const m of ["checkpoint", "restore", "restoreLive", "timeTravel", "storageMB", "saveBase", "loadBase"])
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

// 4) 타입 선언: 소비자(TypeScript)용 index.d.ts가 공개 표면을 전부 덮는가.
console.log("\n[타입]");
const dts = readFileSync(join(ROOT, "index.d.ts"), "utf8");
for (const sym of ["boot", "Runtime", "MemoryCapability", "ReactiveController", "SyscallBridge", "AsgiServer", "Terminal", "Session", "WheelCache", "PyProc", "PAGE_SIZE"]) {
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

// 6) 상대 링크 생존: 모든 *.md의 상대 링크가 실존 경로를 가리키는가(죽은 링크 차단).
//    코드 펜스 안은 예제라 제외. http(s)/mailto/앵커 전용 링크 제외.
console.log("\n[링크]");
for (const f of collect(ROOT, [".md"], [])) {
  check(`links ok: ${rel(f)}`, () => {
    const text = readFileSync(f, "utf8").replace(/```[\s\S]*?```/g, "");
    const dead = [];
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const path = resolve(dirname(f), target.split("#")[0]);
      if (!existsSync(path)) dead.push(target);
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
