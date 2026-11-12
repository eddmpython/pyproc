// controlReconnectHost.mjs - 설치된 pyproc-control host가 client를 잃은 뒤에도 실제 브라우저 session을 쥐고 돌아온 client를 받는지 본다.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, readFile } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import { wirePeer, within } from "../support/controlWire.mjs";

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

async function socketTo(port, firstLine, stepMs) {
  const socket = connect({ host: "127.0.0.1", port });
  await within(once(socket, "connect"), "돌아온 client의 연결", stepMs);
  socket.write(`${firstLine}\n`);
  return { socket, peer: wirePeer(socket, socket, { stepMs }) };
}

/**
 * Start the installed host on a browser-only manifest, lose its stdio client while a session is attached, come back
 * over the endpoint the host wrote and use the same session. Returns what was seen; the caller judges it.
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

    const stranger = await socketTo(endpoint.port, "x".repeat(endpoint.token.length), timeoutMs);
    const strangerRefused = await stranger.peer.next("틀린 token의 거절") === null;
    stranger.socket.destroy();

    returned = await socketTo(endpoint.port, endpoint.token, timeoutMs);
    await returned.peer.greet("hello:returned");
    // The request ID the first connection used is free again, and the session it attached is still the session.
    const observed = output(await returned.peer.call("first:1", "automation.observe",
      { sessionRef, expectedRisk: "read" }), "observe after coming back");
    const sameSessionSeesPage = JSON.stringify(observed).includes(heading);
    const endpointRemoved = await absent(file);
    output(await returned.peer.call("returned:2", "automation.session.detach", { sessionRef }), "session detach");
    output(await returned.peer.call("returned:3", "automation.target.close",
      { targetRef: opened.targetRef, expectedRisk: "externalEffect" }), "target close");

    // Nothing is held any more, so losing this client ends the host.
    returned.socket.end();
    const exitCode = await within(exited, "host 종료", timeoutMs);
    return { hostKeptRunning, strangerRefused, sameSessionSeesPage, endpointRemoved, exitCode,
      endpointGoneAfterExit: await absent(file) };
  } finally {
    returned?.socket.destroy();
    if (child.exitCode === null) child.kill();
  }
}
