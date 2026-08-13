import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import {
  CONTROL_ATTACHMENT_CHUNK_BYTES,
  ControlClientConversation,
  controlBase,
  decodeControlFrame,
  encodeControlFrame,
  validateControlFrame,
} from "../../scripts/controlProtocol/controlProtocol.js";
import { ControlHost } from "../../scripts/controlProtocol/controlHost.js";
import { createBrowserControlTools } from "../../scripts/browserControl/mcpBrowserControl.js";
import { McpControlAdapter, mcpToolResult } from "../../scripts/controlProtocol/mcpControlAdapter.js";
import {
  CONTROL_TOOL_OPERATIONS,
  controlOperationCatalog,
  controlOperationForTool,
  controlSuccessOutcome,
  controlToolForOperation,
} from "../../scripts/controlProtocol/controlOperations.js";
import { PageCommandBridge } from "../../scripts/controlProtocol/pageCommandBridge.mjs";
import { ControlRemoteError, ControlStdioClient } from "../../scripts/controlProtocol/controlClient.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function errorOf(operation) {
  try { await operation(); return null; }
  catch (error) { return error; }
}

const request = (requestId, operation = "machine.run", input = {}) => ({
  ...controlBase("request"), requestId, operation, input,
});

export async function assertControlProtocolContract() {
  const hello = {
    ...controlBase("hello"), requestId: "hello:contract", role: "server",
    peer: { name: "pyproc", version: "1" },
    capabilities: { cancel: true, events: false,
      attachments: { encoding: "base64", maxChunkBytes: CONTROL_ATTACHMENT_CHUNK_BYTES } },
    operations: ["artifact.read", "machine.run"],
  };
  assert(JSON.stringify(decodeControlFrame(encodeControlFrame(hello))) === JSON.stringify(hello),
    "control hello가 NDJSON roundtrip하지 않는다");
  assert((await errorOf(() => validateControlFrame({ ...request("bad-version"), version: 2 })))?.code === "CONTROL_VERSION_UNSUPPORTED",
    "control version mismatch가 fail-closed가 아니다");
  assert((await errorOf(() => validateControlFrame({ ...request("bad-field"), surprise: true })))?.code === "CONTROL_INVALID_FRAME",
    "control unknown field가 fail-closed가 아니다");
  const fatal = { ...controlBase("error"), fatal: true,
    error: { code: "CONTROL_CONNECTION_FAILED", message: "closed", retryable: false, outcome: "notSent" } };
  assert(decodeControlFrame(encodeControlFrame(fatal)).fatal === true,
    "request 없는 connection-fatal error가 roundtrip하지 않는다");
  assert((await errorOf(() => validateControlFrame({ ...fatal, requestId: "fatal:bad" })))?.code === "CONTROL_INVALID_FRAME",
    "fatal error가 request terminal로 위장할 수 있다");

  const eofReadable = new PassThrough();
  const eofWritable = new PassThrough();
  const eofClient = new ControlStdioClient({ readable: eofReadable, writable: eofWritable });
  eofReadable.write(encodeControlFrame({ ...hello, requestId: "hello:client" }));
  await eofClient.ready;
  const eofRequest = eofClient.request("machine.run", { code: "effect" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  eofReadable.end();
  const eofFailure = await errorOf(() => eofRequest);
  assert(eofFailure instanceof ControlRemoteError && eofFailure.code === "CONTROL_CONNECTION_LOST"
    && eofFailure.outcome === "outcomeUnknown" && eofFailure.retryable === false,
  "JS control client의 pending EOF가 canonical outcome을 잃었다");

  let writeCount = 0;
  const writeReadable = new PassThrough();
  const failingWritable = new PassThrough();
  const originalWrite = failingWritable.write.bind(failingWritable);
  failingWritable.write = (chunk, callback) => {
    writeCount += 1;
    if (writeCount === 1) return originalWrite(chunk, callback);
    queueMicrotask(() => callback(new Error("request write failed")));
    return true;
  };
  const writeClient = new ControlStdioClient({ readable: writeReadable, writable: failingWritable });
  writeReadable.write(encodeControlFrame({ ...hello, requestId: "hello:client" }));
  await writeClient.ready;
  const writeFailure = await errorOf(() => writeClient.request("machine.run", { code: "effect" }));
  assert(writeFailure instanceof ControlRemoteError && writeFailure.code === "CONTROL_CONNECTION_LOST"
    && writeFailure.outcome === "outcomeUnknown" && writeFailure.retryable === false,
  "JS control client의 request write 실패가 canonical outcome을 잃었다");

  let cancelWriteCount = 0;
  const cancelReadable = new PassThrough();
  const cancelWritable = new PassThrough();
  const cancelOriginalWrite = cancelWritable.write.bind(cancelWritable);
  cancelWritable.write = (chunk, callback) => {
    cancelWriteCount += 1;
    if (cancelWriteCount < 3) return cancelOriginalWrite(chunk, callback);
    queueMicrotask(() => callback(new Error("cancel write failed")));
    return true;
  };
  const cancelClient = new ControlStdioClient({ readable: cancelReadable, writable: cancelWritable });
  cancelReadable.write(encodeControlFrame({ ...hello, requestId: "hello:client" }));
  await cancelClient.ready;
  const cancelPending = cancelClient.request("machine.run", { code: "effect" }, { requestId: "cancel:write" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const cancelFailure = await errorOf(() => cancelClient.cancel("cancel:write"));
  const cancelPendingFailure = await errorOf(() => cancelPending);
  assert(cancelFailure instanceof ControlRemoteError && cancelFailure.code === "CONTROL_CONNECTION_LOST"
    && cancelFailure.outcome === "outcomeUnknown" && cancelFailure.retryable === false
    && cancelPendingFailure instanceof ControlRemoteError
    && cancelPendingFailure.code === "CONTROL_CONNECTION_LOST"
    && cancelPendingFailure.outcome === "outcomeUnknown" && cancelPendingFailure.retryable === false,
  "JS control client의 cancel write 실패와 원 request가 canonical outcome으로 함께 닫히지 않았다");

  const mapped = Object.entries(CONTROL_TOOL_OPERATIONS);
  assert(mapped.length === 33 && mapped.every(([tool, operation]) => controlOperationForTool(tool) === operation
    && controlToolForOperation(operation) === tool), "MCP tool과 control operation 33종 mapping이 양방향이 아니다");
  const catalog = controlOperationCatalog(mapped.map(([name]) => ({ name, inputSchema: { type: "object" } })));
  assert(catalog.length === 33 && catalog.every((entry) => entry.operationVersion === 1),
    "control operation catalog가 versioned 33종이 아니다");
  const withoutSnapshotTools = createBrowserControlTools({ actions: ["screenshot"] });
  const withoutSnapshotCatalog = controlOperationCatalog(withoutSnapshotTools);
  assert(withoutSnapshotTools.length === 9
    && !withoutSnapshotTools.some((tool) => tool.name === "browserObserve")
    && withoutSnapshotCatalog.length === 9
    && !withoutSnapshotCatalog.some((entry) => entry.name === "automation.observe"),
  "snapshot 권한 없이 MCP와 Control Protocol에 observe가 노출됐다");
  assert(controlSuccessOutcome("automation.command", { expectedRisk: "read" }) === "observed"
    && controlSuccessOutcome("automation.command", { expectedRisk: "externalEffect" }) === "applied"
    && controlSuccessOutcome("memory.open") === "observed"
    && controlSuccessOutcome("memory.inspect") === "observed"
    && controlSuccessOutcome("memory.checkpoint") === "applied",
  "control 성공 outcome이 관찰과 효과를 가르지 않는다");

  let mcpCalls = 0;
  let releaseMcpCall;
  const mcpAdapter = new McpControlAdapter({ tools: [{ name: "pythonRun" }], host: {
    request: async () => {
      mcpCalls++;
      await new Promise((resolve) => { releaseMcpCall = resolve; });
      return { terminal: { type: "response" } };
    },
    cancel: () => false,
  } });
  const activeMcpCall = mcpAdapter.invoke(77, "pythonRun", { code: "first" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const activeMcpDuplicate = await errorOf(() => mcpAdapter.invoke(77, "pythonRun", { code: "second" }));
  releaseMcpCall();
  await activeMcpCall;
  const terminalMcpDuplicate = await errorOf(() => mcpAdapter.invoke(77, "pythonRun", { code: "third" }));
  assert(activeMcpDuplicate?.code === "CONTROL_REQUEST_DUPLICATE"
    && terminalMcpDuplicate?.code === "CONTROL_REQUEST_DUPLICATE" && mcpCalls === 1,
  "MCP adapter가 active 또는 terminal request ID 재사용을 두 번째 효과 전에 막지 않았다");

  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const sha256 = createHash("sha256").update(png).digest("hex");
  let calls = 0;
  const host = new ControlHost({
    operations: catalog,
    handlers: {
      "machine.run": async (input) => { calls++; return { value: input.code }; },
      "automation.observe": async () => ({ screenshot: { kind: "screenshot", artifactRef: "artifact:contract",
        mimeType: "image/png", byteLength: png.byteLength, sha256, dataBase64: png.toString("base64") } }),
      "automation.act": async () => {
        const error = new Error("effect state unknown");
        error.code = "BROWSER_CONTROL_OUTCOME_UNKNOWN";
        error.outcome = "outcomeUnknown";
        error.retryable = true;
        error.completed = [{ index: 0 }];
        throw error;
      },
    },
  });
  const run = await host.request(request("host:run", "machine.run", { code: "1 + 1" }));
  assert(run.terminal.type === "response" && run.terminal.outcome === "applied" && run.terminal.output.value === "1 + 1" && calls === 1,
    "control host가 canonical request를 한 번 실행하지 않았다");
  const duplicate = await errorOf(() => host.request(request("host:run", "machine.run", {})));
  assert(duplicate?.code === "CONTROL_REQUEST_DUPLICATE" && calls === 1,
    "control host가 request ID 재사용을 효과 전에 거부하지 않았다");
  const unknown = await host.request(request("host:unknown", "unknown.operation", {}));
  assert(unknown.terminal.type === "error" && unknown.terminal.error.code === "CONTROL_OPERATION_UNKNOWN"
    && unknown.terminal.error.outcome === "notSent", "unknown operation이 provider 전에 canonical error가 아니다");
  const observed = await host.request(request("host:shot", "automation.observe", {}));
  assert(observed.terminal.type === "response" && observed.attachments.length === 1
    && !JSON.stringify(observed.terminal.output).includes("dataBase64")
    && observed.terminal.attachments[0].sha256 === sha256
    && Buffer.from(observed.attachments[0].bytes).equals(png),
  "inline screenshot이 검증된 control attachment로 분리되지 않았다");
  const mcpObserved = mcpToolResult(observed);
  assert(mcpObserved._meta.pyprocControl.terminal === "completed"
    && mcpObserved._meta.pyprocControl.outcome === "observed"
    && mcpObserved._meta.pyprocControl.attachments[0].sha256 === sha256,
  "MCP success가 Control terminal과 attachment digest를 잃었다");
  const uncertain = await host.request(request("host:uncertain", "automation.act", { actions: [] }));
  assert(uncertain.terminal.type === "error" && uncertain.terminal.error.outcome === "outcomeUnknown"
    && uncertain.terminal.error.retryable === false && uncertain.terminal.error.details.completed.length === 1,
  "control error가 outcomeUnknown의 비재시도와 completed prefix를 보존하지 않았다");
  const mcpUncertain = mcpToolResult(uncertain);
  assert(mcpUncertain._meta.pyprocControl.terminal === "outcomeUnknown"
    && mcpUncertain._meta.pyprocControl.retryable === false,
  "MCP error가 canonical Control terminal을 잃었다");

  let drained = false;
  const drainHost = new ControlHost({ operations: catalog, handlers: {
    "automation.act": async (input, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => setTimeout(() => {
        drained = true;
        const error = new Error("effect terminal persisted during shutdown");
        error.outcome = "outcomeUnknown";
        reject(error);
      }, 15), { once: true });
    }),
  } });
  const active = drainHost.request(request("host:drain", "automation.act", { actions: [] }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await drainHost.close("contract shutdown");
  const drainedTerminal = await active;
  assert(drained && drainedTerminal.terminal.error.outcome === "outcomeUnknown",
    "control host close가 active terminal 정착을 기다리지 않았다");
  assert((await errorOf(() => drainHost.request(request("host:after-close"))))?.code === "CONTROL_HOST_CLOSED",
    "control host close 뒤 새 요청이 차단되지 않았다");

  const conversation = new ControlClientConversation();
  conversation.begin(request("conversation:1"));
  await conversation.accept({ ...controlBase("response"), requestId: "conversation:1", outcome: "observed", output: {} });
  const terminalDuplicate = await errorOf(() => conversation.accept({ ...controlBase("error"), requestId: "conversation:1",
    error: { code: "CONTROL_FAILED", message: "late", retryable: false, outcome: "notSent" } }));
  assert(terminalDuplicate?.code === "CONTROL_TERMINAL_DUPLICATE", "control client가 terminal 2개를 허용했다");

  const attachmentDescriptor = { attachmentId: "attachment:negative", kind: "screen.capture",
    mimeType: "image/png", byteLength: png.byteLength, sha256 };
  const badDigestConversation = new ControlClientConversation();
  badDigestConversation.begin(request("attachment:digest"));
  const badDigest = await errorOf(() => badDigestConversation.accept({ ...controlBase("attachment"),
    requestId: "attachment:digest", attachmentId: attachmentDescriptor.attachmentId, mimeType: "image/png",
    offset: 0, dataBase64: png.toString("base64"), eof: true, byteLength: png.byteLength,
    sha256: "0".repeat(64) }));
  assert(badDigest?.code === "CONTROL_ATTACHMENT_INVALID",
    "attachment digest 변조가 terminal 노출 전에 거부되지 않았다");
  const badOffsetConversation = new ControlClientConversation();
  badOffsetConversation.begin(request("attachment:offset"));
  const badOffset = await errorOf(() => badOffsetConversation.accept({ ...controlBase("attachment"),
    requestId: "attachment:offset", attachmentId: attachmentDescriptor.attachmentId, mimeType: "image/png",
    offset: 1, dataBase64: png.toString("base64"), eof: false }));
  assert(badOffset?.code === "CONTROL_ATTACHMENT_INVALID", "attachment offset gap이 거부되지 않았다");
  const incompleteConversation = new ControlClientConversation();
  incompleteConversation.begin(request("attachment:incomplete"));
  await incompleteConversation.accept({ ...controlBase("attachment"), requestId: "attachment:incomplete",
    attachmentId: attachmentDescriptor.attachmentId, mimeType: "image/png", offset: 0,
    dataBase64: png.subarray(0, 4).toString("base64"), eof: false });
  const incomplete = await errorOf(() => incompleteConversation.accept({ ...controlBase("response"),
    requestId: "attachment:incomplete", outcome: "observed", output: {}, attachments: [attachmentDescriptor] }));
  assert(incomplete?.code === "CONTROL_ATTACHMENT_INVALID", "미완료 attachment를 terminal이 노출했다");
  const negotiatedConversation = new ControlClientConversation({ maxAttachmentChunkBytes: 4 });
  negotiatedConversation.begin(request("attachment:limit"));
  const overNegotiated = await errorOf(() => negotiatedConversation.accept({ ...controlBase("attachment"),
    requestId: "attachment:limit", attachmentId: attachmentDescriptor.attachmentId, mimeType: "image/png",
    offset: 0, dataBase64: png.toString("base64"), eof: false }));
  assert(overNegotiated?.code === "CONTROL_ATTACHMENT_INVALID", "협상된 attachment chunk 상한을 넘겼다");

  const queuedBridge = new PageCommandBridge({ timeoutMs: 1000 });
  queuedBridge.ready({ protocol: "pyproc-control", version: 1, pageEpoch: "page:1", spaceId: "machine:primary" });
  const queuedAbort = new AbortController();
  const queued = queuedBridge.dispatch("machine.run", { code: "queued" }, { signal: queuedAbort.signal, requestId: "page:queued" });
  queuedAbort.abort("cancel before delivery");
  const queuedError = await errorOf(() => queued);
  assert(queuedError?.code === "CONTROL_CANCELLED" && queuedError.outcome === "notSent"
    && queuedBridge.poll("page:1") === null, "queued cancel이 명령을 queue에서 실제 제거하지 않았다");

  const timeoutBridge = new PageCommandBridge({ timeoutMs: 10 });
  timeoutBridge.ready({ protocol: "pyproc-control", version: 1, pageEpoch: "page:timeout", spaceId: "machine:primary" });
  const timedOut = await errorOf(() => timeoutBridge.dispatch("machine.run", { code: "late" },
    { requestId: "page:timeout" }));
  assert(timedOut?.code === "CONTROL_TIMEOUT" && timedOut.outcome === "notSent"
    && timeoutBridge.poll("page:timeout") === null, "queued timeout이 명령을 queue에서 제거하지 않았다");

  const deliveredAbort = new AbortController();
  const delivered = queuedBridge.dispatch("machine.run", { code: "delivered" }, { signal: deliveredAbort.signal, requestId: "page:delivered" });
  const command = queuedBridge.poll("page:1");
  deliveredAbort.abort("cancel after delivery");
  const deliveredError = await errorOf(() => delivered);
  const late = queuedBridge.result({ requestId: command.requestId, pageEpoch: "page:1", ok: true, value: { late: true } });
  assert(deliveredError?.outcome === "outcomeUnknown" && deliveredError.retryable === false && late.accepted === false,
    "delivered cancel이 outcomeUnknown으로 수렴하거나 late result를 격리하지 않았다");

  const reload = queuedBridge.dispatch("machine.run", { code: "reload" }, { requestId: "page:reload" });
  queuedBridge.poll("page:1");
  let replacedPoll = null;
  queuedBridge.holdPoll("page:1", (commandValue, error) => { replacedPoll = { commandValue, error }; });
  queuedBridge.ready({ protocol: "pyproc-control", version: 1, pageEpoch: "page:2", spaceId: "machine:primary" });
  const reloadError = await errorOf(() => reload);
  assert(reloadError?.code === "CONTROL_PAGE_REPLACED" && reloadError.outcome === "outcomeUnknown"
    && replacedPoll?.commandValue === null && replacedPoll?.error?.code === "CONTROL_PAGE_REPLACED",
  "page epoch 교체가 전달된 명령과 이전 poll을 fence하지 않았다");
  queuedBridge.close();
}
