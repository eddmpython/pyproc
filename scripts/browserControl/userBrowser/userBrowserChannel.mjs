// userBrowserChannel.mjs - the control host's side of the user-browser provider: find the browser's native host,
// connect to its named pipe, and speak flat CDP to the paired extension through it. The pipe admits only the current
// Windows user; the extension admits only a control host that presents the key it paired with after the user clicked
// its action. The key lives in the user's local app data, like the rest of pyproc's user state.
import { createHash, randomBytes } from "node:crypto";
import { connect } from "node:net";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CdpConnection } from "../cdpConnection.mjs";

export const USER_BROWSER_HOST_NAME = "com.pyproc.user_browser";
export const USER_BROWSER_EXTENSION_ID = "olckphbppfoanoakaaemgfpobocgdogh";
export const USER_BROWSER_KINDS = Object.freeze(["chrome", "edge"]);
const HOST_PROTOCOL = "pyproc.userBrowserHost";
const MAX_FRAME = 64 * 1024 * 1024;
const MAX_REQUEST_FRAME = 1024 * 1024;
const PAIRING_TIMEOUT_MS = 130000;
const PRODUCT_PREFIX = Object.freeze({ chrome: "Chrome/", edge: "Edg/" });

export function userBrowserRoot(env = process.env) {
  if (process.platform !== "win32") throw new Error("the user-browser provider is available only on Windows");
  if (!env.LOCALAPPDATA) throw new Error("LOCALAPPDATA is not set");
  return join(env.LOCALAPPDATA, "pyproc", "userBrowser");
}

function assertKind(browser) {
  if (!USER_BROWSER_KINDS.includes(browser)) throw new TypeError("userBrowser.browser must be chrome or edge");
  return browser;
}

function running(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === "EPERM"; }
}

/**
 * Native hosts the user's browsers started, one per browser profile running the extension. An announcement whose
 * host is gone (the browser was killed before it could let the host go) is removed.
 */
export async function listUserBrowserHosts({ env = process.env } = {}) {
  const root = join(userBrowserRoot(env), "hosts");
  let names = [];
  try { names = await readdir(root); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const hosts = [];
  for (const name of names.filter((entry) => entry.endsWith(".json")).sort()) {
    try {
      const host = JSON.parse(await readFile(join(root, name), "utf8"));
      if (host?.protocol !== HOST_PROTOCOL || host.version !== 1 || typeof host.pipeName !== "string"
        || !/^\\\\\.\\pipe\\pyproc-userBrowser-[0-9a-f]{32}$/.test(host.pipeName)
        || !/^[A-Za-z0-9-]{1,64}$/.test(String(host.profileId || ""))) continue;
      if (!Number.isInteger(host.pid) || !running(host.pid)) {
        await rm(join(root, name), { force: true });
        continue;
      }
      hosts.push(Object.freeze({ profileId: host.profileId, product: String(host.product || ""),
        pipeName: host.pipeName, pid: Number(host.pid) || 0 }));
    } catch { continue; }
  }
  return hosts;
}

function keyPath(env, profileId) {
  return join(userBrowserRoot(env), "pairing", `${profileId}.key`);
}

async function readPairing(env, profileId) {
  try {
    const pairing = JSON.parse(await readFile(keyPath(env, profileId), "utf8"));
    return /^[0-9a-f]{64}$/.test(String(pairing?.key || "")) ? pairing : null;
  } catch (error) { if (error?.code === "ENOENT" || error instanceof SyntaxError) return null; throw error; }
}

async function readKey(env, profileId) {
  return (await readPairing(env, profileId))?.key || null;
}

/** The pipe frames: a 4-byte little-endian length, then UTF-8 JSON, both ways. */
export function userBrowserPipeChannel(socket) {
  let onMessage = () => {};
  let onClose = () => {};
  let buffered = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.length >= 4) {
      const length = buffered.readUInt32LE(0);
      if (length === 0 || length > MAX_FRAME) { socket.destroy(new Error("user browser frame length is invalid")); return; }
      if (buffered.length < 4 + length) break;
      const text = buffered.subarray(4, 4 + length).toString("utf8");
      buffered = buffered.subarray(4 + length);
      onMessage(text);
    }
  });
  socket.on("close", () => onClose(new Error("the user browser's native host closed the pipe")));
  socket.on("error", (error) => onClose(new Error(`user browser pipe failed: ${error?.message || error}`)));
  return Object.freeze({
    listen(messageListener, closeListener) { onMessage = messageListener; onClose = closeListener; },
    send(text) {
      const body = Buffer.from(text, "utf8");
      if (body.length > MAX_REQUEST_FRAME) throw new Error("a user browser request exceeds 1 MiB");
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length, 0);
      socket.write(Buffer.concat([header, body]));
    },
    close() { socket.destroy(); },
  });
}

async function openPipe(pipeName, timeoutMs) {
  const socket = connect(pipeName);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("the user browser's native host did not answer")); },
      timeoutMs);
    socket.once("connect", () => { clearTimeout(timer); resolve(); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
  return socket;
}

function hostsOf(hosts, browser) {
  return hosts.filter((host) => host.product.startsWith(PRODUCT_PREFIX[assertKind(browser)]));
}

/**
 * Connect to the paired extension of `browser` and authenticate with the stored pairing key. Returns the flat-CDP
 * connection and the host it reached.
 */
export async function openUserBrowserConnection({ browser, timeoutMs = 30000, env = process.env } = {}) {
  const candidates = hostsOf(await listUserBrowserHosts({ env }), browser);
  const paired = [];
  for (const host of candidates) {
    const key = await readKey(env, host.profileId);
    if (key) paired.push({ host, key });
  }
  if (!paired.length) {
    throw new Error(candidates.length
      ? `no ${browser} profile is paired; run pyproc-control user-browser pair --browser ${browser}`
      : `${browser} is not running the pyproc User Browser extension (or its native host is not registered)`);
  }
  let lastError = null;
  for (const { host, key } of paired) {
    let connection = null;
    try {
      connection = new CdpConnection(userBrowserPipeChannel(await openPipe(host.pipeName, 5000)), { timeoutMs });
      const hello = await connection.send("PyprocUserBrowser.hello", { key });
      return Object.freeze({ connection, host, product: hello.product, protocolVersion: hello.protocolVersion });
    } catch (error) {
      connection?.close();
      lastError = error;
    }
  }
  throw lastError;
}

/** Ask the extension of `browser` to pair; the user confirms by clicking its action. The key is kept on success. */
export async function pairUserBrowser({ browser, profileId = "", env = process.env } = {}) {
  const candidates = hostsOf(await listUserBrowserHosts({ env }), browser)
    .filter((host) => !profileId || host.profileId === profileId);
  if (candidates.length !== 1) {
    throw new Error(candidates.length
      ? `${candidates.length} ${browser} profiles run the extension; name one with --profile`
      : `${browser} is not running the pyproc User Browser extension (or its native host is not registered)`);
  }
  const [host] = candidates;
  const key = randomBytes(32).toString("hex");
  const connection = new CdpConnection(userBrowserPipeChannel(await openPipe(host.pipeName, 5000)),
    { timeoutMs: PAIRING_TIMEOUT_MS });
  try {
    await connection.send("PyprocUserBrowser.pair", { keySha256: createHash("sha256").update(key).digest("hex") });
  } finally {
    connection.close();
  }
  const file = keyPath(env, host.profileId);
  await mkdir(join(userBrowserRoot(env), "pairing"), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ key, browser, profileId: host.profileId, product: host.product,
    pairedAt: new Date().toISOString() })}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, file);
  return Object.freeze({ paired: true, browser, profileId: host.profileId, product: host.product });
}

/** Paired and running profiles per browser, without connecting. */
export async function userBrowserStatus({ env = process.env } = {}) {
  const hosts = await listUserBrowserHosts({ env });
  const running = new Set(hosts.map((host) => host.profileId));
  const profiles = [];
  for (const host of hosts) {
    profiles.push(Object.freeze({ profileId: host.profileId, product: host.product,
      paired: Boolean(await readKey(env, host.profileId)) }));
  }
  // Pairings kept here, with whether their browser profile runs now (a paired browser that is closed is not lost).
  let names = [];
  try { names = await readdir(join(userBrowserRoot(env), "pairing")); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  const pairings = [];
  for (const profileId of names.filter((name) => name.endsWith(".key")).map((name) => name.slice(0, -4)).sort()) {
    const pairing = await readPairing(env, profileId);
    if (pairing) pairings.push(Object.freeze({ profileId, browser: String(pairing.browser || ""),
      product: String(pairing.product || ""), running: running.has(profileId) }));
  }
  return Object.freeze({ extensionId: USER_BROWSER_EXTENSION_ID, profiles: Object.freeze(profiles),
    pairings: Object.freeze(pairings) });
}

/** Forget every pairing of `browser` here, and in the extension of each profile that is running. */
export async function unpairUserBrowser({ browser, env = process.env } = {}) {
  assertKind(browser);
  const running = new Map((await listUserBrowserHosts({ env })).map((host) => [host.profileId, host]));
  let names = [];
  try { names = await readdir(join(userBrowserRoot(env), "pairing")); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  const forgotten = [];
  for (const profileId of names.filter((name) => name.endsWith(".key")).map((name) => name.slice(0, -4))) {
    const pairing = await readPairing(env, profileId);
    if (pairing?.browser !== browser) continue;
    const host = running.get(profileId);
    if (host) {
      try {
        const connection = new CdpConnection(userBrowserPipeChannel(await openPipe(host.pipeName, 5000)),
          { timeoutMs: 10000 });
        try {
          await connection.send("PyprocUserBrowser.hello", { key: pairing.key });
          await connection.send("PyprocUserBrowser.unpair");
        } finally { connection.close(); }
      } catch { /* the local key is forgotten even when the extension cannot be reached */ }
    }
    await rm(keyPath(env, profileId), { force: true });
    forgotten.push(profileId);
  }
  return Object.freeze({ unpaired: forgotten });
}
