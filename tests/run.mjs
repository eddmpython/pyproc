// tests/run.mjs - pyproc 구조/린트 게이트. Node 전용, 의존성 0.
// WASM 런타임 진짜 검증은 브라우저에서만 가능(docs/operations/testing.md). 여기서는 브라우저
// 없이 확인 가능한 것만 본다: 공개 표면·타입, em dash 0, 상대 링크 생존, 구조 불변식.
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { containsToolAttribution, containsTraceTerm } from "../scripts/commitMessage.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { runContractSuites } from "./contracts/run.mjs";
import { createGateCounter } from "./support/gateCounter.mjs";
import { mulberry32 } from "./support/seededRandom.mjs";
import { assertHashSoundness } from "./support/hashSoundness.mjs";
import { assertEnvelopeBoundary } from "./support/envelopeBoundary.mjs";
import { assertReactiveTree } from "./support/reactiveTree.mjs";
import { assertElectionProtocol } from "./support/electionProtocol.mjs";
import { assertWebComputerStructure } from "./support/structureWebComputer.mjs";
import { assertDocLifecycleStructure } from "./support/structureDocLifecycle.mjs";
import { assertWebMachineStructure } from "./support/structureWebMachine.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const gate = createGateCounter();
const { check, checkAsync, section } = gate;
const trackedResult = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: ROOT,
  encoding: "utf8",
  timeout: 10000,
});
if (trackedResult.status !== 0) throw new Error(trackedResult.stderr || "검사 표면을 읽지 못했다");
const repositorySurfaceFiles = new Set(trackedResult.stdout.split("\0").filter(Boolean).map((file) => file.replaceAll("\\", "/")));

// 재귀로 지정 확장자 파일 수집(node_modules와 생성 cache 제외).
function collect(dir, exts, acc = []) {
  for (const entry of readdirSync(dir)) {
    // vendor/는 fetchEngine이 받은 서드파티 배포판(gitignore) = 우리 린트 표면이 아니다.
    // .cache/도 빌드 증거와 내려받은 release 문서가 쌓이는 gitignore 산출물이다. 이를 세면
    // 로컬 검사 수가 깨끗한 CI보다 커져 파일 삭제 하한을 거짓으로 만족시킨다.
    // mainPlan/은 착수 전 계획이 사는 작업 공간이다. 아직 없는 파일 경로와 신설 예정 심볼을 참조하는
    // 것이 그 문서의 일이므로 링크 생존과 문서 법의 대상이 아니다. 계획이 끝나면 폴더째 사라진다.
    if (entry === "node_modules" || entry === "vendor" || entry === ".cache" || entry === "mainPlan" || entry.startsWith(".git")) continue;
    const full = join(dir, entry);
    // assets/ 디렉터리는 엔진 배포판과 바이너리 fixture가 사는 곳(전부 gitignore)이다.
    // vendor/와 같은 이유로 린트 표면 밖이다. 파일 assets.js는 이 규칙에 걸리지 않는다.
    if (statSync(full).isDirectory() && entry === "assets") continue;
    if (statSync(full).isDirectory()) collect(full, exts, acc);
    else {
      const relative = full.slice(ROOT.length + 1).replaceAll("\\", "/");
      if (repositorySurfaceFiles.has(relative) && exts.some((e) => entry.endsWith(e))) acc.push(full);
    }
  }
  return acc;
}
const rel = (f) => f.slice(ROOT.length + 1).replaceAll("\\", "/");
// 문서가 어떤 공개 심볼을 "언급했는가"의 판정. 접두 substring(`text.includes("`" + name)`)으로
// 보면 `openMachine`이 `open`을, `bootSession`이 `boot`를 만족시켜서, 루트 동사가 문서에서
// 완전히 사라져도 게이트가 통과한다(2026-07-26 실측). 백틱 뒤 이름이 식별자 문자로 이어지지
// 않을 때만 언급으로 센다: `open`, `open()`, `open({ ... })`는 통과, `openMachine`은 아니다.
// 법 검사들의 공용 전처리: 줄 주석 제거. 법의 근거를 주석에 쓰는 것 자체가 위반이 되면
// 안 되므로 모든 "소스를 좁히는" 검사가 이 함수를 지난다.
const NEWLINE = String.fromCharCode(10);
// 문자열 리터럴 안의 `//`는 주석이 아니다. `line.split("//")[0]`이던 판정은 URL을 담은 줄을
// 통째로 잘라내, 그 뒤에 있는 것을 모든 법에서 보이지 않게 만들었다(실측 2026-07-27: 7줄이
// 이미 중간에서 잘려 있었다. 잃은 것이 지금은 URL 꼬리지만, 같은 줄에 `atob(`나
// `new SharedArrayBuffer(`를 두면 코덱 법·SAB 가드가 그것을 못 본다). 인용 상태를 추적한다.
function stripComments(source) {
  const out = [];
  for (const line of source.split(NEWLINE)) {
    let quote = null;
    let cut = line.length;
    for (let at = 0; at < line.length; at++) {
      const ch = line[at];
      if (quote) {
        if (ch === "\\") { at++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
      if (ch === "/" && line[at + 1] === "/") { cut = at; break; }
    }
    out.push(line.slice(0, cut));
  }
  return out.join(NEWLINE);
}
function mentionsSymbol(text, name) {
  // 정규식 조립 대신 스캔이다: 이름에 든 특수문자 이스케이프와 문자 클래스의 이중 이스케이프가
  // 정확히 이 게이트가 잡으려는 종류의 조용한 무력화를 만든다(실제로 한 번 만들었다).
  const needle = "`" + name;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    const next = text[at + needle.length];
    if (next === undefined || !/[\w$]/.test(next)) return true;
  }
  return false;
}
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
  // 워커 스폰이 리터럴이 아니면 그래프에도 게이트에도 안 나타난다. "상향 자산 edge는 하나"라는
  // 규칙의 실효 범위가 리터럴 newURL에 한정돼 있었고, 주입된 workerURL로 스폰하는 어댑터가
  // 이미 트리에 있다. 정적으로 못 푸는 스폰은 선언 목록에 등재돼야 통과한다.
  for (const m of src.matchAll(/new\s+(?:Shared)?Worker\s*\(\s*([A-Za-z_$][\w$.]*)\s*[,)]/g)) refs.push({ kind: "workerSpawn", spec: m[1] });
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

function workflowSources() {
  const dir = join(ROOT, ".github", "workflows");
  return new Map(readdirSync(dir).filter((f) => f.endsWith(".yml"))
    .map((f) => [f, readFileSync(join(dir, f), "utf8").replaceAll("\r\n", "\n")]));
}
// "무엇이 실제 실행 경로인가"의 판정. [북극성]과 [CI 배관] 두 절이 같은 답을 써야 한다
// (사본이 둘이면 한쪽만 고쳐지고 갈라진다). 실행 경로는 npm script, 워크플로의 실행 라인,
// tests의 러너 소스뿐이다. 주석은 실행이 아니다: CI 주석 한 줄에 적힌 script 이름이 그 레인
// 전체를 초록으로 만들 수 있었다.
function executableCorpus() {
  const scripts = Object.values(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts || {}).join(NEWLINE);
  const workflowRunLines = [...workflowSources().values()].flatMap((source) => source.split(NEWLINE))
    .filter((line) => /^\s*-?\s*run:/.test(line) || /^\s+(npm|node)\s/.test(line))
    .filter((line) => !/^\s*#/.test(line));
  // 북극성 원장은 증거 목록이지 실행 경로가 아니다. corpus에 넣으면 "여기 적혔으니 돈다"가 되어
  // 고아 페이지 검사가 자기 눈을 가린다(원장에 적는 것만으로 페이지가 실행된 것이 된다).
  const runnerSources = collect(join(ROOT, "tests"), [".mjs"], [])
    .filter((f) => rel(f) !== "tests/northStar.mjs")
    .map((f) => stripComments(readFileSync(f, "utf8")));
  return [scripts, ...workflowRunLines, ...runnerSources].join(NEWLINE);
}

console.log("pyproc 게이트\n");

// 1) 공개 표면: index.js가 기대 export를 내는가.
section("표면");
const api = await import(pathToFileURL(join(ROOT, "index.js")).href);
const installedPackageCoverage = await import(pathToFileURL(join(ROOT, "tests", "browser", "installedPackageCoverage.mjs")).href);
const { runMemoryMachineStoreContract } = await import(pathToFileURL(join(ROOT, "tests", "webMachine", "contracts", "machineStoreContract.mjs")).href);
const { runDurableComputerContract } = await import(pathToFileURL(join(ROOT, "tests", "webMachine", "contracts", "durableComputerContract.mjs")).href);
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
const journalApi = await import(pathToFileURL(join(ROOT, "src", "capabilities", "journal", "machineJournal.js")).href);
const distributionApi = await import(pathToFileURL(join(ROOT, "src", "runtime", "pyodideDistribution.js")).href);
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
// 선언이 뒤따르지 않는 독스트링 블록은 아무것도 설명하지 않는다. IDE는 그 문장을 엉뚱한
// 심볼에 붙여 보여주므로(실측: TerminalConfig에 멀티탭 머신 설명이 붙었다) 손유지 d.ts에서
// 이 잔해는 오해를 만든다. 0.0.10 개명 뒤 12개가 남아 있었다.
check("index.d.ts에 고아 독스트링 0", () => {
  const lines = readFileSync(join(ROOT, "index.d.ts"), "utf8").split(NEWLINE);
  const orphans = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim().startsWith("/**")) continue;
    let j = i;
    while (j < lines.length && !lines[j].includes("*/")) j++;
    const next = (lines[j + 1] || "").trim();
    if (!next || next.startsWith("/**") || next.startsWith("}")) orphans.push(i + 1);
    i = j;
  }
  if (orphans.length) throw new Error(`선언 없는 독스트링: L${orphans.slice(0, 6).join(", L")}`);
});
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
await checkAsync("자동 발견 contract suites", async () => { await runContractSuites(); });
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
  for (const role of ["processWorker", "machineWorker", "wasiWorker", "workerHostedGuestWorker", "pyprocServiceWorker"])
    if (!roles.has(role)) throw new Error("role 누락: " + role);
  for (const a of m.assets) {
    if (!a.path.startsWith("src/")) throw new Error("src 밖 자산: " + a.path);
    if (!a.url.startsWith("https://example.test/pkg/src/")) throw new Error("URL 계산 실패: " + a.url);
  }
});
// 역방향 대조. 위 검사는 등재된 role의 "존재"만 보므로 누락을 구조적으로 못 본다: 실제로
// createWebComputer가 스폰하는 workerHostedGuestWorker.js가 그렇게 빠져 있었고, 소비자가
// 매니페스트대로 배포하면 그 워커만 same-origin 배치도 SRI preflight도 못 받았다.
// 스코프의 한계를 명시한다: newURL로 스폰되는 워커 자산만 자동 대조한다. Service Worker는
// 등록 URL로 가고, 주입된 workerURL로 스폰하는 어댑터는 정적으로 풀리지 않는다.
check("asset manifest 역방향 대조: src가 스폰하는 워커가 전부 등재됐다", () => {
  const manifestPaths = new Set(assetsApi.getPyProcAssetManifest().assets.map((a) => a.path));
  const spawned = new Set();
  for (const file of collect(join(ROOT, "src"), [".js"], [])) {
    for (const ref of jsModuleRefs(file)) {
      if (ref.kind !== "newURL") continue;
      const target = moduleTarget(file, ref.spec);
      if (target && existsSync(target)) spawned.add(rel(target));
    }
  }
  const missing = [...spawned].filter((path) => !manifestPaths.has(path));
  if (missing.length) throw new Error("매니페스트에 없는 실행 자산: " + missing.join(", "));
  for (const path of manifestPaths) {
    if (!existsSync(join(ROOT, path))) throw new Error("매니페스트 경로가 실존하지 않는다: " + path);
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
    rejected = String(e).includes("hash mismatch");
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
// 기본 엔진 배포 계약: 같은 origin 주소, 평가용 upstream 주소, 준비 CLI, catalog와 런타임
// trust anchor가 하나의 버전과 바이트 집합을 말해야 한다.
check("기본 엔진 배포 핀 정합(fetchEngine == distribution == assetCatalog)", () => {
  const fe = readFileSync(join(ROOT, "scripts", "fetchEngine.mjs"), "utf8");
  const m = fe.match(/ENGINE_VERSION = "([^"]+)"/);
  if (!m) throw new Error("scripts/fetchEngine.mjs에서 ENGINE_VERSION을 못 찾음");
  if (m[1] !== distributionApi.PYODIDE_VERSION) throw new Error("fetchEngine과 runtime 엔진 버전 불일치");
  if (distributionApi.DEFAULT_INDEX !== "/vendor/pyodide/") throw new Error("기본 엔진이 same-origin 경로가 아니다");
  const catalog = JSON.parse(readFileSync(join(ROOT, "scripts", "assetCatalog.json"), "utf8"));
  const engineAssets = catalog.assets.filter((asset) => asset.componentId === `pyodide-release-${m[1]}` && asset.consumers?.includes("pyproc"));
  if (!engineAssets.length) throw new Error("assetCatalog가 엔진 부팅 집합을 기술하지 않는다");
  for (const asset of engineAssets) {
    if (asset.url !== distributionApi.EVALUATION_INDEX + asset.name) throw new Error(`${asset.name}: upstream provenance URL 불일치`);
    if (asset.localPath !== "." + distributionApi.DEFAULT_INDEX + asset.name) throw new Error(`${asset.name}: same-origin 배포 경로 불일치`);
    const sri = "sha256-" + Buffer.from(asset.sha256, "hex").toString("base64");
    if (distributionApi.DEFAULT_CORE_INTEGRITY.files[asset.name] !== sri) throw new Error(`${asset.name}: runtime trust anchor 불일치`);
  }
  for (const name of ["pyodide.js", "pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"]) {
    if (!engineAssets.some((asset) => asset.name === name)) throw new Error(`엔진 부팅 자산 미기술: ${name}`);
  }
  if (distributionApi.DEFAULT_CORE_INTEGRITY.files["pyodide.js"] !== distributionApi.DEFAULT_ENGINE_SCRIPT_INTEGRITY) {
    throw new Error("pyodide.js script/core trust anchor 불일치");
  }
});

// 2) 능력 계약이 런타임 없이도 형태를 갖추는가(메서드 존재). 소스는 내부 모듈이다:
// 계약의 목적은 "메서드가 사라지는 회귀"의 조기 발견이고, 도달 경로(핸들/탈출구)는 브라우저 게이트가 문다.
section("계약");
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
  for (const m of ["run", "runAsync", "install", "loadPackages", "loadPackagesFromImports", "setStdout", "setStderr", "freeze", "mountHome", "noteStateMutation", "enableReactive", "enableSyscallBridge", "enableAsgiServer", "enableVirtualOrigin", "enableTerminal", "enableWheelCache", "enableDeviceFs", "enableInit", "enableJournal"])
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
  for (const m of ["start", "stop", "commit", "delete", "pack", "prune", "recover"])
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
  if (typeof electionApi.openDurableMachine !== "function") throw new Error("openDurableMachine");
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

// 3) em dash(U+2014) 0 - 훅과 같은 스코프. 텍스트로 나가는 확장자 전부를 본다: .d.ts는
//    npm으로 배포되고 .html/.css는 공개 데모 진열장이며 .yml/.json은 운영 계약이다.
//    좁혔던 스코프(.md/.js/.mjs)의 틈에서 실제로 위반이 났다(2026-07-26, scripts/*.mjs).
section("em dash");
const TEXT_SURFACE_EXTS = [".md", ".js", ".mjs", ".ts", ".html", ".css", ".yml", ".json"];
// 확장자가 없어서 스코프 밖이던 텍스트 표면. `_headers`는 COOP/COEP 배포 계약이고 훅은
// 규칙 집행 코드다: 둘 다 em dash와 원시 제어문자가 들어가면 안 되는 자리인데, 판정이
// 확장자로만 돌아 아무도 보지 않았다(2026-07-27).
const TEXT_SURFACE_FILES = ["_headers", ".githooks/commit-msg", ".githooks/pre-commit", ".githooks/pre-push", ".githooks/reference-transaction"];
const textSurfaceFiles = () => [
  ...collect(ROOT, TEXT_SURFACE_EXTS, []),
  ...TEXT_SURFACE_FILES.map((name) => join(ROOT, name)).filter((f) => existsSync(f)),
];
// 훅과 이 게이트의 스코프가 갈라지면 커밋 시점 차단과 CI 차단이 다른 것을 본다. 실제로
// 갈라져 있었다(훅은 .md/.js, 게이트는 .md/.js/.mjs). 두 스코프를 기계로 묶는다.
check("pre-commit 훅의 텍스트 표면 스코프 = 게이트 스코프", () => {
  const hook = readFileSync(join(ROOT, ".githooks", "pre-commit"), "utf8");
  const patterns = /^\s*(\*\.[a-z|.*]+)\)\s*;;/m.exec(hook);
  if (!patterns) throw new Error("훅의 확장자 case 목록을 찾지 못했다");
  const hookExts = patterns[1].split("|").map((glob) => glob.replace("*", "")).sort();
  const gateExts = [...TEXT_SURFACE_EXTS].sort();
  if (hookExts.join(",") !== gateExts.join(",")) {
    throw new Error(`스코프 불일치: 훅 ${hookExts.join(",")} vs 게이트 ${gateExts.join(",")}`);
  }
  // 확장자 없는 표면도 훅이 함께 봐야 한다(`_headers|.githooks/*` case).
  for (const glob of ["_headers", ".githooks/*"]) {
    if (!hook.includes(glob)) throw new Error(`훅 스코프에 ${glob} 없음`);
  }
  // 제어문자 차단도 훅에 있어야 한다: CI에서만 잡으면 죽은 검사가 이미 커밋된 뒤다.
  if (!/control character found/.test(hook)) throw new Error("훅에 제어문자 차단 없음");
});
const EMDASH = String.fromCharCode(0x2014); // 리터럴로 쓰면 이 게이트가 자기 자신에 걸린다
for (const f of textSurfaceFiles()) {
  check(`no em dash: ${rel(f)}`, () => {
    if (readFileSync(f, "utf8").includes(EMDASH)) throw new Error("U+2014 발견");
  });
}

// 3.0.1) 원시 제어문자 0. 이 게이트의 근거는 자기 사고다(2026-07-27): 코덱 법과 결정성 스텁
//        법의 정규식에 `\b`를 쓰려던 자리에 원시 U+0008(백스페이스)이 들어가 두 법의 절반이
//        조용히 죽었다. `/\batob/`는 `atob(`를 잡지만 `/<0x08>atob/`는 아무것도 잡지 않고,
//        게이트는 초록이었다. 육안으로 구분되지 않으므로 기계가 봐야 한다.
//        허용: TAB(9), LF(10), CR(13). 나머지 C0 제어문자와 U+007F는 텍스트 표면에 없다.
section("제어문자");
{
  const ALLOWED_CONTROL = new Set([9, 10, 13]);
  for (const f of textSurfaceFiles()) {
    check(`제어문자 0: ${rel(f)}`, () => {
      const text = readFileSync(f, "utf8");
      const hits = [];
      for (let at = 0; at < text.length; at++) {
        const code = text.charCodeAt(at);
        if ((code < 32 && !ALLOWED_CONTROL.has(code)) || code === 127) {
          const line = text.slice(0, at).split("\n").length;
          hits.push(`L${line} U+${code.toString(16).padStart(4, "0")}`);
        }
      }
      if (hits.length) throw new Error(hits.slice(0, 5).join(", "));
    });
  }
}

// 3.1) 문서 주체 가드: 문서·주석의 주체는 나다(1인칭/주어 생략). 나를 3인칭 호칭으로
//      지칭하는 표현을 차단한다(커밋 메시지 주체 중립 규칙의 문서판, 2026-07-12 확정).
//      금칙어는 리터럴로 쓰면 이 게이트가 자기 자신에 걸리므로 조립한다.
section("문서 주체");
const OWNER_WORD = ["소유", "자"].join(""); // "소유" + "자"
for (const f of collect(ROOT, TEXT_SURFACE_EXTS, [])) {
  check(`주체 중립: ${rel(f)}`, () => {
    if (readFileSync(f, "utf8").includes(OWNER_WORD)) throw new Error("3인칭 호칭 발견");
  });
}

// 3.2) 네이밍 가드: camelCase는 언어 불문이다(JS 문자열 안의 파이썬 포함).
//      우리 접두(_pyproc*) 스네이크와, 우리가 정의하는 파이썬 함수명의 스네이크를 차단한다.
//      외부 기술 명칭(ASGI 키 문자열, pyodide.ffi.run_sync, API kwarg 등)은 정의가 아니라 안 걸린다.
section("네이밍");
for (const scope of ["src", "examples", "tests", "apps", "scripts"]) {
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
//      벤치에 종속시킨다. 실측은 계속하되(개발 원칙 4) 측정치는 tests의 재현 가능한
//      benchmark artifact에만 산다. 스코프 밖 둘: docs/operations의 게이트 임계값은 자랑이
//      아니라 계약이고, examples/의 Speed Lab은 사용자가 자기 기계에서 직접 재는 도구다.
// 강등 subpath의 타입 선언 목록. [성능 주장]과 [타입] 두 절이 함께 소비한다.
const SUBPATH_DTS = [
  "src/composition/runtimeSubpath.d.ts",
  "src/state/index.d.ts",
  "src/machine/index.d.ts",
  "src/runtime/assets.d.ts",
  "src/capabilities/gpuCompute.d.ts",
  "src/capabilities/socketBridge.d.ts",
  "src/runtime/engines/wasi/wasiSession.d.ts",
];
section("성능 주장");
const BRAG = [
  [/\d+(?:\.\d+)?\s*(?:x|×)\s*(?:faster|speedup)/i, "속도 배수 자랑"],
  [/\d+(?:\.\d+)?\s*(?:x|×)\s+median\s+speedup/i, "속도 배수 자랑"],
  // 방향을 묻지 않는다. 예전 패턴은 "배" 뒤에 "빠"를 요구해서 `340배 실측`, `86배 느림`,
  // `4.05배)`, `2-10배 감속`이 전부 통과했다(2026-07-27 실측: 금지 표면에 6건 생존).
  // 배수 게시 자체가 금지다: 느리다는 숫자도 방어해야 하는 숫자가 된다. 단위 명사(배열/배포)는
  // 뒤 문자로 배제하고, 게이트 임계값이 사는 docs/operations는 스코프 자체가 밖이다.
  [/\d+(?:\.\d+)?\s*배(?![열포치])/, "속도 배수 게시"],
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
  // 소비 문서는 제품이 채택 판단에 읽는 공개 계약이다. 규칙 문구의 문자적 스코프 밖이었지만
  // 실제로 측정치가 여기 살아 있었다(2026-07-26: contract.md의 median, 매트릭스의 p95).
  ...collect(join(ROOT, "docs", "usage"), [".md"]),
  // 타입 선언은 소비자가 가장 많이 읽는 공개 표면이다(에디터 자동완성이 JSDoc을 그대로 띄운다).
  // 규칙 문구가 문서 파일만 열거해 스코프 밖이었지만 실제로 측정치 4개가 여기 살아 있었다
  // (2026-07-27: matmul 3.67배, forkMany 316ms->78ms/4.05배, signal 264ms).
  join(ROOT, "index.d.ts"),
  ...SUBPATH_DTS.map((path) => join(ROOT, path)),
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
// 3.0.0) 탐지기 자기 시험. 이 절의 근거는 외부 감사 지적이다(2026-07-27): 텍스트 법
//        1478개는 파일마다 한 번씩 도는데, 그 탐지기가 실제로 무는지는 아무도 매 실행마다
//        확인하지 않았다. `String.fromCharCode(0x2014)`를 0x2013으로 한 글자 고치면 495개
//        체크가 영구히 통과한다. 음성 시험이 커밋 메시지에만 기록되고 다시 실행되지 않으면
//        그것은 한 번의 사건이지 게이트가 아니다. 그래서 오염 fixture를 매 실행마다 넣는다.
//        [커밋 규칙] 절은 처음부터 이 방식이었고(양성/음성 fixture 15개), 나머지 24절이 아니었다.
section("탐지기 자기 시험");
{
  const bites = (name, detector, poisoned, clean) => {
    check(`탐지기가 문다: ${name}`, () => {
      if (!detector(poisoned)) throw new Error("오염 fixture를 놓쳤다(탐지기가 죽었다)");
      if (detector(clean)) throw new Error("깨끗한 fixture를 잡았다(오탐)");
    });
  };
  bites("em dash", (text) => text.includes(EMDASH), `a ${EMDASH} b`, "a - b");
  bites("제어문자", (text) => {
    for (let at = 0; at < text.length; at++) {
      const code = text.charCodeAt(at);
      if ((code < 32 && !new Set([9, 10, 13]).has(code)) || code === 127) return true;
    }
    return false;
  }, `a${String.fromCharCode(8)}b`, `a\tb${NEWLINE}c`);
  bites("주체 중립", (text) => text.includes(OWNER_WORD), `이 문서의 ${OWNER_WORD}는`, "이 문서의 주체는");
  bites("숫자 자랑", (text) => BRAG.some(([re]) => re.test(text)), "측정 결과 4.05배", "독립 인터프리터 N개 = 독립 GIL N개");
  bites("숫자 자랑(ms 게시)", (text) => BRAG.some(([re]) => re.test(text)), "왕복 3.4ms", "왕복은 커널이 만든다");
  // 언어 탐지기. `가-힣` 범위를 이웃으로 한 글자만 옮기면 d.ts 하드 0과 메시지 예산이 영구히
  // 통과한다. 두 감사가 독립적으로 지목한 자리다: 그 음성 증명이 커밋 메시지에만 있었고, 그것은
  // 이 절이 세 줄 위에서 조건하는 바로 그 안티패턴이다("한 번의 사건이지 게이트가 아니다").
  bites("한국어 탐지", (text) => /[가-힣]/.test(text), "설명 한 줄", "one line of English");
  // 도달성 판정. 전역 이름 폴백이 있으면 "엉뚱한 클래스에 붙은 실존 이름"이 통과한다.
  // 판정을 fixture로 재현해 수신자별 판단이 살아 있는지 매 실행마다 본다.
  check("탐지기가 문다: 도달성 판정은 수신자별이다", () => {
    const own = new Set(["heap", "byteLength"]);
    const approved = new Set(["envBoot"]);
    const verdict = (member) => own.has(member) || approved.has(member);
    if (!verdict("heap")) throw new Error("자기 본문 멤버를 놓쳤다");
    if (!verdict("envBoot")) throw new Error("승인된 외부 부착 멤버를 놓쳤다");
    // `spawn`은 저장소 어딘가(MachineContainer)에 있지만 이 수신자에는 없다. 전역 폴백이
    // 살아 있으면 이 단정이 뒤집힌다.
    if (verdict("spawn")) throw new Error("다른 클래스의 이름을 이 수신자의 구현으로 셌다");
  });
  // 브라우저 러너의 판정자도 탐지기다. 시험 대상 페이지가 보낸 ok를 믿으면 검증 대상이 자기
  // 합격을 선언한다. 실물 함수를 오염 보고로 구동해 매 실행마다 그것이 무는지 본다.
  await checkAsync("탐지기가 문다: judgeReport는 페이지의 self-ok를 믿지 않는다", async () => {
    const { judgeReport } = await import(pathToFileURL(join(ROOT, "tests", "browser", "harness.mjs")).href);
    const failing = judgeReport({ ok: true, checks: [{ name: "x", pass: false }] });
    if (failing.ok) throw new Error("실패 체크를 실은 self-ok 보고를 통과시켰다");
    const empty = judgeReport({ ok: true, checks: [] });
    if (empty.ok) throw new Error("체크 0개 보고를 통과시켰다(GREEN 0/0은 합격이 아니다)");
    const timedOut = judgeReport({ ok: true, checks: [{ name: "x", pass: true }], timedOut: true });
    if (timedOut.ok) throw new Error("타임아웃 보고를 통과시켰다");
    const short = judgeReport({ ok: true, checks: [{ name: "x", pass: true }] }, { floor: 2 });
    if (short.ok) throw new Error("하한 미달 보고를 통과시켰다");
    const good = judgeReport({ ok: false, checks: [{ name: "x", pass: true }] }, { floor: 1 });
    if (!good.ok) throw new Error("전부 통과한 보고를 떨어뜨렸다(오탐)");
  });
  // 러너가 다시 페이지의 판정을 읽는 자리로 돌아가지 못하게 막는다. 판정자는 한 곳이다.
  check("게이트 러너는 페이지가 보낸 ok를 최종 판정으로 쓰지 않는다", () => {
    const runners = ["run.mjs", "examples.mjs", "socketLane.mjs", "goldenWorkflow.mjs", "installedPackageGate.mjs"];
    const offenders = [];
    for (const name of runners) {
      const src = readFileSync(join(ROOT, "tests", "browser", name), "utf8");
      if (!src.includes("judgeReport")) offenders.push(`${name}: judgeReport를 쓰지 않는다`);
      for (const [index, line] of src.split("\n").entries()) {
        if (stripComments(line).includes("result.ok")) offenders.push(`${name}:${index + 1} result.ok를 읽는다`);
      }
    }
    if (offenders.length) throw new Error(offenders.join(" / "));
  });
  // 스캐너 자체도 탐지기다: 문자열 안의 `//`를 주석으로 오인하면 그 줄 뒤가 모든 법에서 사라진다.
  check("탐지기가 문다: stripComments가 문자열 안의 //를 주석으로 보지 않는다", () => {
    const line = `const u = "https://cdn.example/x"; atob(payload);`;
    const kept = stripComments(line);
    if (!kept.includes("atob(")) throw new Error("문자열 뒤 코드가 잘렸다(코덱 법이 부분맹이 된다)");
    if (stripComments(`code(); // atob(x)`).includes("atob(")) throw new Error("진짜 주석을 남겼다");
  });
  // 전처리가 두 벌이면 하나는 반드시 뒤처진다. 실제로 네 법(힙 물질화, MB 단위, 공유 헬퍼
  // import 실존, 엔진 내부 접근 106검사)이 나이브 전처리를 쓰고 있었고, 같은 줄에 URL이 있는
  // src 파일 6개에서 그 줄 뒤가 통째로 사라지고 있었다. 전처리는 stripComments 하나다.
  check("법 전처리는 stripComments 하나뿐이다", () => {
    // 바늘을 리터럴로 쓰면 이 검사 자신이 걸린다(em dash 법이 EMDASH를 조립하는 것과 같은 이유).
    const naive = "split(" + '"' + "//" + '"' + ")[0]";
    const own = stripComments(readFileSync(join(ROOT, "tests", "run.mjs"), "utf8"));
    if (own.includes(naive)) throw new Error("나이브 전처리가 되살아났다(문자열 안의 //를 주석으로 본다)");
  });
}
// 3.0.2) 흔적 금지의 문서·소스 절. 규칙은 "커밋 메시지/주석/문서"를 함께 덮는 절대 게이트인데
//        집행은 commit-msg 훅 한 곳뿐이었다(외부 감사 지적, 2026-07-27: 문서와 소스 커버리지 0).
//        커밋 메시지는 되감을 수 없어 훅이 최후 방어지만, 파일에 들어간 흔적은 훅을 안 지난다:
//        커밋 메시지를 깨끗하게 쓰고 같은 커밋에서 파일에 흔적을 심으면 아무것도 막지 않았다.
//        판정은 scripts/commitMessage.mjs가 내보내는 같은 목록이다(목록이 둘이면 갈라진다).
section("흔적 금지");
{
  // 스코프 밖: 서드파티 벤더 번들, 생성 자산(락 파일), 규칙 자체를 적는 두 파일.
  const TRACE_EXEMPT = [
    "vendor/",                       // 서드파티 배포본. 원문을 고치면 업스트림 대조가 죽는다
    "scripts/commitMessage.mjs",     // 판정 정본. 금칙어 목록이 여기 산다
    "tests/run.mjs",                 // 이 검사와 커밋 규칙 fixture가 금칙어를 문자열로 담는다
    "pyodide-lock.json",             // 엔진이 생성하는 락(패키지 이름에 금칙어가 섞인다)
    "CLAUDE.md",                     // 규칙 문장 자체가 금칙어를 열거한다. git 미추적이라 CI에 없다
  ];
  const traceScope = () => textSurfaceFiles().filter((f) => {
    const path = rel(f);
    return !TRACE_EXEMPT.some((prefix) => path.startsWith(prefix) || path.endsWith(prefix));
  });
  // 규칙 파일의 이름 자체는 흔적이 아니다. 금지의 대상은 귀속 표기(`Generated by`,
  // `Co-Authored-By` 등)이고, 강행규칙 SSOT를 가리키는 파일명 참조는 정보 구조의 요구다
  // (AGENTS.md의 존재 이유가 그 포인터다). 토큰 하나만 지우므로 다른 용법은 그대로 잡힌다.
  for (const f of traceScope()) {
    check(`흔적 0: ${rel(f)}`, () => {
      const text = readFileSync(f, "utf8");
      if (containsToolAttribution(text)) throw new Error("도구·생성·기여자 흔적 용어(절대 게이트)");
    });
  }
  check("탐지기가 문다: 흔적 용어", () => {
    for (const poisoned of ["Co-Authored-By: x", "Generated by a tool", "assisted-by: y", "chatgpt did it"]) {
      if (!containsToolAttribution(poisoned)) throw new Error(`문서 판정이 놓쳤다: ${poisoned}`);
      if (!containsTraceTerm(poisoned)) throw new Error(`커밋 판정이 놓쳤다: ${poisoned}`);
    }
    if (containsToolAttribution("pyproc for AI agents")) throw new Error("제품 명사를 잡았다(오탐)");
    // 커밋 메시지 판정은 홀로 선 AI까지 금지다. 두 판정의 차이가 여기서 고정된다.
    if (!containsTraceTerm("AI가 만들었다")) throw new Error("커밋 판정이 홀로 선 AI를 놓쳤다");
  });
}
section("digest 법");
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
  // 코덱 법: base64/hex 바이트 변환은 코어 두 곳에만 산다. runtime/contentDigest(전 층 공용)와
  // machine/contracts/byteCodec(machine은 바깥 import가 composition 한 점이라 자체 한 벌).
  // pyprocSw는 import 0 자기충족 자산이라 의도된 중복이고 자산 매니페스트가 그 사실을 게시한다.
  const CODEC_CORE = new Set([
    "src/runtime/contentDigest.js",
    "src/machine/image/byteCodec.js",
    "src/capabilities/pyprocSw.js",
    "src/runtime/engines/wasi/browserWasiShim.js", // 벤더 번들(서드파티 스코프)
  ]);
  // 코덱 코어 면제는 "변환을 여기서 한다"는 뜻이지 "여기서는 무엇이든 된다"가 아니다.
  // localeCompare는 코어 안에서 더 위험하다: contentDigest.js가 내용주소의 정본이라, 거기
  // 엔트리 순서가 로케일/ICU 판본에 따라 달라지면 같은 상태가 다른 커밋 주소를 낳는다.
  // 그래서 로케일 비교자는 코어 면제 없이 src 전면 금지다(벤더 번들만 스코프 밖).
  const CODEC_PATTERN = /\batob\s*\(|\bbtoa\s*\(|toString\(16\)/;
  const LOCALE_PATTERN = /localeCompare/;
  const VENDOR_BUNDLE = "src/runtime/engines/wasi/browserWasiShim.js";
  // 로케일 비교자 금지는 src 밖에서도 산다. 게이트와 도구가 로케일 정렬로 목록을 만들면 그
  // 결과가 러너의 로케일에 따라 달라지고, 그러면 "이 커밋에서 통과했다"가 기계마다 다른 말이
  // 된다(내용주소가 로케일에 종속되던 것과 같은 부류의 사고다). 그래서 스코프를 넓힌다.
  const localeScopes = [join(ROOT, "src"), join(ROOT, "tests"), join(ROOT, "apps"), join(ROOT, "scripts")];
  for (const f of localeScopes.flatMap((dir) => collect(dir, [".js", ".mjs"], []))) {
    const relPath = rel(f);
    if (relPath === VENDOR_BUNDLE || relPath === "tests/run.mjs") continue; // 이 파일은 법 자체를 담는다
    const code = stripComments(readFileSync(f, "utf8"));
    check(`로케일 비교자 0: ${relPath}`, () => {
      if (LOCALE_PATTERN.test(code)) throw new Error("localeCompare는 결과를 러너 로케일에 종속시킨다(deterministicOrder 경유)");
    });
  }
  for (const f of collect(join(ROOT, "src"), [".js"], [])) {
    const relPath = rel(f);
    const code = stripComments(readFileSync(f, "utf8"));
    if (CODEC_CORE.has(relPath)) continue;
    check(`코덱 법: ${relPath}`, () => {
      if (CODEC_PATTERN.test(code)) throw new Error("base64/hex 변환 사본(코덱 코어 경유해야 한다)");
    });
  }

  // 결정성 스텁 법: 부팅 구간의 비결정 소스 고정과 재시드 소스는 globalPatch에만 산다.
  // 메인 커널과 워커 커널이 같은 값을 써야 cp0 바이트가 같고, 그래야 fork가 성립한다.
  // 결정적 정렬 비교자의 정의 지점 법. 이 함수는 내용주소와 서명 대상의 엔트리 순서를 정하므로
  // 판본이 갈리면 같은 상태가 다른 주소를 낳는다. 정의가 둘인 것은 층 경계 때문이다:
  // machine의 순수 집합은 "import 0"이 불변식이라 runtime을 import할 수 없고, runtime(rank 0)은
  // machine(rank 5)을 import할 수 없다. 그래서 경계 양쪽에 하나씩만 허용하고 셋째는 금지한다.
  // 실측(2026-07-27): machineManifest.js가 손으로 베낀 셋째 사본을 갖고 있었고, 그 파일과
  // deterministicOrder.js가 모두 순수 집합이라 순수-순수 import가 합법이므로 이유가 없었다.
  const COMPARATOR_HOMES = new Set([
    "src/runtime/memoryLayout.js",            // rank 0 쪽. machine을 import할 수 없다
    "src/machine/contracts/deterministicOrder.js", // 순수 집합 쪽. import 0이 불변식이다
  ]);
  // canonical JSON 정의 지점 법. 이 직렬화가 공개 지문(소비자가 신뢰 목록에 박는 값)과
  // manifest 다이제스트를 정하므로, 판본이 둘이면 같은 키가 다른 지문을 낳는다. machine 층에
  // 같은 알고리즘의 사본이 있었고(2026-07-27 제거) composition이 커널 조각으로 배달한다.
  // 차등 대조 435건으로 두 구현의 바이트 동일성을 먼저 확인한 뒤 지웠으므로 지문 값은 불변이다.
  check("canonical JSON 정의는 커널 한 곳", () => {
    const definers = [];
    for (const f of collect(join(ROOT, "src"), [".js"], [])) {
      const code = stripComments(readFileSync(f, "utf8"));
      // 키 정렬 + finite 판정을 함께 하는 재귀 직렬화기를 정의하는 파일을 찾는다.
      if (/function canonical[A-Za-z]*Json\s*\(/.test(code)) definers.push(rel(f));
    }
    if (definers.join(",") !== "src/state/objectModel.js") {
      throw new Error(`canonical JSON 정의가 커널 밖에 있다: ${definers.join(", ")}`);
    }
  });
  check("결정적 비교자의 정의는 경계 양쪽 각 한 곳", () => {
    const definers = [];
    for (const f of collect(join(ROOT, "src"), [".js"], [])) {
      const code = stripComments(readFileSync(f, "utf8"));
      // 정의만 센다(재수출과 import는 사본이 아니다).
      if (/(?:export\s+)?function compareNames\s*\(/.test(code)) definers.push(rel(f));
    }
    const extra = definers.filter((path) => !COMPARATOR_HOMES.has(path));
    if (extra.length) throw new Error(`비교자 사본: ${extra.join(", ")}(경계 이유가 있으면 목록에 근거와 함께 등재한다)`);
    const missing = [...COMPARATOR_HOMES].filter((path) => !definers.includes(path));
    if (missing.length) throw new Error(`비교자 정의가 사라졌다: ${missing.join(", ")}`);
  });
  check("결정성 스텁의 소스는 한 곳", () => {
    const holders = [];
    for (const f of collect(join(ROOT, "src"), [".js"], [])) {
      const relPath = rel(f);
      if (relPath === "src/runtime/globalPatch.js") continue;
      const code = stripComments(readFileSync(f, "utf8"));
      if (/crypto\.getRandomValues\s*=|Date\.now\s*=|performance\.now\s*=/.test(code)) holders.push(relPath);
      // `_pyprocR`는 재시드 소스의 이름이다. 접두가 겹치는 다른 이름(_pyprocRe, _pyprocRunSync)을
      // 잡지 않게 경계를 준다.
      if (/_pyprocR\b/.test(code)) holders.push(relPath);
    }
    if (holders.length) throw new Error(`결정성 스텁 사본: ${[...new Set(holders)].join(", ")}`);
  });

  // 힙 물질화 법: "성장 -> 경계 되감기 -> 페이지 쓰기 -> 스택 복원 -> 새 경계"는 부활 정확성
  // 그 자체다. 예전에는 이 순서가 네 곳에 각자 구현돼 독립 표류가 가능했다(session.load /
  // openMachine / journal.recover 구포맷 / 커널). 소스를 한 파일로 좁혀 고정한다.
  const MATERIALIZE_CORE = "src/capabilities/image/heapMaterialize.js";
  check("힙 물질화 법의 소스는 한 곳", () => {
    const holders = [];
    for (const f of collect(join(ROOT, "src"), [".js"], [])) {
      const relPath = rel(f);
      if (relPath === MATERIALIZE_CORE) continue;
      // 워커는 fork 경로라 다른 법을 쓴다(cp0 드리프트 정화 + 델타). 여기 스코프는 부활 경로다.
      if (relPath === "src/processOs/worker.js") continue;
      if (relPath === "src/runtime/heapGrow.js") continue; // growHeapTo의 정의처
      const code = stripComments(readFileSync(f, "utf8"));
      if (/\brestore\(\s*0\s*,/.test(code) || /growHeapTo\s*\(/.test(code)) holders.push(relPath);
    }
    if (holders.length) throw new Error(`부활 물질화 사본: ${holders.join(", ")}`);
  });
  // 바이트 -> MB 반올림의 소스는 memoryLayout(rank 0 단위 계약) 하나다. 사본이 8곳에 흩어져
  // 있었고 정밀도까지 갈렸다(1자리 6곳, 2자리 3곳). 벤더 shim은 서드파티라 스코프 밖이다.
  const UNIT_CORE = "src/runtime/memoryLayout.js";
  const VENDORED_SHIM = "src/runtime/engines/wasi/browserWasiShim.js";
  check("바이트 -> MB 단위 변환의 소스는 한 곳", () => {
    const holders = [];
    for (const f of collect(join(ROOT, "src"), [".js"], [])) {
      const relPath = rel(f);
      if (relPath === UNIT_CORE || relPath === VENDORED_SHIM) continue;
      const code = stripComments(readFileSync(f, "utf8"));
      if (/1048576/.test(code)) holders.push(relPath);
    }
    if (holders.length) throw new Error(`MB 단위 사본: ${holders.join(", ")}`);
  });

  // 공유 헬퍼는 쓰는 파일이 import한다. 이 게이트는 원래 미정의 식별자를 못 본다(텍스트 검사다)
  // -> 그 구멍의 실제 대가를 치렀다: bytesToMb를 machineJournal에서 쓰면서 import를 빠뜨려
  // 브라우저 게이트가 ReferenceError로 잡았다(2026-07-27). 파서 없이 좁히는 방법은 스코프를
  // "src가 export하는 이름"으로 한정하는 것이다: 그 이름을 호출하면서 import도 선언도 없으면 RED.
  {
    const declaredBy = new Map(); // 이름 -> 정의 파일
    const srcFiles = collect(join(ROOT, "src"), [".js"], []);
    for (const f of srcFiles) {
      for (const m of readFileSync(f, "utf8").matchAll(/^export (?:async )?function (\w+)/gm)) {
        declaredBy.set(m[1], rel(f));
      }
    }
    for (const f of srcFiles) {
      const relPath = rel(f);
      if (relPath === VENDORED_SHIM) continue; // 서드파티 번들(자체 스코프)
      const source = readFileSync(f, "utf8");
      // 주석과 문자열 리터럴을 걷어낸 JS 위치만 본다. 이 파일들은 파이썬 소스를 문자열로
      // 심으므로(`exec(open(path).read())`) 문자열을 남기면 파이썬 호출이 JS 호출로 오인된다.
      // 템플릿 리터럴은 여러 줄에 걸치므로 줄 단위로는 못 지운다. 통째로 먼저 비운다.
      const code = source.replace(/`[^`]*`/g, '""').split("\n")
        .map((line) => stripComments(line).replace(/"[^"]*"|'[^']*'/g, '""'))
        .join("\n");
      // 파일이 "쓸 수 있는 이름" 집합: import 절(여러 줄 포함) + 선언 + 구조분해 + 인자.
      // 이름이 이 집합 안에 있으면 판정하지 않는다(오탐 0 우선: 노이즈 게이트는 무시를 학습시킨다).
      const available = new Set();
      for (const m of source.matchAll(/import\s+([\s\S]*?)\s+from\s*["'][^"']+["']/g)) {
        for (const id of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) available.add(id[0]);
      }
      for (const m of code.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) available.add(m[1]);
      // 메서드/축약 함수 정의도 그 이름의 선언이다(`async boot(n) {`).
      for (const m of code.matchAll(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) available.add(m[1]);
      // 구조분해와 인자 목록: 괄호/중괄호 안의 식별자를 통째로 받아들인다(관대한 방향).
      for (const m of code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
        for (const id of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) available.add(id[0]);
      }
      for (const m of code.matchAll(/(?:function\s*\w*|=>|\b[A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?:\{|=>)/g)) {
        for (const id of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) available.add(id[0]);
      }
      check(`공유 헬퍼 import 실존: ${relPath}`, () => {
        const missing = new Set();
        for (const [name, owner] of declaredBy) {
          if (owner === relPath || available.has(name)) continue;
          // 호출 형태만 본다. 앞에 `.`이 붙으면 메서드 호출이라 이 이름과 무관하다.
          if (!new RegExp(`(^|[^.\\w$])${name}\\s*\\(`, "m").test(code)) continue;
          missing.add(`${name}(${owner})`);
        }
        if (missing.size) throw new Error(`import 없이 호출: ${[...missing].slice(0, 5).join(", ")}`);
      });
    }
  }

  // 엔진 내부 접근 법: `_module.*`, `HEAPU8`, `_emscripten_stack_*`는 엔진 어댑터에만 산다.
  // 상위는 MemoryCapability를 지난다. 이 법이 없을 때 worker.js가 계약을 손에 들고도 세 곳에서
  // 엔진 내부를 직접 만졌고, 그래서 어댑터의 stackRestore 방어가 워커에는 없어 동작이 갈렸다.
  const ENGINE_INTERNAL = /_module\s*\.|\bHEAPU8\b|_emscripten_stack_/;
  const ENGINE_ADAPTER_DIR = "src/runtime/engines/";
  for (const f of collect(join(ROOT, "src"), [".js"])) {
    const relPath = rel(f);
    if (relPath.startsWith(ENGINE_ADAPTER_DIR)) continue;
    // 주석은 스코프 밖이다: 이 법의 근거를 주석에 쓰는 것 자체가 위반이 되면 안 된다.
    const code = stripComments(readFileSync(f, "utf8"));
    check(`엔진 내부 접근 법: ${relPath}`, () => {
      if (ENGINE_INTERNAL.test(code)) throw new Error("엔진 내부 직접 접근(MemoryCapability 경유해야 한다)");
    });
  }
}

// 3.5) state 커널 게이트(state-kernel 2단계): 순수 집합 + ref CAS 프로토콜 음성 시험.
//      실측 원형은 tests/attempts/stateKernel(0단계 probe GREEN). 여기서는 src 실물이
//      같은 위반들을 무는지 매 커밋 확인한다(안 무는 게이트는 없는 게이트보다 나쁘다).
section("state 커널");
{
  // 순수 집합: 커널은 브라우저 저장·전역 관심사를 모른다. backend(OPFS/IndexedDB)와 정책은
  // 전부 위에서 주입된다. 이 불변식이 무너지면 통합이 결합으로 역전된다(god layer).
  const PURE_STATE = ["bundleFormat.js", "objectModel.js", "refProtocol.js", "signedTag.js", "memoryStateStore.js", "outcomeLog.js"];
  // 브라우저 backend는 순수 집합 밖이다. 배럴은 재수출뿐이라 판정 대상이 아니다.
  const BROWSER_BACKED_STATE = ["opfsStateStore.js", "index.js"];
  // 등재 강제. 이 목록이 allowlist이던 동안 bundleFormat.js가 어느 쪽에도 없어서 **아무 검사도
  // 받지 않고 출력에도 나타나지 않았다**(빠진 파일은 침묵한다). 이제 src/state의 모든 파일이
  // 순수 집합이나 backend 목록 중 정확히 한쪽에 있어야 하고, 새 파일은 판정을 요구받는다.
  check("state 순수 집합 등재 강제: 모든 파일이 한쪽에 있다", () => {
    const listed = new Set([...PURE_STATE, ...BROWSER_BACKED_STATE]);
    const actual = readdirSync(join(ROOT, "src", "state")).filter((name) => name.endsWith(".js"));
    const unlisted = actual.filter((name) => !listed.has(name));
    if (unlisted.length) throw new Error(`어느 목록에도 없다(순수인지 backend인지 판정하라): ${unlisted.join(", ")}`);
    const ghost = [...listed].filter((name) => !actual.includes(name));
    if (ghost.length) throw new Error(`목록에 있는데 파일이 없다: ${ghost.join(", ")}`);
  });
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
  // 오브젝트 저장은 bounded concurrency로 돈다. 병렬화가 깨뜨릴 수 있는 것은 둘이다: 페이지
  // 표의 순서와, 같은 주소를 동시에 쓰는 경합(둘 다 hasObject=false를 보고 겹쳐 쓰면 카운터가
  // 부푼다). 중복 페이지를 섞은 커밋으로 두 성질을 함께 단정한다.
  await checkAsync("state 프로토콜: 병렬 저장이 순서와 카운터를 보존한다", async () => {
    const store = new MemoryStateStore();
    const fills = [7, 7, 9, 7, 9, 11]; // 고유 3개, 중복 3개
    const committed = await state.commitState(provider, store, {
      pages: fills.map((fill, index) => [index, statePage(fill)]),
      pageSize: 1024, heapLen: 1024 * fills.length, sp: 0, env: { h0: "h0-parallel" },
    });
    const table = committed.pageTable;
    if (table.length !== fills.length) throw new Error(`페이지 수 불일치: ${table.length}`);
    for (const [index, [page]] of table.entries()) {
      if (page !== index) throw new Error(`페이지 순서가 뒤섞였다: ${index}번째가 page ${page}`);
    }
    // 같은 내용은 같은 주소여야 한다(CAS). 그리고 고유 내용만 쓰여야 한다.
    const unique = new Set(table.map(([, address]) => address));
    if (unique.size !== 3) throw new Error(`고유 주소 수 불일치: ${unique.size}`);
    if (committed.pagesWrote !== 3) throw new Error(`고유 페이지만 쓰지 않았다: pagesWrote ${committed.pagesWrote}`);
    if (committed.deduped !== fills.length - 3) throw new Error(`중복 합류 수 불일치: deduped ${committed.deduped}`);
    const opened = await state.openState(provider, store, { expectH0: "h0-parallel" });
    for (const [index, fill] of fills.entries()) {
      if (opened.pages.get(index)[0] !== fill) throw new Error(`page ${index} 내용 불일치`);
    }
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
    try { new machineBarrel.MachineCommitCoordinator({ store: {}, cryptoProvider: globalThis.crypto, nowFactory: () => 1 }); }
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
    const unsigned = await bundle.stateBundleHeaderDigest(provider, { commit: committed.commitAddress, meta: meta2, objects });
    const tag = await tags.signStateTag(provider, keyPair, unsigned);
    const bytes = await bundle.encodeStateBundle(provider, { commit: committed.commitAddress, meta: meta2, objects, tag });
    const decoded = await bundle.decodeStateBundle(provider, bytes);
    if (decoded.commit !== committed.commitAddress || decoded.objects.size !== objects.length) throw new Error("왕복 불일치");
    if (decoded.headerDigest !== unsigned || decoded.tag.target !== unsigned) throw new Error("unsigned 다이제스트 불일치");
    const jwk = await tags.exportStatePublicKey(provider, keyPair.publicKey);
    const good = await tags.verifyStateTag(provider, decoded.tag, decoded.headerDigest, { trustedPublicKeys: [jwk] });
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

// 델타 재구성 soundness(휘발 구역)의 property/fuzz. 지금까지 이 경로는 고정 시나리오
// (gate.html의 x=1/999, ROOT/MAIN 마커)로만 검증됐다. 고정 시나리오는 "이 경우엔 된다"를
// 증명하지 "임의의 힙 변이에도 불변식이 성립한다"를 증명하지 않는다. 순수 함수(pageHashes는
// fake engine으로, heapDelta는 그대로)라 WASM 없이 Node에서 항상 돈다.
section("해시 soundness");
await assertHashSoundness(check);

// 이동 봉투와 구 이미지의 적대적 입력 경계. 세 표면 감사가 확정한 공백: (1) bundle
// index-forgery의 라이브 게이트가 졸업하며 삭제된 attempts probe(headerTagProbe)와 함께
// 사라졌다 - 이번 header-target 서명의 핵심 증명이 무방비였다. (2) readStateBundleHeader
// (접두 조기-거부 프리미티브)에 Node 게이트가 전무. (3) machineImage.js(적대적 입력 파서)의
// v1 거부·validateMeta/validateManifest 경계에 라이브 게이트 0. 전부 순수 함수 = WASM 0.
section("봉투·이미지 경계");
await assertEnvelopeBoundary(check, checkAsync);

// 체크포인트 나무(머신의 git)의 참조 무결성. 가장 강한 기존 증거(branchProbe: 형제 델타
// 오염 + base-reset 판별자)는 삭제 예정 non-CI attempts probe에 산다. 그 결함 부류(선형 k-1
// walk가 버려진 형제 분기를 참조)를 임의 트리 property로 CI에 고정한다. 컨트롤러는 fake mem
// (실 MemoryCapability + JS 힙)에 대해 WASM 없이 돈다. 모델 스냅샷을 restore 정확성과 독립으로
// 잡으려고 빌드 시 힙을 모델값으로 강제하고 포인터만 세팅한다(오라클이 독립 대조가 되도록).
section("reactive 나무");
await assertReactiveTree(check);

// 멀티탭 커널 선출(KernelElection)의 정합 계약. 세 표면 감사가 확정: 이 경로는 런타임 CI
// 게이트가 전무하고(method-existence만) split-brain·served-cache 멱등성·reject 상태기계의
// 여러 분기가 삭제 예정 non-CI probe에만 있거나 어디에도 없다. 메시지·락 의존은 주입 가능하므로
// 내부 메서드를 fake로 직접 구동한다(WASM 0). 한계 명시(감사 규율): Web Locks는 구조적으로 두
// 리더를 금지하므로 "자연 발생 split-brain"은 재현 불가 - 여기서는 감지 분기를 메시지 주입으로 문다.
section("election 프로토콜");
await assertElectionProtocol(check, checkAsync);

// 파일/폴더 이름도 camelCase다. 위 검사는 파일 "내용"의 식별자만 봐서 이름 규칙은 기계 검사가
// 0이었다. 검증 데이터와 엔진 픽스처는 제외한다.
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
        // assets/는 엔진 배포판·바이너리 fixture(전부 gitignore)라 이름 규칙 밖이다.
        if (entry !== "assets") walk(full);
        continue;
      }
      const stem = entry.replace(/\.(js|mjs|html|css|json|d\.ts)$/, "");
      if (stem === entry) continue; // 검사 대상 확장자가 아니다
      if (!CAMEL.test(stem) && !exempt.has(stem)) bad.push(rel(full));
    }
  };
  for (const scope of ["src", "scripts", "tests", "examples", "apps"]) walk(join(ROOT, scope));
  if (bad.length) throw new Error("camelCase 아님: " + bad.slice(0, 8).join(", "));
});

// 3.3) 오류 계약 가드: src의 모든 오류 생성은 PyProcError다(코드 없는 Error 금지).
//      계약의 축은 message가 아니라 code이므로, 코드 없는 오류가 하나라도 생기면 소비자의
//      프로그램적 분기가 다시 문자열 매칭으로 퇴행한다. 예외: pyprocSw.js는 SW 자기충족
//      파일(모듈 import 금지 계약)이라 로컬 swError 헬퍼의 new Error 1곳만 허용한다.
// samePage는 워드 비교로 도는데 그 답이 바이트 비교와 같아야 한다. property 시험으로 매 실행
// 대조한다: 정렬된 뷰와 정렬이 깨진 뷰(byteOffset 홀수) 양쪽에서 같은 답을 내는지 본다.
await checkAsync("samePage: 워드 비교가 바이트 비교와 같은 답을 낸다", async () => {
  const { samePage } = await import(pathToFileURL(join(ROOT, "src", "runtime", "heapDelta.js")).href);
  const PAGE = 64;
  const byteSame = (a, b, page) => {
    for (let i = page * PAGE; i < (page + 1) * PAGE; i++) if (a[i] !== b[i]) return false;
    return true;
  };
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 256;
  for (let trial = 0; trial < 200; trial++) {
    const buffer = new ArrayBuffer(PAGE * 4 + 8);
    const a = new Uint8Array(buffer, trial % 2 === 0 ? 0 : 1, PAGE * 4);
    const b = new Uint8Array(new ArrayBuffer(PAGE * 4 + 8), trial % 2 === 0 ? 0 : 1, PAGE * 4);
    for (let i = 0; i < a.length; i++) { const v = rand(); a[i] = v; b[i] = v; }
    // 성긴 비교가 건너뛰는 자리에 어긋냄을 심는다. 워드 stride는 바이트 0-3, 8-11...만 보므로
    // 4-7 구간의 차이는 확정 비교만 잡는다. 그 자리를 쓰지 않으면 확정 비교를 지워도 통과한다.
    if (trial % 3 === 0) b[(trial % 4) * PAGE + 5] ^= 0xff;
    for (let page = 0; page < 4; page++) {
      if (samePage(a, b, page, PAGE) !== byteSame(a, b, page)) {
        throw new Error(`trial ${trial} page ${page}: 워드 비교와 바이트 비교가 갈렸다`);
      }
    }
  }
});
// 죽은 프로세스 엔트리의 상한. 이력 조회용으로 남기되 단조 증가하면 엔트리마다 terminate된
// Worker와 rpc 포트 클로저를 붙잡는다. 정책이 순수하므로 fake 테이블로 실 함수를 구동한다
// (브라우저에서 40회 respawn을 돌리면 게이트 예산을 넘긴다: 판정은 여기가 맞는 층이다).
await checkAsync("프로세스 테이블: 죽은 엔트리 상한이 참조를 회수한다", async () => {
  const { PyProc } = await import(pathToFileURL(join(ROOT, "src", "processOs", "pyProc.js")).href);
  const pool = Object.create(PyProc.prototype);
  let disposed = 0;
  pool.table = [];
  for (let pid = 1; pid <= 50; pid++) {
    pool.table.push({
      pid, state: pid <= 45 ? "dead" : "ready", parentPid: 0,
      worker: { terminate() {} }, port: { dispose() { disposed++; } }, interrupt: new Uint8Array(1),
    });
  }
  pool._reapDeadEntries();
  const dead = pool.table.filter((entry) => entry.state === "dead");
  const live = pool.table.filter((entry) => entry.state !== "dead");
  if (dead.length !== 45) throw new Error(`이력 엔트리가 사라졌다: ${dead.length}`);
  if (live.some((entry) => entry.reaped)) throw new Error("살아 있는 엔트리를 회수했다");
  const reaped = dead.filter((entry) => entry.reaped);
  if (!reaped.length) throw new Error("상한을 넘겼는데 아무것도 회수하지 않았다");
  if (reaped.some((entry) => entry.worker || entry.port || entry.interrupt)) throw new Error("회수했는데 참조가 남았다");
  if (disposed !== reaped.length) throw new Error(`rpc 포트 해제 수 불일치: ${disposed} vs ${reaped.length}`);
  // 공개 형태(ps의 세 필드)는 회수 뒤에도 그대로다.
  for (const entry of reaped) {
    if (!Number.isInteger(entry.pid) || entry.state !== "dead" || !Number.isInteger(entry.parentPid)) {
      throw new Error("회수가 ps() 계약 필드를 지웠다");
    }
  }
});
// MachineHandle의 상태 전이 이력 상한. pause/save/resume을 반복하는 내구 소비자에서 배열이
// 무한히 자라고, inspect를 폴링하면 매 호출이 전체 복사가 된다. created는 남기고 오래된
// 것부터 자르며 자른 수를 센다.
await checkAsync("MachineHandle 이력 상한: created를 남기고 오래된 것부터 자른다", async () => {
  const { MachineHandle } = await import(pathToFileURL(join(ROOT, "src", "machine", "host", "machineHandle.js")).href);
  const handle = Object.create(MachineHandle.prototype);
  handle.epoch = 1;
  handle._history = [{ event: "created", state: "created", epoch: 1 }];
  handle._historyTruncated = 0;
  for (let i = 0; i < 500; i += 1) handle._note({ event: `step${i}`, state: "ready", epoch: 1 });
  if (handle._history.length > 200) throw new Error(`이력이 상한 없이 자랐다: ${handle._history.length}`);
  if (handle._history[0].event !== "created") throw new Error("created 엔트리가 잘렸다");
  if (handle._historyTruncated <= 0) throw new Error("자른 수를 세지 않았다");
  const last = handle._history[handle._history.length - 1];
  if (last.event !== "step499") throw new Error("최근 엔트리가 남지 않았다");
});
section("오류 계약");
// 오류 message와 API 반환 문자열은 소비자가 콘솔·이슈·로그에서 읽는 공개 표면이다. 규칙은
// 공개 표면 영문 우선이고, 실제로 한 파일 안에서 갈려 있었다(operationControl은 한 템플릿
// 리터럴 안에서 영어와 한국어가 섞였다). 판정선: message와 반환 문자열은 영어, 주석은 한국어.
{
  const HANGUL = /[가-힣]/;
  // 코드 인자와 메시지를 가른다: 오류 생성 줄의 모든 문자열 리터럴 중 코드 모양이 아닌 것만 본다.
  const CODE_LIKE = /^[A-Z][A-Z0-9_]*$/;
  for (const f of collect(join(ROOT, "src"), [".js"], [])) {
    const code = stripComments(readFileSync(f, "utf8"));
    check(`메시지 언어: ${rel(f)}`, () => {
      const hits = [];
      for (const line of code.split("\n")) {
        // 오류 생성은 생성자 직접 호출만이 아니다(imageError, kernelError 같은 얇은 헬퍼가 있다).
        // 코드 리터럴이 있는 줄을 오류 줄로 보고, 그 줄의 나머지 문자열을 메시지로 판정한다.
        if (!/"(?:WEB_MACHINE|PYPROC)_[A-Z0-9_]+"/.test(line) && !/note:\s*"/.test(line)) continue;
        for (const m of line.matchAll(/"([^"]*)"/g)) {
          const text = m[1];
          if (!CODE_LIKE.test(text) && HANGUL.test(text)) hits.push(text);
        }
      }
      if (hits.length) throw new Error(`공개 메시지에 한글: ${hits.slice(0, 3).join(" | ").slice(0, 160)}`);
    });
  }
}
// 코드 카탈로그와 실제 throw의 양방향 대조. 한쪽만 늘어나는 표류가 둘 다 나 있었다:
// PYPROC_TASK_TIMEOUT은 카탈로그와 공개 union에 선언만 있고 어디서도 생산되지 않았고
// (소비자는 존재하지 않는 값을 광고받았다), 생성자는 미등록 코드를 조용히 PYPROC_INTERNAL로
// 강등해 오타를 신호 없이 삼켰다. 정적 검사라 리터럴이 아닌 전달 지점은 못 본다: 그 한계를
// 이름에 적어 둔다.
{
  const codes = new Set(api.PYPROC_ERROR_CODES);
  const literalCodes = new Set();
  for (const f of collect(join(ROOT, "src"), [".js"], [])) {
    const code = stripComments(readFileSync(f, "utf8"));
    for (const m of code.matchAll(/new\s+PyProcError\s*\(\s*"([A-Z_]+)"/g)) literalCodes.add(m[1]);
    for (const m of code.matchAll(/[^\w]code:\s*"(PYPROC_[A-Z_]+)"/g)) literalCodes.add(m[1]);
    for (const m of code.matchAll(/kernelError\([^\n]*?"(PYPROC_[A-Z_]+)"/g)) literalCodes.add(m[1]);
  }
  check("오류 코드 리터럴은 카탈로그 안에 있다(정적 리터럴 한정)", () => {
    const unknown = [...literalCodes].filter((code) => !codes.has(code)).sort();
    if (unknown.length) throw new Error(`카탈로그에 없는 코드: ${unknown.join(", ")}`);
  });
  check("카탈로그의 코드는 최소 한 번 생산된다(정적 리터럴 한정)", () => {
    // 워커 경계를 건너온 payload처럼 리터럴이 아닌 생산 지점이 있는 코드는 여기서 면제한다.
    // 면제는 목록으로 남긴다: "정적으로 안 보인다"와 "아무도 안 쓴다"는 다르다.
    const dynamicallyProduced = new Set(["PYPROC_INTERNAL", "PYPROC_WORKER_TASK_ERROR"]);
    const orphan = [...codes].filter((code) => !literalCodes.has(code) && !dynamicallyProduced.has(code)).sort();
    if (orphan.length) throw new Error(`선언만 있고 생산되지 않는 코드: ${orphan.join(", ")}`);
  });
}
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
section("API 레퍼런스");
check("api.md가 루트 export 전수를 다룬다", () => {
  const apiDoc = readFileSync(join(ROOT, "docs", "reference", "api.md"), "utf8");
  const missing = Object.keys(api).filter((name) => !mentionsSymbol(apiDoc, name));
  if (missing.length) throw new Error(`api.md 누락: ${missing.join(", ")}`);
});
// 머신 핸들의 멤버는 api.md의 핸들 절에 등재된다. 루트 export만 대조하던 판정은 핸들 동사를
// 못 봤다: `machine.loadPackages`와 `machine.markDirty`를 만든 커밋이 "api.md를 현재 동사에
// 맞춤"이라고 적으면서 정작 그 두 동사를 빠뜨렸고, 어떤 게이트도 그것을 보지 않았다
// (외부 감사 실측, 2026-07-27). 소비자가 읽는 문서에 없는 동사는 자동완성만 얻고 끝난다.
check("머신 핸들 멤버는 api.md 핸들 절에 등재된다", () => {
  const rootDts = readFileSync(join(ROOT, "index.d.ts"), "utf8");
  const apiDoc = readFileSync(join(ROOT, "docs", "reference", "api.md"), "utf8");
  const open = rootDts.indexOf("declare class PyprocMachine {");
  if (open < 0) throw new Error("PyprocMachine 선언을 찾지 못했다");
  let depth = 1;
  let at = rootDts.indexOf("{", open) + 1;
  while (depth > 0 && at < rootDts.length) {
    if (rootDts[at] === "{") depth++;
    else if (rootDts[at] === "}") depth--;
    at++;
  }
  const body = rootDts.slice(open, at);
  const members = new Set();
  for (const line of body.split(NEWLINE)) {
    const m = /^ {2}(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*[(<?:]/.exec(line);
    if (m && m[1] !== "constructor") members.add(m[1]);
  }
  if (members.size < 8) throw new Error(`핸들 멤버를 ${members.size}개만 찾았다(추출이 죽었다)`);
  // api.md의 핸들 절만 본다. 문서 아무 곳의 언급으로 보면 Runtime 탈출구 절의 설명이
  // 핸들 등재를 대신할 수 있다(그것이 정확히 이번에 놓친 형태다).
  const sectionStart = apiDoc.indexOf("## The machine handle");
  const sectionEnd = apiDoc.indexOf("\n## ", sectionStart + 1);
  if (sectionStart < 0 || sectionEnd < 0) throw new Error("api.md의 머신 핸들 절을 찾지 못했다");
  const section = apiDoc.slice(sectionStart, sectionEnd);
  const missing = [...members].filter((name) => !section.includes(`machine.${name}`)).sort();
  if (missing.length) throw new Error(`api.md 핸들 절에 없는 동사: ${missing.join(", ")}`);
});
const capabilityContractProblems = (matrix) => {
  const problems = [];
  for (const pattern of [
    /30-day/i, /\bsoak\b/i, /release has passed/i, /releases elapsed/i,
    /promotion waiting clock/i, /stable since/i,
  ]) {
    if (pattern.test(matrix)) problems.push(`외부 시간 기준: ${pattern}`);
  }
  if (!matrix.includes("## Contract-state criteria")) problems.push("계약 상태 기준 절 없음");
  const tableHeader = matrix.indexOf("| Capability | Product value | Public surface | Contract state |");
  const tableEnd = matrix.indexOf("\n## Product decision rules", tableHeader);
  if (tableHeader < 0 || tableEnd < 0) problems.push("능력 계약 표 경계 없음");
  const states = new Set(["Complete", "Bounded", "Probe", "Engine proof"]);
  const capabilityRows = tableHeader < 0 || tableEnd < 0 ? [] : matrix.slice(tableHeader, tableEnd)
    .split(NEWLINE)
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length === 8 && states.has(cells[3]));
  const complete = capabilityRows.filter((cells) => cells[3] === "Complete").map((cells) => cells[0]).sort();
  const ledgerStart = matrix.indexOf("### Complete capability evidence");
  const ledgerEnd = matrix.indexOf("\nA runnable surface", ledgerStart);
  if (ledgerStart < 0 || ledgerEnd < 0) problems.push("Complete 증거 원장 경계 없음");
  const ledgerRows = ledgerStart < 0 || ledgerEnd < 0 ? [] : matrix.slice(ledgerStart, ledgerEnd)
    .split(NEWLINE)
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length === 6 && cells[0] !== "Surface" && !/^-+$/.test(cells[0]));
  const recorded = ledgerRows.map((cells) => cells[0]).sort();
  if (complete.join("|") !== recorded.join("|")) {
    problems.push(`Complete 표/증거 불일치: ${complete.join(", ")} != ${recorded.join(", ")}`);
  }
  for (const cells of ledgerRows) {
    if (!cells[2].includes("test:browser")) problems.push(`${cells[0]}: 실제 browser gate 없음`);
    if (!cells[3].includes("test:installed")) problems.push(`${cells[0]}: installed-package gate 없음`);
    if (!/RED|negative|corrupt|bad |failure|invalid/i.test(cells[4])) problems.push(`${cells[0]}: 음성 증거 없음`);
    if (!cells[5]) problems.push(`${cells[0]}: 선언 경계 없음`);
  }
  return problems;
};
check("능력 상태 = 자체 불변식 증거(외부 시간·채택 기준 차단)", () => {
  const matrix = readFileSync(join(ROOT, "docs", "usage", "capabilityMatrix.md"), "utf8");
  const problems = capabilityContractProblems(matrix);
  if (problems.length) throw new Error(problems.join("; "));
});
check("탐지기가 문다: 능력 상태 외부 기준과 증거 누락", () => {
  const matrix = readFileSync(join(ROOT, "docs", "usage", "capabilityMatrix.md"), "utf8");
  if (!capabilityContractProblems(`${matrix}\n30-day soak`).length) throw new Error("달력 기준을 놓쳤다");
  const noInstalled = matrix.replace("`npm run test:installed`", "`npm run test:package`");
  if (!capabilityContractProblems(noInstalled).length) throw new Error("설치 package 증거 누락을 놓쳤다");
  if (capabilityContractProblems(matrix).length) throw new Error("자체 불변식 원장을 불합격시켰다(오탐)");
});
// 영문 비교 페이지 게이트는 제거했다(2026-07-17). 그 게이트는 경쟁 비교 게시를 강제해
// 숫자 자랑 금지 규칙과 정면으로 충돌했다. 비교는 재현 가능한 로컬 벤치 도구로만 수행한다.
check("공개 문서 인프라 존재(CHANGELOG/SECURITY/glossary)", () => {
  for (const f of ["CHANGELOG.md", "SECURITY.md", join("docs", "product", "glossary.md")]) {
    if (!existsSync(join(ROOT, f))) throw new Error(`${f} 없음`);
  }
  const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
  if (!changelog.includes("## Unreleased")) throw new Error("CHANGELOG에 Unreleased 절 없음");
});

// 3.5) 사이트 크롬: 채널(SNS) 행은 라우트마다 고정이고 정의처는 examples/siteChrome.js 하나다.
//      라우트가 늘 때 채널을 빠뜨리거나 마크업을 다시 인라인으로 복제하는 드리프트를 차단한다.
section("사이트 크롬");
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
  const docsMap = readFileSync(join(ROOT, "docs", "README.md"), "utf8");
  const speedLab = readFileSync(join(ROOT, "examples", "speedLab.html"), "utf8");
  const speedBench = readFileSync(join(ROOT, "tests", "browser", "speedBench.mjs"), "utf8");
  const benchArtifact = readFileSync(join(ROOT, "tests", "browser", "benchArtifact.mjs"), "utf8");
  const benchArtifacts = readFileSync(join(ROOT, "tests", "browser", "benchArtifacts.mjs"), "utf8");
  const benchCompare = readFileSync(join(ROOT, "tests", "browser", "benchCompare.mjs"), "utf8");
  const pkgForBench = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  for (const term of ["S0", "S0C", "S1", "S1L", "S2", "S3", "S4", "S5", "median", "p95", "raw output"]) {
    if (!contract.includes(term)) throw new Error(`benchmarking.md 필수 항목 누락: ${term}`);
  }
  for (const term of ["schema v2", "schemaVersion", "scenarioDefinition", "measurement", "environment", "evidence", "commit", "command", "browser", "engine", "samples", "metrics"]) {
    if (!contract.includes(term)) throw new Error(`실측 봉투 필드 누락: ${term}`);
  }
  if (!docsMap.includes("operations/benchmarking.md")) throw new Error("docs 지도에 benchmarking.md 없음");
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
  const installedPackageGate = readFileSync(join(ROOT, "tests", "browser", "installedPackageGate.mjs"), "utf8");
  const immortalProductGate = readFileSync(join(ROOT, "tests", "browser", "immortalProductGate.js"), "utf8");
  for (const term of ["machineExportMs", "machineOpenMs", "machineMB", "machineResumeRows"]) {
    if (!installedPackageGate.includes(term)) throw new Error(`installedPackageGate.mjs S4 timing 누락: ${term}`);
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
section("브랜드");
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
section("타입");
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
// d.ts 멤버 -> src 구현 도달성. 타입체크는 선언끼리의 정합만 보므로 "구현이 없는 선언"을
// 통과시킨다(실측 2026-07-27: PyProc.mapSerial, PyProc.interrupt가 그렇게 살아 있었다).
// 소비자는 d.ts를 계약으로 읽고 자동완성으로 호출하므로, 없는 멤버 선언은 런타임
// TypeError를 타입 통과로 위장시킨다.
//
// 판정은 수신자별이다. 첫 판본은 클래스별 집합을 만들고도 저장소 전역 이름 집합(1151개)과
// OR했다: 그래서 "없는 이름"은 잡았지만 "엉뚱한 클래스에 붙은 이름"은 통과했다. 외부 감사가
// 지적한 대로 그것은 `usesDevice`가 틀린 인터페이스에 있던 결함과 같은 종류이므로, 그 게이트는
// 자기 커밋이 고친 세 번째 항목을 잡을 수 없었다. 전역 폴백을 없애고, 클래스 밖에서 붙는 멤버는
// 이름과 근거로 승인한다(승인 목록의 diff가 심사 지점이다).
const EXTERNALLY_ATTACHED_MEMBERS = Object.freeze({
  // installRuntimeCapabilities가 Runtime.prototype에 심는 능력 배선(레지스트리가 유일 진실).
  Runtime: ["enableReactive", "enableSyscallBridge", "enableAsgiServer", "enableVirtualOrigin",
    "enableTerminal", "enableJail", "enableWheelCache", "enableDeviceFs", "enableInit", "enableJournal",
    // 부팅 경로가 인스턴스에 붙이는 통계(envManager / runtime.boot).
    "envBoot", "coreCache"],
});
check("d.ts declare class 멤버는 src에 구현이 있다", () => {
  const blockAfter = (text, openIndex) => {
    let depth = 1;
    let i = openIndex + 1;
    while (depth > 0 && i < text.length) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      i++;
    }
    return text.slice(openIndex + 1, i - 1);
  };
  // `class Name` 위치는 문자 스캔으로 찾는다. new RegExp + 템플릿 리터럴은 \b를 U+0008로
  // 만들어 검사를 조용히 죽인다(이 저장소에서 세 번 난 사고다. [제어문자] 절이 그 짝이다).
  const classBody = (text, name) => {
    const needle = "class " + name;
    let from = 0;
    for (;;) {
      const at = text.indexOf(needle, from);
      if (at < 0) return null;
      const after = text[at + needle.length];
      if (after === undefined || !/[\w$]/.test(after)) {
        const open = text.indexOf("{", at);
        if (open >= 0) return blockAfter(text, open);
      }
      from = at + needle.length;
    }
  };
  const MEMBER_DECL = /^ {2}(?:readonly\s+|static\s+)*([A-Za-z_$][\w$]*)\s*[(<?:]/;
  const MEMBER_IMPL = /^ {2}(?:async\s+|static\s+|get\s+|set\s+|\*)*([A-Za-z_$][\w$]*)\s*[(=]/;
  const rootDts = readFileSync(join(ROOT, "index.d.ts"), "utf8");
  const srcText = collect(join(ROOT, "src"), [".js"], []).map((f) => readFileSync(f, "utf8"));
  const implemented = new Set();
  for (const text of srcText) {
    // 레지스트리 배선(`enableX: { value(...) }`), 객체 리터럴 메서드, 밖에서 붙는 멤버.
    for (const m of text.matchAll(/^ {2,6}([A-Za-z_$][\w$]*):\s*\{?\s*$/gm)) implemented.add(m[1]);
    for (const m of text.matchAll(/^ {2,6}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)) implemented.add(m[1]);
    for (const m of text.matchAll(/^ {2,6}(?:get\s+)?([A-Za-z_$][\w$]*):\s*(?:\(|function|async|[a-zA-Z_$])/gm)) implemented.add(m[1]);
    for (const m of text.matchAll(/\.([A-Za-z_$][\w$]*)\s*=[^=]/g)) implemented.add(m[1]);
  }
  const dead = [];
  for (const declaration of rootDts.matchAll(/declare class (\w+)[^{]*\{/g)) {
    const name = declaration[1];
    const body = blockAfter(rootDts, declaration.index + declaration[0].length - 1);
    const own = new Set();
    for (const text of srcText) {
      const implBody = classBody(text, name);
      if (!implBody) continue;
      for (const line of implBody.split(NEWLINE)) {
        const m = MEMBER_IMPL.exec(line);
        if (m) own.add(m[1]);
      }
      for (const m of implBody.matchAll(/this\.([A-Za-z_$][\w$]*)\s*=/g)) own.add(m[1]);
    }
    const approved = new Set(EXTERNALLY_ATTACHED_MEMBERS[name] || []);
    for (const line of body.split(NEWLINE)) {
      const m = MEMBER_DECL.exec(line);
      if (!m || m[1] === "constructor") continue;
      // 같은 이름의 클래스 본문에 있거나, 이 클래스에 밖에서 붙는다고 승인된 것만 구현이다.
      if (!own.has(m[1]) && !approved.has(m[1])) dead.push(`${name}.${m[1]}`);
    }
  }
  if (dead.length) throw new Error(`구현 없는 d.ts 멤버 선언: ${dead.join(", ")}`);
});
// 멤버 도달성만 보면 "클래스 자체에 닿을 방법이 없는" 경우를 놓친다. 실측(2026-07-27):
// MachineContainer와 JobControl은 api.md와 capabilityMatrix가 공개 능력으로 설명하고
// index.d.ts가 public constructor까지 선언했는데, package exports에도 없고 어떤 핸들의 동사도
// 아니어서 소비자가 만들 방법이 없었다(0.0.10 개명에서 값-export를 잃고 배선을 못 받은 자리).
// 도달 경로 셋 중 하나는 있어야 한다: (1) 값-export, (2) enable* 바인딩, (3) 핸들의 동사 반환형.
// 타입으로만 사는 것이 정직한 선언. 각 항목은 판단 기록이다: 왜 소비자가 만들 필요가 없는지가
// 여기 남아야 목록이 "설명 못 하는 것을 담는 자리"로 썩지 않는다.
const TYPE_ONLY_CLASSES = Object.freeze({
  Session: "내부 세션 클래스. 소비자는 machine.history로 말하고 boot({deterministic})이 만든다",
  PyodideEngine: "Runtime이 로드된 Pyodide를 직접 받으므로(new Runtime(py)) 소비자가 어댑터를 만들 일이 없다",
});
check("d.ts declare class는 소비자가 닿을 경로가 있다", () => {
  const rootDts = readFileSync(join(ROOT, "index.d.ts"), "utf8");
  const declared = [...rootDts.matchAll(/declare class (\w+)/g)].map((m) => m[1]);
  // 반환형/속성형으로 등장하면 어떤 핸들을 통해 얻는다는 뜻이다(예: proc(): Promise<PyProc>).
  const referencedAsType = new Set();
  for (const m of rootDts.matchAll(/:\s*(?:Promise<)?([A-Z]\w*)/g)) referencedAsType.add(m[1]);
  const bindings = new Set();
  for (const f of collect(join(ROOT, "src", "composition"), [".js"], [])) {
    for (const m of readFileSync(f, "utf8").matchAll(/^ {2}(enable[A-Za-z]*):/gm)) bindings.add(m[1]);
  }
  const exported = new Set(Object.keys(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).exports || {}));
  const unreachable = [];
  for (const name of declared) {
    if (name in TYPE_ONLY_CLASSES) continue;
    // 값-export로 나가는가(루트 또는 강등 subpath의 export 선언).
    if (new RegExp(`export (?:declare )?(?:class|const|function) ${name}\\b`).test(rootDts)) continue;
    if (bindings.has(`enable${name}`)) continue;
    // 핸들 동사의 반환형으로 나가는가. `declare class X`의 선언 자리 자체는 세지 않는다.
    if (referencedAsType.has(name)) continue;
    unreachable.push(name);
    void exported;
  }
  if (unreachable.length) {
    throw new Error(`소비자가 만들 수 없는 공개 클래스: ${unreachable.join(", ")}(값-export, enable* 바인딩, 핸들 동사 중 하나가 필요하다)`);
  }
});
check("d.ts subpath 값 선언(assets/history)", () => {
  const assetsDts = readFileSync(join(ROOT, "src", "runtime", "assets.d.ts"), "utf8");
  for (const sym of ["getPyProcAssetManifest", "verifyPyProcAssetIntegrity", "registerPyProcServiceWorker", "PYPROC_ASSET_MANIFEST_VERSION"]) {
    if (!new RegExp(`^export (?:function|const) ${sym}\\b`, "m").test(assetsDts)) throw new Error(`assets.d.ts: ${sym}`);
  }
  const stateDts = readFileSync(join(ROOT, "src", "state", "index.d.ts"), "utf8");
  // 폴백(`|| includes(sym)`)과 깨진 이스케이프가 있던 자리다: 실효 검사가 "이름이 파일
  // 어딘가에 문자열로 있는가"로 축소돼, 선언을 지우고 주석에만 남겨도 통과했다.
  for (const sym of ["commitState", "openState", "encodeStateBundle", "decodeStateBundle", "PAGE_SIZE"]) {
    if (!new RegExp(`^export (?:function|const) ${sym}\\b`, "m").test(stateDts)) throw new Error(`state/index.d.ts: ${sym}`);
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
  // `pyproc/runtime`을 단독으로 import한 소비자가 완전한 Runtime을 받는가. 능력 팩토리는
  // runtimeApi가 import 시점에 prototype에 설치하므로, subpath가 rank 0 배럴을 직접 가리키면
  // 그것만 import한 소비자는 팩토리 없는 Runtime을 받는다: 문서가 지시하는 채택 패턴
  // (`new Runtime(py)` 후 `enableAsgiServer`)이 TypeError로 죽는다. 2026-07-27 workerGuest
  // 캠페인이 라이브로 재현했고, 그때까지 어떤 게이트도 이것을 보지 않았다.
  // 격리 import로 판정한다: 같은 프로세스에서 루트를 먼저 import하면 prototype이 이미 오염돼
  // 있어서 어떤 타깃이든 통과한다(첫 진단이 그렇게 틀렸다).
  await checkAsync("pyproc/runtime 단독 import가 완전한 Runtime을 준다", async () => {
    const pkgJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const target = pkgJson.exports["./runtime"]?.default;
    if (!target) throw new Error("./runtime default 타깃 없음");
    const result = spawnSync(process.execPath, ["-e", `
      import(${JSON.stringify(pathToFileURL(join(ROOT, target)).href)}).then((m) => {
        const missing = ["enableReactive", "enableAsgiServer", "enableTerminal", "enableJail"]
          .filter((name) => typeof m.Runtime?.prototype?.[name] !== "function");
        const verbs = ["bootRuntime", "Runtime", "checkEnvironment"]
          .filter((name) => typeof m[name] === "undefined");
        process.stdout.write(JSON.stringify({ missing, verbs }));
      }).catch((e) => { process.stdout.write(JSON.stringify({ error: String(e.message || e) })); });
    `], { encoding: "utf8" });
    const out = JSON.parse((result.stdout || "{}").trim() || "{}");
    if (out.error) throw new Error(`격리 import 실패: ${out.error}`);
    if (out.missing?.length) throw new Error(`능력 팩토리 없음: ${out.missing.join(", ")}(subpath가 조립 지점을 안 지난다)`);
    if (out.verbs?.length) throw new Error(`값-export 없음: ${out.verbs.join(", ")}`);
  });
check("강등 subpath 타입은 자기 .js 옆에", () => {
  for (const rel of SUBPATH_DTS) {
    if (!existsSync(join(ROOT, rel))) throw new Error(`${rel} 없음`);
    const js = rel.replace(/\.d\.ts$/, ".js");
    if (!existsSync(join(ROOT, js))) throw new Error(`${js} 없음(d.ts가 짝 없이 떠 있다)`);
    const target = Object.values(pkg.exports).find((t) => {
      const resolved = typeof t === "string" ? t : t?.default;
      return resolved === "./" + js;
    });
    if (!target) throw new Error(`${js}가 exports subpath가 아니다`);
  }
  if (readFileSync(join(ROOT, "index.d.ts"), "utf8").includes('declare module "pyproc/')) {
    throw new Error("index.d.ts의 declare module 블록: 형제 d.ts로 옮겨야 한다(TS2665)");
  }
});
check("타입 계약 게이트 배선", () => {
  if (pkg.scripts?.["test:types"] !== "tsc -p tests/tsconfig.json") throw new Error("test:types 누락 또는 lockfile compiler 미사용");
  const cfg = JSON.parse(readFileSync(join(ROOT, "tests", "tsconfig.json"), "utf8"));
  // skipLibCheck는 .d.ts 검사 자체를 건너뛴다. 켜지면 게이트가 조용히 통과한다.
  if (cfg.compilerOptions?.skipLibCheck !== false) throw new Error("skipLibCheck가 false가 아니다(게이트가 조용히 통과한다)");
  if (cfg.compilerOptions?.strict !== true) throw new Error("strict 필요");
  for (const rel of ["../index.d.ts", ...SUBPATH_DTS.map((p) => "../" + p)]) {
    if (!cfg.files.includes(rel)) throw new Error(`tsconfig files에 ${rel} 누락`);
  }
});
check("package.json bin -> asset와 엔진 준비 CLI", () => {
  if (pkg.bin?.["pyproc-assets"] !== "./scripts/assetManifest.mjs") throw new Error("pyproc-assets bin 누락");
  if (pkg.bin?.["pyproc-engine"] !== "./scripts/fetchEngine.mjs") throw new Error("pyproc-engine bin 누락");
  if (!pkg.files.includes("scripts/assetManifest.mjs")) throw new Error("files에 assetManifest.mjs 누락");
  for (const file of ["scripts/fetchEngine.mjs", "scripts/assetCatalog.json"]) {
    if (!pkg.files.includes(file)) throw new Error(`files에 ${file} 누락`);
  }
});
check("package.json 소비자 게이트 스크립트", () => {
  if (pkg.scripts?.["test:package"] !== "node tests/packageGate.mjs") throw new Error("test:package 누락");
  if (pkg.scripts?.["test:installed"] !== "node tests/browser/installedPackageGate.mjs") throw new Error("test:installed 누락");
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
  const allowed = new Set([".", "./runtime", "./history", "./machine", "./worker", "./assets", "./gpu", "./socket", "./wasi"]);
  const keys = Object.keys(pkg.exports);
  for (const key of keys) {
    if (!allowed.has(key)) throw new Error(`승인 안 된 export key: ${key}`);
    if (key.startsWith("./src/")) throw new Error(`src deep export 금지: ${key}`);
  }
  for (const key of allowed) if (!keys.includes(key)) throw new Error(`export key 누락: ${key}`);
  if (pkg.exports["./history"]?.default !== "./src/state/index.js") throw new Error("pyproc/history는 state 배럴을 가리켜야 함");
});

// 4.5) README 표면 동기화: index.js의 모든 export가 양쪽 README에 등장해야 한다.
//      승격이 문서를 앞지르는 드리프트를 차단한다(계약 실태 표의 부채 해소, 2026-07-12).
section("README 표면");
for (const readme of ["README.md", "README.ko.md"]) {
  check(`${readme}가 공개 표면 전부 언급`, () => {
    const text = readFileSync(join(ROOT, readme), "utf8");
    const missing = Object.keys(api).filter((name) => !mentionsSymbol(text, name));
    if (missing.length) throw new Error(`표면 누락: ${missing.join(", ")}`);
  });
}
// 목차는 제목과 함께 움직여야 한다. 손으로 유지하는 목차는 절을 추가·개명할 때 조용히
// 표류하고, 표류한 목차는 없는 목차보다 나쁘다(독자를 없는 앵커로 보낸다).
for (const readme of ["README.md", "README.ko.md"]) {
  check(`${readme} 목차 = 제목 집합`, () => {
    const text = readFileSync(join(ROOT, readme), "utf8");
    const block = /<summary><b>(?:Contents|목차)<\/b><\/summary>([\s\S]*?)<\/details>/.exec(text);
    if (!block) throw new Error("목차 블록 없음");
    // GitHub 앵커 규칙: 유니코드 문자·숫자를 보존한다(ASCII \w로 깎으면 한국어 제목이 빈다).
    const slug = (title) => title.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-");
    const titles = [...text.matchAll(/^## (.+)$/gm)].map((m) => slug(m[1]));
    const anchors = [...block[1].matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    const missing = titles.filter((title) => !anchors.includes(title));
    const stale = anchors.filter((anchorId) => !titles.includes(anchorId));
    if (missing.length) throw new Error(`목차 누락: ${missing.slice(0, 4).join(", ")}`);
    if (stale.length) throw new Error(`죽은 목차 앵커: ${stale.slice(0, 4).join(", ")}`);
  });
}
check("README가 root 제품 진입점을 한 표에 모음", () => {
  const readmeEn = readFileSync(join(ROOT, "README.md"), "utf8");
  const readmeKo = readFileSync(join(ROOT, "README.ko.md"), "utf8");
  if (!readmeEn.includes("| You need | Root entry | Returned handle and capability path |")) throw new Error("README.md 제품 진입점 표 누락");
  if (!readmeKo.includes("| 필요한 것 | root 진입점 | 반환 handle과 capability 경로 |")) throw new Error("README.ko.md 제품 진입점 표 누락");
  if (readmeEn.includes("| Export | What |")) throw new Error("README.md가 장황한 export 설명표로 회귀");
  if (readmeKo.includes("| Export | 무엇 |")) throw new Error("README.ko.md가 장황한 export 설명표로 회귀");
});
check("단일 Machine 제품 언어와 의존성 경계가 공개 표면에 고정", () => {
  const readmeEn = readFileSync(join(ROOT, "README.md"), "utf8");
  const readmeKo = readFileSync(join(ROOT, "README.ko.md"), "utf8");
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const vision = readFileSync(join(ROOT, "docs", "product", "vision.md"), "utf8");
  const webComputer = readFileSync(join(ROOT, "apps", "webComputer", "index.html"), "utf8");

  for (const [surface, source, required] of [
    ["README.md", readmeEn, [
      "A persistent Python computer in your browser.",
      "## Product model",
      "## One machine lifecycle",
      "## Dependency boundary",
      "Zero runtime npm dependencies is an exact package fact",
      "| **Machine** | `open()` by default; `boot()` for an explicit transient kernel |",
      "| **Workspace** | `open({ name })` + `/home/web` |",
      "Make the browser a persistent computer, make Python its default Machine",
    ]],
    ["README.ko.md", readmeKo, [
      "브라우저에 영속하는 파이썬 컴퓨터.",
      "## 제품 모델",
      "## 하나의 Machine 생명주기",
      "## 의존성 경계",
      "runtime npm 의존성 0은 정확한 package 사실",
      "| **Machine** | 기본 `open()`, 명시적 휘발 kernel은 `boot()` |",
      "| **Workspace** | `open({ name })` + `/home/web` |",
      "브라우저를 영속하는 컴퓨터로 만들고, Python을 기본 Machine으로 삼으며",
    ]],
    ["docs/product/vision.md", vision, ["pyproc is a persistent Python computer"]],
    ["apps/webComputer/index.html", webComputer, ["Python as the default Machine"]],
  ]) {
    for (const term of required) {
      if (!source.includes(term)) throw new Error(`${surface} 단일 제품 계약 누락: ${term}`);
    }
  }
  if (!packageJson.description.includes("A persistent Python computer in the browser")) {
    throw new Error("package.json description이 Machine 제품 언어와 불일치");
  }
  if (Object.keys(packageJson.dependencies || {}).length) {
    throw new Error("runtime npm dependency 0 계약과 package.json이 불일치");
  }
  for (const [surface, source] of [["README.md", readmeEn], ["README.ko.md", readmeKo]]) {
    if (source.includes("badge/dependencies-0") || source.includes('alt="zero dependencies"')) {
      throw new Error(`${surface}가 npm·engine·platform 의존성을 한데 뭉친다`);
    }
  }
  if (landing.includes("Consumer contract")) throw new Error("랜딩 package 계약 명칭 회귀");
});
// 랜딩 벤치 메시지 게이트는 제거했다(2026-07-17). 이 게이트는 랜딩에 박힌 측정치(3.95x, 18ms,
// 76ms, 10.8MB ...)를 필수로 강제하고 '낡은 벤치 숫자' 목록까지 따로 관리했다. 숫자를 간판으로
// 걸면 그 숫자를 영원히 방어해야 한다는 규칙의 근거가 바로 이 게이트였다. 성능 주장 가드가 대신한다.
check("랜딩이 Machine 계약 판단 경로를 직접 노출", () => {
  for (const term of [
    '<a href="#build">Contract</a>',
    '<h2 id="build">Build on the Machine contract</h2>',
    "Use the gathered root entrances, named plumbing subpaths, and documented execution assets, never engine internals.",
    "Product entrances",
    "Capability matrix",
    "Package contract",
    "Benchmark contract",
    "Pin an exact npm version.",
  ]) {
    if (!landing.includes(term)) throw new Error(`examples/index.html Machine 계약 경로 누락: ${term}`);
  }
  for (const url of [
    "https://github.com/eddmpython/pyproc#product-entrances",
    "https://github.com/eddmpython/pyproc/blob/main/docs/usage/capabilityMatrix.md",
    "https://github.com/eddmpython/pyproc/blob/main/docs/usage/contract.md",
    "https://github.com/eddmpython/pyproc/blob/main/docs/operations/benchmarking.md",
  ]) {
    if (!landing.includes(`href="${url}"`)) throw new Error(`examples/index.html GitHub 문서 링크 누락: ${url}`);
  }
  if (/href="docs\//.test(landing)) throw new Error("Pages 배포에서 깨질 로컬 docs 링크 사용");
});
check("사용 문서 역할 분리", () => {
  const contract = readFileSync(join(ROOT, "docs", "usage", "contract.md"), "utf8");
  const docsMap = readFileSync(join(ROOT, "docs", "README.md"), "utf8");
  if (!contract.includes("The roles are split.")) throw new Error("contract.md 역할 분리 선언 누락");
  if (!contract.includes("## Public import boundary")) throw new Error("contract.md import 경계 절 누락");
  if (!contract.includes("## Runtime-asset deployment contract")) throw new Error("contract.md 실행 자산 배포 절 누락");
  if (!contract.includes("## Contract verification")) throw new Error("contract.md 계약 검증 절 누락");
  if (!contract.includes("### Installed-package browser gate coverage")) throw new Error("contract.md 설치 패키지 브라우저 게이트 coverage 절 누락");
  if (!contract.includes("[capabilityMatrix.md](capabilityMatrix.md): per-capability intrinsic value")) throw new Error("contract.md가 capability matrix 역할을 위임하지 않음");
  if (contract.includes("| export | what |")) throw new Error("contract.md가 capability별 export 설명표로 회귀");
  if (!docsMap.includes("install, version pinning, import boundaries, runtime-asset deployment")) throw new Error("docs/README.md contract 역할 설명이 낡음");
});
check("공개 표면은 명명된 외부 저장소를 기록하지 않는다", () => {
  const contract = readFileSync(join(ROOT, "docs", "usage", "contract.md"), "utf8");
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  for (const term of ["## Package surface boundary", "Package-internal paths are never public."]) {
    if (!contract.includes(term)) throw new Error(`package boundary 누락: ${term}`);
  }
  if (readme.includes("## Who uses it")) throw new Error("README에 외부 사용 목록이 재등장했다");

  const forbiddenNames = ["eGxwb2Q=", "ZGFydGxhYg==", "Y29kYXJv"].map((value) =>
    Buffer.from(value, "base64").toString("utf8"));
  const forbiddenFraming = [
    "cHJvZHVjdCBjb25zdW1lcg==",
    "cGVyLWNvbnN1bWVy",
    "Y29uc3VtZXIgc3VwcG9ydA==",
    "Y29uc3VtaW5nIHByb2R1Y3Q=",
    "cGVyLXByb2R1Y3Q=",
    "Y29uc3VtcHRpb24gY29udHJhY3Q=",
  ].map((value) => Buffer.from(value, "base64").toString("utf8"));
  forbiddenFraming.push(
    String.fromCodePoint(0xc18c, 0xbe44, 0xc790, 0x20, 0xc9c0, 0xc6d0),
    String.fromCodePoint(0xc18c, 0xbe44, 0x20, 0xc81c, 0xd488),
    String.fromCodePoint(0xc18c, 0xbe44, 0x20, 0xacc4, 0xc57d),
  );
  const forbiddenLegacyNames = [
    "dGVzdDpjb25zdW1lcg==",
    "cHJvZHVjdGNvbnN1bWVy",
    "cGFja2FnZWNvbnN1bWVy",
    "Y29uc3VtZXJhZG9wdA==",
  ].map((value) => Buffer.from(value, "base64").toString("utf8"));
  const textExtensions = [".md", ".js", ".mjs", ".ts", ".html", ".json", ".yml", ".yaml", ".css", ".sh"];
  const assertIndependentSurface = (entries) => {
    for (const [path, text] of entries) {
      const lowered = text.toLowerCase();
      const loweredPath = path.toLowerCase();
      if (forbiddenNames.some((name) => lowered.includes(name))) {
        throw new Error(`명명된 외부 저장소가 남았다: ${path}`);
      }
      if (forbiddenFraming.some((term) => lowered.includes(term))) {
        throw new Error(`외부 지원 프레이밍이 남았다: ${path}`);
      }
      if (forbiddenLegacyNames.some((term) => lowered.includes(term) || loweredPath.includes(term))) {
        throw new Error(`레거시 호환 식별자가 남았다: ${path}`);
      }
    }
  };
  const texts = [...repositorySurfaceFiles]
    .filter((path) => textExtensions.some((extension) => path.endsWith(extension)))
    .map((path) => [path, readFileSync(join(ROOT, path), "utf8")]);
  assertIndependentSurface(texts);
  let caught = false;
  try { assertIndependentSurface([["fixture.md", forbiddenNames[0]]]); }
  catch { caught = true; }
  if (!caught) throw new Error("명명 저장소 음성 fixture를 놓쳤다");
  caught = false;
  try { assertIndependentSurface([["fixture.md", forbiddenFraming[0]]]); }
  catch { caught = true; }
  if (!caught) throw new Error("외부 지원 프레이밍 음성 fixture를 놓쳤다");
  caught = false;
  try { assertIndependentSurface([[forbiddenLegacyNames[0], "fixture"]]); }
  catch { caught = true; }
  if (!caught) throw new Error("레거시 호환 식별자 음성 fixture를 놓쳤다");
});
check("durable RPC 상태표와 공개 투영이 한 의미다", () => {
  const paths = [
    "README.md",
    "README.ko.md",
    "SECURITY.md",
    "docs/reference/api.md",
    "docs/usage/contract.md",
    "docs/usage/capabilityMatrix.md",
    "docs/operations/contractReality.md",
  ];
  const texts = new Map(paths.map((path) => [path, readFileSync(join(ROOT, path), "utf8")]));
  const anchor = "durable-rpc-state-table-normative";
  const contract = texts.get("docs/usage/contract.md");
  const assertProjection = (documents) => {
    const canonical = documents.get("docs/usage/contract.md") || "";
    for (const term of [
      "### Durable RPC state table (normative)",
      "Leader stays live and the caller timer expires",
      "No or proxy present",
      "Outcome in recovered generation",
      "Caller leaves or its browsing context disappears",
      "`PYPROC_RPC_OUTCOME_UNKNOWN`, `retryable=false`",
    ]) {
      if (!canonical.includes(term)) throw new Error(`contract.md 상태표 축 누락: ${term}`);
    }
    for (const [path, text] of documents) {
      if (path === "docs/usage/contract.md") continue;
      if (!text.includes(anchor)) throw new Error(`${path} durable RPC 정본 포인터 누락`);
    }
  };
  assertProjection(texts);
  for (const stale of [
    "sent request is never auto-replayed; leader change or timeout means outcome unknown",
    "On a durable machine a leader change instead parks the command",
    "An RPC cut off after being sent has an unknown outcome and is never replayed automatically",
  ]) {
    for (const [path, text] of texts) if (text.includes(stale)) throw new Error(`${path} 낡은 blanket RPC 주장: ${stale}`);
  }
  const runtime = readFileSync(join(ROOT, "src", "session", "kernelElection.js"), "utf8");
  for (const term of ["timeout or unprovable failover: outcome unknown", "durable proven-portable failover: resend once by requestId"]) {
    if (!runtime.includes(term)) throw new Error(`runtime status 의미 누락: ${term}`);
  }
  // 음성 fixture: 표 머리글만 지우면 포인터가 남아 있어도 검출기가 반드시 RED여야 한다.
  const broken = new Map(texts);
  broken.set("docs/usage/contract.md", contract.replace("### Durable RPC state table (normative)", "### RPC notes"));
  let caught = false;
  try { assertProjection(broken); }
  catch { caught = true; }
  if (!caught) throw new Error("durable RPC 상태표 음성 fixture를 놓쳤다");
});
check("shipped subpath 실행 증거가 CI와 계약 실태에서 정합", () => {
  const reality = readFileSync(join(ROOT, "docs", "operations", "contractReality.md"), "utf8");
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const socketScript = pkg.scripts?.["test:socket"];
  const staleClaims = [
    "`pyproc/gpu` and `pyproc/socket` have zero headless CI gates",
    "The GPU and socket subpaths have no headless CI gate",
    "Build that socket lane",
  ];
  const assertEvidence = (text) => {
    if (!socketScript) throw new Error("package.json test:socket 누락");
    if (!ci.includes("npm run test:socket")) throw new Error("ci.yml test:socket 실행 누락");
    if (!text.includes("The GPU subpath has no headless execution gate")) {
      throw new Error("contractReality.md GPU 단독 실행 증거 부채 누락");
    }
    if (!text.includes("`test:socket`")) throw new Error("contractReality.md socket 게이트 증거 누락");
    for (const stale of staleClaims) {
      if (text.includes(stale)) throw new Error(`contractReality.md 낡은 실행 증거 주장: ${stale}`);
    }
  };
  assertEvidence(reality);
  // 음성 fixture: 과거의 GPU/socket 일괄 무게이트 주장이 돌아오면 반드시 RED여야 한다.
  let caught = false;
  try { assertEvidence(`${reality}\nThe GPU and socket subpaths have no headless CI gate`); }
  catch { caught = true; }
  if (!caught) throw new Error("shipped subpath 실행 증거 음성 fixture를 놓쳤다");
});
check("Python-Linux 교차 엔진 packet 경로가 cold restore까지 실증", () => {
  const page = readFileSync(join(ROOT, "tests", "webMachine", "browser", "probes", "packetNetworkProbe.html"), "utf8");
  const runner = readFileSync(join(ROOT, "tests", "webMachine", "run.mjs"), "utf8");
  const assertCrossEngine = (source) => {
    for (const term of [
      "createPyprocGuestFactory",
      'machineId: "pythonOs"',
      "PYPROC_TO_LINUX_WIRE",
      "/sys/class/net/eth0/statistics/rx_packets",
      "machines: [python, linux]",
      "machines: { pythonOs: python, linuxOs: linux }",
      "Linux -> Python ICMP",
      "Python -> Linux frame",
    ]) {
      if (!source.includes(term)) throw new Error(`packetNetworkProbe 교차 엔진 증거 누락: ${term}`);
    }
    if (source.includes("createIpv4EchoPeer")) throw new Error("packetNetworkProbe가 실제 Python 대신 JS peer를 사용");
  };
  assertCrossEngine(page);
  if (!runner.includes('"tests/webMachine/browser/probes/packetNetworkProbe.html"')) throw new Error("packetNetworkProbe 실행 레인 누락");
  let caught = false;
  try { assertCrossEngine(page.replace("machines: [python, linux]", "machines: [linux]")); }
  catch { caught = true; }
  if (!caught) throw new Error("교차 엔진 generation 음성 fixture를 놓쳤다");
});
check("설치 패키지 브라우저 게이트 coverage가 실제 게이트와 정합", () => {
  const contract = readFileSync(join(ROOT, "docs", "usage", "contract.md"), "utf8");
  const testing = readFileSync(join(ROOT, "docs", "operations", "testing.md"), "utf8");
  const packageGate = readFileSync(join(ROOT, "tests", "packageGate.mjs"), "utf8");
  const installedPackageGate = readFileSync(join(ROOT, "tests", "browser", "installedPackageGate.mjs"), "utf8");
  const immortalGate = readFileSync(join(ROOT, "tests", "browser", "immortalProductGate.js"), "utf8");
  const immortalParticipant = readFileSync(join(ROOT, "tests", "browser", "immortalProductParticipant.html"), "utf8");
  const expectedTable = installedPackageCoverage.renderInstalledPackageCoverageMarkdown();
  if (!contract.includes(expectedTable)) throw new Error("contract.md 설치 패키지 coverage 표가 installedPackageCoverage.mjs 렌더링과 불일치");
  if (!installedPackageGate.includes("installedPackageCoverageManifest")) throw new Error("installedPackageGate.mjs가 coverage manifest SSOT를 import하지 않음");
  if (!installedPackageGate.includes("coverageManifest")) throw new Error("installedPackageGate.mjs가 coverage manifest를 report하지 않음");
  if (!installedPackageGate.includes("installed-package coverage manifest")) throw new Error("installedPackageGate.mjs가 coverage manifest report 검증을 출력하지 않음");
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
    if (!mentionsSymbol(contract, name)) throw new Error(`contract.md consumer coverage export 누락: ${name}`);
    if (!installedPackageGate.includes(name)) throw new Error(`installedPackageGate.mjs export 사용 누락: ${name}`);
  }
  for (const term of [
    "pyproc/assets",
    "pyproc/history",
    "pyproc/machine",
    "commitState",
    "pyproc-assets",
    "pyproc-engine",
    "--copy-to",
  ]) {
    if (!packageGate.includes(term)) throw new Error(`packageGate.mjs 설치 패키지 표면 검사 누락: ${term}`);
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
    if (!installedPackageGate.includes(term)) throw new Error(`installedPackageGate.mjs coverage check 누락: ${term}`);
  }
  for (const term of [
    "default durable Machine",
    "durable auto-commit",
    "installed machine elects exactly one leader across browsing contexts",
    "installed machine survives forced leader context removal",
    "installed timeout/failover RPC rejects unknown outcome, ignores late response and never replays",
    "collision-free request IDs",
    "installed machine cold-reopens auto-committed heap and home after all participants close",
    "prepared environment",
    "productPrepared",
    "PYPROC_RPC_OUTCOME_UNKNOWN",
  ]) {
    if (!immortalGate.includes(term) && !immortalParticipant.includes(term)) throw new Error(`immortal installed-package coverage 누락: ${term}`);
  }
  if (!installedPackageGate.includes("runImmortalProductGate")) throw new Error("installedPackageGate.mjs가 immortal product gate를 실행하지 않음");
  if (!immortalParticipant.includes('from "pyproc"')) throw new Error("immortal participant가 설치 패키지 root export를 쓰지 않음");
  if (!testing.includes("설치 패키지 브라우저 게이트 coverage 표")) throw new Error("testing.md 설치 패키지 coverage 표 포인터 누락");
});
check("능력 매트릭스가 자체 capability 계약을 고정", () => {
  const matrixPath = join(ROOT, "docs", "usage", "capabilityMatrix.md");
  if (!existsSync(matrixPath)) throw new Error("capabilityMatrix.md 없음");
  const matrix = readFileSync(matrixPath, "utf8");
  const docsMap = readFileSync(join(ROOT, "docs", "README.md"), "utf8");
  const readmeEn = readFileSync(join(ROOT, "README.md"), "utf8");
  const readmeKo = readFileSync(join(ROOT, "README.ko.md"), "utf8");
  for (const text of [docsMap, readmeEn, readmeKo]) {
    if (!text.includes("capabilityMatrix.md")) throw new Error("능력 매트릭스 링크 누락");
  }
  // 필드는 능력 표의 헤더 행에서 확인한다. 문서 아무 곳의 문자열 존재로 보면 산문 한 줄이
  // 표를 대신할 수 있다(문자열 존재 검사 계열의 약점).
  const capabilityHeader = matrix.split(NEWLINE).find((line) => line.startsWith("| Capability |"));
  if (!capabilityHeader) throw new Error("능력 표 헤더 행 없음");
  for (const term of ["Product value", "Public surface", "Contract state", "Prerequisites", "Runnable surface", "Verification", "Boundaries"]) {
    if (!capabilityHeader.includes(term)) throw new Error(`능력 매트릭스 필드 누락: ${term}`);
  }
  for (const term of ["Complete", "Bounded", "Probe", "Engine proof"]) {
    if (!matrix.includes(term)) throw new Error(`능력 매트릭스 상태 누락: ${term}`);
  }
  const required = ["boot", "Runtime", "ReactiveController", "PyProc", "AsgiServer", "VirtualOrigin", "bootSession", "openMachine", "MachineJournal", "enableJail", "SocketBridge", "KernelElection", "bootWasi", "GpuCompute", "getPyProcAssetManifest", "checkEnvironment"];
  const missing = required.filter((name) => !mentionsSymbol(matrix, name));
  if (missing.length) throw new Error(`능력 매트릭스 공개 표면 누락: ${missing.join(", ")}`);
  const runnableLinks = [
    "../../examples/basic.html",
    "../../examples/processOs.html",
    "../../examples/speedLab.html",
    "../../examples/serverDev.html",
    "../../examples/terminal.html",
    "../../examples/machine.html",
    "../../examples/immortal.html",
    "../../tests/browser/installedPackageGate.mjs",
  ];
  for (const target of runnableLinks) {
    if (!matrix.includes(`](${target})`)) throw new Error(`능력 매트릭스 실행 표면 링크 누락: ${target}`);
  }
  const statusLabels = new Set(["Complete", "Bounded", "Probe", "Engine proof"]);
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
// 패키지 계약 문서가 게시하는 자산 경로 목록이 실제 매니페스트와 같은가.
// 링크 게이트는 마크다운 링크만 보고 코드블록 산문은 아무도 안 봤다. 그 사이 이 목록은
// 이미 표류해서, 삭제된 파일(sharedKernelHost)을 소비자에게 계약으로 게시하고 있었다.
check("패키지 계약 문서의 자산 목록 = 실제 매니페스트", () => {
  const doc = readFileSync(join(ROOT, "docs", "usage", "contract.md"), "utf8");
  const block = doc.slice(doc.indexOf("// manifest.assets:"));
  const listed = [...block.matchAll(/^\/\/ - (\w+)\s+(\S+)$/gm)].map((m) => ({ role: m[1], path: m[2] }));
  if (!listed.length) throw new Error("문서에서 자산 목록 블록을 못 찾음");
  const actual = assetsApi.getPyProcAssetManifest({ baseURL: "/x/" }).assets.map((a) => ({ role: a.role, path: a.path }));
  const fmt = (xs) => xs.map((x) => `${x.role}=${x.path}`).sort().join(", ");
  if (fmt(listed) !== fmt(actual)) throw new Error(`문서 [${fmt(listed)}] != 실제 [${fmt(actual)}]`);
});

// 4.5) 북극성: 축 원장(tests/northStar.mjs)과 README 두 판, 그리고 실제 게이트 레인의 정합.
//      규칙은 하나다. **점수의 근거는 CI에서 실제로 도는 게이트다.** 산문으로 적힌 증거는 썩는다:
//      게이트 파일이 개명되거나 삭제되거나 러너에 한 번도 안 꽂혀도 "이 축은 검증됐다"는 문장은
//      그대로 남는다(이 저장소에서 probe 15개가 그렇게 좌초해 있었다). 그래서 축마다 실행 가능한
//      산출물을 등재하고, README 표는 원장에서 렌더한 문자열이며, 수동 증거는 점수를 9점 아래로
//      묶는다. 문서만 고쳐서 점수를 올리는 경로를 없애는 것이 이 절의 전부다.
section("북극성");
{
  const northStar = await import(pathToFileURL(join(ROOT, "tests", "northStar.mjs")).href);
  const { NORTH_STAR_AXES, NORTH_STAR_BROWSER_LANES, northStarScore, renderNorthStarMarkdown } = northStar;
  const { ceilingLadder, renderCeilingLadderMarkdown } = northStar;
  const scriptNames = new Set(Object.keys(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts || {}));
  const ciSource = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const ciRunLines = ciSource.split(NEWLINE)
    .filter((line) => !/^\s*#/.test(line))
    .filter((line) => /^\s*-?\s*run:/.test(line) || /^\s+(npm|node)\s/.test(line));
  const corpus = executableCorpus();
  // 증거가 실행 경로에 있는가. `.html`은 러너가 경로 문자열로 여니 전체 경로를 요구하고,
  // 모듈은 상대 경로로 import되므로(`./immortalProductGate.js`) 파일명까지 인정한다.
  const reachable = (path) => {
    if (corpus.includes(path)) return true;
    if (path.endsWith(".html")) return false;
    return corpus.includes(path.slice(path.lastIndexOf("/") + 1));
  };
  // 무자산 레인 목록은 webMachine 러너가 정본이다. x86 자산이 필요한 probe를 CI 증거로 등재하면
  // 여기서 걸린다: 그 레인은 자산이 gitignore라 CI에서 아예 돌 수 없다.
  const webMachineRunner = readFileSync(join(ROOT, "tests", "webMachine", "run.mjs"), "utf8");
  const assetFreeBlock = webMachineRunner.slice(
    webMachineRunner.indexOf("const ASSET_FREE"),
    webMachineRunner.indexOf("const V86_BACKED"),
  );
  const v86Block = webMachineRunner.slice(
    webMachineRunner.indexOf("const V86_BACKED"),
    webMachineRunner.indexOf("const V86_ASSET_DIR"),
  );
  // 페이지가 CI에서 열리는 길은 셋뿐이다: ci.yml 명령 줄에 경로가 박혔거나, 기본 게이트 페이지거나,
  // webMachine 무자산 레인에 등재돼 있거나. 손목록이 아니라 실물 소스에서 각각을 읽는다.
  const ciOpensPage = (path) => ciRunLines.some((line) => line.includes(path))
    || path === "tests/browser/gate.html"
    || assetFreeBlock.includes(path);
  const laneRuns = (lane, path) => {
    // lane "ci" = npm script가 아니라 ci.yml이 직접 부르는 명령. 그 명령 줄에 경로가 있어야 한다.
    if (lane === "ci") return ciRunLines.some((line) => line.includes(path));
    if (!scriptNames.has(lane)) return false;
    if (lane === "test:web-machine" && !assetFreeBlock.includes(path)) return false;
    // v86 레인은 자산이 필요한 페이지 목록에 대해서만 성립한다. 두 레인이 서로의 페이지를
    // 증거로 세면 "무자산 CI"와 "자산 CI"의 구분이 사라진다.
    if (lane === "test:web-machine:v86" && !v86Block.includes(path)) return false;
    const pattern = lane === "test" ? /npm test(\s|$)/ : new RegExp(`npm run ${lane}(\\s|$)`);
    return ciRunLines.some((line) => pattern.test(line));
  };
  const missingPaths = (axis) => [...axis.evidence, ...axis.manual]
    .filter((entry) => !existsSync(join(ROOT, entry.path)))
    .map((entry) => entry.path);
  const unreachable = (axis) => axis.evidence.filter((entry) => !reachable(entry.path)).map((entry) => entry.path);
  const laneProblems = (axis) => [
    ...axis.evidence.filter((entry) => !laneRuns(entry.lane, entry.path))
      .map((entry) => `${entry.path}: 레인 ${entry.lane}이 CI에서 돌지 않는다`),
    // 반대 방향도 본다. CI에서 도는 것을 수동이라 적으면 점수 상한(9점)이 근거 없이 낮아지고,
    // 그 다음에는 "수동이니 어쩔 수 없다"가 사실이 아닌 채로 원장에 남는다.
    ...axis.manual.filter((entry) => ciOpensPage(entry.path))
      .map((entry) => `${entry.path}: 수동이라 적혔는데 CI가 연다`),
    ...axis.manual.filter((entry) => !entry.why).map((entry) => `${entry.path}: 수동 사유 없음`),
  ];
  const scoreProblems = (axis) => {
    const problems = [];
    if (!(axis.score > 0 && axis.score <= 10)) problems.push(`점수 범위 밖: ${axis.score}`);
    if (!Number.isInteger(Math.round(axis.score * 10)) || Math.abs(axis.score * 10 - Math.round(axis.score * 10)) > 1e-9) {
      problems.push(`소수 한 자리가 아니다: ${axis.score}`);
    }
    // 9점 = "거의 끝났다"는 주장이다. 그 주장이 사람이 기억해서 돌리는 probe에 기대면 안 된다.
    if (axis.score >= 9 && axis.manual.length) problems.push(`수동 증거를 든 축이 ${axis.score}점`);
    if (!axis.evidence.some((entry) => NORTH_STAR_BROWSER_LANES.includes(entry.lane))) {
      problems.push("브라우저 레인 증거 0(WASM 런타임의 진짜 검증은 브라우저에서만 가능하다)");
    }
    return problems;
  };
  const intrinsicValueProblems = (axis) => {
    const text = JSON.stringify({ en: axis.en, ko: axis.ko, next: axis.next }).toLowerCase();
    const forbidden = [
      "adoption", "user count", "release age", "market response", "other repositories",
      "30-day", "soak", "project release", "release discipline", "local-agent",
    ];
    return forbidden.filter((term) => text.includes(term)).map((term) => `외부 가치 기준: ${term}`);
  };
  // 다음 수(next)의 법. 축은 "지금"과 "10점"만으로는 반쪽이고, 둘을 잇는 경로가 원장 밖 산문에
  // 살면 그 경로가 표류한다(천장 사다리가 vision.md와 README 두 판에 손으로 세 벌 있었다).
  // **계획은 증거가 아니다**: next에 path/lane이 붙는 순간 게이트 없는 것이 증거로 위장하므로 막는다.
  const nextProblems = (axis) => {
    const problems = [];
    if (axis.score >= 10 && axis.next.length) problems.push("10점 축에 다음 수가 남아 있다");
    if (axis.score < 10 && !axis.next.length) problems.push("다음 수 0(경로가 원장 밖에 산다)");
    for (const move of axis.next) {
      if (!/^[a-z][A-Za-z0-9]*$/.test(move.id || "")) problems.push(`다음 수 id가 camelCase가 아니다: ${move.id}`);
      if ("path" in move || "lane" in move) problems.push(`${move.id}: 계획에 증거 경로가 붙었다`);
      for (const locale of ["en", "ko"]) {
        const line = move[locale];
        if (typeof line !== "string" || !line.trim()) problems.push(`${move.id}: ${locale} 문장 없음`);
        else if (line.length > 160) problems.push(`${move.id}: ${locale} 문장이 160자를 넘는다`);
      }
      if (move.rung !== undefined && !(Number.isInteger(move.rung) && move.rung > 0)) {
        problems.push(`${move.id}: 단 번호가 양의 정수가 아니다`);
      }
    }
    return problems;
  };
  // 사다리는 전역 순서 하나다. 구멍이나 중복이 나면 "몇 단부터 잡을 것인가"가 답이 없어진다.
  const ladderProblems = (axes) => {
    const rungs = ceilingLadder(axes).map(({ move }) => move.rung);
    const problems = rungs.length ? [] : ["사다리가 비었다"];
    rungs.forEach((rung, at) => { if (rung !== at + 1) problems.push(`${at + 1}번째 단이 ${rung}`); });
    return problems;
  };
  const raise = (label, problems) => { if (problems.length) throw new Error(`${label}: ${problems.join("; ")}`); };

  check("북극성 축 id가 유일하고 camelCase다", () => {
    const ids = NORTH_STAR_AXES.map((axis) => axis.id);
    const duplicated = ids.filter((id, at) => ids.indexOf(id) !== at);
    if (duplicated.length) throw new Error(`중복 축 id: ${duplicated.join(", ")}`);
    const bad = ids.filter((id) => !/^[a-z][A-Za-z0-9]*$/.test(id));
    if (bad.length) throw new Error(`camelCase 아님: ${bad.join(", ")}`);
    if (ids.length < 8) throw new Error(`축 ${ids.length}개(원장이 비었다)`);
  });
  for (const axis of NORTH_STAR_AXES) {
    check(`북극성 증거 실존: ${axis.id}`, () => raise("없는 증거", missingPaths(axis)));
    check(`북극성 실행 경로: ${axis.id}`, () => raise("아무도 열지 않는 증거", unreachable(axis)));
    check(`북극성 레인: ${axis.id}`, () => raise("레인 불일치", laneProblems(axis)));
    check(`북극성 점수 법: ${axis.id}`, () => raise("점수 법 위반", scoreProblems(axis)));
    check(`북극성 자체 가치 법: ${axis.id}`, () => raise("자체 가치 법 위반", intrinsicValueProblems(axis)));
    check(`북극성 다음 수: ${axis.id}`, () => raise("다음 수 법 위반", nextProblems(axis)));
  }
  check("북극성 다음 수 id가 유일하다", () => {
    const ids = NORTH_STAR_AXES.flatMap((axis) => axis.next.map((move) => move.id));
    const duplicated = ids.filter((id, at) => ids.indexOf(id) !== at);
    if (duplicated.length) throw new Error(`중복 다음 수 id: ${duplicated.join(", ")}`);
  });
  check("천장 사다리 단이 1..N 연속이다", () => raise("사다리 번호", ladderProblems(NORTH_STAR_AXES)));
  check("북극성 표 = 원장 렌더(README.md)", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    if (!readme.includes(renderNorthStarMarkdown("en"))) throw new Error("README.md 북극성 블록이 원장 렌더와 불일치");
  });
  check("북극성 표 = 원장 렌더(README.ko.md)", () => {
    const readme = readFileSync(join(ROOT, "README.ko.md"), "utf8");
    if (!readme.includes(renderNorthStarMarkdown("ko"))) throw new Error("README.ko.md 북극성 블록이 원장 렌더와 불일치");
  });
  check("천장 사다리 = 원장 렌더(README.md)", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8");
    if (!readme.includes(renderCeilingLadderMarkdown("en"))) throw new Error("README.md 사다리 블록이 원장 렌더와 불일치");
  });
  check("천장 사다리 = 원장 렌더(README.ko.md)", () => {
    const readme = readFileSync(join(ROOT, "README.ko.md"), "utf8");
    if (!readme.includes(renderCeilingLadderMarkdown("ko"))) throw new Error("README.ko.md 사다리 블록이 원장 렌더와 불일치");
  });
  // vision.md는 단마다 왜 그 순서인지를 논증하는 정본이라 산문이 길다. 목록 자체는 원장이 정본이므로
  // 여기서는 단 수만 맞춘다: 한쪽에서 단이 늘거나 줄면 다른 쪽이 조용히 옛 사다리로 남는 것을 막는다.
  check("제품 방향의 사다리 단 수 = 원장 단 수", () => {
    const vision = readFileSync(join(ROOT, "docs", "product", "vision.md"), "utf8");
    const start = vision.indexOf("## Where the ceiling moves next");
    if (start < 0) throw new Error("제품 방향에 사다리 절이 없다");
    const after = vision.indexOf("\n## ", start + 1);
    const body = vision.slice(start, after < 0 ? vision.length : after);
    const numbered = body.split(NEWLINE).filter((line) => /^\d+\. /.test(line)).length;
    const rungs = ceilingLadder(NORTH_STAR_AXES).length;
    if (numbered !== rungs) throw new Error(`제품 방향 ${numbered}단 != 원장 ${rungs}단`);
  });
  // 북극성 정의가 두 곳에 있으면 둘은 반드시 갈라진다. README가 정본이고 나머지는 가리킨다.
  check("북극성 정의는 한 곳에만 산다", () => {
    const sites = [];
    for (const f of [join(ROOT, "README.md"), ...collect(join(ROOT, "docs"), [".md"], [])]) {
      for (const line of readFileSync(f, "utf8").split(NEWLINE)) {
        if (line.trim() === "## North Star") sites.push(rel(f));
      }
    }
    if (sites.length !== 1 || sites[0] !== "README.md") throw new Error(`정의 위치: ${sites.join(", ") || "없음"}`);
    const vision = readFileSync(join(ROOT, "docs", "product", "vision.md"), "utf8");
    if (!vision.includes("tests/northStar.mjs")) throw new Error("제품 방향 문서가 축 원장을 가리키지 않는다");
    if (!vision.includes("## North Star axes")) throw new Error("제품 방향 문서에 축 계약 절이 없다");
  });
  check("북극성 총점이 축 합과 같다", () => {
    const score = northStarScore();
    const sum = NORTH_STAR_AXES.reduce((total, axis) => total + axis.score, 0);
    if (score.total !== sum.toFixed(1)) throw new Error(`${score.total} != ${sum.toFixed(1)}`);
    if (score.max !== String(NORTH_STAR_AXES.length * 10)) throw new Error(`만점 ${score.max}`);
  });
  // 이 절의 법들이 실제로 무는지를 매 실행마다 오염 fixture로 본다. 음성 증명이 커밋 메시지에만
  // 있으면 그것은 한 번의 사건이지 게이트가 아니다([탐지기 자기 시험] 절과 같은 이유).
  const fixture = (over) => ({
    id: "fixtureAxis",
    score: 8.0,
    evidence: [{ path: "tests/browser/gate.html", lane: "test:browser" }],
    manual: [],
    next: [{ id: "fixtureMove", en: "fixture move", ko: "fixture 다음 수" }],
    ...over,
  });
  const ladderFixture = (...rungs) => [fixture({ next: rungs.map((rung, at) => ({ id: `fixtureRung${at}`, rung, en: "x", ko: "x" })) })];
  check("탐지기가 문다: 북극성 법", () => {
    if (missingPaths(fixture({ evidence: [{ path: "tests/browser/noSuchGate.html", lane: "test:browser" }] })).length !== 1) {
      throw new Error("없는 증거 경로를 놓쳤다");
    }
    if (missingPaths(fixture()).length) throw new Error("실존 증거를 없다고 했다(오탐)");
    // 고아 경로는 조립한다. 이 파일도 corpus에 들어가므로(tests의 .mjs 전수), 리터럴로 쓰면
    // 그 문자열 자체가 corpus에 생겨서 탐지기가 자기 fixture를 "실행된다"고 판정한다.
    const orphanPath = ["tests/browser/", "neverOpened", "Fixture.html"].join("");
    if (!unreachable(fixture({ evidence: [{ path: "tests/browser/gate.html", lane: "test:browser" }, { path: orphanPath, lane: "test" }] })).length) {
      throw new Error("아무 러너도 열지 않는 증거를 놓쳤다");
    }
    if (unreachable(fixture()).length) throw new Error("러너가 여는 페이지를 고아라고 했다(오탐)");
    // bench:speed는 실제로 CI에 없는 레인이다(v86은 이제 CI에서 돈다: 이 fixture가 그것을 모르면
    // 레인 판정이 조용히 죽는다 - 감사가 정확히 이 지점을 예고했다).
    if (!laneProblems(fixture({ evidence: [{ path: "tests/browser/gate.html", lane: "bench:speed" }] })).length) {
      throw new Error("CI 밖 레인을 CI 증거로 셌다");
    }
    // 두 레인이 서로의 페이지를 증거로 세지 못한다(양방향). 한쪽만 막으면 구분이 반만 산다.
    if (!laneProblems(fixture({ evidence: [{ path: "tests/webMachine/browser/probes/hostContractProbe.html", lane: "test:web-machine:v86" }] })).length) {
      throw new Error("무자산 페이지를 v86 레인 증거로 셌다");
    }
    if (!laneProblems(fixture({ evidence: [{ path: "tests/webMachine/browser/probes/dualBootProbe.html", lane: "test:web-machine" }] })).length) {
      throw new Error("x86 자산이 필요한 probe를 CI 레인 증거로 셌다");
    }
    if (!laneProblems(fixture({ manual: [{ path: "tests/browser/gate.html", why: "x" }] })).length) {
      throw new Error("CI가 부르는 것을 수동이라 적은 원장을 놓쳤다");
    }
    if (!laneProblems(fixture({ manual: [{ path: "tests/attempts/gpuCompute/gpuPythonProbe.html" }] })).length) {
      throw new Error("사유 없는 수동 증거를 놓쳤다");
    }
    if (laneProblems(fixture()).length) throw new Error("CI에서 도는 레인을 불합격시켰다(오탐)");
    if (!scoreProblems(fixture({ score: 9.5, manual: [{ path: "tests/attempts/gpuCompute/gpuPythonProbe.html", why: "x" }] })).length) {
      throw new Error("수동 증거를 든 9점대 축을 놓쳤다");
    }
    if (!scoreProblems(fixture({ score: 8.25 })).length) throw new Error("소수 두 자리 점수를 놓쳤다");
    if (!scoreProblems(fixture({ score: 11 })).length) throw new Error("범위 밖 점수를 놓쳤다");
    if (!scoreProblems(fixture({ evidence: [{ path: "tests/run.mjs", lane: "test" }] })).length) {
      throw new Error("브라우저 증거 0인 축을 놓쳤다");
    }
    if (scoreProblems(fixture()).length) throw new Error("법을 지킨 축을 불합격시켰다(오탐)");
    if (!intrinsicValueProblems(fixture({ en: { target: "Wait for market response" } })).length) {
      throw new Error("외부 시장 기준을 놓쳤다");
    }
    if (intrinsicValueProblems(fixture()).length) throw new Error("자체 능력 기준을 불합격시켰다(오탐)");
    if (!nextProblems(fixture({ next: [] })).length) throw new Error("다음 수 없는 축을 놓쳤다");
    if (!nextProblems(fixture({ score: 10 })).length) throw new Error("끝난 축에 남은 다음 수를 놓쳤다");
    if (nextProblems(fixture({ score: 10, next: [] })).length) throw new Error("끝난 축을 불합격시켰다(오탐)");
    if (!nextProblems(fixture({ next: [{ id: "fixtureMove", en: "x", ko: "x", path: "tests/browser/gate.html" }] })).length) {
      throw new Error("증거 경로를 단 계획을 놓쳤다");
    }
    if (!nextProblems(fixture({ next: [{ id: "fixture_move", en: "x", ko: "x" }] })).length) {
      throw new Error("camelCase 아닌 다음 수 id를 놓쳤다");
    }
    if (!nextProblems(fixture({ next: [{ id: "fixtureMove", en: "x" }] })).length) throw new Error("한 로케일이 빈 다음 수를 놓쳤다");
    if (!nextProblems(fixture({ next: [{ id: "fixtureMove", en: "x", ko: "x", rung: 0 }] })).length) {
      throw new Error("단 번호 0을 놓쳤다");
    }
    if (nextProblems(fixture()).length) throw new Error("법을 지킨 다음 수를 불합격시켰다(오탐)");
    if (!ladderProblems(ladderFixture(1, 3)).length) throw new Error("사다리 구멍을 놓쳤다");
    if (!ladderProblems(ladderFixture(1, 1)).length) throw new Error("중복 단 번호를 놓쳤다");
    if (!ladderProblems([fixture()]).length) throw new Error("빈 사다리를 놓쳤다");
    if (ladderProblems(ladderFixture(1, 2, 3)).length) throw new Error("연속 사다리를 불합격시켰다(오탐)");
    // 표 대조도 탐지기다: 점수 한 칸을 고친 렌더가 README와 같으면 그 대조는 죽어 있다.
    const poisoned = renderNorthStarMarkdown("en", NORTH_STAR_AXES.map((axis, at) => (at ? axis : { ...axis, score: 1 })));
    if (readFileSync(join(ROOT, "README.md"), "utf8").includes(poisoned)) throw new Error("점수를 바꾼 표가 README와 일치했다");
    // 사다리 대조도 같다: 단 하나를 다른 축에 옮겨 붙인 렌더가 README와 같으면 그 대조는 죽어 있다.
    const moved = NORTH_STAR_AXES.map((axis) => (axis.id === "virtualizedNetwork"
      ? { ...axis, next: axis.next.map((move) => (move.rung === 1 ? { ...move, en: "Climb some other wall first" } : move)) }
      : axis));
    if (readFileSync(join(ROOT, "README.md"), "utf8").includes(renderCeilingLadderMarkdown("en", moved))) {
      throw new Error("단을 바꾼 사다리가 README와 일치했다");
    }
  });
}

// 4.53) 핸들 유입구 고정: JS 핸들이 파이썬 힙에 생기는 곳은 엔진의 globals.set 한 줄이어야 한다.
//       이식성 판정(imagePortability)이 그 지점을 세기 때문이다. 우회가 새로 생기면 판정은
//       조용히 바닥이 되고, 그것이 외부 감사가 잡은 구멍이었다. 증명할 수 없는 영역을 없앨 수는
//       없지만(guest 파이썬의 import js, rt.raw 탈출구) **넓어지는 것은 막을 수 있다.**
section("핸들 유입구");
{
  // 승인된 예외는 이 표가 정본이고, 늘리려면 이 줄을 고치는 것이 곧 심사다.
  const approved = new Map([
    ["src/runtime/engines/pyodideEngine.js", "계수 지점 그 자체(판정의 정본)"],
    ["src/processOs/worker.js", "워커 커널에는 Runtime 래퍼가 없다(태스크 인자/REPL 소스 주입). 이 커널은 이미지를 쓰지 않는다: fork는 델타이지 이미지가 아니다"],
  ]);
  const offenders = [];
  for (const f of collect(join(ROOT, "src"), [".js"], [])) {
    const path = rel(f);
    const code = stripComments(readFileSync(f, "utf8"));
    if (!code.includes("globals.set(")) continue;
    if (!approved.has(path)) offenders.push(path);
  }
  check("파이썬 힙에 핸들을 심는 곳은 승인된 지점뿐이다", () => {
    if (offenders.length) throw new Error(`승인 밖 globals.set: ${offenders.join(", ")}`);
    for (const [path] of approved) {
      if (!existsSync(join(ROOT, path))) throw new Error(`승인 목록의 죽은 항목: ${path}`);
    }
  });
}

// 4.54) export 도달성: src가 export하는 이름은 자기 파일 밖에서 소비되거나 공개 표면에 등재돼야
//       한다. 아무도 안 부르는 export는 두 가지를 동시에 판다. (1) 파일 경계가 실제보다 넓어 보여
//       리팩터가 "이건 밖에서 쓰니 못 고친다"고 잘못 판단하고, (2) 죽은 코드가 계약처럼 읽힌다.
//       실제로 그 사이에서 법이 복제됐다: JSPI 판정이 preflight와 socketBridge 두 곳에 있었고
//       preflight의 것은 아무도 안 불렀다(2026-07-31 실측 14건).
//       한계도 적어둔다: 판정이 텍스트라 남아 있는 import 한 줄도 소비로 센다. 즉 이 게이트는
//       "쓰는 곳이 없다"가 아니라 "이름이 다른 파일에 없다"를 본다. 죽은 import까지 잡으려면
//       사용 여부 분석이 필요하고, 그것은 이 게이트의 스코프가 아니다(과녁을 넓히면 오탐이 산다).
section("export 도달성");
{
  const srcFiles = collect(join(ROOT, "src"), [".js"], []);
  const consumers = [
    ...srcFiles,
    join(ROOT, "index.js"),
    ...collect(join(ROOT, "tests"), [".js", ".mjs", ".html"], []),
    ...collect(join(ROOT, "apps"), [".js"], []),
    ...collect(join(ROOT, "scripts"), [".mjs"], []),
    ...collect(join(ROOT, "examples"), [".js", ".html"], []),
  ].map((f) => [rel(f), readFileSync(f, "utf8")]);
  // 타입 선언도 소비 지점이다: d.ts에 이름이 있으면 그것은 계약이지 죽은 코드가 아니다.
  const declarations = [join(ROOT, "index.d.ts"), ...SUBPATH_DTS.map((p) => join(ROOT, p))]
    .filter((f) => existsSync(f)).map((f) => [rel(f), readFileSync(f, "utf8")]);
  const unreachable = [];
  for (const file of srcFiles) {
    const path = rel(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/^export (?:async )?(?:function|class|const|let) (\w+)/gm)) {
      const name = match[1];
      const pattern = new RegExp(`\\b${name}\\b`);
      const used = [...consumers, ...declarations].some(([other, source]) => other !== path && pattern.test(source));
      if (!used) unreachable.push(`${path}:${name}`);
    }
  }
  check("src의 export는 파일 밖에서 소비되거나 표면에 등재된다", () => {
    if (unreachable.length) {
      throw new Error(`아무도 부르지 않는 export ${unreachable.length}건: ${unreachable.slice(0, 8).join(", ")}${unreachable.length > 8 ? " ..." : ""}`);
    }
  });
}

// 4.55) 컴퓨터 조립 계약: createWebComputer가 브라우저 없이도 조립되는 부분(장치·어댑터 등록·
//       머신 집합)의 법. 소비자 앱이 이 동사들을 다시 구현하면 계약이 두 곳에 살고 오류 어휘가
//       갈라진다(실제로 갈라져 있었다: 앱은 new Error, 커널은 WebMachineError). adoptMachines가
//       그 사본의 유일한 존재 이유였으므로, 그 동사의 법을 여기서 문다.
// 4.52) 결과 기록: 정확히 한 번의 수렴이 서는 자리. 순수 코덱이라 WASM 없이 전부 문다.
//       핵심 판정 하나: 실릴 수 없는 결과는 조용히 잘리는 대신 **기록되지 않는다**. 잘린 결과를
//       세대가 나르면 승계자가 "됐다"고 답하면서 다른 값을 준다(가장 나쁜 실패다).
section("결과 기록");
{
  const log = await import(pathToFileURL(join(ROOT, "src", "state", "outcomeLog.js")).href);
  const record = (requestId, extra = {}) => ({ requestId, epoch: 1, action: "run", ok: true, result: 42, at: 0, ...extra });
  check("결과 기록 왕복: 인코딩한 것이 그대로 돌아온다", () => {
    const records = log.appendOutcomeRecord([], record("a/1/1"));
    const back = log.decodeOutcomeLog(log.encodeOutcomeLog(records));
    if (back.length !== 1 || back[0].requestId !== "a/1/1" || back[0].result !== 42) throw new Error(JSON.stringify(back));
    if (log.findOutcome(back, "a/1/1")?.ok !== true) throw new Error("findOutcome이 답을 못 찾는다");
    if (log.findOutcome(back, "a/1/2")) throw new Error("없는 요청에 답을 지어냈다");
  });
  check("첫 결과가 정본이다(같은 requestId를 덮지 않는다)", () => {
    let records = log.appendOutcomeRecord([], record("a/1/1", { result: 1 }));
    records = log.appendOutcomeRecord(records, record("a/1/1", { result: 2 }));
    if (records.length !== 1 || records[0].result !== 1) throw new Error(JSON.stringify(records));
  });
  check("링 상한: 오래된 기록부터 밀려난다", () => {
    let records = [];
    for (let at = 0; at < log.OUTCOME_LOG_MAX_RECORDS + 5; at += 1) records = log.appendOutcomeRecord(records, record(`a/1/${at}`));
    if (records.length !== log.OUTCOME_LOG_MAX_RECORDS) throw new Error(`길이 ${records.length}`);
    if (log.findOutcome(records, "a/1/0")) throw new Error("상한을 넘겼는데 가장 오래된 것이 남았다");
  });
  check("실릴 수 없는 결과는 기록하지 않는다(자르지 않는다)", () => {
    const circular = {};
    circular.self = circular;
    if (log.isRecordable(record("a/1/1", { result: circular }))) throw new Error("순환 참조를 실을 수 있다고 했다");
    if (log.appendOutcomeRecord([], record("a/1/1", { result: circular })).length) throw new Error("실을 수 없는 것을 기록했다");
    const huge = "x".repeat(log.OUTCOME_RECORD_MAX_BYTES + 1);
    if (log.appendOutcomeRecord([], record("a/1/2", { result: huge })).length) throw new Error("상한 초과를 기록했다");
  });
  check("파손된 기록은 큰 소리로 거부한다", () => {
    const codes = [];
    for (const bytes of [
      new TextEncoder().encode('{"kind":"other","version":1,"records":[]}'),
      new TextEncoder().encode('{"kind":"outcomeLog","version":9,"records":[]}'),
      new TextEncoder().encode('{"kind":"outcomeLog","version":1,"records":[{"ok":true}]}'),
      new TextEncoder().encode("not json"),
    ]) {
      try { log.decodeOutcomeLog(bytes); codes.push("없음"); }
      catch (error) { codes.push(error.code); }
    }
    if (codes.some((code) => code !== "PYPROC_STATE_CORRUPT")) throw new Error(codes.join(","));
    if (log.decodeOutcomeLog(new Uint8Array(0)).length !== 0) throw new Error("빈 바이트는 빈 목록이어야 한다");
  });
  check("requestId 없는 기록은 입력 계약 위반이다", () => {
    let code = "";
    try { log.appendOutcomeRecord([], { ok: true }); } catch (error) { code = error.code; }
    if (code !== "PYPROC_INPUT_INVALID") throw new Error(code);
  });
}

section("컴퓨터 조립");
{
  const { createWebComputer } = await import(pathToFileURL(join(ROOT, "src", "machine", "index.js")).href);
  const fakeMachine = (machineId) => ({
    machineId, state: "created", boot() {}, adoptOwnership() {}, invalidateOwnership() {},
  });
  check("adoptMachines가 Map 정체를 유지한다(수명주기 동사가 붙들고 있다)", () => {
    const computer = createWebComputer({ createMachines: false });
    const before = computer.machines;
    const returned = computer.adoptMachines(new Map([["pythonOs", fakeMachine("pythonOs")]]));
    if (returned !== before || computer.machines !== before) throw new Error("Map을 갈아끼웠다(클로저가 옛 Map을 본다)");
    if (computer.machines.size !== 1) throw new Error(`size ${computer.machines.size}`);
    if (computer.machine("pythonOs").machineId !== "pythonOs") throw new Error("machine()이 입양분을 못 본다");
  });
  check("adoptMachines가 두 번째 입양에서 옛 머신을 남기지 않는다", () => {
    const computer = createWebComputer({ createMachines: false });
    computer.adoptMachines(new Map([["pythonOs", fakeMachine("pythonOs")]]));
    computer.adoptMachines(new Map([["linuxOs", fakeMachine("linuxOs")]]));
    if (computer.machines.size !== 1 || !computer.machines.has("linuxOs")) {
      throw new Error(`잔재: ${[...computer.machines.keys()].join(",")}`);
    }
  });
  check("adoptMachines가 인자 계약과 오류 어휘를 지킨다", () => {
    const computer = createWebComputer({ createMachines: false });
    let typeCode = "";
    try { computer.adoptMachines({}); } catch (error) { typeCode = error.constructor.name; }
    if (typeCode !== "TypeError") throw new Error(`비-Map 거부가 ${typeCode}`);
    let handleCode = "";
    try { computer.adoptMachines(new Map([["x", {}]])); } catch (error) { handleCode = error.code; }
    if (handleCode !== "WEB_MACHINE_INPUT_INVALID") throw new Error(`비-핸들 거부가 ${handleCode}`);
  });
  // 사본 재발 차단: 앱이 다시 자기 팬아웃을 들면 이 검사가 RED가 된다. 수명주기의 정본은
  // 컴퓨터이고 제품이 소유하는 것은 화면 관심사뿐이라는 결정을 기계가 지킨다.
  check("소비자 앱이 수명주기 팬아웃을 다시 구현하지 않는다", () => {
    const source = readFileSync(join(ROOT, "apps", "webComputer", "webComputerContext.js"), "utf8");
    const reimplemented = [...source.matchAll(/\[\.\.\.this\.machines\.values\(\)\]/g)].length;
    if (reimplemented) throw new Error(`머신 팬아웃 사본 ${reimplemented}곳(위임으로 옮긴다)`);
  });
}

// 4.6) 셰이더 바이트 동일성: 헤드리스 CI에 WebGPU 어댑터가 없다는 사실이 이 절의 전제다.
//      실행할 수 없으면 실행했다고 쓰지 않는다. 대신 **가능한 가장 강한 대조**를 둔다: 소비자
//      경로가 실제로 컴파일에 넘기는 최종 WGSL 문자열의 해시를 고정한다. GPU 없이도 잡히는 것:
//      커널 수식의 무단 변경, 템플릿 치환 경로의 회귀(__EXPR__/__OP__/__IDENTITY__가 안 박히는
//      경우), 새 커널이 게이트 없이 들어오는 것. 잡히지 않는 것: 그 셰이더가 GPU에서 옳은 값을
//      내는지. 그 한계를 여기 적어두는 것이 상한을 명시한다는 뜻이다(계약 실태 표와 같은 규율).
section("셰이더");
{
  const kernels = await import(pathToFileURL(join(ROOT, "src", "capabilities", "gpuKernels.js")).href);
  const { MATMUL_WGSL, ELEMENTWISE_WGSL, BINARY_WGSL, TRANSPOSE_WGSL, REDUCE_WGSL, REDUCE_OPS } = kernels;
  // 소비자 경로가 만드는 최종 문자열 그대로 만든다(gpuCompute의 치환과 같은 형태여야 한다).
  const finalShaders = new Map([
    ["matmul", MATMUL_WGSL],
    ["transpose", TRANSPOSE_WGSL],
    ["elementwise:x * 2.0", ELEMENTWISE_WGSL.replace("__EXPR__", "x * 2.0")],
    ["binary:a + b", BINARY_WGSL.replace("__EXPR__", "a + b")],
    ...Object.keys(REDUCE_OPS).map((op) => [
      `reduce:${op}`,
      REDUCE_WGSL.replace("__OP__", REDUCE_OPS[op][0]).replace("__IDENTITY__", REDUCE_OPS[op][1]),
    ]),
  ]);
  const digestOf = (text) => createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
  const recorded = JSON.parse(readFileSync(join(ROOT, "tests", "shaderDigests.json"), "utf8"));
  check("셰이더 등재가 전수다(새 커널은 해시 없이 못 들어온다)", () => {
    const exported = Object.keys(kernels).filter((name) => name.endsWith("_WGSL"));
    const covered = new Set([...finalShaders.keys()].map((key) => key.split(":")[0]));
    const missing = exported.filter((name) => !covered.has(name.replace("_WGSL", "").toLowerCase()));
    if (missing.length) throw new Error(`대조되지 않는 커널: ${missing.join(", ")}`);
    const recordedKeys = Object.keys(recorded.shaders).sort().join(",");
    const builtKeys = [...finalShaders.keys()].sort().join(",");
    if (recordedKeys !== builtKeys) throw new Error(`등재 목록 불일치: ${recordedKeys} != ${builtKeys}`);
  });
  for (const [name, source] of finalShaders) {
    check(`셰이더 바이트 동일성: ${name}`, () => {
      const actual = digestOf(source);
      if (recorded.shaders[name] !== actual) {
        throw new Error(`해시 불일치: ${recorded.shaders[name]} != ${actual}(커널을 고쳤으면 같은 커밋에서 이 값을 고친다)`);
      }
    });
  }
  // 치환이 실제로 일어났는가. 해시 고정만으로는 "치환 안 된 채로 고정된" 상태를 정상이라 부를 수
  // 있다. 자리표시자가 최종 문자열에 남아 있으면 그 셰이더는 컴파일 자체가 안 된다.
  check("치환 자리표시자가 최종 셰이더에 남지 않는다", () => {
    const leftovers = [...finalShaders].filter(([, source]) => /__[A-Z]+__/.test(source)).map(([name]) => name);
    if (leftovers.length) throw new Error(`자리표시자 잔류: ${leftovers.join(", ")}`);
  });
  // GPU가 잡아줄 구조 불변식 중 텍스트로 볼 수 있는 것. 어댑터가 없으니 이것이 상한이다.
  check("모든 커널이 compute 진입점과 workgroup_size를 갖는다", () => {
    const bad = [...finalShaders].filter(([, source]) =>
      !/@compute\s/.test(source) || !/@workgroup_size\(/.test(source) || !/fn\s+main\s*\(/.test(source));
    if (bad.length) throw new Error(`진입점 계약 위반: ${bad.map(([name]) => name).join(", ")}`);
  });
}

// 5) worker 계약: Node import 불가(onmessage 전역)라 텍스트로 확인.
//    worker.js는 pyProc.js와 같은 폴더 = new URL 상대경로(번들러 워커 emit) 계약.
section("worker");
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
  const gateHtml = readFileSync(join(ROOT, "tests", "browser", "gate.html"), "utf8");
  const gateModule = readFileSync(join(ROOT, "tests", "browser", "gate.js"), "utf8");
  const gateSrc = gateHtml + "\n" + gateModule;
  const ciSrc = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  if (!runSrc.includes('"scripts/assetManifest.mjs", "--baseURL", "/"')) throw new Error("run.mjs가 pyproc-assets CLI를 실행하지 않음");
  if (!runSrc.includes('"/pyproc-assets.json"')) throw new Error("run.mjs가 asset manifest endpoint를 제공하지 않음");
  if (!gateHtml.includes('src="./gate.js"') || /<script type="module">\s*\S/.test(gateHtml)) {
    throw new Error("gate.html 실행 코드가 gate.js 모듈로 분리되지 않음");
  }
  if (!gateSrc.includes('fetch("/pyproc-assets.json"')) throw new Error("gate.html이 CLI 산출 manifest를 fetch하지 않음");
  if (!gateSrc.includes('assetOk.verified > 1') || !gateSrc.includes('"src/processOs/ipc.js"')) throw new Error("gate.html이 graph 단위 preflight를 검증하지 않음");
  // 배선을 본다. 예전에는 info 문자열의 `coreIntegrity=/pyproc-assets.json` 에코를 찾았는데,
  // 그것은 메시지 문구를 다듬는 것만으로 법이 깨지고(2026-08-03 실제로 깨졌다) 반대로 실제
  // 등록이 사라져도 메시지만 남으면 통과한다. 실제 옵션 전달을 찾는다.
  if (!gateSrc.includes("registerPyProcServiceWorker") || !/coreIntegrity:\s*"\/pyproc-assets\.json"/.test(gateSrc))
    throw new Error("gate.html이 Service Worker 등록 경로와 SW coreIntegrity를 검증하지 않음");
  if (!gateSrc.includes("Runtime -> SyscallBridge 상속 거부") || !gateSrc.includes("assetIntegrity 상속 childWorker"))
    throw new Error("gate.html이 Runtime assetIntegrity 상속 경로를 검증하지 않음");
  if (!ciSrc.includes("npm run test:installed")) throw new Error("CI가 설치 패키지 브라우저 게이트를 실행하지 않음");
});
check("설치 패키지 게이트가 공개 표면과 pyproc-assets를 사용", () => {
  const r = spawnSync(process.execPath, ["tests/packageGate.mjs"], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim().slice(-4000));
  if (!r.stdout.includes("package gate ok:")) throw new Error("package gate 완료 신호 없음");
});
// 워커 호스팅 계약: 워커에는 document가 없어 엔진 스크립트를 태그로 심을 수 없다. 런타임은
// loadPyodide 옵션으로 그 경로를 열어놨고 porcelain boot의 옵션 허용 목록과 BootOptions 타입도
// 그것을 약속했는데, 결정적 부팅 경로만 그 옵션을 조용히 떨어뜨렸다: 메인 스레드에서는 전역
// 엔진이 대신 로드돼 무증상이고(호출자가 준 엔진이 무시된다) 워커에서는 즉사였다. 그래서
// 결정적 리플레이 = history/save/export 전부가 워커에 올라가지 못했다.
// WASM 없이 문다: 호출자가 준 로더가 실제로 불리는지만 보면 되고, 그 자리에 센티넬을 심으면
// 전달 여부가 관측된다. cfg까지 보므로 "불렸지만 비결정 부팅이었다"도 걸린다.
await checkAsync("워커 호스팅: 결정적 부팅이 호출자의 엔진 로더를 런타임까지 전달", async () => {
  let calls = 0;
  let deterministicCfg = false;
  const loadPyodide = (cfg) => {
    calls++;
    deterministicCfg = cfg?.env?.PYTHONHASHSEED === "0";
    throw new Error("PYPROC_GATE_LOADER_SENTINEL");
  };
  let message = "";
  try { await sessionApi.bootSession({ indexURL: "https://engine.invalid/pyodide/", loadPyodide }); }
  catch (e) { message = String(e?.message || e); }
  if (calls !== 1) throw new Error(`호출자 로더가 불리지 않았다(calls=${calls}): bootSession이 loadPyodide를 떨어뜨린다`);
  if (!message.includes("PYPROC_GATE_LOADER_SENTINEL")) throw new Error(`센티넬이 아닌 경로로 실패했다: ${message.slice(0, 160)}`);
  if (!deterministicCfg) throw new Error("결정적 부팅의 PYTHONHASHSEED=0이 로더 cfg에 실리지 않았다");
});
// 부활 경로는 따로 문다: bundle의 매니페스트는 파일 안 JSON이라 함수를 담을 수 없으므로,
// 워커 호스팅의 로더는 호출 옵션에서 와야 한다(session.js withHostLoader). 봉투는 실물로
// 만든다: 로더는 verify-on-read와 신뢰 게이트를 통과한 뒤에 불려야 의미가 있다.
await checkAsync("워커 호스팅: bundle 부활도 호출자의 엔진 로더로 부팅", async () => {
  const { encodeStateBundle } = await import(pathToFileURL(join(ROOT, "src", "state", "bundleFormat.js")).href);
  const { sha256AddressWith } = await import(pathToFileURL(join(ROOT, "src", "runtime", "contentDigest.js")).href);
  const payload = new TextEncoder().encode("pyproc gate bundle object");
  // 봉투는 자기 색인에 commit 오브젝트가 있어야 디코드된다(decodeStateBundle). 커밋 트리의
  // 내용 검증은 bootSession 뒤의 openState 몫이므로, 로더 전달을 보는 데는 색인 정합만 필요하다.
  const commit = await sha256AddressWith(globalThis.crypto, payload);
  const objects = [[commit, payload]];
  const meta = { manifest: JSON.stringify({ indexURL: "https://engine.invalid/pyodide/" }) };
  const image = await encodeStateBundle(globalThis.crypto, { commit, meta, objects, tag: null });
  let calls = 0;
  const loadPyodide = () => { calls++; throw new Error("PYPROC_GATE_LOADER_SENTINEL"); };
  let message = "";
  try { await sessionApi.openMachine(new Blob([image]), { trust: true, loadPyodide }); }
  catch (e) { message = String(e?.message || e); }
  if (calls !== 1) throw new Error(`부활이 호출자 로더를 쓰지 않았다(calls=${calls}): 파일 매니페스트는 JSON이라 로더를 담을 수 없다`);
  if (!message.includes("PYPROC_GATE_LOADER_SENTINEL")) throw new Error(`센티넬이 아닌 경로로 실패했다: ${message.slice(0, 160)}`);
});

// 6) 상대 링크 생존: 모든 *.md의 상대 링크가 "git 추적" 경로를 가리키는가.
//    존재 검사만으로는 부족하다: 로컬에만 있는 미추적 파일(로컬 규칙 문서 등)을 가리키면
//    로컬은 green인데 CI 러너는 red가 된다(2026-07-12 실제 사고: CI 전 이력 적색의 원인).
//    추적 집합이 기준이면 로컬 게이트 = CI 게이트다. 대소문자 불일치(Windows 관용)도 잡힌다.
//    코드 펜스 안은 예제라 제외. http(s)/mailto/앵커 전용 링크 제외.
section("링크");
// git 실패는 닫는 방향으로 다룬다. 예전에는 실패 시 추적 집합이 빈 Set이 되어 "CI에서 죽는
// 링크" 검사가 통째로 꺼진 채 existsSync만 남았다(fail-open). 같은 파일의 다른 git 호출은
// 전부 status를 보고 던지는데 여기만 반대 방향이었다.
const trackedList = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", timeout: 20000 });
if (trackedList.status !== 0 || !trackedList.stdout.trim()) {
  throw new Error(`링크 게이트: git ls-files 실패(추적 집합 없이 검사하면 fail-open이다): ${trackedList.stderr || trackedList.status}`);
}
const trackedFiles = new Set(
  trackedList.stdout.split("\n").map((p) => p.trim()).filter(Boolean)
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

// 7) 구조 불변식: attempts 카테고리와 공개 문서의 README 의무.
section("구조");
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
// 층위 = 옛 package 소속. pure(0: 옛 core) <- platform(1: 옛 browser) <- guests(2) <- composition(3).
// rank는 폴더에서 나온다. 예전에는 순수 집합이 손으로 유지하는 11개 파일 목록이었고, 새 파일을
// 만들 때마다 게이트 소스를 열어 등재를 판단해야 했다. 빠뜨리면 자동으로 platform이 되어 순수성
// 검사를 아예 안 받았다(누락에 의한 침묵). 계약 층 두 파일을 contracts/로, 전역을 만지는 코덱을
// image/로 옮겨 그 목록을 없앴다: 이제 "레이어 = 폴더" 원칙이 최상층에서도 성립한다.
const machineFileRank = (relPath) => {
  const folder = relPath.split("/")[2];
  if (folder === "contracts" || folder === "host") return 0;
  if (folder === "guests") return 2;
  // 층 배럴은 조립 지점이다: guests와 composition을 재수출하므로 platform으로 부르면
  // 그 재수출이 전부 위로 향하는 edge가 된다(그래서 edge 검사가 배럴을 건너뛰어 왔다).
  if (folder === "composition" || relPath === "src/machine/index.js") return 3;
  return 1;
};
// 파일 헤더의 `Layer N` 라벨은 rank 맵과 같은 값이어야 하고, 이제 전 파일에 있어야 한다.
// 예전 판정은 "라벨이 있으면 값이 맞는가"였다: 라벨 없는 파일 67개가 자연 통과했고(2026-07-27
// 실측, 113개 중), 그래서 machine 층 46개 파일은 자기 층위를 한 줄도 말하지 않았다. 층이
// 폴더로만 살면 읽는 사람은 매번 게이트 소스를 열어야 한다. machine 층은 내부 파일 rank까지
// 라벨이 말한다(`Layer 5/guests`): 그 rank가 import 방향과 순수성 판정의 실제 기준이다.
const MACHINE_RANK_NAME = ["pure", "platform", "guests", "composition"];
// 벤더 번들은 업스트림 diff를 보존해야 갱신이 가능하므로 헤더를 고치지 않는다.
const LAYER_LABEL_EXEMPT = new Set(["src/runtime/engines/wasi/browserWasiShim.js"]);
check("src 전 파일이 헤더에 Layer 라벨을 갖고 rank 맵과 일치한다", () => {
  const problems = [];
  for (const f of collect(join(ROOT, "src"), [".js"], [])) {
    const relPath = rel(f);
    if (LAYER_LABEL_EXEMPT.has(relPath)) continue;
    const layer = srcLayerName(relPath);
    if (!layer || !LAYER_RANK.has(layer)) continue;
    const rank = LAYER_RANK.get(layer);
    const expected = layer === "machine"
      ? `Layer 5/${MACHINE_RANK_NAME[machineFileRank(relPath)]}`
      : `Layer ${rank}`;
    const text = readFileSync(f, "utf8");
    const found = [...text.matchAll(/\bLayer (\d)(?:\/([a-z]+))?/g)];
    if (!found.length) { problems.push(`${relPath}: Layer 라벨 없음(기대 ${expected})`); continue; }
    for (const m of found) {
      const actual = m[2] ? `Layer ${m[1]}/${m[2]}` : `Layer ${m[1]}`;
      if (actual !== expected) problems.push(`${relPath}: ${actual} != ${expected}`);
    }
  }
  if (problems.length) throw new Error(`${problems.length}건: ${problems.slice(0, 6).join("; ")}`);
});
// 규칙 문서와 게이트가 같은 순위를 말하는가. CLAUDE.md는 로컬 전용이라 CI에 없으므로
// 추적되는 기여자 문서를 대조 대상으로 둔다(규칙 문장의 공개 정본).
// moduleBoundaries.md는 규칙이 모듈 경계의 SSOT로 지목하는 문서인데 rank 표가 없었다. 이제
// 있고, 두 문서가 같은 순위를 말하는지 함께 대조한다(세 곳에 적힌 숫자는 반드시 갈라진다).
check("moduleBoundaries의 레이어 순위 = rank 맵", () => {
  const doc = readFileSync(join(ROOT, "docs", "operations", "moduleBoundaries.md"), "utf8");
  for (const [layer, rank] of LAYER_RANK) {
    const stated = [...doc.matchAll(new RegExp("`" + layer + "/`\\s*\\((\\d)", "g"))].map((m) => Number(m[1]));
    if (!stated.length) throw new Error(`moduleBoundaries에 ${layer}(${rank}) 순위 표기 없음`);
    if (stated.some((value) => value !== rank)) throw new Error(`moduleBoundaries의 ${layer} 순위 표기 모순: ${stated.join(",")}`);
  }
  // machine 내부 rank도 이 문서가 말해야 한다. 그 rank가 순수성 판정의 실제 기준이다.
  for (const marker of ["`contracts/`", "`host/`", "`guests/`", "pure"]) {
    if (!doc.includes(marker)) throw new Error(`moduleBoundaries에 machine 내부 rank 표기 없음: ${marker}`);
  }
});
check("CONTRIBUTING의 레이어 순위 = rank 맵", () => {
  const doc = readFileSync(join(ROOT, "CONTRIBUTING.md"), "utf8");
  // 존재만 보면 모순을 못 잡는다: 같은 층을 두 순위로 적어도 맞는 쪽 하나가 통과시킨다.
  // 그래서 그 층의 순위 표기 전부를 걷어 유일성까지 본다.
  for (const [layer, rank] of LAYER_RANK) {
    const stated = [...doc.matchAll(new RegExp("`" + layer + "/`\\s*\\((\\d)", "g"))].map((m) => Number(m[1]));
    if (!stated.length) throw new Error(`CONTRIBUTING에 ${layer}(${rank}) 순위 표기 없음`);
    if (stated.some((value) => value !== rank)) {
      throw new Error(`CONTRIBUTING의 ${layer} 순위 표기 모순: ${stated.join(",")} (rank ${rank})`);
    }
  }
  // 파일 헤더 라벨 규칙도 여기 살아야 한다(게이트가 강제하는 것을 기여자 문서가 말한다).
  for (const marker of ["Layer 2:", "Layer 5/guests", "`pure`", "`composition`"]) {
    if (!doc.includes(marker)) throw new Error(`CONTRIBUTING에 라벨 규칙 표기 없음: ${marker}`);
  }
});
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
  if (registrySrc.includes("../capabilities/")) {
    throw new Error("runtimeBindings.js가 capability class를 직접 import함");
  }
  const clusterSrc = collect(join(ROOT, "src", "composition", "runtimeBindings"), [".js"], [])
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  for (const term of ["installRuntimeCapabilities", "enableReactive", "enableSyscallBridge", "enableAsgiServer", "enableJournal"]) {
    if (!apiSrc.includes(term) && !registrySrc.includes(term) && !clusterSrc.includes(term)) {
      throw new Error(`runtime capability binding 누락: ${term}`);
    }
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
    "src/composition/envManager.js -> src/runtime/contentDigest.js",
    "src/capabilities/journal/journalBlobStore.js -> src/runtime/contentDigest.js",
    "src/capabilities/journal/journalKernelStore.js -> src/runtime/contentDigest.js",
    "src/capabilities/journal/machineJournal.js -> src/runtime/contentDigest.js",
    // 구 포맷 reader를 별도 파일로 가르면서 함께 옮겨간 edge다. 새 예산이 아니라 이사다:
    // machineJournal이 갖고 있던 같은 두 edge가 그 파일에서 줄어든다(은퇴 시 파일째 사라진다).
    "src/capabilities/journal/journalLegacyGeneration.js -> src/runtime/contentDigest.js",
    "src/capabilities/journal/journalLegacyGeneration.js -> src/runtime/errors.js",
    // machineJournal은 heapGrow를 직접 쓰지 않게 됐지만 memoryLayout(PAGE)은 남는다.
    "src/capabilities/journal/machineJournal.js -> src/runtime/memoryLayout.js",
    // 힙 물질화 법의 유일한 보관소. 성장은 파이썬 할당 경로여야 하고(heapGrow) 페이지 단위는
    // 엔진 ABI가 정한다(memoryLayout). 그래서 이 두 edge는 이 파일 하나로 모았다: 예전에는
    // 같은 두 edge가 session/journal 네 사본에 흩어져 있었다.
    "src/capabilities/image/heapMaterialize.js -> src/runtime/heapGrow.js",
    "src/capabilities/image/heapMaterialize.js -> src/runtime/memoryLayout.js",
    "src/capabilities/reactive.js -> src/runtime/memoryLayout.js",
    // 단위 계약(PAGE_SIZE, bytesToMb)은 rank 0에 있고 비용 영수증을 내는 능력이 그것을 쓴다.
    // 각자 1048576을 다시 쓰는 것보다 이 edge가 싸다(정밀도까지 갈리던 사본 8곳을 수렴).
    "src/capabilities/journal/journalBlobStore.js -> src/runtime/memoryLayout.js",
    // ASGI 응답 body는 base64로 건너온다. 디코더를 또 쓰는 것보다 코덱 코어를 지나는 것이
    // 옳다(폴백 한쪽만 갖춘 사본이 "같은 입력에 다르게 실패"를 만든 전례가 이 코어의 근거다).
    "src/capabilities/asgiServer.js -> src/runtime/contentDigest.js",
    "src/capabilities/image/machineHome.js -> src/runtime/memoryLayout.js",
    "src/capabilities/reactive.js -> src/runtime/heapDelta.js",
    "src/capabilities/wheelCache.js -> src/runtime/globalPatch.js",
    "src/capabilities/syscallBridge.js -> src/runtime/assets.js",
    "src/capabilities/syscallBridge.js -> src/runtime/rpcChannel.js",
    // 환경 판정(JSPI 유무)과 그 가드는 preflight 하나가 소유한다. 이 edge를 열기 전에는 같은
    // 판정이 socketBridge 안에 사본으로 있었고, preflight 쪽은 아무도 부르지 않는 export였다:
    // 사본과 죽은 코드를 동시에 만드는 배치였다. 예산 한 줄이 그 둘을 없앤다.
    "src/capabilities/socketBridge.js -> src/runtime/preflight.js",
  ]);
  // 정적으로 대상을 못 푸는 워커 스폰(주입된 URL)은 여기 등재돼야 통과한다. 등재는 "이 파일이
  // 워커를 스폰하는데 그 대상이 코드에 없다"는 사실의 공개이고, 그 대상은 자산 매니페스트가
  // 계약으로 갖는다(자산 역방향 대조가 그 짝이다).
  const injectedWorkerSpawns = new Set([
    "src/machine/guests/bridged/workerHostedGuestAdapter.js:this._workerURL",
  ]);
  const problems = [];
  for (const f of collect(join(ROOT, "src"), [".js"], [])) {
    for (const ref of jsModuleRefs(f)) {
      if (ref.kind === "workerSpawn") {
        const entry = `${rel(f)}:${ref.spec}`;
        if (!injectedWorkerSpawns.has(entry)) problems.push(`${entry} (주입 워커 스폰 선언 목록 밖: 대상이 정적으로 풀리지 않는다)`);
        continue;
      }
      const target = moduleTarget(f, ref.spec);
      // bare specifier는 저장소 안에 대상이 없다. machine 게이트는 이미 이것을 물지만 src 전역
      // 게이트는 조용히 흘려보내고 있었다(현재 src에 bare import 0건이라 즉시 green이다).
      if (!target) {
        if (ref.kind === "module" || ref.kind === "dynamic") problems.push(`${rel(f)} -> ${ref.spec} (bare specifier: src는 저장소 안 상대 경로만 쓴다)`);
        continue;
      }
      if (!existsSync(target)) continue;
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
const demoEnginePathProblems = (sources) => {
  const expected = 'new URL("../vendor/pyodide/", import.meta.url).href';
  return Object.entries(sources)
    .filter(([, source]) => !source.includes(expected))
    .map(([file]) => `${file}: document-relative engine default 없음`);
};
check("공개 examples는 subpath hosting에서도 준비된 same-site engine을 기본 사용", () => {
  const files = [
    "heroConsole.js", "agentSandbox.html", "basic.html", "immortal.html", "machine.html",
    "mcpSandbox.html", "processOs.html", "serverDev.html", "speedLab.html", "terminal.html",
  ];
  const sources = Object.fromEntries(files.map((file) => [file, readFileSync(join(ROOT, "examples", file), "utf8")]));
  const problems = demoEnginePathProblems(sources);
  if (problems.length) throw new Error(problems.join("; "));
  const subpathEngine = new URL("../vendor/pyodide/", "https://example.test/pyproc/examples/basic.html");
  if (subpathEngine.pathname !== "/pyproc/vendor/pyodide/") throw new Error(`subpath engine 해석 오류: ${subpathEngine.pathname}`);
  const pages = readFileSync(join(ROOT, ".github", "workflows", "pages.yml"), "utf8");
  if (!/cp -r [^\n]*\bvendor\b[^\n]*_site\//.test(pages)) throw new Error("Pages가 same-site vendor tree를 배치하지 않는다");
});
check("탐지기가 문다: 공개 example의 origin-root 엔진 회귀", () => {
  const poisoned = { "basic.html": 'const INDEX = "/vendor/pyodide/";' };
  if (!demoEnginePathProblems(poisoned).length) throw new Error("origin-root engine 회귀를 놓쳤다");
});
assertDocLifecycleStructure({ check, ROOT, collect, rel });

const machineRoot = join(ROOT, "src", "machine");
await assertWebMachineStructure({ check, checkAsync, ROOT, collect, rel, stripComments, jsModuleRefs, moduleTarget, findCycles, machineRoot, machineFileRank, runMemoryMachineStoreContract, runDurableComputerContract });
assertWebComputerStructure({ check, ROOT, collect, rel, jsModuleRefs, moduleTarget, machineRoot });

// 7.4) 사용자 진입 표면: 사용자가 실제로 읽는 진단·거부 문장은 영문이다. README와 api.md가
//      영문인데 이 문장들이 한국어면, 사용자가 checkEnvironment()를 부른 첫 순간
//      읽을 수 없는 진단을 받는다(유일한 온보딩 장치가 무력화된다). 내부 주석은 한국어 유지다.
//      스코프는 진입 표면 파일로 좁힌다: 나머지 진단 텍스트는 열린 부채로 기록돼 있다.
section("진입 표면 언어");
{
  // 스코프는 src 전수다(기본 RED). 아직 옮기지 않은 파일은 예산 목록에 남기고, 그 숫자는
  // 단조 감소만 한다: 예산을 늘리는 diff가 곧 "소비자가 읽을 수 없는 문장을 늘렸다"는 심사
  // 지점이다. 화이트리스트 2파일 방식이었을 때 실물은 530개 중 8개만 영문이었다.
  // 소비자에게 나가는 문장 전부를 본다. 생성자 리터럴만 보던 판정은 두 형태에 눈이 멀었다:
  //  - 한 줄 팩토리(inputError/formatError/journalCorrupt/kernelError/imageError/swError)
  //  - 오류 객체가 아니라 값으로 나가는 결과 문자열({ error: "..." }: map의 원소 결과가 그렇다)
  // 실측(2026-07-27): 그 사각에 74줄이 살아 있었고 게이트는 "0건"으로 GREEN이었다.
  const MESSAGE_SOURCES = [
    /new (?:PyProcError|TypeError|WebMachineError)\(\s*(?:"[^"]*",\s*)?([`"][\s\S]*?)[`"]\s*[,)]/g,
    /\b(?:journalCorrupt|imageError|kernelError|formatError|inputError|swError)\s*\(\s*(`[^`]*`|"[^"]*")/g,
    /error:\s*(`[^`]*`|"[^"]*")/g,
    // JS 문자열에 심은 파이썬이 던지는 문장. 소비자가 traceback에서 그대로 읽는다.
    /(?:raise\s+\w+\(|print\()([^\r\n]*)/g,
  ];
  // machine 층 322개는 아직 한국어다. 이 층의 문장은 Web Computer 제품 화면에 뜨고 라이브러리
  // API 표면에는 거의 안 나오므로 우선순위가 뒤였다. 옮길 때 게이트 단정과 같은 커밋으로.
  // 타입 선언의 주석 언어. 사용자가 가장 많이 읽는 표면이다: 에디터 자동완성이 JSDoc을 그대로
  // 띄우고, npm 패키지에 함께 나가고, api.md가 서명의 정본으로 이 파일을 지정한다.
  // 예산 단계는 끝났다(339 -> 291 -> 0): 루트와 강등 subpath 8파일 전부 하드 0이다. 예산이
  // 남아 있으면 "조금은 되돌려도 된다"가 되므로, 0에 닿은 표면은 0으로 잠근다.
  // 사용 문서의 언어. 스코프를 손으로 열거하면 벽이 옮겨간다: d.ts를 영문화한 뒤에도
  // README가 핀 정책·능력 매트릭스·플랫폼 요구·계약 실태로 보내는 문서가 전부 한국어였다(외부 감사,
  // 2026-07-27). 그래서 목록을 박지 않고 **사용자 진입점에서 링크로 닿는 문서**를 스코프로 계산한다.
  // README(영/한)와 api.md가 가리키는 곳이 곧 사용 경로다.
  // 한국어판 README는 그 자체가 한국어 표면이라 스코프 밖이고, 내부 운영 문서는 링크되지 않는 한
  // 한국어로 남는다(규칙: 공개 표면 영문 우선, 내부 문서 한국어).
  const USER_ENTRY_POINTS = ["README.md", "docs/reference/api.md"];
  // 링크를 담은 파일 기준으로 상대 경로를 저장소 기준으로 정규화한다. 첫 판본은 href가
  // 문자 그대로 `docs/`로 시작하는 것만 잡았는데, api.md의 링크는 전부 `../usage/...`
  // 형태라 두 진입점 중 하나가 스코프에 0개를 기여했다(외부 감사 실측). 진입점을 둘 적어두고
  // 하나가 죽어 있으면 그 목록은 의도를 말할 뿐 집행하지 않는다.
  const resolveDocHref = (fromFile, href) => {
    const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
    const stack = [];
    for (const part of `${dir}/${href}`.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return stack.join("/");
  };
  const docLinksOf = (fromFile) => {
    const text = readFileSync(join(ROOT, fromFile), "utf8");
    const out = [];
    for (const m of text.matchAll(/\]\((?!https?:)([A-Za-z0-9/_.-]+\.md)\)/g)) {
      const resolved = resolveDocHref(fromFile, m[1]);
      if (resolved.startsWith("docs/") && existsSync(join(ROOT, resolved))) out.push(resolved);
    }
    return out;
  };
  const usageDocs = () => {
    const found = new Set();
    for (const entry of USER_ENTRY_POINTS) {
      for (const doc of docLinksOf(entry)) found.add(doc);
    }
    // 배럴 문서(docs/README.md)는 라우팅 표라 그 자체가 판단 문서가 아니다. 그것이 가리키는
    // 곳까지 따라가면 내부 운영 문서 전체가 스코프에 들어온다.
    found.delete("docs/README.md");
    found.delete("docs/reference/api.md");
    // 한 홉 더 따라간다. 진입점이 직접 가리키지 않아도 사용 문서가 가리키는 곳은 같은
    // 경로다(trustPermissions는 contract.md에서 한 홉이라 첫 판정에서 빠졌다). 두 홉까지는
    // 가지 않는다: 그러면 내부 운영 문서가 전부 들어온다.
    // 한 홉 확장은 사용자 대면 트리에만 적용한다. `docs/operations/`는 내부 절차(릴리즈 수순,
    // 게이트 임계값)라 진입점이 직접 가리킬 때만 스코프다: 규칙이 공개 표면과 내부 문서를
    // 가르는 지점이 여기다. `docs/product/`는 제품 방향이라 공개 표면이다(숫자 자랑 게이트도
    // 그 트리를 공개로 본다).
    for (const doc of [...found]) {
      for (const linked of docLinksOf(doc)) {
        if (linked.startsWith("docs/usage/") || linked.startsWith("docs/product/")) found.add(linked);
      }
    }
    found.delete("docs/README.md");
    found.delete("docs/reference/api.md");
    return [...found].sort();
  };
  // 예산 단계는 끝났다(343 -> 275 -> 178 -> 51 -> 0). 0에 닿은 표면은 0으로 잠근다: 예산이
  // 남아 있으면 "조금은 되돌려도 된다"가 되고, 그 여유가 벽이 다시 서는 자리다.
  check("사용 문서는 전부 영문이다", () => {
    const docs = usageDocs();
    if (docs.length < 4) throw new Error(`사용 문서를 ${docs.length}개만 찾았다(링크 추출이 죽었다)`);
    const byFile = [];
    let korean = 0;
    for (const relative of docs) {
      const lines = readFileSync(join(ROOT, relative), "utf8").split(NEWLINE);
      const count = lines.filter((line) => /[가-힣]/.test(line)).length;
      if (count) byFile.push(`${relative}(${count})`);
      korean += count;
    }
    if (korean) throw new Error(`사용 문서에 한국어가 남았다: ${byFile.join(", ")}`);
  });
  check("d.ts 주석은 전부 영문이다", () => {
    const byFile = [];
    let korean = 0;
    for (const relative of ["index.d.ts", ...SUBPATH_DTS]) {
      const lines = readFileSync(join(ROOT, relative), "utf8").split(NEWLINE);
      const count = lines.filter((line) => /[가-힣]/.test(line)).length;
      if (count) byFile.push(`${relative}(${count})`);
      korean += count;
    }
    if (korean) throw new Error(`d.ts 주석에 한국어가 남았다: ${byFile.join(", ")}`);
  });
  // 예산 단계는 끝났다(309 -> 233 -> 141 -> 0). machine 층을 뒤로 미룬 근거는 "라이브러리 API
  // 표면에 거의 안 나온다"였는데 그것이 틀렸다: `createWebComputer`가 루트 export이므로 그 층의
  // 첫 오류가 곧 소비자가 보는 첫 문장이다(외부 감사 지적). 0에 닿았으므로 하드 0으로 잠근다.
  // 데모 소스의 주석 언어. 렌더되는 문장은 이미 전부 영문이지만(랜딩·데모 UI는 공개 표면 규칙의
  // 대상이었다) 그 **이유**를 적은 주석이 한국어였다. examples는 개발자가 패턴을 베껴가는 곳이라
  // 왜 그렇게 했는지가 읽히지 않으면 베낀 코드가 근거 없이 퍼진다(외부 감사 지적, 하위 등급).
  // 예산 단계는 끝났다(106 -> 59 -> 0). 0에 닿았으므로 하드 0으로 잠근다.
  check("데모 소스 주석은 전부 영문이다", () => {
    const byFile = [];
    let korean = 0;
    for (const f of collect(join(ROOT, "examples"), [".js", ".html"], [])) {
      const lines = readFileSync(f, "utf8").split(NEWLINE);
      const count = lines.filter((line) => /[가-힣]/.test(line)).length;
      if (count) byFile.push(`${rel(f)}(${count})`);
      korean += count;
    }
    if (korean) throw new Error(`데모 소스에 한국어가 남았다: ${byFile.join(", ")}`);
  });
  check("사용자 대면 메시지는 전부 영문이다", () => {
    let korean = 0;
    const byFile = new Map();
    for (const f of collect(join(ROOT, "src"), [".js"], [])) {
      if (rel(f) === "src/runtime/engines/wasi/browserWasiShim.js") continue; // 벤더 번들
      const code = stripComments(readFileSync(f, "utf8"));
      let count = 0;
      for (const pattern of MESSAGE_SOURCES) {
        for (const m of code.matchAll(pattern)) if (/[가-힣]/.test(m[1])) count++;
      }
      if (count) byFile.set(rel(f), count);
      korean += count;
    }
    const outside = [...byFile].filter(([path]) => !path.startsWith("src/machine/"));
    if (outside.length) {
      throw new Error(`machine 층 밖에 한국어 메시지가 남았다: ${outside.map(([p, n]) => `${p}(${n})`).join(", ")}`);
    }
    if (korean) {
      throw new Error(`사용자 대면 메시지에 한국어가 남았다: ${[...byFile].map(([path, n]) => `${path}(${n})`).join(", ")}`);
    }
  });
  // npm 배포 메타데이터. 채택 결정자가 이 프로젝트에서 **가장 먼저** 읽는 문장이고, 대개 유일하게
  // 읽는 문장이다: npm 검색 결과와 패키지 페이지가 렌더하는 것이 description이고, 검색에 걸리는
  // 키가 keywords다. 규칙은 이미 있었다(CLAUDE.md: 공개 데모 표면 = 레포 설명 포함 영문 우선).
  // 게이트가 없어서 0.0.10까지 게시된 description은 한국어로 시작했다. 규칙만 있고 게이트가 없는
  // 자리는 규칙이 아니라 의도다.
  check("npm 배포 메타데이터는 영문 우선이다", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const description = String(pkg.description || "");
    if (!description) throw new Error("description이 비어 있다");
    // 한국어 병기 자체는 규칙이 허용한다(영문 우선 + 한국어 아래). 금지는 순서다: 첫 한글이
    // 나오기 전에 영문 문장 하나가 끝나 있어야 한다.
    const firstKorean = description.search(/[가-힣]/);
    const head = firstKorean < 0 ? description : description.slice(0, firstKorean);
    if (!/[.!?]/.test(head)) throw new Error(`description이 영문 문장 하나를 끝내기 전에 한국어로 넘어간다: ${description.slice(0, 60)}`);
    // keywords는 검색 키라 번역 대상이 아니다(한국어 키워드는 npm 검색에서 죽은 값이다).
    const korean = (pkg.keywords || []).filter((word) => /[가-힣]/.test(String(word)));
    if (korean.length) throw new Error(`keywords에 한국어: ${korean.join(", ")}`);
  });
  check("탐지기가 문다: npm 메타데이터 언어", () => {
    const firstEnglishSentence = (text) => {
      const at = text.search(/[가-힣]/);
      return /[.!?]/.test(at < 0 ? text : text.slice(0, at));
    };
    if (firstEnglishSentence("브라우저 파이썬 - Real Python in the browser tab.")) {
      throw new Error("한국어로 시작하는 description을 놓쳤다");
    }
    if (!firstEnglishSentence("Real CPython in a browser tab. 탭에서 도는 진짜 CPython.")) {
      throw new Error("영문 우선 description을 불합격시켰다(오탐)");
    }
  });
  check("가드에 넘기는 feature 이름도 영문", () => {
    const korean = [];
    for (const f of collect(join(ROOT, "src"), [".js"], [])) {
      const code = stripComments(readFileSync(f, "utf8"));
      for (const m of code.matchAll(/require(?:Coi|Jspi)\(\s*"([^"]*)"/g)) {
        if (/[가-힣]/.test(m[1])) korean.push(`${rel(f)}: ${m[1]}`);
      }
    }
    if (korean.length) throw new Error(korean.join(", "));
  });
  // 워커가 소비하는 매직 이름은 소비자 계약이다. 그 이름이 타입과 레퍼런스에 없으면 출하 문서만
  // 보고 map을 쓸 수 없다(다른 이름을 쓰면 워커에서 NameError가 나고 원인이 문서에 없다).
  check("워커의 매직 함수 이름이 타입과 레퍼런스에 있다", () => {
    const worker = stripComments(readFileSync(join(ROOT, "src", "processOs", "worker.js"), "utf8"));
    const magic = /(_[a-zA-Z]\w*)\s*\(_arg\)/.exec(worker);
    if (!magic) throw new Error("worker.js에서 태스크 진입 함수 이름을 찾지 못했다");
    const name = magic[1];
    const dts = readFileSync(join(ROOT, "index.d.ts"), "utf8");
    const api = readFileSync(join(ROOT, "docs", "reference", "api.md"), "utf8");
    if (!dts.includes("`" + name + "`")) throw new Error(`index.d.ts에 ${name} 계약 없음`);
    if (!api.includes("`" + name + "`")) throw new Error(`api.md에 ${name} 계약 없음`);
    // 예시가 실제로 그 이름으로 정의하는지도 본다(이름만 언급하고 예시가 다른 이름이면 무의미).
    if (!new RegExp(`def ${name}\\(`).test(api)) throw new Error(`api.md 예시가 def ${name}(...)를 쓰지 않는다`);
  });
  // 옵션 화이트리스트는 타입 선언과 같은 집합이어야 한다. 한쪽만 늘면 새 옵션이 입구에서
  // 거부되거나(타입만 추가) 오타 방어가 비어버린다(목록만 추가).
  check("boot 옵션 화이트리스트 = BootMachineOptions 선언", () => {
    const source = readFileSync(join(ROOT, "src", "machine", "composition", "pyprocMachine.js"), "utf8");
    const listed = new Set([...(/BOOT_MACHINE_OPTION_KEYS = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(source)?.[1] || "")
      .matchAll(/"(\w+)"/g)].map((m) => m[1]));
    if (!listed.size) throw new Error("화이트리스트 선언을 찾지 못했다");
    const dts = readFileSync(join(ROOT, "index.d.ts"), "utf8");
    const declaredKeys = (block) => new Set([...block.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]));
    const bootOptions = /export interface BootOptions \{([\s\S]*?)\n\}/.exec(dts);
    const machineOptions = /export interface BootMachineOptions extends BootOptions \{([\s\S]*?)\n\}/.exec(dts);
    if (!bootOptions || !machineOptions) throw new Error("index.d.ts 옵션 선언을 찾지 못했다");
    const declared = new Set([...declaredKeys(bootOptions[1]), ...declaredKeys(machineOptions[1])]);
    const missing = [...declared].filter((key) => !listed.has(key));
    const extra = [...listed].filter((key) => !declared.has(key));
    if (missing.length) throw new Error(`화이트리스트 누락: ${missing.join(", ")}`);
    if (extra.length) throw new Error(`선언에 없는 키: ${extra.join(", ")}`);
  });
  // SAB 생성 지점은 전부 가드를 지난다. README가 "암호 같은 SharedArrayBuffer is not defined
  // 대신 실행 가능한 에러"를 약속하는데 IPC 경로만 그 약속 밖이었다.
  check("SharedArrayBuffer 생성 지점은 COI 가드를 지난다", () => {
    const offenders = [];
    for (const f of collect(join(ROOT, "src"), [".js"], [])) {
      const code = stripComments(readFileSync(f, "utf8"));
      if (!/new SharedArrayBuffer\(/.test(code)) continue;
      if (/requireCoi\(/.test(code)) continue;
      // 전이 가드 예산: 이 파일들의 SAB는 이미 가드를 지난 진입 뒤에만 만들어진다. 예외 목록이
      // 아니라 예산이다(늘리려면 이 줄을 고치는 것이 곧 심사 지점).
      const TRANSITIVE_COI_BUDGET = new Map([
        ["src/processOs/pyProc.js", "풀 부팅(boot)이 requireCoi를 지난 뒤에만 스냅샷 SAB를 만든다"],
        ["src/processOs/machineContainer.js", "자식 머신은 부모 풀의 부팅 뒤에만 생긴다"],
        ["src/processOs/shardCompute.js", "mapArray/matmul은 부팅된 풀의 동사다(풀 없이 도달 불가)"],
      ]);
      if (TRANSITIVE_COI_BUDGET.has(rel(f))) continue;
      offenders.push(rel(f));
    }
    if (offenders.length) throw new Error(`가드 없는 SAB 생성: ${offenders.join(", ")}`);
  });
}

// 7.5) CI 배관: 게이트 정의는 tests/가 정본이지만, "그 게이트가 실제로 돈다"는 배관에 산다.
//      배관이 조용히 갈라진 사례가 셋 있었다: 게시 경로가 ci 게이트의 부분집합이었고,
//      workflow_dispatch가 태그 검증 step만 건너뛰고 게시까지 갔고, 액션 major가 워크플로마다
//      달랐다(재현 빌드만 다른 툴체인 위에 서 있었다).
section("CI 배관");
{
  const workflowRoot = join(ROOT, ".github", "workflows");
  const workflows = new Map(
    readdirSync(workflowRoot).filter((f) => f.endsWith(".yml"))
      .map((f) => [f, readFileSync(join(workflowRoot, f), "utf8").replaceAll("\r\n", "\n")]),
  );
  check("workflow action은 승인한 exact commit SHA에 고정", () => {
    const approved = new Map([
      ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
      ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
      ["actions/upload-artifact", "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"],
      ["actions/download-artifact", "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c"],
      ["actions/cache", "0057852bfaa89a56745cba8c7296529d2fc39830"],
      ["actions/upload-pages-artifact", "56afc609e74202658d3ffba0e8f6dda462b719fa"],
      ["actions/deploy-pages", "d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e"],
    ]);
    const assertPinned = (sources) => {
      const seen = new Set();
      for (const [name, source] of sources) {
        for (const m of source.matchAll(/uses:\s*(actions\/[\w-]+)@([^\s#]+)/g)) {
          const expected = approved.get(m[1]);
          if (!expected) throw new Error(`${name}: 승인 목록 밖 action ${m[1]}`);
          if (!/^[0-9a-f]{40}$/.test(m[2])) throw new Error(`${name}: floating action ref ${m[1]}@${m[2]}`);
          if (m[2] !== expected) throw new Error(`${name}: 승인 SHA 불일치 ${m[1]}@${m[2]}`);
          seen.add(m[1]);
        }
      }
      for (const action of approved.keys()) if (!seen.has(action)) throw new Error(`승인 action이 workflow에서 사라짐: ${action}`);
    };
    assertPinned(workflows);
    // 음성 fixture: exact SHA 하나를 floating major로 돌리면 반드시 RED여야 한다.
    const broken = new Map(workflows);
    broken.set("ci.yml", broken.get("ci.yml").replace(approved.get("actions/checkout"), "v7"));
    let caught = false;
    try { assertPinned(broken); }
    catch { caught = true; }
    if (!caught) throw new Error("workflow action floating-ref 음성 fixture를 놓쳤다");
  });
  check("릴리즈 도구와 타입 컴파일러는 exact version과 lockfile에 고정", () => {
    const packageLock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
    const publish = workflows.get("publish.yml");
    const typescript = pkg.devDependencies?.typescript;
    if (typescript !== "5.9.3") throw new Error(`TypeScript exact pin 불일치: ${typescript || "missing"}`);
    if (pkg.scripts?.["test:types"] !== "tsc -p tests/tsconfig.json") throw new Error("test:types가 lockfile compiler를 쓰지 않는다");
    if (packageLock.packages?.[""]?.devDependencies?.typescript !== typescript) throw new Error("package-lock root TypeScript pin 불일치");
    if (packageLock.packages?.["node_modules/typescript"]?.version !== typescript) throw new Error("package-lock TypeScript resolved version 불일치");
    if (!publish.includes("npm install -g npm@11.19.0")) throw new Error("publish npm CLI exact pin 누락");
    if (/npm@(latest|next)\b/.test(publish) || /typescript@[~^]?\d+\b/.test(pkg.scripts?.["test:types"] || "")) {
      throw new Error("릴리즈/타입 도구에 floating version 재등장");
    }
  });
  check("게시 경로는 ci 게이트 집합을 재사용한다", () => {
    const publish = workflows.get("publish.yml");
    if (!publish) throw new Error("publish.yml 없음");
    if (!/uses:\s*\.\/\.github\/workflows\/ci\.yml/.test(publish)) {
      throw new Error("publish가 ci workflow_call을 호출하지 않는다(게이트 목록 복사본 = 표류)");
    }
    if (!/needs:\s*gates/.test(publish)) throw new Error("publish job이 게이트 job을 needs로 받지 않는다");
    if (!workflows.get("ci.yml").includes("workflow_call:")) throw new Error("ci.yml에 workflow_call 트리거 없음");
  });
  check("게시 검증 step에 조건 우회가 없다", () => {
    const publish = workflows.get("publish.yml");
    const verifyBlock = /- name: 태그와 package\.json 버전 일치 검증([\s\S]*?)\n      - /.exec(publish);
    if (!verifyBlock) throw new Error("버전 일치 검증 step 없음");
    if (/^\s+if:/m.test(verifyBlock[1])) {
      throw new Error("검증 step에 if 조건이 있다(dispatch 경로가 검증을 건너뛴다)");
    }
    if (!verifyBlock[1].includes("git tag --points-at HEAD")) {
      throw new Error("dispatch 경로의 태그 확인이 없다");
    }
  });
  check("공개 데모 배포 앞에 구조 게이트가 있다", () => {
    const pages = workflows.get("pages.yml");
    if (!pages.includes("npm test")) throw new Error("pages 배포가 게이트 없이 돈다");
  });
  check("죽은 워치를 초록으로 만들지 않는다", () => {
    const watch = workflows.get("engine-watch.yml");
    if (/\|\|\s*true/.test(watch)) throw new Error("engine-watch가 조회 실패를 삼킨다");
    if (!/워치가 감지력을 잃었다/.test(watch)) throw new Error("조회 실패의 명시 실패 경로 없음");
  });
  // 게이트 폴더의 모든 페이지는 어떤 실행 경로(npm script 또는 CI 명령줄)에 등장한다.
  // 이 검사가 없을 때 probe 15개가 게이트 폴더에 있으면서 아무도 돌리지 않았다: 구조 게이트가
  // 존재를 고정하고 문서가 과거 수치를 인용하는데 실행은 0이었다(깨져도 아무도 모르고, 지우면
  // 구조 게이트가 RED가 되는 최악의 조합). attempts는 실험 레인이라 스코프 밖이다.
  check("게이트 폴더에 실행되지 않는 페이지가 없다", () => {
    // 실행 경로 판정은 executableCorpus() 하나다([북극성] 절이 같은 답을 쓴다). 주석과 미사용
    // 배열은 실행이 아니고, 증거 원장에 적힌 것도 실행이 아니다.
    const executable = executableCorpus();
    const pages = [
      ...collect(join(ROOT, "tests", "browser"), [".html"], []),
      ...collect(join(ROOT, "tests", "webMachine", "browser"), [".html"], []),
    ].map((f) => rel(f));
    // participant 페이지는 probe가 iframe으로 여는 종속 자산이라 러너가 직접 열지 않는다.
    const orphans = pages.filter((page) => !executable.includes(page) && !/Participant\.html$/.test(page));
    if (orphans.length) throw new Error(`실행 경로 없는 게이트 페이지: ${orphans.join(", ")}`);
  });
  // 게이트 레인은 CI에서 돈다. 예외는 이름으로 승인한다: "로컬에서만 도는 레인"이 목록에
  // 없으면 그 레인의 증거는 사람 기억에만 산다(v86 자산은 gitignore라 CI에서 만들 수 없다).
  check("test:* 레인은 CI에서 돌거나 로컬 전용으로 승인돼 있다", () => {
    const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts || {};
    const LOCAL_ONLY = new Map([
      ["test:contracts", "npm test가 같은 aggregator를 부른다(CI 이중 실행 회피)"],
      ["test:package", "npm test가 spawn으로 부른다"],
    ]);
    const ci = workflows.get("ci.yml");
    const publish = workflows.get("publish.yml");
    const missing = [];
    for (const name of Object.keys(scripts)) {
      if (!name.startsWith("test:")) continue;
      if (LOCAL_ONLY.has(name)) continue;
      const runLine = new RegExp(`run:\\s*npm run ${name.replace(/:/g, ":")}(\\s|$)`);
      if (!runLine.test(ci) && !runLine.test(publish)) missing.push(name);
    }
    if (missing.length) throw new Error(`CI에 없고 로컬 전용 승인도 없는 레인: ${missing.join(", ")}`);
  });
  // 워크플로를 job 단위로 자른다. 순서 판정은 job 안에서만 뜻이 있다: 서로 다른 job은
  // 병렬로 돌므로 파일 안의 줄 순서가 실행 순서가 아니다.
  const jobsOf = (source) => {
    const lines = source.split(NEWLINE);
    const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
    const jobs = new Map();
    if (start < 0) return jobs;
    let current = null;
    for (let at = start + 1; at < lines.length; at++) {
      const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[at]);
      if (header) { current = header[1]; jobs.set(current, []); continue; }
      if (current) jobs.get(current).push(lines[at]);
    }
    return jobs;
  };
  // job이 실제로 실행하는 명령만 순서대로 뽑는다(주석과 값 문자열은 실행이 아니다).
  const runCommandsOf = (jobLines) => {
    const commands = [];
    let inRun = false;
    for (const line of jobLines) {
      if (/^\s*#/.test(line)) continue;
      const inline = /^\s*-?\s*run:\s*(\S.*)$/.exec(line);
      if (inline) { commands.push(inline[1]); inRun = false; continue; }
      if (/^\s*-?\s*run:\s*[|>]/.test(line)) { inRun = true; continue; }
      if (inRun) {
        if (/^\s*-\s|^\s*\w[\w-]*:\s/.test(line)) { inRun = false; continue; }
        if (line.trim()) commands.push(line.trim());
      }
    }
    return commands;
  };
  // 출시 브라우저 경계는 엔진 이름만 바꾼 단일 Linux job이 아니다. Windows에 설치된 실제
  // Microsoft Edge가 설치 tarball 소비 경로와 핵심 브라우저 계약을 독립적으로 완주해야 한다.
  // 아래 fixture 둘은 이 검사가 문구 존재 확인으로 퇴행하지 않게 각각 Chrome-only와 Edge 핵심
  // 레인 누락을 고의로 만든다. 둘 다 판정기에 잡혀야 실제 회귀 방지 게이트다.
  check("Chrome/Edge 릴리스 매트릭스가 OS와 핵심 레인을 고정", () => {
    const assertReleaseMatrix = (source) => {
      const jobs = jobsOf(source);
      const chrome = jobs.get("browser");
      const edge = jobs.get("edge-release");
      if (!chrome) throw new Error("Chrome browser job 없음");
      if (!edge) throw new Error("Windows Edge release job 없음(Chrome-only 매트릭스)");

      const chromeText = chrome.join("\n");
      const edgeText = edge.join("\n");
      const chromeRuns = runCommandsOf(chrome);
      const edgeRuns = runCommandsOf(edge);
      if (!chromeText.includes("runs-on: ubuntu-latest") || !chromeText.includes("PYPROC_BROWSER: /usr/bin/google-chrome")) {
        throw new Error("Chrome job이 Ubuntu의 실제 Google Chrome을 고정하지 않음");
      }
      if (!edgeText.includes("runs-on: windows-latest")) throw new Error("Edge job이 Windows runner가 아님");
      if (!edgeText.includes("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe")) {
        throw new Error("Edge job이 실제 Microsoft Edge 실행 파일을 고정하지 않음");
      }
      if (!edgeText.includes("Test-Path -LiteralPath $env:PYPROC_BROWSER")) {
        throw new Error("Edge 설치 확인이 fail-closed가 아님");
      }

      const requiredChrome = ["npm run test:browser", "npm run test:installed", "npm run test:golden"];
      const requiredEdge = [
        "npm ci",
        "npm test",
        "npm run test:browser",
        "npm run test:installed",
        "npm run test:golden",
        "npm run test:web-machine",
      ];
      for (const command of requiredChrome) {
        if (!chromeRuns.includes(command)) throw new Error(`Chrome 핵심 릴리스 레인 누락: ${command}`);
      }
      for (const command of requiredEdge) {
        if (!edgeRuns.includes(command)) throw new Error(`Edge 핵심 릴리스 레인 누락: ${command}`);
      }
      for (const assetCommand of ["npm run test:web-machine:v86", "node scripts/fetchWasiAssets.mjs", "prepareWebComputerAssets"]) {
        if (edgeRuns.some((command) => command.includes(assetCommand))) {
          throw new Error(`Edge 핵심 레인은 무자산이어야 함: ${assetCommand}`);
        }
      }
    };

    const ci = workflows.get("ci.yml");
    assertReleaseMatrix(ci);
    const editJob = (source, jobName, edit) => {
      const lines = source.split(NEWLINE);
      const start = lines.findIndex((line) => line === `  ${jobName}:`);
      if (start < 0) throw new Error(`fixture 대상 job 없음: ${jobName}`);
      let end = start + 1;
      while (end < lines.length && !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[end])) end++;
      return [...lines.slice(0, start), ...edit(lines.slice(start, end)), ...lines.slice(end)].join("\n");
    };
    const expectRejected = (fixture, label) => {
      try {
        assertReleaseMatrix(fixture);
      } catch {
        return;
      }
      throw new Error(`negative fixture를 놓침: ${label}`);
    };
    expectRejected(editJob(ci, "edge-release", () => []), "Chrome-only");
    expectRejected(
      editJob(ci, "edge-release", (lines) => lines.filter((line) => !line.includes("- run: npm run test:golden"))),
      "Edge test:golden 누락",
    );
  });
  // 자산을 요구하는 probe는 그 자산을 만드는 step 뒤에, 그리고 같은 job 안에 있어야 한다.
  // 예전 판정은 파일 전문에 indexOf를 걸었다: 다른 job에 있어도 줄이 뒤면 통과하고(병렬이라
  // 순서 보장이 없다), 주석에 적힌 명령도 실행으로 셌다(2026-07-27 발견한 두 사각).
  check("자산 요구 게이트는 같은 job 안에서 자산 준비 step 뒤에 온다", () => {
    const PREPARE = "node scripts/fetchWasiAssets.mjs";
    const CONSUMERS = ["node tests/browser/run.mjs tests/browser/wasiGate.html", "npm run test:web-machine"];
    const jobs = jobsOf(workflows.get("ci.yml"));
    if (!jobs.size) throw new Error("ci.yml에서 job을 찾지 못했다");
    let hostJob = null;
    let commands = null;
    for (const [name, lines] of jobs) {
      const runs = runCommandsOf(lines);
      if (runs.some((command) => command.includes(PREPARE))) { hostJob = name; commands = runs; break; }
    }
    if (!hostJob) throw new Error("WASI 자산 준비를 실행 라인에서 찾지 못했다(주석뿐이면 실행이 아니다)");
    const prepareAt = commands.findIndex((command) => command.includes(PREPARE));
    for (const consumer of CONSUMERS) {
      const useAt = commands.findIndex((command) => command.includes(consumer));
      if (useAt < 0) throw new Error(`${consumer}가 자산 준비 job(${hostJob}) 안에 없다(다른 job은 병렬이라 순서 보장이 없다)`);
      if (useAt < prepareAt) throw new Error(`${consumer}가 자산 준비보다 앞에 있다(job ${hostJob})`);
    }
  });
  // 업로드 실패를 삼키는 방법은 둘이다: `ignore`로 적기, 그리고 키를 아예 안 적기.
  // upload-artifact의 기본값은 `warn`이라 파일이 없어도 job이 초록이다. 증거 업로드가
  // 조용히 비면 "게이트가 돌았다"는 기록만 남고 증거는 없다.
  check("증거 업로드는 파일 부재를 삼키지 않는다", () => {
    const problems = [];
    for (const [name, source] of workflows) {
      const lines = source.split(NEWLINE);
      for (let at = 0; at < lines.length; at++) {
        if (!/uses:\s*actions\/upload-artifact@/.test(lines[at])) continue;
        // 이 step의 with 블록에서 키를 찾는다(다음 step 시작 전까지).
        let found = null;
        for (let scan = at + 1; scan < lines.length; scan++) {
          if (/^\s*-\s/.test(lines[scan])) break;
          const key = /^\s*if-no-files-found:\s*(\S+)/.exec(lines[scan]);
          if (key) { found = key[1]; break; }
        }
        if (found === null) problems.push(`${name}:${at + 1} if-no-files-found 키 없음(기본값 warn = 삼킴)`);
        else if (found !== "error") problems.push(`${name}:${at + 1} if-no-files-found: ${found}`);
      }
    }
    if (problems.length) throw new Error(problems.join(" / "));
  });
  // upload v4 이상이 쓴 artifact는 download v4 이상만 읽는다(GitHub의 호환 경계). 두 액션의
  // 버전 라인은 독립이므로 major 동일을 요구하는 것은 틀리고, 이 경계만이 실제 계약이다.
  check("artifact 업로드와 다운로드 세대가 호환된다", () => {
    const majors = { upload: [], download: [] };
    for (const [name, source] of workflows) {
      for (const m of source.matchAll(/uses:\s*actions\/(upload|download)-artifact@v(\d+)/g)) {
        majors[m[1]].push({ version: Number(m[2]), file: name });
      }
    }
    if (!majors.upload.length || !majors.download.length) return; // 한쪽만 쓰면 경계가 없다
    const newestUpload = Math.max(...majors.upload.map((entry) => entry.version));
    if (newestUpload < 4) return;
    const stale = majors.download.filter((entry) => entry.version < 4);
    if (stale.length) {
      throw new Error(`upload v${newestUpload} artifact를 못 읽는 download: ${stale.map((e) => `${e.file}(v${e.version})`).join(", ")}`);
    }
  });
  check("워크플로가 실존 npm script만 호출한다", () => {
    const scripts = new Set(Object.keys(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts || {}));
    const missing = new Set();
    for (const source of workflows.values()) {
      for (const m of source.matchAll(/npm run ([\w:-]+)/g)) if (!scripts.has(m[1])) missing.add(m[1]);
    }
    if (missing.size) throw new Error(`package.json에 없는 script: ${[...missing].join(", ")}`);
  });
  check("죽은 workspaces 전제가 주석에 남아 있지 않다", () => {
    // packages/는 machine 층 흡수로 사라졌고 구조 게이트가 그 부활을 막는다. 그런데 CI 주석은
    // 여전히 "workspaces 심볼릭 링크가 필요하다"고 근거를 위조했다.
    for (const [name, source] of workflows) {
      if (/workspaces\(packages\/\*\)|@web-machine\//.test(source)) throw new Error(`${name}: 죽은 workspaces 전제`);
    }
  });
}

// 8) 커밋 메시지 규칙: 판정 정본(scripts/commitMessage.mjs)이 배선돼 있고, 무는지까지 본다.
//    git 이력은 되감을 수 없으므로 커밋 시점에 막는 훅이 유일한 집행 지점이다. 그래서 훅이
//    정본을 실제로 호출하는지(배선)와 정본이 위반마다 RED인지(이빨)를 매 게이트 실행마다
//    양성/음성 fixture로 확인한다. 규칙 문장의 SSOT는 CLAUDE.md "Git 규칙"이다.
// 명령 실행과 내구 커밋의 정책은 한 함수다. 리더 로컬 경로와 서버 경로가 각자 그 정책을
// 구현하고 있었고(둘 다 execute -> autoCommit -> outcome-unknown), 한쪽만 고치면 조용히 갈렸다.
// 정책 사본이 되살아나면 RED가 되도록 두 경로가 같은 함수를 부르는지 본다.
check("커널 명령 정책은 _runCommand 한 곳이다", () => {
  const src = stripComments(readFileSync(join(ROOT, "src", "session", "kernelElection.js"), "utf8"));
  const calls = (src.match(/this\._runCommand\(/g) || []).length;
  if (calls < 2) throw new Error(`_runCommand 호출이 ${calls}개다(리더 로컬과 서버 경로 둘이어야 한다)`);
  // 정책의 재료가 함수 밖에서 다시 조립되면 사본이다. _commitJournal은 _runCommand와
  // commit action 경로에서만 불린다.
  const commitCalls = (src.match(/this\._commitJournal\(/g) || []).length;
  if (commitCalls > 2) throw new Error(`_commitJournal 호출이 ${commitCalls}개다(정책 사본이 되살아났다)`);
});
section("커밋 규칙");
{
  const { checkCommitMessage, COMMIT_MESSAGE_LIMITS } = await import(
    pathToFileURL(join(ROOT, "scripts", "commitMessage.mjs")).href
  );
  const hook = readFileSync(join(ROOT, ".githooks", "commit-msg"), "utf8");
  check("commit-msg 훅이 판정 정본을 호출한다", () => {
    if (!hook.includes("scripts/commitMessage.mjs")) throw new Error("훅이 정본을 호출하지 않는다");
    if (!/command -v node/.test(hook) || !/exit 1/.test(hook)) throw new Error("node 부재 시 fail-closed 아님");
  });
  check("훅에 판정 로직 사본이 없다", () => {
    // sh grep으로 같은 판정을 또 하면 두 판정이 표류한다. 정본은 한 곳이다.
    if (/grep\s+-\w*[Ee]\w*\s+'\(/.test(hook)) throw new Error("훅에 정규식 판정 사본이 남아 있다");
  });
  // 커밋 메시지의 검증 줄은 주장이지 증거가 아니다. 실제 사고(2026-08-02): 378d370이
  // "npm test 3188 passed"를 적고 나갔지만 구조 게이트는 9건 RED였고, 아무도 게이트를 다시
  // 돌리지 않아 그대로 origin/main에 올랐다. 공개된 이력은 되감을 수 없으므로 푸시가 마지막
  // 차단 지점이다. 판정은 tests/run.mjs에 있고 훅은 호출과 exit code만 본다.
  check("pre-push 훅이 구조 게이트를 호출한다", () => {
    const push = readFileSync(join(ROOT, ".githooks", "pre-push"), "utf8");
    // 주석에 남은 호출은 호출이 아니다: 실행되는 줄에서 찾는다(문자열 포함만 보면 주석
    // 처리된 훅이 통과한다).
    const invokes = push.split("\n").some((line) => !line.trimStart().startsWith("#") && line.includes("node tests/run.mjs"));
    if (!invokes) throw new Error("훅이 구조 게이트를 돌리지 않는다");
    if (!/command -v node/.test(push)) throw new Error("node 부재 시 fail-closed 아님");
    if (!/structure gate is RED/.test(push)) throw new Error("RED에서 차단하는 경로가 없다");
    // 타입 계약도 푸시에서 다시 판정한다. index.d.ts는 손유지 1300줄이고 소비자가 읽는 계약
    // 자체인데 구조 게이트는 그것을 텍스트로만 본다. 컴파일러가 없으면 건너뛰지 않고 막는다.
    const typeLine = push.split("\n").some((line) => !line.trimStart().startsWith("#") && line.includes("tests/tsconfig.json"));
    if (!typeLine) throw new Error("훅이 타입 게이트를 돌리지 않는다");
    if (!/typescript is not installed/.test(push)) throw new Error("컴파일러 부재 시 fail-closed 아님");
  });
  // 규칙 문장은 추적되는 문서에 있어야 한다. CLAUDE.md는 로컬 전용(.gitignore)이라 clone에
  // 없으므로 여기서 읽으면 CI에서만 RED가 된다. 기여자 문서 2판이 규칙의 공개 정본이다.
  for (const doc of ["CONTRIBUTING.md", "CONTRIBUTING.ko.md"]) {
    check(`${doc}가 커밋 메시지 규칙을 문장으로 갖는다`, () => {
      const rules = readFileSync(join(ROOT, doc), "utf8");
      for (const token of ["분류:", "scripts/commitMessage.mjs", "72", "100"]) {
        if (!rules.includes(token)) throw new Error(`규칙 요소 누락: ${token}`);
      }
      const limits = [
        [COMMIT_MESSAGE_LIMITS.subjectMaxChars, "제목 길이"],
        [COMMIT_MESSAGE_LIMITS.bodyLineMaxChars, "본문 줄 길이"],
      ];
      // 문서가 말하는 숫자와 판정 정본의 상수가 어긋나면 둘 중 하나는 거짓말이다.
      for (const [value, what] of limits) {
        if (!rules.includes(String(value))) throw new Error(`${what} 상수(${value})가 문서에 없다`);
      }
    });
  }
  // 훅이 무엇을 막는지 문서에 없으면 차단당한 기여자는 규칙이 아니라 고장으로 읽고 우회를 찾는다.
  for (const doc of ["CONTRIBUTING.md", "CONTRIBUTING.ko.md"]) {
    check(`${doc}가 푸시 게이트 규칙을 문장으로 갖는다`, () => {
      const rules = readFileSync(join(ROOT, doc), "utf8");
      for (const token of [".githooks/pre-push", "npm test"]) {
        if (!rules.includes(token)) throw new Error(`규칙 요소 누락: ${token}`);
      }
    });
  }

  const GOOD = [
    "게이트: 커밋 메시지 규칙을 판정 정본과 훅으로 집행",
    "",
    "scripts/commitMessage.mjs를 신설해 제목 형식·본문 최소량·검증 줄을 술어로 옮겼다.",
    "제목 한 줄만 남는 커밋이 반복돼 이력이 라벨 모음으로 퇴화하던 문제를 막는다.",
    "검증: 구조 게이트 green, 양성/음성 fixture 12건이 위반마다 RED.",
  ].join("\n");
  check("양성: 규칙을 지킨 메시지는 통과", () => {
    const violations = checkCommitMessage(GOOD);
    if (violations.length) throw new Error(violations.map((v) => v.code).join(","));
  });
  const swapSubject = (subject) => [subject, ...GOOD.split("\n").slice(1)].join("\n");
  // 음성 fixture: 위반 하나씩 주입해 그 코드가 잡히는지 본다(위반마다 RED = 게이트의 이빨).
  const NEGATIVE = [
    ["empty", "   \n\n#주석만\n"],
    ["traceTerm", swapSubject("게이트: Codex 흔적이 들어간 제목")],
    ["emDash", swapSubject(`게이트: em dash${String.fromCharCode(0x2014)}주입`)],
    ["subjectTooLong", swapSubject(`게이트: ${"가".repeat(COMMIT_MESSAGE_LIMITS.subjectMaxChars)}`)],
    ["subjectPunctuation", swapSubject("게이트: 마침표로 끝나는 제목.")],
    ["subjectNotKorean", swapSubject("gate: english only subject line")],
    ["subjectForm", swapSubject("분류 없이 쓴 제목 한 줄")],
    ["categoryTooLong", swapSubject(`${"분".repeat(COMMIT_MESSAGE_LIMITS.categoryMaxChars + 1)}: 요약을 적는다`)],
    ["summaryTooThin", swapSubject("게이트: 짧음")],
    ["bodyMissing", "게이트: 본문 없는 제목 한 줄만 남긴 커밋"],
    ["blankLineMissing", "게이트: 빈 줄이 없는 커밋\n본문이 바로 붙었다. 검증: 구조 게이트 green.\n두 번째 줄도 채운다."],
    ["bodyTooShort", "게이트: 본문이 한 줄뿐인 커밋\n\n한 줄만 있고 검증도 여기 뭉쳐 있다. 게이트 green 주장만 남는다."],
    ["bodyTooThin", "게이트: 본문이 얇은 커밋\n\n수리했다.\n게이트 green."],
    ["bodyLineTooLong", `게이트: 본문 줄이 너무 긴 커밋\n\n${"가".repeat(COMMIT_MESSAGE_LIMITS.bodyLineMaxChars + 1)}\n두 번째 줄. 검증: 구조 게이트 green.`],
    ["verificationMissing", "게이트: 검증 사실이 없는 커밋\n\n무엇을 바꿨는지는 적었고 왜 필요한지도 적었다.\n그런데 무엇으로 확인했는지가 어디에도 없다."],
  ];
  for (const [code, message] of NEGATIVE) {
    check(`음성: ${code} 위반은 RED`, () => {
      const codes = checkCommitMessage(message).map((v) => v.code);
      if (!codes.includes(code)) throw new Error(`잡지 못함(실제: ${codes.join(",") || "없음"})`);
    });
  }
  check("양성: 기술 명칭 분류(CI)는 통과", () => {
    // 분류에 원어 기술 명칭을 허용한다. 한글 요건은 제목 전체 단위다(2026-07-27 규칙 정밀화:
    // 분류까지 한글로 강제하면 저장소 관례인 `CI:` 분류가 규칙에 걸렸다).
    const violations = checkCommitMessage(swapSubject("CI: 게시 경로 게이트를 대칭으로 만들었다"));
    if (violations.length) throw new Error(violations.map((v) => v.code).join(","));
  });
  check("git이 만드는 제목(merge/revert)은 형식 검사 밖", () => {
    const merged = checkCommitMessage("Revert \"게이트: 이전 변경\"\n\nThis reverts commit 0123456789.");
    if (merged.length) throw new Error(merged.map((v) => v.code).join(","));
  });
}

// 9) 게이트 층 하한: 섹션별 체크 수가 tests/gateFloor.json 아래로 내려가면 RED. 이 검사가
//    없으면 앞의 모든 절을 지워도 결과는 GREEN이다(2026-07-26 실측: [election 프로토콜] 절
//    전체 삭제 후에도 통과). 하한을 내리는 diff가 곧 "검증을 줄인다"는 심사 지점이다.
{
  const floors = JSON.parse(readFileSync(join(ROOT, "tests", "gateFloor.json"), "utf8"));
  gate.assertFloors(floors.sections, floors.laws);
}

gate.exit();
