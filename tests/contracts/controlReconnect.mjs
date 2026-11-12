import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { ControlHost } from "../../scripts/controlProtocol/controlHost.js";
import { encodeControlFrame } from "../../scripts/controlProtocol/controlProtocol.js";
import {
  CONTROL_RECONNECT_DEFAULT_MS,
  CONTROL_RECONNECT_MAX_MS,
  CONTROL_RECONNECT_SCHEMA_VERSION,
  ControlServer,
  applyControlReconnectEnvironment,
  controlReconnectFromEnvironment,
  controlReconnectOptions,
} from "../../scripts/controlProtocol/controlServer.mjs";
import { controlRequest as request, wirePeer, within as wireWithin } from "../support/controlWire.mjs";

const STEP_MS = 5_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorOf(operation) {
  try { operation(); return null; }
  catch (error) { return error; }
}

const within = (promise, what, ms = STEP_MS) => wireWithin(promise, what, ms);

async function until(probe, what) {
  const deadline = Date.now() + STEP_MS;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`${what}: ${STEP_MS}ms 안에 일어나지 않았다`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A host whose `automation.act` stays in flight until it is aborted. */
function fakeHost() {
  const aborted = [];
  const host = new ControlHost({
    operations: ["automation.act", "machine.run"],
    handlers: {
      "machine.run": async (input) => ({ value: input.code }),
      "automation.act": (input, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted.push(String(signal.reason));
          reject(new Error("act stopped with its client"));
        }, { once: true });
      }),
    },
  });
  return { host, aborted };
}

function serverOf({ reconnect = null, holds = () => false } = {}) {
  const { host, aborted } = fakeHost();
  const ended = [];
  const server = new ControlServer({ host, operations: host.operations, reconnect, holds,
    onEnd: (code) => { ended.push(code); void server.stop(); } });
  const input = new PassThrough();
  const output = new PassThrough();
  server.serve(input, output);
  return { server, ended, aborted, input, output, peer: wirePeer(output, input, { stepMs: STEP_MS }) };
}

async function endpointOf(file) {
  return until(async () => {
    try { return JSON.parse(await readFile(file, "utf8")); }
    catch (error) { return null; }
  }, "돌아올 곳 파일");
}

const fileGone = (file) => until(async () => {
  try { await readFile(file); return false; }
  catch (error) { return error.code === "ENOENT"; }
}, "돌아올 곳 파일 지우기");

/** Connect to a waiting host and show `token`; resolves with the socket and its peer. */
async function comeBack(port, token) {
  const socket = connect({ host: "127.0.0.1", port });
  socket.on("error", () => {});
  await within(once(socket, "connect"), "다시 붙는 연결");
  socket.write(`${token}\n`);
  return { socket, peer: wirePeer(socket, socket, { stepMs: STEP_MS }) };
}

async function refused(port, token, what) {
  const { socket } = await comeBack(port, token);
  if (!socket.destroyed) await within(once(socket, "close"), what);
}

async function assertOptions() {
  assert(controlReconnectOptions() === null && controlReconnectOptions({ file: "" }) === null,
    "다시 붙기 옵션이 없으면 꺼져 있어야 한다");
  const file = join(tmpdir(), "pyproc-reconnect-options.json");
  const byDefault = controlReconnectOptions({ file });
  assert(byDefault.file === file && byDefault.windowMs === CONTROL_RECONNECT_DEFAULT_MS && Object.isFrozen(byDefault),
    "기다리는 시간을 주지 않으면 기본값이어야 한다");
  assert(controlReconnectOptions({ file, windowMs: String(CONTROL_RECONNECT_MAX_MS) }).windowMs === CONTROL_RECONNECT_MAX_MS,
    "기다리는 시간의 상한이 받아들여지지 않는다");
  for (const bad of [{ windowMs: "5" }, { file: "relative.json" }, { file, windowMs: "0" }, { file, windowMs: "1.5" },
    { file, windowMs: "abc" }, { file, windowMs: String(CONTROL_RECONNECT_MAX_MS + 1) }]) {
    assert(errorOf(() => controlReconnectOptions(bad)) instanceof TypeError,
      `잘못된 다시 붙기 옵션을 받았다: ${JSON.stringify(bad)}`);
  }
  // An inherited variable must never switch reconnect on.
  const env = { PYPROC_CONTROL_RECONNECT_FILE: file, PYPROC_CONTROL_RECONNECT_MS: "9" };
  applyControlReconnectEnvironment(null, env);
  assert(controlReconnectFromEnvironment(env) === null && Object.keys(env).length === 0,
    "물려받은 환경 변수가 다시 붙기를 켠다");
  applyControlReconnectEnvironment(controlReconnectOptions({ file, windowMs: "250" }), env);
  const carried = controlReconnectFromEnvironment(env);
  assert(carried.file === file && carried.windowMs === 250, "다시 붙기 옵션이 서버 모듈로 전해지지 않는다");
}

async function assertEndsWithItsClient(root) {
  // Without the option the host ends with its client, whatever it holds.
  const plain = serverOf({ holds: () => true });
  await plain.peer.greet("hello:plain");
  plain.peer.send(request("plain:1", "machine.run", { code: "1" }));
  assert((await plain.peer.next("response")).output.value === "1", "요청이 응답되지 않는다");
  plain.input.end();
  await until(() => plain.ended.length, "클라이언트가 떠난 뒤 호스트 끝");
  assert(plain.ended.join() === "0", "다시 붙기 없이 클라이언트를 잃은 호스트가 0으로 끝나지 않는다");

  // With the option, a host that holds nothing ends the same way and names no place to return to.
  const file = join(root, "empty.json");
  const empty = serverOf({ reconnect: controlReconnectOptions({ file }) });
  await empty.peer.greet("hello:empty");
  empty.input.end();
  await until(() => empty.ended.length, "쥔 것이 없는 호스트 끝");
  assert(empty.ended.join() === "0", "쥔 것이 없는 호스트가 0으로 끝나지 않는다");
  assert((await readFile(file).catch((error) => error.code)) === "ENOENT", "쥔 것이 없는 호스트가 돌아올 곳을 적었다");

  // A client that breaks the protocol ends the host with one fatal frame, reconnect or not.
  const broken = serverOf({ reconnect: controlReconnectOptions({ file }), holds: () => true });
  broken.input.write("not a control frame\n");
  const fatal = await broken.peer.next("fatal frame");
  assert(fatal?.type === "error" && fatal.fatal === true, "프로토콜을 어긴 클라이언트가 fatal 프레임을 받지 못했다");
  await until(() => broken.ended.length, "프로토콜 위반 뒤 호스트 끝");
  assert(broken.ended.join() === "1", "프로토콜 위반이 1로 끝나지 않는다");
}

async function assertClientComesBack(root) {
  const file = join(root, "held.json");
  let held = true;
  const first = serverOf({ reconnect: controlReconnectOptions({ file, windowMs: "20000" }), holds: () => held });
  await first.peer.greet("hello:first");
  first.peer.send(request("held:1", "machine.run", { code: "first" }));
  assert((await first.peer.next("response")).output.value === "first", "첫 연결의 요청이 응답되지 않는다");
  first.peer.send(request("held:2", "automation.act", { actions: [] }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const lostAt = Date.now();
  first.input.end();

  // The lost client's request ends with it, and its terminal goes to that client only.
  const stopped = await first.peer.next("끊긴 요청의 terminal");
  assert(stopped?.type === "error" && stopped.requestId === "held:2", "끊긴 연결의 요청이 그 연결에서 끝나지 않았다");
  assert(first.aborted.join() === "control client was lost", "끊긴 연결의 요청이 취소되지 않았다");

  const endpoint = await endpointOf(file);
  assert(endpoint.schemaVersion === CONTROL_RECONNECT_SCHEMA_VERSION && endpoint.pid === process.pid
    && Number.isInteger(endpoint.port) && endpoint.port > 0
    && typeof endpoint.token === "string" && endpoint.token.length >= 43
    && endpoint.expiresAtMs > lostAt && endpoint.expiresAtMs <= Date.now() + 20_000
    && Object.keys(endpoint).sort().join() === "expiresAtMs,pid,port,schemaVersion,token",
  "돌아올 곳 파일의 모양이 계약과 다르다");
  assert(first.ended.length === 0, "세션을 쥔 호스트가 클라이언트를 잃자 끝났다");

  // Only the token opens the host; a refused connection leaves it waiting.
  await refused(endpoint.port, "x".repeat(endpoint.token.length), "틀린 토큰 거절");
  await refused(endpoint.port, endpoint.token.slice(0, -1), "짧은 토큰 거절");
  const flood = connect({ host: "127.0.0.1", port: endpoint.port });
  flood.on("error", () => {});
  await within(once(flood, "connect"), "큰 첫 줄 연결");
  flood.write("x".repeat(80 * 1024));
  // Sooner than the time a connection has to show its token: the size alone refuses it.
  if (!flood.destroyed) await within(once(flood, "close"), "토큰 없이 큰 첫 줄 거절", 2_000);
  assert((await endpointOf(file)).token === endpoint.token && first.ended.length === 0,
    "거절한 연결 때문에 호스트가 기다리기를 그만뒀다");

  // The returning client starts its own connection: a new hello and its own request IDs.
  const second = await comeBack(endpoint.port, endpoint.token);
  await second.peer.greet("hello:second");
  second.peer.send(request("held:1", "machine.run", { code: "second" }));
  const again = await second.peer.next("돌아온 연결의 응답");
  assert(again?.type === "response" && again.requestId === "held:1" && again.output.value === "second",
    "돌아온 클라이언트가 앞 연결이 쓴 요청 ID를 다시 쓰지 못한다");
  assert(second.peer.unread() === 0, "앞 연결의 terminal이 돌아온 클라이언트에게 갔다");
  await fileGone(file);
  const late = connect({ host: "127.0.0.1", port: endpoint.port });
  const lateError = await within(Promise.race([once(late, "error").then(([error]) => error),
    once(late, "connect").then(() => null)]), "클라이언트가 붙은 뒤의 연결");
  late.destroy();
  assert(lateError?.code === "ECONNREFUSED", "클라이언트가 붙은 뒤에도 호스트가 연결을 받는다");

  // Losing that client too opens a new wait with a new token.
  second.socket.destroy();
  const next = await endpointOf(file);
  assert(next.token !== endpoint.token && first.ended.length === 0, "두 번째로 잃은 뒤 새 토큰으로 기다리지 않는다");
  await refused(next.port, endpoint.token, "지난 토큰 거절");
  const third = await comeBack(next.port, next.token);
  await third.peer.greet("hello:third");

  // Once nothing is held, a lost client ends the host.
  held = false;
  third.socket.destroy();
  await until(() => first.ended.length, "쥔 것이 없어진 호스트 끝");
  assert(first.ended.join() === "0", "쥔 것이 없어진 호스트가 0으로 끝나지 않는다");
  await fileGone(file);
}

async function assertUnfinishedFrameIsALostClient(root) {
  // A client killed in the middle of a write leaves a line without its newline. That is a lost client, not a
  // protocol violation: without reconnect the host ends with 0, and a host that holds a session waits.
  const unfinished = encodeControlFrame(request("cut:1", "machine.run", { code: "cut" })).slice(0, -12);
  const plain = serverOf({ holds: () => true });
  await plain.peer.greet("hello:cutPlain");
  plain.input.end(unfinished);
  await until(() => plain.ended.length, "쓰다 만 프레임을 남긴 클라이언트가 떠난 뒤 호스트 끝");
  assert(plain.ended.join() === "0", "쓰다 만 프레임을 프로토콜 위반으로 보고 호스트가 1로 끝났다");

  const file = join(root, "cut.json");
  const cut = serverOf({ reconnect: controlReconnectOptions({ file, windowMs: "20000" }), holds: () => true });
  await cut.peer.greet("hello:cut");
  cut.input.end(unfinished);
  const endpoint = await endpointOf(file);
  assert(cut.ended.length === 0, "쓰다 만 프레임을 남기고 끊긴 클라이언트 때문에 세션을 쥔 호스트가 끝났다");
  // The unfinished line was never a request: the client that returns can use its ID.
  const back = await comeBack(endpoint.port, endpoint.token);
  await back.peer.greet("hello:back");
  back.peer.send(request("cut:1", "machine.run", { code: "back" }));
  const answer = await back.peer.next("돌아온 연결의 응답");
  assert(answer?.type === "response" && answer.output.value === "back" && back.peer.unread() === 0,
    "쓰다 만 프레임이 요청으로 처리됐다");
  await cut.server.stop();
  back.socket.destroy();
}

async function assertWaitIsBounded(root) {
  const file = join(root, "bounded.json");
  const bounded = serverOf({ reconnect: controlReconnectOptions({ file, windowMs: "200" }), holds: () => true });
  await bounded.peer.greet("hello:bounded");
  // The client is lost through its output this time: a broken pipe, not a closed input.
  bounded.output.destroy(new Error("broken pipe"));
  const endpoint = await endpointOf(file);
  assert(bounded.ended.length === 0, "기다리는 시간이 지나기 전에 호스트가 끝났다");
  await until(() => bounded.ended.length, "기다리는 시간이 지난 뒤 호스트 끝");
  assert(bounded.ended.join() === "0" && Date.now() >= endpoint.expiresAtMs - 50,
    "아무도 돌아오지 않은 호스트가 기다리는 시간 뒤 0으로 끝나지 않는다");
  await fileGone(file);
  const late = connect({ host: "127.0.0.1", port: endpoint.port });
  const lateError = await within(Promise.race([once(late, "error").then(([error]) => error),
    once(late, "connect").then(() => null)]), "기다림이 끝난 뒤의 연결");
  late.destroy();
  assert(lateError?.code === "ECONNREFUSED", "기다림이 끝난 호스트가 연결을 받는다");
}

export async function assertControlReconnectContract() {
  await assertOptions();
  const root = await mkdtemp(join(tmpdir(), "pyproc-reconnect-"));
  try {
    await assertEndsWithItsClient(root);
    await assertClientComesBack(root);
    await assertUnfinishedFrameIsALostClient(root);
    await assertWaitIsBounded(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
