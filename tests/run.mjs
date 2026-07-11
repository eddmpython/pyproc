// tests/run.mjs - pyproc 구조/린트 게이트. Node 전용, 의존성 0.
// WASM 런타임 진짜 검증은 브라우저에서만 가능(examples/). 여기서는 브라우저 없이
// 확인 가능한 것만 본다: 공개 표면 존재·타입, em dash 0, worker 계약.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const ok = (name) => { passed++; console.log(`  PASS ${name}`); };
const bad = (name, msg) => { failed++; console.log(`  FAIL ${name}: ${msg}`); };
function check(name, fn) { try { fn(); ok(name); } catch (e) { bad(name, e.message); } }

// 재귀로 *.md / *.js 파일 수집(node_modules 제외).
function collect(dir, exts, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".git")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, exts, acc);
    else if (exts.some((e) => entry.endsWith(e))) acc.push(full);
  }
  return acc;
}

console.log("pyproc 게이트\n");

// 1) 공개 표면: index.js가 기대 export를 내는가.
console.log("[표면]");
const api = await import(pathToFileURL(join(ROOT, "index.js")).href);
for (const [name, kind] of [
  ["boot", "function"], ["Runtime", "function"], ["MemoryCapability", "function"],
  ["ReactiveController", "function"], ["SyscallBridge", "function"], ["PyProc", "function"],
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
  for (const m of ["run", "runAsync", "install", "loadPackages", "enableReactive", "enableSyscallBridge"])
    if (typeof p[m] !== "function") throw new Error(`missing ${m}`);
});
check("PyProc 메서드", () => {
  const p = api.PyProc.prototype;
  for (const m of ["boot", "map", "mapSerial", "ps", "terminate"])
    if (typeof p[m] !== "function") throw new Error(`missing ${m}`);
});
check("ReactiveController 메서드", () => {
  const p = api.ReactiveController.prototype;
  for (const m of ["checkpoint", "restore", "restoreLive", "timeTravel", "storageMB"])
    if (typeof p[m] !== "function") throw new Error(`missing ${m}`);
});

// 3) em dash(U+2014) 0 - 훅과 같은 스코프(*.md, *.js).
console.log("\n[em dash]");
const EMDASH = "—";
for (const f of collect(ROOT, [".md", ".js"], [])) {
  const rel = f.slice(ROOT.length + 1);
  check(`no em dash: ${rel}`, () => {
    if (readFileSync(f, "utf8").includes(EMDASH)) throw new Error("U+2014 발견");
  });
}

// 4) worker 계약: Node import 불가(onmessage 전역)라 텍스트로 확인.
console.log("\n[worker]");
check("worker.js가 boot/task 처리", () => {
  const src = readFileSync(join(ROOT, "src", "worker.js"), "utf8");
  if (!src.includes("onmessage")) throw new Error("onmessage 핸들러 없음");
  if (!src.includes('"boot"') || !src.includes('"task"')) throw new Error("boot/task 분기 없음");
});

console.log(`\n결과: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
