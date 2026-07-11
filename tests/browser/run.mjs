// tests/browser/run.mjs - 브라우저 런타임 게이트/probe 하네스. Node 전용, 의존성 0.
// COOP/COEP 서버(examples/serve.mjs 재사용)를 임시 포트로 띄우고, 로컬 Chromium 계열
// 브라우저를 headless로 실행해 페이지의 실측 결과를 POST /gateReport로 회수한다.
// 사용: npm run test:browser                          (기본: tests/browser/gate.html)
//       node tests/browser/run.mjs tests/attempts/<카테고리>/probe.html   (attempts probe)
//       브라우저 지정: PYPROC_BROWSER=<실행파일 경로>
// 이것이 pyproc의 "진짜 검증"이다. tests/run.mjs는 구조만 보고, 여기는 런타임을 본다.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStaticServer } from "../../examples/serve.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 240000); // 콜드 CDN 감안. 무거운 probe는 env로 연장

function findBrowser() {
  if (process.env.PYPROC_BROWSER) return process.env.PYPROC_BROWSER;
  const candidates = process.platform === "win32" ? [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
  ] : process.platform === "darwin" ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ] : [
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/microsoft-edge",
  ];
  const found = candidates.find((c) => c && existsSync(c));
  if (!found) throw new Error("Chromium 계열 브라우저를 찾지 못함. PYPROC_BROWSER=<경로>로 지정하라.");
  return found;
}

let reportResolve;
const reportPromise = new Promise((res) => { reportResolve = res; });

const server = createStaticServer(async (req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/gateReport")) return false;
  let body = "";
  for await (const chunk of req) body += chunk;
  res.writeHead(204); res.end();
  try { reportResolve(JSON.parse(body)); } catch (e) { reportResolve({ ok: false, checks: [], parseError: String(e) }); }
  return true;
});

await new Promise((res) => server.listen(0, "127.0.0.1", res));
const page = (process.argv[2] || "tests/browser/gate.html").replaceAll("\\", "/").replace(/^\/+/, "");
const url = `http://127.0.0.1:${server.address().port}/${page}`;

const browser = findBrowser();
const profile = mkdtempSync(join(tmpdir(), "pyprocGate-"));
const args = [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--disable-background-networking", `--user-data-dir=${profile}`,
];
if (process.env.CI) args.push("--no-sandbox"); // 컨테이너 러너 호환
args.push(url);

console.log(`pyproc 브라우저 게이트\n  browser: ${browser}\n  url:     ${url}\n`);
const proc = spawn(browser, args, { stdio: "ignore" });

const timeout = setTimeout(() => reportResolve({ ok: false, checks: [], timedOut: true }), TIMEOUT_MS);
const result = await reportPromise;
clearTimeout(timeout);

// headless 브라우저는 자식 프로세스를 거느리므로 트리째 정리한다.
if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
else proc.kill("SIGKILL");
server.close();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}

if (result.timedOut) {
  console.log(`FAIL 게이트 타임아웃(${TIMEOUT_MS / 1000}s). 네트워크(Pyodide CDN) 또는 브라우저 실행을 확인하라.`);
  process.exit(1);
}
for (const c of result.checks) console.log(`  ${c.pass ? "PASS" : "FAIL"} ${c.name}${c.info ? " (" + c.info + ")" : ""}`);
if (result.timings) console.log(`\n실측: ${JSON.stringify(result.timings)}`);
// 실측 수치 아카이브(CI 아티팩트용): 러너 숫자와 로컬 숫자를 비교 가능하게 보존한다.
if (process.env.PYPROC_GATE_OUT) writeFileSync(process.env.PYPROC_GATE_OUT, JSON.stringify({ page, browser, ...result }, null, 2));
console.log(`\n결과: ${result.ok ? "GREEN" : "RED"} (${result.checks.filter((c) => c.pass).length}/${result.checks.length})`);
process.exit(result.ok ? 0 : 1);
