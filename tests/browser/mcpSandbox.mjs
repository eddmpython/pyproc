// mcpSandbox.mjs - MCP 레시피 게이트(Node 전용, 의존성 0).
// scripts/mcpSandboxServer.mjs를 자식으로 띄워 stdio MCP 왕복을 실검증한다:
// initialize -> tools/list -> pythonRun(1+1)=2 -> checkpointSave -> 오염 -> checkpointRestore
// -> 오염 소거 확인 -> sandboxReset -> 재실행. 도구 오류 경로(파이썬 예외)도 isError로 온다.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 240000);

let exfilRequests = 0;
const receiver = createServer((req, res) => {
  if (new URL(req.url, "http://receiver.invalid").pathname === "/collect") exfilRequests++;
  res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
  res.end();
});
await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve));
const receiverOrigin = `http://127.0.0.1:${receiver.address().port}`;

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
const messages = [];
let reqSeq = 0;
const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
rl.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch (e) { return; }
  messages.push(message);
  const waiter = waiters.get(message.id);
  if (waiter) { waiters.delete(message.id); waiter(message); }
});
const childExit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));

function request(method, params) {
  const id = ++reqSeq;
  return requestWithId(id, method, params);
}

function requestWithId(id, method, params) {
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
  check("tools/list: 도구 8종", names === "checkpointRestore,checkpointSave,eyesReplay,eyesVerify,pythonRun,sandboxReset,skills.read,skills.search", names);

  const skillSearch = toolText(await request("tools/call", {
    name: "skills.search", arguments: { query: "start-pyproc" },
  }));
  const selectedSkill = skillSearch.results[0];
  check("skills.search는 body 없이 digest-bound metadata만 반환",
    selectedSkill?.name === "start-pyproc" && !Object.hasOwn(selectedSkill, "content")
    && skillSearch.results.length <= 3, selectedSkill?.sha256);
  const skillRead = toolText(await request("tools/call", { name: "skills.read", arguments: {
    name: selectedSkill.name, expectedSha256: selectedSkill.sha256, relativePath: "SKILL.md",
  } }));
  check("skills.read는 기존 MCP에서 catalog와 같은 body digest를 반환",
    skillRead.sha256 === selectedSkill.sha256 && skillRead.catalogDigest === skillSearch.catalogDigest
    && skillRead.content.includes("name: start-pyproc"), skillRead.sha256);
  const staleSkill = await request("tools/call", { name: "skills.read", arguments: {
    name: selectedSkill.name, expectedSha256: `sha256:${"0".repeat(64)}`, relativePath: "SKILL.md",
  } });
  check("skills.read stale digest가 effect 없이 안정된 오류로 끝남",
    staleSkill.result?.isError === true && toolText(staleSkill).code === "SKILL_READ_STALE");

  const t0 = Date.now();
  const run1 = toolText(await request("tools/call", { name: "pythonRun", arguments: { code: "1 + 1" } }));
  check("pythonRun: 1 + 1 == 2 (부팅 포함 첫 호출)", run1.value === "2", `${Date.now() - t0}ms`);

  const health = await fetch(receiverOrigin + "/health");
  check("네트워크 음성 시험 대조군: 통제 수신기 도달 가능", health.status === 204);
  await request("tools/call", {
    name: "pythonRun",
    arguments: { code: `import js\njs.fetch(${JSON.stringify(receiverOrigin + "/collect")})` },
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  check("fail-closed CSP: import js/fetch 외부 전송 0건", exfilRequests === 0, `${exfilRequests} requests`);

  toolText(await request("tools/call", { name: "pythonRun", arguments: { code: "prepared = [10, 20, 30]" } }));
  const cp = toolText(await request("tools/call", { name: "checkpointSave", arguments: {} }));
  check("checkpointSave: 인덱스 반환", Number.isInteger(cp.index) && cp.index >= 0, `index ${cp.index}`);

  toolText(await request("tools/call", { name: "pythonRun", arguments: { code: "prepared.append(999)\nleak = 'dirty'" } }));
  const restored = toolText(await request("tools/call", { name: "checkpointRestore", arguments: {} }));
  const afterRestore = toolText(await request("tools/call", { name: "pythonRun", arguments: { code: "(len(prepared), 'leak' in globals())" } }));
  check("checkpointRestore: 실패 시도 소거", afterRestore.value === "(3, False)" && restored.restored === true,
    JSON.stringify({ value: afterRestore.value, restored }));

  const failCall = await request("tools/call", { name: "pythonRun", arguments: { code: "raise ValueError('boom')" } });
  check("도구 오류: isError 결과로 전달(프로토콜 오류 아님)", failCall.result && failCall.result.isError === true && failCall.result.content[0].text.includes("boom"));

  // 전달 뒤 취소는 Python 실행을 되감았다고 주장할 수 없다. caller는 즉시 결과 불명으로 끝나고,
  // page가 나중에 올린 결과는 두 번째 terminal이 되지 않아야 한다.
  const cancelId = ++reqSeq;
  const cancelledCall = requestWithId(cancelId, "tools/call", {
    name: "pythonRun",
    arguments: { code: "cancelEffect = 'applied'\nsum(i * i for i in range(5000000))" },
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled",
    params: { requestId: cancelId, reason: "gate cancellation" } }) + "\n");
  const cancelledPayload = toolText(await cancelledCall);
  check("전달 뒤 Python 취소는 outcomeUnknown이며 late result를 재응답하지 않는다",
    cancelledPayload.code === "CONTROL_CANCELLED" && cancelledPayload.outcome === "outcomeUnknown"
    && cancelledPayload.retryable === false, JSON.stringify(cancelledPayload));
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const afterCancel = toolText(await request("tools/call", { name: "pythonRun", arguments: { code: "cancelEffect" } }));
  check("취소 뒤 page bridge가 다음 명령을 받고 기존 effect는 한 번만 남는다", afterCancel.value === "'applied'", afterCancel.value);

  const reset = toolText(await request("tools/call", { name: "sandboxReset", arguments: {} }));
  const afterReset = toolText(await request("tools/call", {
    name: "pythonRun",
    arguments: { code: "('prepared' in globals(), __import__('importlib.util', fromlist=['find_spec']).find_spec('js') is None)" },
  }));
  check("sandboxReset: cp0 복귀 후 외부 JS bridge 부재", afterReset.value === "(False, True)" && reset.restored === true,
    JSON.stringify({ afterReset, reset }));

  const duplicateId = 900001;
  const firstDuplicate = await requestWithId(duplicateId, "tools/call", { name: "pythonRun", arguments: { code: "6 * 7" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: duplicateId, method: "tools/call",
    params: { name: "pythonRun", arguments: { code: "duplicateEffect = True" } } }) + "\n");
  const exited = await Promise.race([
    childExit,
    new Promise((resolve) => setTimeout(() => resolve(null), 10000)),
  ]);
  const duplicateTerminals = messages.filter((message) => message.id === duplicateId);
  const fatalDuplicate = messages.find((message) => message.id === null && message.error?.code === -32600);
  check("같은 MCP request id 재사용은 terminal을 복제하지 않고 연결을 닫는다",
    toolText(firstDuplicate).value === "42" && duplicateTerminals.length === 1
    && fatalDuplicate?.error?.message.includes("already used") && exited?.code === 1,
  JSON.stringify({ first: toolText(firstDuplicate), duplicateTerminals: duplicateTerminals.length,
    fatal: fatalDuplicate?.error, exitCode: exited?.code }));
} catch (e) {
  check("예외 없음", false, String(e).slice(0, 200));
}

child.kill();
receiver.close();
console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
