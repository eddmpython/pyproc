// 설치 tarball의 공개 specifier만으로 대표 prepare-candidate-restore-commit-reopen 루프를 돈다.
import { createServer } from "node:http";
import { rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { safeJoin, sendFile } from "../../scripts/staticServer.mjs";
import { installPackedPyProc, ROOT } from "../packageHarness.mjs";
import { launchBrowser } from "./harness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GOLDEN_TIMEOUT || 180000);
const GOLDEN_PAGE = "tests/browser/goldenWorkflow.html";

function createGoldenServer(appDir, publicDir, onReport, onProgress) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && url.pathname === "/gateProgress") {
      let body = "";
      for await (const chunk of req) body += chunk;
      res.writeHead(204); res.end();
      try { onProgress(JSON.parse(body).stage); }
      catch (error) { onProgress(`invalid progress: ${String(error)}`); }
      return;
    }
    if (req.method === "POST" && url.pathname === "/gateReport") {
      let body = "";
      for await (const chunk of req) body += chunk;
      res.writeHead(204); res.end();
      try { onReport(JSON.parse(body)); }
      catch (error) { onReport({ ok: false, checks: [], parseError: String(error) }); }
      return;
    }

    let file = null;
    if (url.pathname === "/") file = join(publicDir, "goldenWorkflow.html");
    else if (url.pathname.startsWith("/node_modules/")) file = safeJoin(appDir, url.pathname);
    else if (url.pathname.startsWith("/vendor/pyodide/")) file = safeJoin(ROOT, url.pathname);
    if (!file) { res.writeHead(403); res.end("forbidden"); return; }
    await sendFile(res, file);
  });
}

const { tmp, appDir, packed } = await installPackedPyProc("pyprocGolden-");
let server = null;
let session = null;
try {
  const installedPackage = JSON.parse(await readFile(join(appDir, "node_modules", "pyproc", "package.json")));
  if (!packed.version || installedPackage.version !== packed.version) {
    throw new Error(`packed install version mismatch: pack=${packed.version || "missing"}, installed=${installedPackage.version || "missing"}`);
  }
  const publicDir = join(appDir, "public");
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, "goldenWorkflow.html"),
    await readFile(join(ROOT, ...GOLDEN_PAGE.split("/"))));

  let reportResolve;
  const reportPromise = new Promise((resolve) => { reportResolve = resolve; });
  server = createGoldenServer(appDir, publicDir, reportResolve,
    (stage) => console.log(`  stage: ${stage}`));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const indexQuery = process.env.PYPROC_INDEX_URL
    ? `?indexURL=${encodeURIComponent(process.env.PYPROC_INDEX_URL)}` : "";
  const url = `http://127.0.0.1:${server.address().port}/${indexQuery}`;
  session = launchBrowser(url, { prefix: "pyprocGolden-" });
  console.log(`pyproc golden workflow\n  package: pyproc@${installedPackage.version} (${packed.filename})\n  browser: ${session.browser}\n  url:     ${url}\n`);

  const timeout = setTimeout(() => reportResolve({ ok: false, checks: [], timedOut: true }), TIMEOUT_MS);
  const result = await reportPromise;
  clearTimeout(timeout);
  if (result.timedOut) {
    console.log(`FAIL golden workflow timeout(${TIMEOUT_MS / 1000}s)`);
    process.exitCode = 1;
  } else {
    for (const entry of result.checks || []) {
      console.log(`  ${entry.pass ? "PASS" : "FAIL"} ${entry.name}${entry.info ? ` (${entry.info})` : ""}`);
    }
    if (result.timings) console.log(`\nmeasurement: ${JSON.stringify(result.timings)}`);
    const passCount = (result.checks || []).filter((entry) => entry.pass).length;
    const ok = result.ok && passCount > 0;
    console.log(`\nresult: ${ok ? "GREEN" : "RED"} (${passCount}/${(result.checks || []).length})`);
    if (!ok) process.exitCode = 1;
  }
} finally {
  session?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  rmSync(tmp, { recursive: true, force: true });
}
