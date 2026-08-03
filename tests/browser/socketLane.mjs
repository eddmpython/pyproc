// socketLane.mjs - 소켓 표면의 밀폐 게이트(Node 전용, 의존성 0).
//
// 이 표면은 "릴레이를 이 패키지가 배송하지 않는다"는 이유로 헤드리스 게이트가 0이었다. 그런데
// 릴레이는 이 저장소 안에 의존성 0으로 있으므로(tests/attempts/socketBridge/relay.mjs), 러너가
// 릴레이와 로컬 HTTP 오리진을 함께 소유하면 바깥으로 한 바이트도 나가지 않는 레인이 된다.
// 배송 결정은 그대로다: 게이트가 자기 릴레이를 띄우는 것과 패키지가 릴레이를 싣는 것은 다르다.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createStaticServer } from "../../scripts/staticServer.mjs";
import { findBrowser, headlessArgs, judgeReport, killBrowser } from "./harness.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 240000);
const indexQuery = process.env.PYPROC_INDEX_URL ? `&indexURL=${encodeURIComponent(process.env.PYPROC_INDEX_URL)}` : "";

const listenOn = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

// 이 게이트가 다이얼할 오리진. 릴레이가 진짜 TCP로 여는 대상이 이것이다.
const origin = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain", "Content-Length": "18", Connection: "close" });
  res.end("pyproc-socket-lane");
});
const originPort = await listenOn(origin);

// 포트만 빌리고 **닫아서** 돌려준다: 안 닫으면 릴레이가 그 자리를 못 잡고, 그러면 이 게이트는
// "릴레이가 죽었다"를 "소켓이 안 된다"로 잘못 보고한다.
const portLender = createServer();
const relayPort = await listenOn(portLender);
await new Promise((resolve) => portLender.close(resolve));
const relay = spawn(process.execPath, [join(ROOT, "tests", "attempts", "socketBridge", "relay.mjs"), String(relayPort)], {
  cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
});
relay.stderr.on("data", (chunk) => process.stderr.write(String(chunk)));
await new Promise((resolve) => {
  const done = () => resolve();
  relay.stdout.on("data", (chunk) => { if (String(chunk).includes("relay listening")) done(); });
  setTimeout(done, 3000);
});

let resolveReport = null;
const pageServer = createStaticServer(async (req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/gateReport")) return false;
  let body = "";
  for await (const chunk of req) body += chunk;
  res.writeHead(204); res.end();
  const waiting = resolveReport;
  if (waiting) { resolveReport = null; try { waiting(JSON.parse(body)); } catch (error) { waiting({ ok: false, parseError: String(error) }); } }
  return true;
});
await new Promise((resolve) => pageServer.listen(0, "127.0.0.1", resolve));
const pagePort = pageServer.address().port;

const browser = findBrowser();
console.log(`pyproc 소켓 레인 게이트\n  browser: ${browser}\n  relay:   ws://127.0.0.1:${relayPort}\n  origin:  http://127.0.0.1:${originPort}\n`);
const profileDir = join(ROOT, "node_modules", ".pyprocSocketLaneProfile");
const url = `http://127.0.0.1:${pagePort}/tests/browser/socketLane.html?gate=1&relay=${encodeURIComponent(`ws://127.0.0.1:${relayPort}`)}&originPort=${originPort}${indexQuery}`;
const child = spawn(browser, [...headlessArgs(profileDir), url], { stdio: "ignore" });

const result = await new Promise((resolve) => {
  resolveReport = resolve;
  setTimeout(() => { if (resolveReport === resolve) { resolveReport = null; resolve({ ok: false, timedOut: true }); } }, TIMEOUT_MS);
});

await killBrowser(child, profileDir);
relay.kill();
origin.close();
pageServer.close();

for (const entry of result.checks || []) {
  console.log(`  ${entry.pass ? "PASS" : "FAIL"} ${entry.name}${entry.info ? ` (${entry.info})` : ""}`);
}
if (result.timings) console.log(`\n실측: ${JSON.stringify(result.timings)}`);
// 판정은 harness.judgeReport 한 곳이다(페이지가 보낸 ok는 읽지 않는다).
const verdict = judgeReport(result, { timeoutLabel: "타임아웃" });
// 보고가 비면 그 사실을 말한다. 빈 보고를 "0/0 RED"로만 찍으면 타임아웃과 페이지 사망이 구분되지 않는다.
if (!verdict.total) console.log(`  보고 없음: ${result.timedOut ? "타임아웃" : JSON.stringify(result).slice(0, 200)}`);
for (const problem of verdict.problems) console.log(`\nFAIL ${problem}`);
console.log(`\n결과: ${verdict.ok ? "GREEN" : "RED"} (${verdict.passed}/${verdict.total})`);
process.exit(verdict.ok ? 0 : 1);
