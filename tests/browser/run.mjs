// tests/browser/run.mjs - 브라우저 런타임 게이트/probe 하네스. Node 전용, 의존성 0.
// COOP/COEP 서버(examples/serve.mjs 재사용)를 임시 포트로 띄우고, 로컬 Chromium 계열
// 브라우저를 headless로 실행해 페이지의 실측 결과를 POST /gateReport로 회수한다.
// POST /gateRestart는 현재 브라우저 프로세스 트리를 종료하고 같은 profile로 새 프로세스를 연다.
// 사용: npm run test:browser                          (기본: tests/browser/gate.html)
//       node tests/browser/run.mjs tests/attempts/<카테고리>/probe.html   (attempts probe)
//       브라우저 지정: PYPROC_BROWSER=<실행파일 경로>
// 이것이 pyproc의 "진짜 검증"이다. tests/run.mjs는 구조만 보고, 여기는 런타임을 본다.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStaticServer } from "../../examples/serve.mjs";
import { findBrowser, headlessArgs } from "./harness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 240000); // 콜드 CDN 감안. 무거운 probe는 env로 연장

let reportResolve;
const reportPromise = new Promise((res) => { reportResolve = res; });
let restartResolve;
let restartPromise;
function resetRestartPromise() {
  restartPromise = new Promise((resolveRestart) => { restartResolve = resolveRestart; });
}
resetRestartPromise();

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
      restartResolve({ nextSearch: String(request.nextSearch || ""), timings: request.timings || {} });
    } catch (e) {
      reportResolve({ ok: false, checks: [], restartParseError: String(e) });
    }
    return true;
  }
  if (req.method !== "POST" || !req.url.startsWith("/gateReport")) return false;
  let body = "";
  for await (const chunk of req) body += chunk;
  res.writeHead(204); res.end();
  try { reportResolve(JSON.parse(body)); } catch (e) { reportResolve({ ok: false, checks: [], parseError: String(e) }); }
  return true;
}, { coi: !process.env.PYPROC_NO_COI });

await new Promise((res) => server.listen(0, "127.0.0.1", res));
const page = (process.argv[2] || "tests/browser/gate.html").replaceAll("\\", "/").replace(/^\/+/, "");
// PYPROC_INDEX_URL: 게이트/probe를 다른 배포 지점으로 전 검사한다(자가 호스팅 P0 게이트:
// PYPROC_INDEX_URL=/vendor/pyodide/ 가 CDN 0으로 같은 검사를 돌린다). 페이지는 ?indexURL=로 받는다.
const baseUrl = `http://127.0.0.1:${server.address().port}/${page}`;
function pageUrl(nextSearch = "") {
  const params = new URLSearchParams(String(nextSearch).replace(/^\?/, ""));
  if (process.env.PYPROC_INDEX_URL && !params.has("indexURL")) params.set("indexURL", process.env.PYPROC_INDEX_URL);
  const search = params.toString();
  return `${baseUrl}${search ? `?${search}` : ""}`;
}

const browser = findBrowser();
const profile = mkdtempSync(join(tmpdir(), "pyprocGate-"));
function launch(url, phase) {
  console.log(`${phase === 1 ? "pyproc 브라우저 게이트" : `\n브라우저 재시작 phase ${phase}`}\n  browser: ${browser}\n  url:     ${url}\n`);
  return spawn(browser, [...headlessArgs(profile), url], { stdio: "ignore" });
}
function stop(processHandle) {
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(processHandle.pid), "/T", "/F"], { stdio: "ignore" });
  else processHandle.kill("SIGKILL");
}

let phase = 1;
let proc = launch(pageUrl(), phase);
const restartTimings = {};

const timeout = setTimeout(() => reportResolve({ ok: false, checks: [], timedOut: true }), TIMEOUT_MS);
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
  stop(proc);
  Object.assign(restartTimings, event.value.timings);
  resetRestartPromise();
  phase += 1;
  proc = launch(pageUrl(event.value.nextSearch), phase);
}
clearTimeout(timeout);
result.timings = { ...restartTimings, ...(result.timings || {}) };

// headless 브라우저는 자식 프로세스를 거느리므로 트리째 정리한다.
stop(proc);
server.close();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}

if (result.timedOut) {
  console.log(`FAIL 게이트 타임아웃(${TIMEOUT_MS / 1000}s). 네트워크(Pyodide CDN) 또는 브라우저 실행을 확인하라.`);
  process.exit(1);
}
for (const c of result.checks) console.log(`  ${c.pass ? "PASS" : "FAIL"} ${c.name}${c.info ? " (" + c.info + ")" : ""}`);
if (result.timings) console.log(`\n실측: ${JSON.stringify(result.timings)}`);
if (phase > 1) console.log(`브라우저 프로세스 phase: ${phase}`);
// 실측 수치 아카이브(CI 아티팩트용): 러너 숫자와 로컬 숫자를 비교 가능하게 보존한다.
if (process.env.PYPROC_GATE_OUT) writeFileSync(process.env.PYPROC_GATE_OUT, JSON.stringify({ page, browser, ...result }, null, 2));
console.log(`\n결과: ${result.ok ? "GREEN" : "RED"} (${result.checks.filter((c) => c.pass).length}/${result.checks.length})`);
process.exit(result.ok ? 0 : 1);
