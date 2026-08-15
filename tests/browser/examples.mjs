// examples.mjs - 예제 실행 게이트: 데모 페이지가 "사람이 여는 그대로" 완주하는지 검증한다.
// 배경(2026-07-12): processOs 예제의 BigInt 직렬화 실결함이 어떤 게이트에도 안 걸린 채
// 라이브 데모까지 나갔다. 공개 표면 게이트(gate.html)는 라이브러리를 검증하지 예제를
// 실행하지 않는다. 예제는 데모(진열장)이므로 이 게이트가 매 CI에서 실제로 연다.
// 각 예제는 ?gate 쿼리에서만 /gateReport로 완주 여부를 보고한다(사람이 열면 no-op).
import { readFileSync } from "node:fs";
import { createStaticServer } from "../../scripts/staticServer.mjs";
import { awaitGateReport, countRequests, findBrowser, judgeReport, launchBrowser } from "./harness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 240000);
// brandGate: 예제가 쓰는 브랜드 자산(마크 SVG + demo.css 팔레트)이 실제로 그려지는지 먼저 본다.
// 이 층의 실패는 조용하다(파싱 실패 = 이미지가 사라지고, 색만 초기값으로 돌아간다). 파이썬을
// 안 띄우므로 몇 초면 끝난다: 예제 5쪽을 다 돌리기 전에 진열장이 깨졌는지부터 알려준다.
// 빈 문자열 = 랜딩("/"). 랜딩 히어로가 진짜로 CPython을 부팅해 체크포인트/복원을 돌리므로 예제와
// 같은 급의 실행 표면이다. 랜딩은 배포 루트 기준 상대 경로를 쓰니 반드시 "/"로 열어야 한다
// (examples/index.html 경로로 열면 assets/와 index.js가 어긋난다. staticServer가 "/"를 랜딩에 매핑한다).
const PAGES = ["tests/browser/brandGate.html", "", "examples/basic.html", "examples/agentSandbox.html", "examples/terminal.html", "examples/machine.html", "examples/immortal.html", "examples/serverDev.html", "examples/speedLab.html", "examples/processOs.html"];
const label = (page) => page || "/ (랜딩 히어로 라이브 데모)";
// 페이지별 통과 체크 수 하한. 예제 페이지는 단정이 하나뿐인 것이 많아서, 그 하나를 지우거나
// 약화시키면 이 레인이 통째로 무의미해진다(그것을 막는 층은 여기밖에 없다). 하한은
// tests/browser/gateFloor.json 한 곳에 산다: 브라우저 레인의 하한 정본이 갈리면 안 된다.
const FLOORS = JSON.parse(readFileSync(new URL("./gateFloor.json", import.meta.url), "utf8")).floors;

const browser = findBrowser();
let resolveReport = null;
const server = createStaticServer(async (req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/gateReport")) return false;
  let body = "";
  for await (const chunk of req) body += chunk;
  res.writeHead(204); res.end();
  const r = resolveReport;
  if (r) { resolveReport = null; try { r(JSON.parse(body)); } catch (e) { r({ ok: false, parseError: String(e) }); } }
  return true;
});
const totalRequests = countRequests(server);
await new Promise((res) => server.listen(0, "127.0.0.1", res));
const port = server.address().port;
console.log(`pyproc 예제 게이트\n  browser: ${browser}\n`);

let failed = 0;
for (const page of PAGES) {
  // speedLab의 speedup 문턱만 환경으로 조정 가능(공유 러너의 물리 코어 한계).
  // 속도 주장 자체의 인증은 artifact 계약이 담당한다(skills/benchmark-pyproc/references/benchmarking.md S1).
  const minSpeedup = page === "examples/speedLab.html" && process.env.PYPROC_EXAMPLES_MIN_SPEEDUP
    ? `&minSpeedup=${process.env.PYPROC_EXAMPLES_MIN_SPEEDUP}` : "";
  const launch = () => launchBrowser(`http://127.0.0.1:${port}/${page}?gate=1${minSpeedup}`, { browser, prefix: "pyprocExample-" });
  const before = totalRequests();
  const reportPromise = new Promise((res) => { resolveReport = res; });
  const awaited = await awaitGateReport({
    reportPromise, timeoutMs: TIMEOUT_MS, session: launch(),
    relaunch: launch, requestCount: () => totalRequests() - before,
  });
  const result = awaited.result;
  // 타임아웃이면 이 페이지의 늦은 보고가 다음 페이지의 promise를 가로채지 못하게 끊는다.
  if (result.timedOut) resolveReport = null;
  awaited.session.close();
  const info = ((result.checks && result.checks[0] && result.checks[0].info) || "").replaceAll("\n", " | ").slice(-150);
  // 판정은 harness.judgeReport 한 곳이다(페이지가 보낸 ok는 읽지 않는다). 예제 페이지는
  // 단정이 하나뿐인 경우가 많아 하한이 특히 중요하다: 단정을 지우면 체크 0개로 RED가 된다.
  const verdict = judgeReport(result, { floor: FLOORS[page], timeoutLabel: "타임아웃" });
  if (!verdict.ok) failed++;
  const problems = verdict.problems.length ? "\n        " + verdict.problems.join(" / ") : "";
  const diagnosis = result.timedOut ? `\n        진단: ${JSON.stringify(result.diagnosis)}` : "";
  console.log(`  ${verdict.ok ? "PASS" : "FAIL"} ${label(page)} (${verdict.passed}/${verdict.total})${result.timedOut ? " 타임아웃" : ""}${diagnosis}${info ? "\n        " + info : ""}${problems}`);
}
server.close();
console.log(`\n결과: ${PAGES.length - failed}/${PAGES.length} ${failed ? "RED" : "GREEN"}`);
process.exit(failed ? 1 : 0);
