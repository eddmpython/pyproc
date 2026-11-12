// controlReconnectHost.mjs - 설치된 pyproc-control host가 client를 잃은 뒤에도 실제 브라우저 session을 쥐고, listen socket 없이 돌아온 client에게 가는지 본다.
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { access, readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { wirePeer, within } from "../support/controlWire.mjs";
import { listeningSocketsOf } from "../support/listeningSockets.mjs";

// Long enough for a waiting host to look at an announcement and go to its port, had it meant to.
const QUIET_MS = 500;

const absent = (file) => access(file).then(() => false, () => true);

async function until(probe, what, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`${what}: ${ms}ms 안에 일어나지 않았다`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function listenOnLoopback() {
  const listener = createServer();
  listener.listen({ host: "127.0.0.1", port: 0 });
  await once(listener, "listening");
  return listener;
}

/** Announce a returning client beside the endpoint file in one step, as the protocol reference describes it. */
async function announce(file, listener, token, clientToken) {
  const path = `${file}.client`;
  await writeFile(`${path}.draft`, JSON.stringify({ schemaVersion: 1, port: listener.address().port, token, clientToken }));
  await rename(`${path}.draft`, path);
}

/**
 * Start the installed host on a browser-only manifest, lose its stdio client while a session is attached, let the
 * host come to a client that announced itself with the endpoint the host wrote, and use the same session. Returns what
 * was seen; the caller judges it.
 */
export async function checkControlReconnect({ packageRoot, configPath, cwd, targetOrigin, heading, timeoutMs }) {
  const file = join(cwd, "controlReconnect.endpoint.json");
  const child = spawn(process.execPath, [join(packageRoot, "scripts", "pyprocControl.mjs"), "--config", configPath,
    "--reconnect", file, "--reconnect-ms", "60000"], { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  child.stderr.resume();
  child.stdin.on("error", () => {});
  const output = (frame, what) => {
    if (frame.type !== "response") throw new Error(`${what}: ${JSON.stringify(frame.error || frame)}`);
    return frame.output;
  };
  const clientToken = randomBytes(32).toString("base64url");
  const listeners = [];
  let returned = null;
  try {
    const first = wirePeer(child.stdout, child.stdin, { stepMs: timeoutMs });
    await first.greet("hello:first");
    const opened = output(await first.call("first:1", "automation.target.open",
      { url: `${targetOrigin}/`, expectedRisk: "externalEffect", waitUntil: "load" }), "target open");
    const sessionRef = output(await first.call("first:2", "automation.session.attach",
      { targetRef: opened.targetRef }), "session attach");

    child.stdin.end();
    const endpoint = JSON.parse(await until(() => readFile(file, "utf8").catch(() => ""), "host의 endpoint 파일", timeoutMs));
    const hostKeptRunning = child.exitCode === null && endpoint.pid === child.pid;
    // The operating system's table, not the host's word: the waiting host and its browser listen nowhere.
    const waitingListeners = listeningSocketsOf(child.pid);
    const endpointNamesNoPort = !("port" in endpoint);

    // An announcement that does not carry the host's token is removed, and the host does not go to its port.
    const stranger = await listenOnLoopback();
    listeners.push(stranger);
    let wentToStranger = false;
    stranger.on("connection", (socket) => { wentToStranger = true; socket.destroy(); });
    await announce(file, stranger, "x".repeat(endpoint.token.length), clientToken);
    await until(() => absent(`${file}.client`), "host가 따르지 않은 알림 지우기", timeoutMs);
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS));

    const listener = await listenOnLoopback();
    listeners.push(listener);
    const arrived = once(listener, "connection");
    await announce(file, listener, endpoint.token, clientToken);
    const [socket] = await within(arrived, "host가 돌아온 client로 오는 연결", timeoutMs);
    socket.on("error", () => {});
    const [firstLine] = await within(once(socket, "data"), "host의 첫 줄", timeoutMs);
    // The host proves that it holds the endpoint token and read the announcement; neither token is on the connection.
    const hostProved = String(firstLine) === `${createHmac("sha256", endpoint.token).update(clientToken).digest("hex")}\n`;
    socket.write(`${clientToken}\n`);
    returned = { socket, peer: wirePeer(socket, socket, { stepMs: timeoutMs }) };
    await returned.peer.greet("hello:returned");
    // The request ID the first connection used is free again, and the session it attached is still the session.
    const observed = output(await returned.peer.call("first:1", "automation.observe",
      { sessionRef, expectedRisk: "read" }), "observe after coming back");
    const sameSessionSeesPage = JSON.stringify(observed).includes(heading);
    const endpointRemoved = await absent(file) && await absent(`${file}.client`);
    output(await returned.peer.call("returned:2", "automation.session.detach", { sessionRef }), "session detach");
    output(await returned.peer.call("returned:3", "automation.target.close",
      { targetRef: opened.targetRef, expectedRisk: "externalEffect" }), "target close");

    // Nothing is held any more, so losing this client ends the host.
    returned.socket.end();
    const exitCode = await within(exited, "host 종료", timeoutMs);
    return { hostKeptRunning, waitingListeners, endpointNamesNoPort, wentToStranger, hostProved, sameSessionSeesPage,
      endpointRemoved, exitCode, endpointGoneAfterExit: await absent(file) };
  } finally {
    returned?.socket.destroy();
    for (const listener of listeners) listener.close();
    if (child.exitCode === null) child.kill();
  }
}
