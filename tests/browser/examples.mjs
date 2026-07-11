// examples.mjs - 예제 실행 게이트: 데모 페이지가 "사람이 여는 그대로" 완주하는지 검증한다.
// 배경(2026-07-12): processOs 예제의 BigInt 직렬화 실결함이 어떤 게이트에도 안 걸린 채
// 라이브 데모까지 나갔다. 공개 표면 게이트(gate.html)는 라이브러리를 검증하지 예제를
// 실행하지 않는다. 예제는 데모(진열장)이므로 이 게이트가 매 CI에서 실제로 연다.
// 각 예제는 ?gate 쿼리에서만 /gateReport로 완주 여부를 보고한다(사람이 열면 no-op).
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStaticServer } from "../../examples/serve.mjs";
import { findBrowser, headlessArgs } from "./harness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 240000);
const PAGES = ["examples/basic.html", "examples/terminal.html", "examples/machine.html", "examples/processOs.html"];

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
await new Promise((res) => server.listen(0, "127.0.0.1", res));
const port = server.address().port;
console.log(`pyproc 예제 게이트\n  browser: ${browser}\n`);

let failed = 0;
for (const page of PAGES) {
  const profile = mkdtempSync(join(tmpdir(), "pyprocExample-"));
  const proc = spawn(browser, [...headlessArgs(profile), `http://127.0.0.1:${port}/${page}?gate=1`], { stdio: "ignore" });
  const result = await new Promise((res) => {
    resolveReport = res;
    setTimeout(() => { if (resolveReport === res) { resolveReport = null; res({ ok: false, timedOut: true }); } }, TIMEOUT_MS);
  });
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  else proc.kill("SIGKILL");
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  const info = ((result.checks && result.checks[0] && result.checks[0].info) || "").replaceAll("\n", " | ").slice(-150);
  if (result.ok !== true) failed++;
  console.log(`  ${result.ok === true ? "PASS" : "FAIL"} ${page}${result.timedOut ? " (타임아웃)" : ""}${info ? "\n        " + info : ""}`);
}
server.close();
console.log(`\n결과: ${PAGES.length - failed}/${PAGES.length} ${failed ? "RED" : "GREEN"}`);
process.exit(failed ? 1 : 0);
