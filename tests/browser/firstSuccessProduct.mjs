// 설치 그래프 playground가 기본 core Machine을 부팅하고 첫 receipt를 두 번 같은 값으로 내는지 검증한다.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIRST_SUCCESS_OUTPUT } from "../../scripts/playground/firstSuccessContract.js";
import { findDataEngineAssets } from "../../scripts/playground/firstSuccessAssets.js";
import { createPlaygroundServer, PLAYGROUND_PAGE_PATH } from "../../scripts/playground/playgroundServer.js";
import { awaitGateReport, findBrowser, judgeReport, launchBrowser } from "./harness.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 240000);
const browser = findBrowser();

let resolveReport = null;
const server = createPlaygroundServer({
  root: ROOT,
  onRequest: async (request, response) => {
    if (request.method !== "POST" || new URL(request.url, "http://local").pathname !== "/gateReport") {
      return false;
    }
    let body = "";
    for await (const chunk of request) body += chunk;
    response.writeHead(204);
    response.end();
    const settle = resolveReport;
    resolveReport = null;
    if (settle) {
      try { settle(JSON.parse(body)); }
      catch (error) { settle({ ok: false, parseError: String(error) }); }
    }
    return true;
  },
});

await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const port = server.address().port;
const pageUrl = `http://127.0.0.1:${port}${PLAYGROUND_PAGE_PATH}?gate=1`;
console.log(`pyproc first-success product\n  browser: ${browser}\n  url: ${pageUrl}\n`);

let failed = 0;
const outputs = [];
for (const round of [1, 2]) {
  const before = server.requestedPaths.length;
  const reportPromise = new Promise((res) => { resolveReport = res; });
  const launch = () => launchBrowser(pageUrl, { browser, prefix: `pyprocFirstSuccess-${round}-` });
  const awaited = await awaitGateReport({
    reportPromise, timeoutMs: TIMEOUT_MS, session: launch(),
    relaunch: launch, requestCount: () => server.requestedPaths.length - before,
  });
  if (awaited.result.timedOut) resolveReport = null;
  awaited.session.close();
  const info = awaited.result?.checks?.[0]?.info || "";
  outputs.push(info);
  const verdict = judgeReport(awaited.result, { floor: 1, timeoutLabel: "타임아웃" });
  const pass = verdict.ok && awaited.result.checks?.[0]?.name === "firstSuccess" && info === FIRST_SUCCESS_OUTPUT;
  if (!pass) failed += 1;
  console.log(`  ${pass ? "PASS" : "FAIL"} round ${round} output=${info || "(empty)"}`);
  if (verdict.problems.length) console.log(`        ${verdict.problems.join(" / ")}`);
}

const leaked = findDataEngineAssets(server.requestedPaths);
if (leaked.length) {
  failed += 1;
  console.log(`  FAIL data-engine assets requested: ${leaked.join(", ")}`);
} else {
  console.log("  PASS no data-engine assets requested");
}
if (outputs[0] !== outputs[1] || outputs[0] !== FIRST_SUCCESS_OUTPUT) {
  failed += 1;
  console.log(`  FAIL receipt outputs drifted: ${outputs.join(" / ")}`);
} else {
  console.log(`  PASS receipt output ${FIRST_SUCCESS_OUTPUT} twice`);
}

server.close();
console.log(`\n결과: ${failed ? "RED" : "GREEN"}`);
process.exit(failed ? 1 : 0);
