// cellValueProbe.mjs - 한 번의 실행 호출이 print 출력과 마지막 식의 값을 함께 돌려줄 수 있는지 실측한다.
// 질문: 0.0.25의 machine.run.python은 출력만 주고 마지막 식의 값을 주지 않는다. Control 경로의 사설
// 하니스(mcpMachine.html)는 소스 전체가 식일 때만 값을 준다. 마지막 문장이 식이면 그 repr을 주는 REPL 의미론을
// 공개 실행 계약으로 올릴 수 있는가, 얼마의 비용으로, 어떤 경계에서.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { safeJoin, sendFile } from "../../../scripts/staticServer.mjs";
import { binPath, installPackedPyProc, ROOT, run } from "../../packageHarness.mjs";

const timeoutMs = Number(process.env.PYPROC_GATE_TIMEOUT || 180000);
const keepEvidence = process.env.PYPROC_KEEP_ATTEMPT_EVIDENCE === "1";

const CASES = [
  { id: "printsThenExpression", code: 'print("a")\nprint("b")\n1 + 1', output: "a\nb", value: "2" },
  { id: "assignmentTail", code: "x = 5", output: "", value: null },
  { id: "noneTail", code: "None", output: "", value: null },
  { id: "stringTail", code: '"text"', output: "", value: "'text'" },
  { id: "blockTail", code: "for i in range(2):\n    print(i)", output: "0\n1", value: null },
  { id: "multiLineTail", code: "(1 +\n 2)", output: "", value: "3" },
  { id: "functionTail", code: "def f():\n    return 3\nf()", output: "", value: "3" },
  { id: "writeReturnsCount", code: 'import sys\nsys.stdout.write("no newline\\n")', output: "no newline", value: "11" },
  { id: "deepNesting", code: `${"(".repeat(90)}1${")".repeat(90)}`, output: "", value: "1" },
  { id: "semicolonTail", code: "y = 2; y * 3", output: "", value: "6" },
  { id: "raises", code: 'raise ValueError("boom")', error: "ValueError" },
  { id: "syntaxError", code: "1 +", error: "SyntaxError" },
];

// 후보: 파싱만 AST로 하고 앞부분은 exec, 마지막 Expr만 eval한다. 값은 repr, None은 REPL처럼 비운다.
const CELL_HELPER = [
  "import ast as pyprocAst, json as pyprocJson",
  "def pyprocCell(pyprocSource):",
  "    tree = pyprocAst.parse(pyprocSource, mode='exec')",
  "    tail = None",
  "    if tree.body and isinstance(tree.body[-1], pyprocAst.Expr):",
  "        tail = pyprocAst.Expression(tree.body.pop().value)",
  "    exec(compile(tree, '<cell>', 'exec'), globals())",
  "    if tail is None:",
  "        return None",
  "    value = eval(compile(tail, '<cell>', 'eval'), globals())",
  "    return None if value is None else repr(value)",
].join("\n");

function page(importMap) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>cell value probe</title>
<script type="importmap">${JSON.stringify({ imports: importMap })}</script></head>
<body><main><h1>Cell value probe</h1><p id="status">running</p><pre id="rows"></pre></main>
<script type="module">
import { boot } from "pyproc";
const CASES = ${JSON.stringify(CASES)};
const HELPER = ${JSON.stringify(CELL_HELPER)};
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
let machine = null;
try {
  machine = await boot({ deterministic: true });
  const baselineKeys = Object.keys(await machine.run.python("1 + 1")).sort();
  const baselineRows = [];
  for (const entry of CASES) {
    try {
      const receipt = await machine.run.python(entry.code);
      baselineRows.push({ id: entry.id, output: receipt.output, value: receipt.value ?? "(no value field)" });
    } catch (error) { baselineRows.push({ id: entry.id, error: String(error?.message || error).slice(0, 160) }); }
  }
  await machine.run.python(HELPER);
  const candidate = async (code) => {
    const receipt = await machine.run.python("pyprocCellValue = pyprocCell(pyprocJson.loads(" + JSON.stringify(JSON.stringify(code)) + "))");
    return { output: receipt.output, value: await machine.run.get("pyprocCellValue") };
  };
  const rows = [];
  for (const entry of CASES) {
    try {
      const got = await candidate(entry.code);
      const pass = entry.error === undefined && got.output === entry.output && got.value === entry.value;
      rows.push({ id: entry.id, pass, output: got.output, value: got.value });
    } catch (error) {
      const message = String(error?.message || error);
      rows.push({ id: entry.id, pass: entry.error !== undefined && message.includes(entry.error), error: message.slice(0, 200) });
    }
  }
  const plain = []; const cell = [];
  for (let index = 0; index < 20; index += 1) {
    let started = performance.now(); await machine.run.python('print("a")\\n1 + 1'); plain.push(performance.now() - started);
    started = performance.now(); await candidate('print("a")\\n1 + 1'); cell.push(performance.now() - started);
  }
  const survivesAfterError = (await candidate("40 + 2")).value === "42";
  const report = { ok: rows.every((row) => row.pass) && survivesAfterError, baselineKeys, baselineRows, rows,
    survivesAfterError, timingMs: { plainMedian: median(plain), cellMedian: median(cell) } };
  document.getElementById("rows").textContent = JSON.stringify(report, null, 2);
  document.getElementById("status").textContent = report.ok ? "PASS" : "RED";
  await fetch("/probeReport", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) });
} catch (error) {
  await fetch("/probeReport", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: false, fatal: String(error?.message || error) }) });
} finally { if (machine) await machine.close(); }
</script></body></html>`;
}

let resolveReport;
const reportPromise = new Promise((resolve) => { resolveReport = resolve; });
const installed = await installPackedPyProc("pyprocCellValue-");
const publicDir = join(installed.appDir, "public");
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method === "POST" && url.pathname === "/probeReport") {
    let body = ""; for await (const chunk of request) body += chunk;
    response.writeHead(204); response.end();
    try { resolveReport(JSON.parse(body)); } catch (error) { resolveReport({ ok: false, fatal: String(error) }); }
    return;
  }
  const file = url.pathname.startsWith("/node_modules/") ? safeJoin(installed.appDir, url.pathname)
    : safeJoin(publicDir, url.pathname === "/" ? "/cellValue.html" : url.pathname);
  if (!file) { response.writeHead(403); response.end("forbidden"); return; }
  await sendFile(response, file);
});
let client = null; let targetRef = null;
try {
  await mkdir(publicDir, { recursive: true });
  const packageJson = JSON.parse(await readFile(join(installed.appDir, "node_modules", "pyproc", "package.json"), "utf8"));
  await writeFile(join(publicDir, "cellValue.html"),
    page({ pyproc: `/node_modules/pyproc/${packageJson.exports["."].default.replace(/^\.\//, "")}` }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const configPath = join(installed.appDir, ".pyproc-cell-value", "manifest.json");
  run(binPath(installed.appDir, "pyproc-mcp"), ["init", "--recipe", "authorizedBrowser", "--project-root", installed.appDir,
    "--out", ".pyproc-cell-value", "--engine-root", join(ROOT, "src", "runtime", "engines", "wasi", "owned", "core"),
    "--timeout-ms", String(timeoutMs), "--origin", origin, "--max-risk", "externalEffect",
    "--purpose", "cell value probe", "--acknowledge-effects", "--action", "snapshot",
    ...(process.env.PYPROC_BROWSER ? ["--browser", process.env.PYPROC_BROWSER] : [])], { cwd: installed.appDir });
  const installedRequire = createRequire(join(installed.appDir, "probeEntry.mjs"));
  const { PyProcControlClient } = await import(pathToFileURL(installedRequire.resolve("pyproc/control")).href);
  client = await PyProcControlClient.start(configPath, { cwd: installed.appDir, startupTimeoutMs: timeoutMs, shutdownTimeoutMs: 10000 });
  const opened = await client.openTarget(`${origin}/`, { expectedRisk: "externalEffect", waitUntil: "load" });
  targetRef = opened.output.targetRef;
  const report = await Promise.race([reportPromise, new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`cell value report timed out after ${timeoutMs} ms`)), timeoutMs))]);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  if (targetRef && client) await client.closeTarget(targetRef, { expectedRisk: "externalEffect" }).catch(() => {});
  if (client) await client.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  if (!keepEvidence) await rm(installed.tmp, { recursive: true, force: true });
}
