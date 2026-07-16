// mcpSandboxServer.mjs - pyproc 샌드박스를 MCP(stdio) 도구로 노출하는 레시피(Node 전용, 의존성 0).
// AI 에이전트(Claude Code 등)가 이 서버를 붙이면 도구 4개를 얻는다:
//   pythonRun(code)          - 준비된 파이썬 머신에서 실행(stdout + 마지막 식 repr)
//   checkpointSave()         - 지금 상태를 복원 핸들로 저장
//   checkpointRestore(index) - 저장 지점으로 밀리초 복귀(생략 시 마지막)
//   sandboxReset()           - 부팅 직후 준비 상태(cp0)로 복귀
// 구조: COOP/COEP 정적 서버(examples/serve.mjs) + headless Chromium(tests/browser/harness.mjs)
// 위에 examples/mcpSandbox.html 머신 페이지를 띄우고, long-poll 훅으로 명령을 왕복한다.
// MCP 전송은 stdio의 newline-delimited JSON-RPC 2.0이다(스펙의 stdio transport).
// 등록 예시: claude mcp add pyproc-sandbox -- node scripts/mcpSandboxServer.mjs
import { mkdtempSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createStaticServer } from "../examples/serve.mjs";
import { findBrowser, headlessArgs } from "../tests/browser/harness.mjs";

const PROTOCOL_VERSION = "2025-06-18"; // 지원 MCP 스펙 리비전(클라이언트 제안을 에코 우선)
const COMMAND_TIMEOUT_MS = Number(process.env.PYPROC_MCP_TIMEOUT || 180000); // 첫 호출은 엔진 부팅 포함
const POLL_HOLD_MS = 20000; // long-poll 보류 상한(프록시 idle 타임아웃 회피)

const TOOLS = [
  {
    name: "pythonRun",
    description: "Run Python in the prepared browser machine. Returns stdout and the repr of the last expression. State persists across calls.",
    inputSchema: { type: "object", properties: { code: { type: "string", description: "Python source to execute" } }, required: ["code"] },
  },
  {
    name: "checkpointSave",
    description: "Save the current machine state as a restore handle. Returns the checkpoint index.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "checkpointRestore",
    description: "Restore a saved checkpoint in milliseconds (omit index for the most recent save). Use after a failed attempt to get the prepared state back.",
    inputSchema: { type: "object", properties: { index: { type: "number", description: "Checkpoint index from checkpointSave" } } },
  },
  {
    name: "sandboxReset",
    description: "Restore the machine to its just-booted prepared state (cp0) and drop saved checkpoints.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ---- 페이지 <-> 서버 명령 채널(게이트 하네스와 같은 훅 패턴) ----
const commandQueue = [];
let pollWaiter = null;      // 페이지의 보류 중 long-poll 응답
const pending = new Map();  // 명령 id -> { resolve }
let commandSeq = 0;
let pageReady = false;
let readyWaiters = [];

function drainCommand(res) {
  const command = commandQueue.shift();
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(command));
}

function dispatch(tool, args) {
  const id = ++commandSeq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`sandbox 명령 timeout(${COMMAND_TIMEOUT_MS}ms): ${tool}`));
    }, COMMAND_TIMEOUT_MS);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); } });
    commandQueue.push({ id, tool, args });
    if (pollWaiter) { const w = pollWaiter; pollWaiter = null; clearTimeout(w.hold); drainCommand(w.res); }
  });
}

const server = createStaticServer(async (req, res) => {
  if (req.method === "POST" && req.url.startsWith("/mcpReady")) {
    for await (const chunk of req) void chunk;
    pageReady = true;
    for (const resolve of readyWaiters) resolve();
    readyWaiters = [];
    res.writeHead(204); res.end();
    return true;
  }
  if (req.method === "GET" && req.url.startsWith("/mcpCommand")) {
    if (commandQueue.length) { drainCommand(res); return true; }
    const hold = setTimeout(() => {
      if (pollWaiter && pollWaiter.res === res) pollWaiter = null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ none: true }));
    }, POLL_HOLD_MS);
    pollWaiter = { res, hold };
    return true;
  }
  if (req.method === "POST" && req.url.startsWith("/mcpResult")) {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.writeHead(204); res.end();
    try {
      const result = JSON.parse(body);
      const waiter = pending.get(result.id);
      if (waiter) { pending.delete(result.id); waiter.resolve(result); }
    } catch (e) { process.stderr.write(`mcpResult 파싱 실패: ${e}\n`); }
    return true;
  }
  return false;
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const pageUrl = `http://127.0.0.1:${server.address().port}/examples/mcpSandbox.html`
  + (process.env.PYPROC_INDEX_URL ? `?indexURL=${encodeURIComponent(process.env.PYPROC_INDEX_URL)}` : "");

const profile = mkdtempSync(join(tmpdir(), "pyprocMcp-"));
const browser = findBrowser();
const browserProc = spawn(browser, [...headlessArgs(profile), pageUrl], { stdio: "ignore" });
process.stderr.write(`pyproc MCP sandbox: ${browser} -> ${pageUrl}\n`);

function shutdown(code = 0) {
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(browserProc.pid), "/T", "/F"], { stdio: "ignore" });
    else browserProc.kill("SIGKILL");
  } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function waitForPage() {
  if (pageReady) return Promise.resolve();
  return new Promise((resolve) => readyWaiters.push(resolve));
}

// ---- MCP stdio(JSON-RPC 2.0, 한 줄 = 한 메시지) ----
const write = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const resultOf = (id, result) => write({ jsonrpc: "2.0", id, result });
const errorOf = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });

function toolResult(id, payload) {
  resultOf(id, { content: [{ type: "text", text: JSON.stringify(payload, null, 1) }] });
}

function toolError(id, error) {
  // 도구 실패는 프로토콜 오류가 아니라 isError 결과다(에이전트가 읽고 재시도 판단).
  resultOf(id, { content: [{ type: "text", text: JSON.stringify(error, null, 1) }], isError: true });
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("close", () => shutdown(0));
rl.on("line", async (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try { message = JSON.parse(text); } catch (e) { return; }
  const { id, method, params } = message;
  try {
    if (method === "initialize") {
      resultOf(id, {
        protocolVersion: (params && params.protocolVersion) || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "pyproc-sandbox", version: "1" },
        instructions: "A persistent Python machine in a browser sandbox. Prepare state with pythonRun, checkpointSave before risky attempts, checkpointRestore to roll back in milliseconds.",
      });
    } else if (method === "notifications/initialized") {
      // 알림: 응답 없음
    } else if (method === "ping") {
      resultOf(id, {});
    } else if (method === "tools/list") {
      resultOf(id, { tools: TOOLS });
    } else if (method === "tools/call") {
      const tool = params && params.name;
      if (!TOOLS.some((t) => t.name === tool)) { errorOf(id, -32602, `unknown tool: ${tool}`); return; }
      await waitForPage();
      const outcome = await dispatch(tool, (params && params.arguments) || {});
      if (outcome.ok) toolResult(id, outcome.value);
      else toolError(id, outcome.error);
    } else if (id !== undefined) {
      errorOf(id, -32601, `unknown method: ${method}`);
    }
  } catch (e) {
    if (id !== undefined) errorOf(id, -32603, String((e && e.message) || e).slice(-300));
  }
});
