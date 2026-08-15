// Runs the golden workflow against a clean offline tarball install.
import { createServer } from "node:http";
import { rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { safeJoin, sendFile } from "../../scripts/staticServer.mjs";
import { installPackedPyProc } from "../packageHarness.mjs";
import { awaitGateReport, judgeReport, launchBrowser } from "./harness.mjs";

const { tmp, appDir } = await installPackedPyProc("pyprocGolden-");
try {
  const publicDir = join(appDir, "public");
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, "goldenWorkflow.html"),
    await readFile(new URL("./goldenWorkflow.html", import.meta.url)));
  let resolveReport;
  const reportPromise = new Promise((resolve) => { resolveReport = resolve; });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://local");
    if (request.method === "POST" && url.pathname === "/gateReport") {
      let body = "";
      for await (const chunk of request) body += chunk;
      response.writeHead(204);
      response.end();
      resolveReport(JSON.parse(body));
      return;
    }
    const file = url.pathname === "/" ? join(publicDir, "goldenWorkflow.html")
      : url.pathname.startsWith("/node_modules/") ? safeJoin(appDir, url.pathname) : safeJoin(publicDir, url.pathname);
    if (!file) { response.writeHead(403); response.end("forbidden"); return; }
    await sendFile(response, file);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const launch = () => launchBrowser(url, { prefix: "pyprocGolden-" });
  const first = launch();
  const { result, session } = await awaitGateReport({ reportPromise, timeoutMs: 120000,
    session: first, relaunch: launch });
  session.close();
  server.close();
  for (const entry of result.checks || []) console.log(`${entry.pass ? "PASS" : "FAIL"} ${entry.name}`);
  const verdict = judgeReport(result, { floor: 9 });
  for (const problem of verdict.problems) console.log(`FAIL ${problem}`);
  console.log(`result: ${verdict.ok ? "GREEN" : "RED"} (${verdict.passed}/${verdict.total})`);
  process.exitCode = verdict.ok ? 0 : 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
