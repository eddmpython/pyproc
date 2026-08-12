// mcpSandboxServer.mjs - pyproc 샌드박스를 MCP(stdio) 도구로 노출하는 설치 런타임(Node 전용, 의존성 0).
// 에이전트가 이 서버를 붙이면 기본 도구 4개를 얻는다:
//   pythonRun(code)          - 준비된 파이썬 머신에서 실행(stdout + 마지막 식 repr)
//   checkpointSave()         - 지금 상태를 복원 핸들로 저장
//   checkpointRestore(index) - 저장 지점으로 밀리초 복귀(생략 시 마지막)
//   sandboxReset()           - 부팅 직후 준비 상태(cp0)로 복귀
// PYPROC_BROWSER_CONTROL=1을 명시하면 격리 profile의 저수준 및 고수준 browser 도구가 더 열린다.
// CDP endpoint는 Node broker만 소유하고 MCP stdio 밖에 listener를 추가하지 않는다.
// 구조: COOP/COEP 정적 서버 + product browser launcher
// 설치 패키지의 전용 머신 페이지를 띄우고, long-poll 훅으로 명령을 왕복한다.
// MCP 전송은 stdio의 newline-delimited JSON-RPC 2.0이다(스펙의 stdio transport).
// 등록 예시: claude mcp add pyproc-sandbox -- node scripts/mcpSandboxServer.mjs
import { createInterface } from "node:readline";
import { createControlProduct } from "./controlProtocol/controlProduct.mjs";
import { McpControlAdapter, mcpToolResult } from "./controlProtocol/mcpControlAdapter.js";

const PROTOCOL_VERSION = "2025-06-18"; // 지원 MCP 스펙 리비전(클라이언트 제안을 에코 우선)
const product = await createControlProduct();
const { host: controlHost, tools: TOOLS } = product;
const mcpAdapter = new McpControlAdapter({ host: controlHost, tools: TOOLS });
process.stderr.write(`pyproc MCP sandbox: ${product.browserSession.browser} -> ${product.pageUrl}\n`);

let shuttingDown = false;
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await product.close(); } catch (error) {}
  process.exit(code);
}
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

// ---- MCP stdio(JSON-RPC 2.0, 한 줄 = 한 메시지) ----
const write = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const resultOf = (id, result) => write({ jsonrpc: "2.0", id, result });
const errorOf = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("close", () => void shutdown(0));

rl.on("line", async (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try { message = JSON.parse(text); }
  catch (e) { errorOf(null, -32700, "invalid JSON-RPC message"); return; }
  const { id, method, params } = message;
  try {
    if (method === "initialize") {
      resultOf(id, {
        protocolVersion: (params && params.protocolVersion) || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "pyproc-sandbox", version: "1" },
        instructions: "A persistent Python machine in a browser sandbox. Agent code has no external network permission; same-origin MCP control traffic remains open. Prepare state with pythonRun, checkpointSave before risky attempts, and checkpointRestore after a failed attempt. Python checkpointRestore never rolls back browser actions. Browser tools appear only when the operator enables a scoped broker. Prefer compact browserObserve and bounded browserAct pipelines; use browserCommand only for separately raw-allowlisted CDP methods. Never retry an outcomeUnknown browser effect.",
      });
    } else if (method === "notifications/initialized") {
      // 알림: 응답 없음
    } else if (method === "notifications/cancelled") {
      mcpAdapter.cancel(params?.requestId, params?.reason || "MCP client cancelled the request");
    } else if (method === "ping") {
      resultOf(id, {});
    } else if (method === "tools/list") {
      resultOf(id, { tools: TOOLS });
    } else if (method === "tools/call") {
      const tool = params && params.name;
      if (!mcpAdapter.hasTool(tool)) { errorOf(id, -32602, `unknown tool: ${tool}`); return; }
      try {
        resultOf(id, mcpToolResult(await mcpAdapter.invoke(id, tool, (params && params.arguments) || {})));
      } catch (error) {
        if (error?.code === "CONTROL_REQUEST_DUPLICATE") errorOf(id, -32600, error.message);
        else resultOf(id, { content: [{ type: "text", text: JSON.stringify({
          code: error?.code || "PYPROC_INTERNAL", message: String(error?.message || error).slice(-500),
          outcome: error?.outcome || "notSent", retryable: error?.retryable === true,
        }, null, 1) }], isError: true });
      }
    } else if (id !== undefined) {
      errorOf(id, -32601, `unknown method: ${method}`);
    }
  } catch (e) {
    if (id !== undefined) errorOf(id, -32603, String((e && e.message) || e).slice(-300));
  }
});
