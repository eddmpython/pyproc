// webdriverCauseRunner.mjs - navigator.webdriver 인과 격리. Node 전용, 의존성 0.
// bootIsolationRunner의 스텔스 측정은 "content script도 webdriver=true"를 보였으나, 이는 확장 로드에
// 쓴 --remote-debugging-port가 webdriver를 브라우저 전역으로 켠 하네스 오염이라는 가설을 세웠다.
// 이 러너가 그 가설을 확장/조작 없이 직접 검증한다: 크롬을 조건별(포트 없음/있음)로 켜고, 자동 로드된
// 측정 페이지가 navigator.webdriver를 백채널로 보고한다(CDP 불필요 = 오염원 없이 baseline 측정).
// 판정: 1번(평범)이 false이고 2~3번(디버그 플래그)이 true면 범인은 포트 플래그이고 조작 경로는 무죄 =
// 실배포(정상 설치, 포트 없음)에서 content script 경로는 webdriver를 켜지 않는다(논리 확정).
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBrowser } from "../../browser/harness.mjs";

// 측정 페이지: 자기 navigator.webdriver 등을 백채널로 POST. 크롬이 이 URL을 인자로 열면 자동 실행.
const PAGE = `<!doctype html><meta charset=utf-8><title>wd</title><script>
fetch("/report", { method:"POST", body: JSON.stringify({
  webdriver: navigator.webdriver,
  uaHeadless: /Headless/.test(navigator.userAgent),
  plugins: navigator.plugins.length
})});
</script>`;

let pending = null;
const server = createServer((req, res) => {
  if (req.url === "/probe") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(PAGE); }
  if (req.url === "/report" && req.method === "POST") {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      res.writeHead(204); res.end();
      if (pending) pending(JSON.parse(b));
    });
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/probe`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const killTree = (p) => { if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }); else p.kill("SIGKILL"); };

const browser = findBrowser();
const results = {};

// 조건별로 크롬을 새 프로필 + 새 프로세스로 켜고 측정 페이지 보고를 회수.
async function measure(label, extraArgs) {
  const profile = mkdtempSync(join(tmpdir(), "wdCause-"));
  const got = new Promise((res) => { pending = res; });
  const proc = spawn(browser, [
    "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    `--user-data-dir=${profile}`, ...extraArgs, url,
  ], { stdio: "ignore" });
  const result = await Promise.race([got, wait(15000).then(() => ({ timeout: true }))]);
  killTree(proc);
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  results[label] = result;
  console.log(`  ${label.padEnd(34)} -> webdriver=${result.webdriver}  (uaHeadless=${result.uaHeadless}, plugins=${result.plugins})`);
  await wait(500);
}

console.log(`webdriver 인과 격리\n  browser: ${browser}\n`);
await measure("1. 평범(플래그 없음)", []);
await measure("2. +원격 포트", ["--remote-debugging-port=0"]);
await measure("3. +원격 포트 +확장디버그", ["--remote-debugging-port=0", "--enable-unsafe-extension-debugging"]);
server.close();

// 게이트: baseline false + 포트 조건 true = 범인이 포트 플래그임을 확정.
const baseline = results["1. 평범(플래그 없음)"];
const withPort = results["2. +원격 포트"];
const green = baseline && baseline.webdriver === false && withPort && withPort.webdriver === true;
console.log(`\n결과: ${green ? "GREEN" : "RED"} - ${green
  ? "범인은 --remote-debugging-port(디버그 모드). 조작 경로 무죄 = content script는 실배포에서 webdriver 미점화(논리 확정)."
  : "예상과 다름: baseline/포트 조건을 확인하라(브라우저 버전별 동작 차이 가능)."}`);
process.exit(green ? 0 : 1);
