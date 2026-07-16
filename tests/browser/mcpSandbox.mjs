// mcpSandbox.mjs - MCP 레시피 게이트(Node 전용, 의존성 0).
// scripts/mcpSandboxServer.mjs를 자식으로 띄워 stdio MCP 왕복을 실검증한다:
// initialize -> tools/list -> pythonRun(1+1)=2 -> checkpointSave -> 오염 -> checkpointRestore
// -> 오염 소거 확인 -> sandboxReset -> 재실행. 도구 오류 경로(파이썬 예외)도 isError로 온다.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 240000);

let passed = 0, failed = 0;
const check = (name, pass, info = "") => {
  if (pass) { passed++; console.log(`  PASS ${name}${info ? " (" + info + ")" : ""}`); }
  else { failed++; console.log(`  FAIL ${name}${info ? " (" + info + ")" : ""}`); }
};

const child = spawn(process.execPath, [join(ROOT, "scripts", "mcpSandboxServer.mjs")], {
  cwd: ROOT,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});
child.stderr.on("data", (chunk) => process.stderr.write(String(chunk)));

const waiters = new Map();
let reqSeq = 0;
const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
rl.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch (e) { return; }
  const waiter = waiters.get(message.id);
  if (waiter) { waiters.delete(message.id); waiter(message); }
});

function request(method, params) {
  const id = ++reqSeq;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(id); reject(new Error(`${method} timeout`)); }, TIMEOUT_MS);
    waiters.set(id, (message) => { clearTimeout(timer); resolve(message); });
  });
}

function toolText(message) {
  return JSON.parse(message.result.content[0].text);
}

console.log("pyproc MCP 샌드박스 게이트");
try {
  const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "gate", version: "1" } });
  check("initialize: 프로토콜/serverInfo", init.result && init.result.serverInfo.name === "pyproc-sandbox" && !!init.result.capabilities.tools, init.result && init.result.protocolVersion);
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const list = await request("tools/list", {});
  const names = list.result.tools.map((t) => t.name).sort().join(",");
  check("tools/list: 도구 4종", names === "checkpointRestore,checkpointSave,pythonRun,sandboxReset", names);

  const t0 = Date.now();
  const run1 = toolText(await request("tools/call", { name: "pythonRun", arguments: { code: "1 + 1" } }));
  check("pythonRun: 1 + 1 == 2 (부팅 포함 첫 호출)", run1.value === "2", `${Date.now() - t0}ms`);

  toolText(await request("tools/call", { name: "pythonRun", arguments: { code: "prepared = [10, 20, 30]" } }));
  const cp = toolText(await request("tools/call", { name: "checkpointSave", arguments: {} }));
  check("checkpointSave: 인덱스 반환", Number.isInteger(cp.index) && cp.index > 0, `index ${cp.index}`);

  toolText(await request("tools/call", { name: "pythonRun", arguments: { code: "prepared.append(999)\nleak = 'dirty'" } }));
  const restored = toolText(await request("tools/call", { name: "checkpointRestore", arguments: {} }));
  const afterRestore = toolText(await request("tools/call", { name: "pythonRun", arguments: { code: "(len(prepared), 'leak' in globals())" } }));
  check("checkpointRestore: 실패 시도 소거", afterRestore.value === "(3, False)", `${afterRestore.value}, ${restored.pagesWritten}p`);

  const failCall = await request("tools/call", { name: "pythonRun", arguments: { code: "raise ValueError('boom')" } });
  check("도구 오류: isError 결과로 전달(프로토콜 오류 아님)", failCall.result && failCall.result.isError === true && failCall.result.content[0].text.includes("boom"));

  const reset = toolText(await request("tools/call", { name: "sandboxReset", arguments: {} }));
  const afterReset = toolText(await request("tools/call", { name: "pythonRun", arguments: { code: "'prepared' in globals()" } }));
  check("sandboxReset: cp0 복귀(준비 상태 초기화)", afterReset.value === "False", `reset ${reset.pagesWritten}p`);
} catch (e) {
  check("예외 없음", false, String(e).slice(0, 200));
}

child.kill();
console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
