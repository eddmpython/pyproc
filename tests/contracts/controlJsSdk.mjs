// 공개 JavaScript Control facade가 기존 protocol 의미론 위에만 사는지 고정한다.
import { PassThrough } from "node:stream";
import {
  ControlRemoteError,
  ControlRequest,
  PerceptionClient,
  PerceptionEntity,
  PerceptionQueryResult,
  PyProcControlClient,
} from "../../scripts/controlProtocol/controlApi.js";
import { controlBase, decodeControlFrame, encodeControlFrame } from "../../scripts/controlProtocol/controlProtocol.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function errorOf(operation) {
  try { await operation(); return null; }
  catch (error) { return error; }
}

function serverHello() {
  return { ...controlBase("hello"), requestId: "hello:client", role: "server",
    peer: { name: "fixture", version: "1" }, capabilities: { cancel: true, events: false,
      attachments: { encoding: "base64", maxChunkBytes: 262144 } },
    operations: ["machine.run"] };
}

export async function assertControlJsSdkContract() {
  for (const value of [ControlRemoteError, ControlRequest, PerceptionClient, PerceptionEntity,
    PerceptionQueryResult, PyProcControlClient]) {
    assert(typeof value === "function", "pyproc/control 공개 class가 누락됐다");
  }

  const readable = new PassThrough();
  const writable = new PassThrough();
  const sent = [];
  writable.on("data", (chunk) => {
    for (const line of String(chunk).trim().split("\n")) if (line) sent.push(decodeControlFrame(`${line}\n`));
  });
  const client = new PyProcControlClient({ readable, writable, cancelSettleTimeoutMs: 50 });
  readable.write(encodeControlFrame(serverHello()));
  await client.ready;
  const pending = client.requestAsync("machine.run", { code: "40 + 2" }, { requestId: "sdk:one" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(pending instanceof ControlRequest && sent.some((frame) => frame.type === "request"
    && frame.requestId === "sdk:one" && frame.operation === "machine.run"),
  "JavaScript request handle이 canonical operation을 보내지 않았다");
  readable.write(encodeControlFrame({ ...controlBase("response"), requestId: "sdk:one",
    outcome: "applied", output: { value: "42" } }));
  assert((await pending.result).output.value === "42" && await pending.cancel() === false,
    "terminal 뒤 cancel이 새 frame을 보냈다");

  let deadlineCancel = false;
  let releaseDeadline;
  const deadlineResult = new Promise((resolve) => { releaseDeadline = resolve; });
  const deadline = new ControlRequest({
    cancelSettleTimeoutMs: 50,
    cancel: async () => { deadlineCancel = true; releaseDeadline({ output: {}, outcome: "observed", attachments: [] }); return true; },
    close: async () => {},
  }, "sdk:deadline", deadlineResult);
  await deadline.wait({ timeoutMs: 1 });
  assert(deadlineCancel, "JavaScript request deadline이 protocol cancel을 보내지 않았다");

  const fakeCalls = [];
  const observation = { protocol: "apx", entities: [{ entityRef: "entity:save", locatorRef: "locator:save",
    kind: "control", semantic: { role: "button", name: "Save" }, interaction: { actionable: true } }] };
  const eyes = new PerceptionClient({
    observe: async (sessionRef, options) => {
      fakeCalls.push({ operation: "observe", sessionRef, options });
      return { output: observation, outcome: "observed", attachments: [] };
    },
    act: async (sessionRef, actions) => {
      fakeCalls.push({ operation: "act", sessionRef, actions });
      return { output: { completed: [{ index: 0 }] }, outcome: "applied", attachments: [] };
    },
  }, { sessionId: "session:1" });
  const match = (await eyes.query({ role: "button", name: "Save", actionable: true })).one();
  await eyes.act("click", match.locatorRef, { verify: { entityAppeared: { role: "status" } } });
  assert(match instanceof PerceptionEntity && match.entityRef === "entity:save" && match.role === "button"
    && fakeCalls[0].options.representation === "apx.graph" && fakeCalls[0].options.expectedRisk === "read"
    && fakeCalls[1].actions[0].verify.entityAppeared.role === "status",
  "APX facade가 automation.observe와 automation.act 의미론을 재사용하지 않았다");
  const ambiguous = await errorOf(() => new PerceptionQueryResult({ output: { entities: [] },
    outcome: "observed", attachments: [] }).one());
  assert(ambiguous?.message === "APX query expected one entity, received 0",
    "APX one()이 후보 없음에서 추측했다");
  const truncatedAmbiguous = await errorOf(() => new PerceptionQueryResult({ output: {
    entities: observation.entities, query: { matched: 2, total: 10 },
  }, outcome: "observed", attachments: [] }).one());
  assert(truncatedAmbiguous?.message === "APX query expected one entity, received 2",
    "APX one()이 budget으로 하나만 남은 복수 후보를 단일 후보로 오판했다");

  const unavailable = await errorOf(() => PyProcControlClient.start("config.json", { command: [] }));
  assert(unavailable instanceof TypeError, "빈 control command가 effect 전에 거부되지 않았다");
  await client.close();
}
