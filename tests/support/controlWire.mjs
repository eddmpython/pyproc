// controlWire.mjs - Control Protocol 연결의 client 쪽을 SDK 없이 프레임 단위로 다루는 시험 도구.
import { createInterface } from "node:readline";
import {
  CONTROL_ATTACHMENT_CHUNK_BYTES,
  controlBase,
  decodeControlFrame,
  encodeControlFrame,
} from "../../scripts/controlProtocol/controlProtocol.js";

export const within = (promise, what, ms) => Promise.race([promise,
  new Promise((resolve, reject) => setTimeout(() => reject(new Error(`${what}: ${ms}ms 안에 일어나지 않았다`)), ms))]);

export const clientHello = (requestId) => ({
  ...controlBase("hello"), requestId, role: "client",
  peer: { name: "wire-test", version: "1" },
  capabilities: { cancel: true, events: false,
    attachments: { encoding: "base64", maxChunkBytes: CONTROL_ATTACHMENT_CHUNK_BYTES } },
});

export const controlRequest = (requestId, operation, input = {}) =>
  ({ ...controlBase("request"), requestId, operation, input });

/** The client's side of one connection: frames out, decoded frames in. `next` resolves null once the host closed it. */
export function wirePeer(readable, writable, { stepMs = 5_000 } = {}) {
  const frames = [];
  const waiters = [];
  let closed = false;
  const lines = createInterface({ input: readable, crlfDelay: Infinity });
  lines.on("line", (line) => {
    const frame = decodeControlFrame(line);
    const waiter = waiters.shift();
    if (waiter) waiter(frame); else frames.push(frame);
  });
  lines.on("close", () => {
    closed = true;
    for (const waiter of waiters.splice(0)) waiter(null);
  });
  lines.on("error", () => {});
  readable.on("error", () => {});
  const next = (what) => frames.length ? Promise.resolve(frames.shift()) : closed ? Promise.resolve(null)
    : within(new Promise((resolve) => waiters.push(resolve)), what, stepMs);
  return {
    send: (frame) => writable.write(encodeControlFrame(frame)),
    next,
    unread: () => frames.length,
    /** Say hello and return the server's hello. */
    async greet(requestId) {
      writable.write(encodeControlFrame(clientHello(requestId)));
      const answer = await next("server hello");
      if (answer?.type !== "hello" || answer.role !== "server" || answer.requestId !== requestId) {
        throw new Error(`client hello가 server hello로 수락되지 않는다: ${JSON.stringify(answer)}`);
      }
      return answer;
    },
    /** Send one request and return its terminal frame. */
    async call(requestId, operation, input = {}) {
      writable.write(encodeControlFrame(controlRequest(requestId, operation, input)));
      for (;;) {
        const frame = await next(`${operation} terminal`);
        if (!frame) throw new Error(`${operation}: terminal 전에 연결이 닫혔다`);
        if (frame.requestId === requestId && (frame.type === "response" || frame.type === "error")) return frame;
      }
    },
  };
}
