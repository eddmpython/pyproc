// controlProtocolProbe.mjs - Control Protocol wire 양성/음성 fixture.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CONTROL_ATTACHMENT_CHUNK_BYTES,
  CONTROL_PROTOCOL,
  CONTROL_VERSION,
  ControlClientConversation,
  controlBase,
  decodeControlFrame,
  encodeControlFrame,
  validateControlFrame,
} from "../../../scripts/controlProtocol/controlProtocol.js";

let passed = 0;
const checks = [];
const check = (name, operation) => {
  checks.push(async () => {
    await operation();
    passed++;
    console.log(`  PASS ${name}`);
  });
};
const rejects = (name, code, operation) => check(name, async () => {
  await assert.rejects(async () => operation(), (error) => error?.code === code, code);
});
const capabilities = { cancel: true, events: true, attachments: { encoding: "base64", maxChunkBytes: CONTROL_ATTACHMENT_CHUNK_BYTES } };
const helloClient = { ...controlBase("hello"), requestId: "hello:1", role: "client", peer: { name: "probe", version: "1" }, capabilities };
const helloServer = { ...controlBase("hello"), requestId: "hello:1", role: "server", peer: { name: "pyproc", version: "1" }, capabilities,
  operations: ["artifact.read", "browser.observe", "machine.run"] };
const request = { ...controlBase("request"), requestId: "req:1", operation: "machine.run", input: { code: "1 + 1" } };
const success = { ...controlBase("response"), requestId: "req:1", outcome: "observed", output: { value: "2" } };
const failure = { ...controlBase("error"), requestId: "req:2",
  error: { code: "BROWSER_CONTROL_OUTCOME_UNKNOWN", message: "effect outcome is unknown", retryable: false, outcome: "outcomeUnknown", details: { completed: 1 } } };

console.log("automationComputer Control Protocol probe");
check("client hello roundtrip", () => assert.deepEqual(decodeControlFrame(encodeControlFrame(helloClient)), helloClient));
check("server hello and operation catalog", () => assert.deepEqual(decodeControlFrame(encodeControlFrame(helloServer)), helloServer));
check("request roundtrip", () => assert.deepEqual(decodeControlFrame(encodeControlFrame(request)), request));
check("success response roundtrip", () => assert.deepEqual(decodeControlFrame(encodeControlFrame(success)), success));
check("error keeps retryable, outcome, details", () => assert.deepEqual(decodeControlFrame(encodeControlFrame(failure)), failure));
check("cancel roundtrip", () => validateControlFrame({ ...controlBase("cancel"), requestId: "req:1", reason: "operator cancelled" }));
check("event roundtrip", () => validateControlFrame({ ...controlBase("event"), eventId: "event:1", requestId: "req:1", name: "operation.started", data: { operation: "machine.run" } }));

const bytes = Buffer.from("screenshot-bytes");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const attachment = { ...controlBase("attachment"), requestId: "req:attach", attachmentId: "shot:1", mimeType: "image/png",
  offset: 0, dataBase64: bytes.toString("base64"), eof: true, byteLength: bytes.length, sha256 };
const attachmentResponse = { ...controlBase("response"), requestId: "req:attach", outcome: "observed", output: { artifactRef: "artifact:shot" },
  attachments: [{ attachmentId: "shot:1", kind: "screen.capture", mimeType: "image/png", byteLength: bytes.length, sha256 }] };
check("attachment chunk and descriptor converge", async () => {
  const conversation = new ControlClientConversation();
  conversation.begin({ ...request, requestId: "req:attach" });
  await conversation.accept(attachment);
  await conversation.accept(attachmentResponse);
});
check("multi-chunk attachment offsets converge", async () => {
  const conversation = new ControlClientConversation();
  conversation.begin({ ...request, requestId: "req:chunks" });
  const chunkDigest = createHash("sha256").update("abcdef").digest("hex");
  await conversation.accept({ ...controlBase("attachment"), requestId: "req:chunks", attachmentId: "shot:1", mimeType: "image/png",
    offset: 0, dataBase64: Buffer.from("abc").toString("base64"), eof: false });
  await conversation.accept({ ...controlBase("attachment"), requestId: "req:chunks", attachmentId: "shot:1", mimeType: "image/png",
    offset: 3, dataBase64: Buffer.from("def").toString("base64"), eof: true, byteLength: 6, sha256: chunkDigest });
  await conversation.accept({ ...attachmentResponse, requestId: "req:chunks",
    attachments: [{ ...attachmentResponse.attachments[0], byteLength: 6, sha256: chunkDigest }] });
});

rejects("unknown protocol name", "CONTROL_INVALID_FRAME", () => validateControlFrame({ ...request, protocol: "other" }));
rejects("unknown version", "CONTROL_VERSION_UNSUPPORTED", () => validateControlFrame({ ...request, version: CONTROL_VERSION + 1 }));
rejects("unknown frame type", "CONTROL_INVALID_FRAME", () => validateControlFrame({ protocol: CONTROL_PROTOCOL, version: CONTROL_VERSION, type: "command" }));
rejects("unknown request field", "CONTROL_INVALID_FRAME", () => validateControlFrame({ ...request, surprise: true }));
rejects("numeric request ID", "CONTROL_INVALID_FRAME", () => validateControlFrame({ ...request, requestId: 1 }));
rejects("malformed operation name", "CONTROL_INVALID_FRAME", () => validateControlFrame({ ...request, operation: "machineRun" }));
rejects("non-object request input", "CONTROL_INVALID_FRAME", () => validateControlFrame({ ...request, input: [] }));
rejects("non-finite JSON number", "CONTROL_INVALID_FRAME", () => validateControlFrame({ ...request, input: { value: Infinity } }));
rejects("client hello cannot claim operations", "CONTROL_INVALID_FRAME", () => validateControlFrame({ ...helloClient, operations: ["machine.run"] }));
rejects("server hello duplicate operation", "CONTROL_INVALID_FRAME", () => validateControlFrame({ ...helloServer, operations: ["machine.run", "machine.run"] }));
rejects("success cannot carry error", "CONTROL_INVALID_FRAME", () => validateControlFrame({ ...success, error: failure.error }));
rejects("failure must carry retryable", "CONTROL_INVALID_FRAME", () => validateControlFrame({ ...failure, error: { code: "CONTROL_FAILED", message: "failed" } }));
rejects("outcomeUnknown cannot be retryable", "CONTROL_INVALID_FRAME", () => validateControlFrame({ ...failure, error: { ...failure.error, retryable: true } }));
rejects("attachment invalid base64", "CONTROL_ATTACHMENT_INVALID", () => validateControlFrame({ ...attachment, dataBase64: "!!!" }));
rejects("attachment terminal metadata only at eof", "CONTROL_ATTACHMENT_INVALID", () => validateControlFrame({ ...attachment, eof: false }));
rejects("attachment offset gap", "CONTROL_ATTACHMENT_INVALID", async () => {
  const conversation = new ControlClientConversation(); conversation.begin({ ...request, requestId: "req:gap" });
  await conversation.accept({ ...attachment, requestId: "req:gap", offset: 3 });
});
rejects("response before attachment completion", "CONTROL_ATTACHMENT_INVALID", async () => {
  const conversation = new ControlClientConversation(); conversation.begin({ ...request, requestId: "req:early" });
  await conversation.accept({ ...controlBase("attachment"), requestId: "req:early", attachmentId: "shot:1", mimeType: "image/png",
    offset: 0, dataBase64: Buffer.from("abc").toString("base64"), eof: false });
  await conversation.accept({ ...attachmentResponse, requestId: "req:early" });
});
rejects("attachment bytes digest mismatch", "CONTROL_ATTACHMENT_INVALID", async () => {
  const conversation = new ControlClientConversation(); conversation.begin({ ...request, requestId: "req:digest" });
  await conversation.accept({ ...attachment, requestId: "req:digest", sha256: "b".repeat(64) });
});
rejects("request ID reuse", "CONTROL_REQUEST_DUPLICATE", () => {
  const conversation = new ControlClientConversation(); conversation.begin(request); conversation.begin(request);
});
rejects("duplicate terminal response", "CONTROL_TERMINAL_DUPLICATE", async () => {
  const conversation = new ControlClientConversation(); conversation.begin(request); await conversation.accept(success); await conversation.accept(success);
});
rejects("unknown response request", "CONTROL_REQUEST_UNKNOWN", async () => new ControlClientConversation().accept(success));
rejects("duplicate event ID", "CONTROL_EVENT_DUPLICATE", async () => {
  const conversation = new ControlClientConversation(); conversation.begin(request);
  const event = { ...controlBase("event"), eventId: "event:dup", requestId: "req:1", name: "operation.progress", data: {} };
  await conversation.accept(event); await conversation.accept(event);
});
rejects("frame byte limit", "CONTROL_FRAME_TOO_LARGE", () => decodeControlFrame(" ".repeat(1024 * 1024 + 1)));

for (const run of checks) await run();
console.log(`\n결과: GREEN (${passed}/${passed})`);
