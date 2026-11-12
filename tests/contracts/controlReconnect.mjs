import { once } from "node:events";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
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
  controlReconnectAnnouncement,
  controlReconnectFromEnvironment,
  controlReconnectOptions,
  controlReconnectProof,
} from "../../scripts/controlProtocol/controlServer.mjs";
import { controlRequest as request, wirePeer, within as wireWithin } from "../support/controlWire.mjs";

const STEP_MS = 5_000;
// Long enough for a waiting host to look at an announcement and go to its port, had it meant to.
const QUIET_MS = 400;
const CLIENT_TOKEN = "c".repeat(43);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorOf(operation) {
  try { operation(); return null; }
  catch (error) { return error; }
}

const within = (promise, what, ms = STEP_MS) => wireWithin(promise, what, ms);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(probe, what) {
  const deadline = Date.now() + STEP_MS;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`${what}: ${STEP_MS}ms 안에 일어나지 않았다`);
    await pause(10);
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

const endpointOf = (file) => until(async () => {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { return null; }
}, "돌아올 곳 파일");

const fileGone = (file, what = "돌아올 곳 파일 지우기") => until(async () => {
  try { await readFile(file); return false; }
  catch (error) { return error.code === "ENOENT"; }
}, what);

/** A loopback listener, as a returning client opens one. `next` resolves with the next connection made to it. */
async function listenOnLoopback() {
  const server = createServer();
  const arrived = [];
  const waiters = [];
  server.on("connection", (socket) => {
    socket.on("error", () => {});
    const waiter = waiters.shift();
    if (waiter) waiter(socket); else arrived.push(socket);
  });
  server.listen({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  return {
    port: server.address().port,
    next: (what) => arrived.length ? Promise.resolve(arrived.shift())
      : within(new Promise((resolve) => waiters.push(resolve)), what),
    /** True when the host made no connection that nobody took, now or within the quiet time. */
    async stayedQuiet() {
      await pause(QUIET_MS);
      return arrived.length === 0;
    },
    close() {
      server.close();
      for (const socket of arrived.splice(0)) socket.destroy();
    },
  };
}

const announcementOf = (endpoint, port, changes = {}) =>
  ({ schemaVersion: CONTROL_RECONNECT_SCHEMA_VERSION, port, token: endpoint.token, clientToken: CLIENT_TOKEN, ...changes });

/** Put `announced` beside `file` in one step, as a returning client does. */
async function announce(file, announced) {
  const path = controlReconnectAnnouncement(file);
  await writeFile(`${path}.draft`, typeof announced === "string" ? announced : JSON.stringify(announced));
  await rename(`${path}.draft`, path);
}

/**
 * Announce `listener` to the host that waits with `file`; resolves with the host's connection once its first line
 * proved it: made from both tokens, carrying neither.
 */
async function hostComesTo(listener, file, endpoint) {
  await announce(file, announcementOf(endpoint, listener.port));
  const socket = await listener.next("호스트가 돌아온 클라이언트로 오는 연결");
  const [first] = await within(once(socket, "data"), "호스트의 첫 줄");
  const shown = String(first);
  assert(shown === `${controlReconnectProof(endpoint.token, CLIENT_TOKEN)}\n`,
    "호스트의 첫 줄이 두 토큰으로 만든 증명이 아니다");
  assert(!shown.includes(endpoint.token) && !shown.includes(CLIENT_TOKEN), "호스트가 토큰을 연결에 실었다");
  return socket;
}

/** Come back to the host that waits with `file` the way a client does: listen, announce, answer the proven host. */
async function comeBack(file) {
  const endpoint = await endpointOf(file);
  const listener = await listenOnLoopback();
  try {
    const socket = await hostComesTo(listener, file, endpoint);
    socket.write(`${CLIENT_TOKEN}\n`);
    return { socket, endpoint, peer: wirePeer(socket, socket, { stepMs: STEP_MS }) };
  } finally {
    listener.close();
  }
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
  assert(controlReconnectAnnouncement(file) === `${file}.client`, "돌아온 클라이언트가 알리는 파일의 자리가 계약과 다르다");
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

/** The host goes to no port that was not announced, whole, together with the token of its wait. */
async function assertOnlyItsAnnouncementIsFollowed(file, endpoint, server) {
  const listener = await listenOnLoopback();
  try {
    const good = announcementOf(endpoint, listener.port);
    const withoutClientToken = { ...good };
    delete withoutClientToken.clientToken;
    for (const [what, announced] of [
      ["틀린 토큰", { ...good, token: "x".repeat(endpoint.token.length) }],
      ["짧은 토큰", { ...good, token: endpoint.token.slice(0, -1) }],
      ["다른 schemaVersion", { ...good, schemaVersion: CONTROL_RECONNECT_SCHEMA_VERSION + 1 }],
      ["숫자가 아닌 port", { ...good, port: String(listener.port) }],
      ["범위 밖 port", { ...good, port: 65_536 }],
      ["clientToken 없음", withoutClientToken],
      ["짧은 clientToken", { ...good, clientToken: "c".repeat(31) }],
      ["줄바꿈이 든 clientToken", { ...good, clientToken: `${"c".repeat(40)}\n${"c".repeat(40)}` }],
      ["JSON이 아닌 글", "not an announcement"],
      ["너무 긴 글", JSON.stringify({ ...good, padding: "x".repeat(8 * 1024) })],
    ]) {
      await announce(file, announced);
      // Read once: the host removes what it does not follow, so nothing stale is left to be followed later.
      await fileGone(controlReconnectAnnouncement(file), `${what}: 알림 파일 지우기`);
      assert(await listener.stayedQuiet(), `${what}: 호스트가 받아들이면 안 되는 알림의 port로 갔다`);
    }
    assert(server.ended.length === 0, "따르지 않은 알림 때문에 호스트가 기다리기를 그만뒀다");
  } finally {
    listener.close();
  }
}

/** A connection that does not answer with the announced client's token is not the client; the wait goes on. */
async function assertOnlyTheAnnouncedClientIsTaken(file, endpoint, server) {
  // Nobody listens at the announced port.
  const vacated = await listenOnLoopback();
  vacated.close();
  await announce(file, announcementOf(endpoint, vacated.port));
  await fileGone(controlReconnectAnnouncement(file), "아무도 없는 port의 알림 지우기");
  await pause(QUIET_MS);
  assert(server.ended.length === 0, "아무도 없는 port로 갔던 호스트가 끝났다");

  const listener = await listenOnLoopback();
  try {
    for (const [what, answer] of [["틀린 답", `${"x".repeat(CLIENT_TOKEN.length)}\n`],
      ["짧은 답", `${CLIENT_TOKEN.slice(0, -1)}\n`], ["돌아올 곳 파일의 토큰으로 한 답", `${endpoint.token}\n`],
      ["줄 없이 큰 답", "x".repeat(80 * 1024)]]) {
      const socket = await hostComesTo(listener, file, endpoint);
      socket.write(answer);
      // Sooner than the time a client has to answer: the answer alone refuses it.
      if (!socket.destroyed) await within(once(socket, "close"), `${what}: 호스트가 연결을 닫기`, 2_000);
      // One announcement, one connection: the host does not come again for it.
      assert(await listener.stayedQuiet(), `${what}: 호스트가 같은 알림으로 다시 왔다`);
      assert(server.ended.length === 0, `${what}: 클라이언트가 아닌 연결 때문에 호스트가 끝났다`);
    }
  } finally {
    listener.close();
  }
  // No connection was shown a token, so the wait still offers the one it wrote.
  assert((await endpointOf(file)).token === endpoint.token, "클라이언트가 아닌 연결 뒤에 돌아올 곳 파일이 바뀌었다");
}

async function assertClientComesBack(root) {
  const file = join(root, "held.json");
  let held = true;
  const first = serverOf({ reconnect: controlReconnectOptions({ file, windowMs: "30000" }), holds: () => held });
  await first.peer.greet("hello:first");
  first.peer.send(request("held:1", "machine.run", { code: "first" }));
  assert((await first.peer.next("response")).output.value === "first", "첫 연결의 요청이 응답되지 않는다");
  first.peer.send(request("held:2", "automation.act", { actions: [] }));
  await pause(20);
  const lostAt = Date.now();
  first.input.end();

  // The lost client's request ends with it, and its terminal goes to that client only.
  const stopped = await first.peer.next("끊긴 요청의 terminal");
  assert(stopped?.type === "error" && stopped.requestId === "held:2", "끊긴 연결의 요청이 그 연결에서 끝나지 않았다");
  assert(first.aborted.join() === "control client was lost", "끊긴 연결의 요청이 취소되지 않았다");

  // The endpoint names no port: the waiting host listens nowhere.
  const endpoint = await endpointOf(file);
  assert(endpoint.schemaVersion === CONTROL_RECONNECT_SCHEMA_VERSION && endpoint.pid === process.pid
    && typeof endpoint.token === "string" && endpoint.token.length >= 43
    && endpoint.expiresAtMs > lostAt && endpoint.expiresAtMs <= Date.now() + 30_000
    && Object.keys(endpoint).sort().join() === "expiresAtMs,pid,schemaVersion,token",
  "돌아올 곳 파일의 모양이 계약과 다르다");
  assert(first.ended.length === 0, "세션을 쥔 호스트가 클라이언트를 잃자 끝났다");

  await assertOnlyItsAnnouncementIsFollowed(file, endpoint, first);
  await assertOnlyTheAnnouncedClientIsTaken(file, endpoint, first);

  // The returning client starts its own connection: a new hello and its own request IDs.
  const second = await comeBack(file);
  await second.peer.greet("hello:second");
  second.peer.send(request("held:1", "machine.run", { code: "second" }));
  const again = await second.peer.next("돌아온 연결의 응답");
  assert(again?.type === "response" && again.requestId === "held:1" && again.output.value === "second",
    "돌아온 클라이언트가 앞 연결이 쓴 요청 ID를 다시 쓰지 못한다");
  assert(second.peer.unread() === 0, "앞 연결의 terminal이 돌아온 클라이언트에게 갔다");
  await fileGone(file);

  // A host that has its client looks at no announcement.
  const late = await listenOnLoopback();
  try {
    await announce(file, announcementOf(second.endpoint, late.port));
    assert(await late.stayedQuiet(), "클라이언트가 붙은 뒤에도 호스트가 알림을 따른다");
    assert(JSON.parse(await readFile(controlReconnectAnnouncement(file), "utf8")).port === late.port,
      "클라이언트가 붙은 호스트가 알림 파일을 건드렸다");

    // Losing that client too opens a new wait with a new token; what was announced before it is not followed.
    second.socket.destroy();
    const next = await endpointOf(file);
    assert(next.token !== second.endpoint.token && first.ended.length === 0, "두 번째로 잃은 뒤 새 토큰으로 기다리지 않는다");
    await fileGone(controlReconnectAnnouncement(file), "앞 기다림의 알림 지우기");
    assert(await late.stayedQuiet(), "호스트가 앞 기다림의 토큰으로 쓴 알림을 따랐다");
  } finally {
    late.close();
  }
  const third = await comeBack(file);
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
  // The unfinished line was never a request: the client that returns can use its ID.
  const back = await comeBack(file);
  assert(cut.ended.length === 0, "쓰다 만 프레임을 남기고 끊긴 클라이언트 때문에 세션을 쥔 호스트가 끝났다");
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
  // A wait that is over follows no announcement, not even one with its own token.
  const late = await listenOnLoopback();
  try {
    await announce(file, announcementOf(endpoint, late.port));
    assert(await late.stayedQuiet(), "기다림이 끝난 호스트가 알림을 따른다");
  } finally {
    late.close();
    await rm(controlReconnectAnnouncement(file), { force: true });
  }
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
