#!/usr/bin/env node
// controlProtocolServer.mjs - 언어 중립 Control Protocol을 stdio NDJSON으로 제공한다.
import { createInterface } from "node:readline";
import { once } from "node:events";
import { createControlProduct } from "./controlProtocol/controlProduct.mjs";
import {
  CONTROL_ATTACHMENT_CHUNK_BYTES,
  acceptControlHello,
  controlBase,
  decodeControlFrame,
  encodeControlFrame,
} from "./controlProtocol/controlProtocol.js";

const product = await createControlProduct();
let helloComplete = false;
let closing = false;
let shutdownPromise = null;
let outputTail = Promise.resolve();
let attachmentChunkBytes = CONTROL_ATTACHMENT_CHUNK_BYTES;

async function writeText(text) {
  if (!process.stdout.write(text)) await once(process.stdout, "drain");
}

function queueFrames(frames) {
  const encoded = frames.map(encodeControlFrame).join("");
  outputTail = outputTail.then(() => writeText(encoded));
  return outputTail;
}

function errorPayload(error, fallbackCode = "CONTROL_CONNECTION_FAILED") {
  const outcome = ["notSent", "rejected", "applied", "outcomeUnknown"].includes(error?.outcome)
    ? error.outcome : "notSent";
  return {
    code: String(error?.code || fallbackCode),
    message: String(error?.message || error || "control connection failed").slice(-2000),
    retryable: outcome !== "applied" && outcome !== "outcomeUnknown" && error?.retryable === true,
    outcome,
  };
}

function attachmentFrames(requestId, attachment) {
  const bytes = Buffer.from(attachment.bytes);
  const frames = [];
  if (bytes.byteLength === 0) {
    frames.push({ ...controlBase("attachment"), requestId, attachmentId: attachment.attachmentId,
      mimeType: attachment.mimeType, offset: 0, dataBase64: "", eof: true,
      byteLength: attachment.byteLength, sha256: attachment.sha256 });
    return frames;
  }
  for (let offset = 0; offset < bytes.byteLength; offset += attachmentChunkBytes) {
    const chunk = bytes.subarray(offset, Math.min(bytes.byteLength, offset + attachmentChunkBytes));
    const eof = offset + chunk.byteLength === bytes.byteLength;
    frames.push({ ...controlBase("attachment"), requestId, attachmentId: attachment.attachmentId,
      mimeType: attachment.mimeType, offset, dataBase64: chunk.toString("base64"), eof,
      ...(eof ? { byteLength: attachment.byteLength, sha256: attachment.sha256 } : {}) });
  }
  return frames;
}

async function sendFatal(error) {
  if (closing) return;
  closing = true;
  try {
    await queueFrames([{ ...controlBase("error"), fatal: true, error: errorPayload(error) }]);
  } finally {
    await shutdown(1);
  }
}

async function handleRequest(frame) {
  const result = await product.host.request(frame);
  if (!result?.terminal) return;
  const frames = result.attachments.flatMap((attachment) => attachmentFrames(frame.requestId, attachment));
  frames.push(result.terminal);
  await queueFrames(frames);
}

async function handleLine(line) {
  let frame;
  try { frame = decodeControlFrame(line); }
  catch (error) { await sendFatal(error); return; }
  if (!helloComplete) {
    let accepted;
    try {
      accepted = acceptControlHello(frame, {
        operations: product.operationCatalog.map((operation) => operation.name),
      });
    } catch (error) { await sendFatal(error); return; }
    helloComplete = true;
    attachmentChunkBytes = accepted.maxAttachmentChunkBytes;
    await queueFrames([accepted.response]);
    return;
  }
  if (frame.type === "request") {
    void handleRequest(frame).catch(sendFatal);
    return;
  }
  if (frame.type === "cancel") {
    product.host.cancel(frame.requestId, frame.reason || "control client cancelled the request");
    return;
  }
  const error = new Error(`client cannot send control frame type after hello: ${frame.type}`);
  error.code = "CONTROL_FRAME_DIRECTION";
  await sendFatal(error);
}

async function shutdown(code = 0) {
  if (shutdownPromise) return shutdownPromise;
  closing = true;
  shutdownPromise = (async () => {
    try { await product.close(); } catch (error) {}
    await outputTail.catch(() => {});
    process.exit(code);
  })();
  return shutdownPromise;
}

process.stderr.write(`pyproc control: ${product.browserSession.browser} -> ${product.pageUrl}\n`);
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let inputTail = Promise.resolve();
input.on("line", (line) => {
  if (closing) return;
  inputTail = inputTail.then(() => handleLine(line)).catch(sendFatal);
});
input.on("close", () => void inputTail.finally(() => shutdown(0)));
