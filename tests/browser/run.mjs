// tests/browser/run.mjs - 브라우저 런타임 게이트/probe 하네스. Node 전용, 의존성 0.
// COOP/COEP 서버(scripts/staticServer.mjs 재사용)를 임시 포트로 띄우고, 로컬 Chromium 계열
// 브라우저를 headless로 실행해 페이지의 실측 결과를 POST /gateReport로 회수한다.
// POST /gateRestart는 현재 브라우저 프로세스 트리를 종료하고 같은 profile 또는 요청한 새 profile로 연다.
// /gateArtifact는 profile 밖 임시 파일로 큰 probe 산출물을 스트리밍해 process 사이에 전달한다.
// 사용: npm run test:browser                          (기본: tests/browser/gate.html)
//       node tests/browser/run.mjs tests/attempts/<카테고리>/probe.html   (attempts probe)
//       브라우저 지정: PYPROC_BROWSER=<실행파일 경로>
// 이것이 pyproc의 "진짜 검증"이다. tests/run.mjs는 구조만 보고, 여기는 런타임을 본다.
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStaticServer } from "../../scripts/staticServer.mjs";
import { countRequests, findBrowser, headlessArgs, judgeReport, killBrowser } from "./harness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 300000); // 콜드 CDN 감안. 무거운 probe는 env로 연장
const MAX_ARTIFACT_BYTES = Number(process.env.PYPROC_GATE_ARTIFACT_MAX || 512 * 1024 * 1024);
const runRoot = mkdtempSync(join(tmpdir(), "pyprocGate-"));
const artifactPath = join(runRoot, "gateArtifact.bin");

let reportResolve;
const reportPromise = new Promise((res) => { reportResolve = res; });
let restartResolve;
let restartPromise;
function resetRestartPromise() {
  restartPromise = new Promise((resolveRestart) => { restartResolve = resolveRestart; });
}
resetRestartPromise();

const page = (process.argv[2] || "tests/browser/gate.html").replaceAll("\\", "/").replace(/^\/+/, "");
// 헤더 없는 호스팅(GitHub Pages 등가)을 요구하는 페이지는 이름으로 그 조건을 선언한다.
// npm script는 의존성 0 계약 때문에 크로스플랫폼 env 설정 수단이 없으므로(cross-env 금지),
// 조건을 페이지 이름에서 유도해 `npm run test:preflight`가 어느 OS에서도 같게 돈다.
const noCoi = !!process.env.PYPROC_NO_COI || /NoCoi\.html$/.test(page);

// 제품 배포 파이프라인 등가: pyproc-assets CLI가 만든 graph/SRI manifest를 테스트 서버가
// 같은 오리진에서 제공하고, 브라우저 게이트가 그 JSON을 assetIntegrity로 소비한다.
const assetManifest = spawnSync(process.execPath, ["scripts/assetManifest.mjs", "--baseURL", "/"], { encoding: "utf8" });
if (assetManifest.status !== 0) throw new Error(assetManifest.stderr || assetManifest.stdout);

// PYPROC_NO_COI=1이면 헤더 없는 호스팅(GitHub Pages 등가)을 재현한다(noCoi/swCoi probe용).
const server = createStaticServer(async (req, res) => {
  if (req.method === "GET" && req.url.startsWith("/pyproc-assets.json")) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(assetManifest.stdout);
    return true;
  }
  if (req.method === "POST" && req.url.startsWith("/gateRestart")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.writeHead(204); res.end();
    try {
      const request = JSON.parse(body || "{}");
      restartResolve({
        freshProfile: request.freshProfile === true,
        nextSearch: String(request.nextSearch || ""),
        timings: request.timings || {},
      });
    } catch (e) {
      reportResolve({ ok: false, checks: [], restartParseError: String(e) });
    }
    return true;
  }
  if (req.method === "POST" && req.url.startsWith("/gateArtifact")) {
    const writer = createWriteStream(artifactPath, { flags: "w" });
    let byteLength = 0;
    try {
      for await (const chunk of req) {
        byteLength += chunk.byteLength;
        if (byteLength > MAX_ARTIFACT_BYTES) {
          writer.destroy();
          try { rmSync(artifactPath, { force: true }); } catch (e) {}
          res.writeHead(413); res.end();
          return true;
        }
        if (!writer.write(chunk)) await once(writer, "drain");
      }
      writer.end();
      await once(writer, "finish");
      res.writeHead(204, { "X-Gate-Artifact-Bytes": String(byteLength) }); res.end();
    } catch (e) {
      writer.destroy();
      try { rmSync(artifactPath, { force: true }); } catch (ignored) {}
      res.writeHead(500); res.end(String(e));
    }
    return true;
  }
  if (req.method === "GET" && req.url.startsWith("/gateArtifact")) {
    if (!existsSync(artifactPath)) {
      res.writeHead(404); res.end();
      return true;
    }
    const byteLength = statSync(artifactPath).size;
    res.writeHead(200, {
      "Content-Type": "application/x-webmachine",
      "Content-Length": String(byteLength),
      "Cache-Control": "no-store",
    });
    createReadStream(artifactPath).pipe(res);
    return true;
  }
  if (req.method !== "POST" || !req.url.startsWith("/gateReport")) return false;
  let body = "";
  for await (const chunk of req) body += chunk;
  res.writeHead(204); res.end();
  try { reportResolve(JSON.parse(body)); } catch (e) { reportResolve({ ok: false, checks: [], parseError: String(e) }); }
  return true;
}, { coi: !noCoi });

await new Promise((res) => server.listen(0, "127.0.0.1", res));

// PYPROC_INDEX_URL: 게이트/probe를 다른 배포 지점으로 전 검사한다(자가 호스팅 P0 게이트:
// PYPROC_INDEX_URL=/vendor/pyodide/ 가 CDN 0으로 같은 검사를 돌린다). 페이지는 ?indexURL=로 받는다.
const baseUrl = `http://127.0.0.1:${server.address().port}/${page}`;
function pageUrl(nextSearch = "") {
  const params = new URLSearchParams(String(nextSearch).replace(/^\?/, ""));
  // 예제·랜딩 페이지는 ?gate가 있어야 보고한다(사람이 열면 no-op이 이 표면의 계약이다).
  // 이 러너로 예제를 직접 돌리면 gate 없이 300초 침묵 타임아웃이 된다(실측 2026-08-05:
  // 이 침묵을 src 회귀로 오독해 유령을 한 시간 추적했다. 정본 레인은 test:examples이고,
  // 이 러너는 단일 페이지 재현용이다). 조건을 페이지 경로에서 유도해 함정을 없앤다.
  if ((page.startsWith("examples/") || page === "") && !params.has("gate")) params.set("gate", "1");
  if (process.env.PYPROC_INDEX_URL && !params.has("indexURL")) params.set("indexURL", process.env.PYPROC_INDEX_URL);
  const search = params.toString();
  return `${baseUrl}${search ? `?${search}` : ""}`;
}

const browser = findBrowser();
const requestsSeen = countRequests(server);
let currentProfile = mkdtempSync(join(runRoot, "profile-"));
// 런처 종료 기록. 판정이 아니라 진단 재료다(Edge는 위임 종료할 수 있다 - harness 주석 참조).
let launcherExit = null;
function launch(url, phase) {
  console.log(`${phase === 1 ? "pyproc 브라우저 게이트" : `\n브라우저 재시작 phase ${phase}`}\n  browser: ${browser}\n  url:     ${url}\n`);
  launcherExit = null;
  const spawnedAt = Date.now();
  const child = spawn(browser, [...headlessArgs(currentProfile), url], { stdio: "ignore" });
  child.on("exit", (code, signal) => { launcherExit = { code, signal, afterMs: Date.now() - spawnedAt }; });
  return child;
}
// 타임아웃은 증거를 실어야 한다. 침묵 240초로 죽고 아무것도 안 남긴 사건(installed 레인,
// 2026-08-03)과 콜드 119/120 미식별이 근거다. 여기의 어휘는 awaitGateReport의 진단과 같다.
function timeoutReport() {
  const diagnosis = {
    browser: launcherExit ? `exited(code=${launcherExit.code} signal=${launcherExit.signal ?? "없음"} +${launcherExit.afterMs}ms)` : "alive-but-silent",
    requests: requestsSeen(),
    phase,
    elapsedMs: TIMEOUT_MS,
  };
  return { ok: false, checks: [], timedOut: true, diagnosis };
}
// 프로필 수명주기는 이 게이트 고유다(재시작 phase가 같은 프로필을 다시 물어야 SW/OPFS
// 지속성을 검증할 수 있다). 그래서 launchBrowser 대신 종료 지식만 하네스와 공유한다.
const stop = killBrowser;

let phase = 1;
let proc = launch(pageUrl(process.env.PYPROC_GATE_INITIAL_SEARCH || ""), phase);
const restartTimings = {};

const timeout = setTimeout(() => reportResolve(timeoutReport()), TIMEOUT_MS);
let result;
while (!result) {
  const event = await Promise.race([
    reportPromise.then((value) => ({ type: "report", value })),
    restartPromise.then((value) => ({ type: "restart", value })),
  ]);
  if (event.type === "report") {
    result = event.value;
    break;
  }
  if (phase >= 4) {
    result = { ok: false, checks: [], restartLimit: true };
    break;
  }
  stop(proc, currentProfile);
  Object.assign(restartTimings, event.value.timings);
  if (event.value.freshProfile) currentProfile = mkdtempSync(join(runRoot, "profile-"));
  resetRestartPromise();
  phase += 1;
  proc = launch(pageUrl(event.value.nextSearch), phase);
}
clearTimeout(timeout);
result.timings = { ...restartTimings, ...(result.timings || {}) };

// headless 브라우저는 자식 프로세스를 거느리므로 트리째 정리한다.
stop(proc, currentProfile);
server.close();
try { rmSync(runRoot, { recursive: true, force: true }); } catch (e) {}

if (result.timedOut) {
  console.log(`FAIL 게이트 타임아웃(${TIMEOUT_MS / 1000}s). 네트워크(Pyodide CDN) 또는 브라우저 실행을 확인하라.`);
  console.log(`  진단: ${JSON.stringify(result.diagnosis)}`);
  process.exit(1);
}
for (const c of result.checks) console.log(`  ${c.pass ? "PASS" : "FAIL"} ${c.name}${c.info ? " (" + c.info + ")" : ""}`);
// 판정은 harness.judgeReport 한 곳이다(페이지가 보낸 ok는 읽지 않는다). 예산 초과처럼 러너가
// 페이지 밖에서 만든 단정은 extra로 넘긴다.
const budgetProblems = [];
if (result.timings) console.log(`\n실측: ${JSON.stringify(result.timings)}`);
if (phase > 1) console.log(`브라우저 프로세스 phase: ${phase}`);
// 성능 예산: 기본 게이트의 핵 경로 측정치가 상한(자릿수 회귀 차단용, perfBudget.json)을 넘으면 RED.
// 상한 근거와 여유 계수는 그 파일에 있다. probe 지정 실행(다른 페이지)은 해당 키가 없어 자연 통과.
if (result.timings) {
  const budgetFile = JSON.parse(readFileSync(new URL("./perfBudget.json", import.meta.url), "utf8"));
  const floors = JSON.parse(readFileSync(new URL("./gateFloor.json", import.meta.url), "utf8")).floors;
  // 시간과 메모리는 같은 규율로 판정한다. 메모리 축은 2026-08-03까지 판정이 0이었다: 게이트가
  // MB를 재면서 인쇄만 했고, 그 회귀는 시간 예산의 여유 안에 전부 숨었다.
  for (const [label, budget] of [["성능", budgetFile.budgets], ["메모리", budgetFile.memoryBudgets]]) {
    if (!budget) continue;
    const over = Object.entries(budget)
      .filter(([key, limit]) => Number.isFinite(result.timings[key]) && result.timings[key] > limit)
      .map(([key, limit]) => `${key} ${result.timings[key]} > ${limit}`);
    if (over.length) budgetProblems.push(`${label} 예산 초과: ${over.join(", ")}`);
    // 키가 없으면 그 예산은 조용히 무효가 된다(위 filter가 걸러낸다). 기본 게이트 페이지는
    // 예산 키 전부를 내놓아야 한다: 측정 이름을 바꾸면 예산이 영구히 죽는 자리였다.
    // probe 지정 실행은 다른 측정 집합이라 하한이 등재된 페이지에만 요구한다.
    if (page in floors && page.endsWith("gate.html")) {
      const absent = Object.keys(budget).filter((key) => !Number.isFinite(result.timings[key]));
      if (absent.length) budgetProblems.push(`${label} 예산 키가 측정에 없다: ${absent.join(", ")}(이름을 바꾸면 예산이 죽는다)`);
    }
  }
}
// 체크 수 하한 근거와 유지 규칙은 gateFloor.json에 있다. 등재 없는 페이지(probe)는 자연 통과.
const verdict = judgeReport(result, {
  floor: JSON.parse(readFileSync(new URL("./gateFloor.json", import.meta.url), "utf8")).floors[page],
  extra: budgetProblems.map((name) => ({ name, pass: false })),
});
for (const problem of verdict.problems) console.log(`\nFAIL ${problem}`);
// 실측 수치 아카이브(CI 아티팩트용): 러너 숫자와 로컬 숫자를 비교 가능하게 보존한다.
if (process.env.PYPROC_GATE_OUT) writeFileSync(process.env.PYPROC_GATE_OUT, JSON.stringify({ page, browser, ...result, verdict }, null, 2));
console.log(`\n결과: ${verdict.ok ? "GREEN" : "RED"} (${result.checks.filter((c) => c.pass).length}/${result.checks.length})`);
process.exit(verdict.ok ? 0 : 1);
