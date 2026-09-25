// userBrowserInstaller.mjs - explicit build, install, and removal of the user-browser provider on Windows: the native
// host binary, the extension folder the user loads once, the native messaging manifest, and its per-user registration
// for Chrome and Edge. Nothing here touches a browser profile; the user loads the extension and confirms pairing.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { USER_BROWSER_EXTENSION_ID, USER_BROWSER_HOST_NAME, userBrowserRoot, userBrowserStatus }
  from "./userBrowserChannel.mjs";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..", "..", "..");
export const USER_BROWSER_SOURCE_ROOT = join(HERE, "nativeHost");
export const USER_BROWSER_EXTENSION_SOURCE = join(HERE, "extension");
const HOST_FILE = "pyproc-user-browser-host.exe";
const RECEIPT_FILE = "userBrowserHost.json";
const REGISTRY = Object.freeze({
  chrome: "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
  edge: "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts",
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function treeSha256(root) {
  const hash = createHash("sha256");
  for (const name of (await readdir(root, { recursive: true })).map(String).sort()) {
    const file = join(root, name);
    if (!(await stat(file)).isFile()) continue;
    hash.update(`${name.replaceAll("\\", "/")}\n`).update(await readFile(file)).update("\n");
  }
  return hash.digest("hex");
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "w" });
  await rename(temporary, file);
}

function assertHostName(name) {
  if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(name)) throw new TypeError("native messaging host names are dotted lower-case");
  return name;
}

/**
 * The native host a platform wheel carries beside this package tree: the wheel's `host.json` names it with its SHA-256
 * for exactly this package version. Null in an npm install or a source checkout (setup builds the host there) and in a
 * platform wheel for another system.
 */
export async function bundledUserBrowserHost() {
  const descriptorPath = join(PACKAGE_ROOT, "..", "host.json");
  let descriptor;
  try { descriptor = JSON.parse(await readFile(descriptorPath, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  const { version } = JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8"));
  if (descriptor?.package?.name !== "pyproc" || descriptor.package.version !== version || !descriptor.userBrowserHost) {
    return null;
  }
  const entry = descriptor.userBrowserHost;
  const path = join(dirname(descriptorPath), entry.path);
  if (sha256(await readFile(path)) !== entry.sha256) {
    throw new Error(`the platform wheel's user-browser host ${path} does not match its SHA-256`);
  }
  return Object.freeze({ path, sha256: entry.sha256, sourceTree: entry.sourceTree });
}

// A running host keeps its file open: the new one is written beside it and swapped in by renames, which Windows allows
// for a running executable, and the old file is deleted once nothing runs it (now, or at the next setup).
async function replaceHost(source, hostPath) {
  const staged = `${hostPath}.${process.pid}.new`;
  await copyFile(source, staged);
  if (existsSync(hostPath)) await rename(hostPath, `${hostPath}.${Date.now()}.old`);
  await rename(staged, hostPath);
  const folder = dirname(hostPath);
  for (const name of await readdir(folder)) {
    if (name.startsWith(`${HOST_FILE}.`) && name.endsWith(".old")) {
      await unlink(join(folder, name)).catch((error) => {
        if (!["EBUSY", "EPERM", "EACCES"].includes(error?.code)) throw error;
      });
    }
  }
}

/**
 * Install the native host with the extension folder under `installRoot`, and register the host for Chrome and Edge.
 * The host is `hostBinary` when given, else the one a platform wheel carries, else built from source with `cargo`.
 * `hostName`, `extensionIds`, and `presetPairingSha256` are for pyproc's own isolated gates.
 */
export async function setupUserBrowser({ installRoot = join(userBrowserRoot(), "install"), cargo = "cargo",
  hostBinary = null, hostName = USER_BROWSER_HOST_NAME, extensionIds = [USER_BROWSER_EXTENSION_ID],
  presetPairingSha256 = null, browsers = ["chrome", "edge"] } = {}) {
  if (process.platform !== "win32") throw new Error("the user-browser provider is available only on Windows");
  assertHostName(hostName);
  const root = resolve(installRoot);
  await mkdir(root, { recursive: true });
  const hostPath = join(root, HOST_FILE);
  const bundled = hostBinary ? null : await bundledUserBrowserHost();
  const hostSource = hostBinary ? "given" : bundled ? "platformWheel" : "cargo";
  if (hostBinary || bundled) {
    await replaceHost(hostBinary ? resolve(hostBinary) : bundled.path, hostPath);
  } else {
    const buildRoot = await mkdtemp(join(tmpdir(), "pyproc-user-browser-"));
    try {
      await execFileAsync(cargo, ["build", "--release", "--locked", "--manifest-path",
        join(USER_BROWSER_SOURCE_ROOT, "Cargo.toml"), "--target-dir", buildRoot], {
        cwd: USER_BROWSER_SOURCE_ROOT, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
      });
      await replaceHost(join(buildRoot, "release", HOST_FILE), hostPath);
    } finally {
      await rm(buildRoot, { recursive: true, force: true });
    }
  }
  const extensionPath = join(root, "extension");
  await rm(extensionPath, { recursive: true, force: true });
  await cp(USER_BROWSER_EXTENSION_SOURCE, extensionPath, { recursive: true });
  await writeFile(join(extensionPath, "config.js"), [
    "// config.js - written by the installer: the native messaging host this extension talks to.",
    `export const HOST_NAME = ${JSON.stringify(hostName)};`,
    `export const PRESET_PAIRING_SHA256 = ${JSON.stringify(presetPairingSha256)};`, ""].join("\n"), "utf8");
  const manifestPath = join(root, `${hostName}.json`);
  await writeJsonAtomic(manifestPath, { name: hostName, description: "pyproc User Browser native host",
    path: hostPath, type: "stdio", allowed_origins: extensionIds.map((id) => `chrome-extension://${id}/`) });
  for (const browser of browsers) {
    await execFileAsync("reg", ["add", `${REGISTRY[browser]}\\${hostName}`, "/ve", "/t", "REG_SZ", "/d",
      manifestPath, "/f"], { windowsHide: true });
  }
  const receipt = { protocol: "pyproc.userBrowserInstall", version: 1, hostName, browsers, extensionIds,
    hostPath, hostSource, hostSha256: sha256(await readFile(hostPath)), sourceSha256: await treeSha256(join(USER_BROWSER_SOURCE_ROOT, "src")),
    extensionPath, extensionSha256: await treeSha256(extensionPath), manifestPath, installedAt: new Date().toISOString() };
  await writeJsonAtomic(join(root, RECEIPT_FILE), receipt);
  return Object.freeze(receipt);
}

/** The install receipt, whether each registration still points at it, and the running, paired browser profiles. */
export async function userBrowserInstallStatus({ installRoot = join(userBrowserRoot(), "install") } = {}) {
  const root = resolve(installRoot);
  let receipt = null;
  try { receipt = JSON.parse(await readFile(join(root, RECEIPT_FILE), "utf8")); } catch { receipt = null; }
  const registered = {};
  for (const browser of receipt?.browsers || []) {
    try {
      const { stdout } = await execFileAsync("reg", ["query", `${REGISTRY[browser]}\\${receipt.hostName}`, "/ve"],
        { windowsHide: true });
      registered[browser] = stdout.includes(receipt.manifestPath);
    } catch { registered[browser] = false; }
  }
  let hostIntact = false;
  try { hostIntact = Boolean(receipt) && sha256(await readFile(receipt.hostPath)) === receipt.hostSha256; }
  catch { hostIntact = false; }
  return Object.freeze({ installed: Boolean(receipt), hostIntact, registered, receipt,
    extensionPath: receipt?.extensionPath || null, extensionId: USER_BROWSER_EXTENSION_ID,
    ...(await userBrowserStatus()) });
}

/** Unregister the native host and delete what setup installed. The extension itself is removed in the browser. */
export async function removeUserBrowser({ installRoot = join(userBrowserRoot(), "install") } = {}) {
  const root = resolve(installRoot);
  let receipt = null;
  try { receipt = JSON.parse(await readFile(join(root, RECEIPT_FILE), "utf8")); } catch { receipt = null; }
  for (const browser of receipt?.browsers || []) {
    try {
      await execFileAsync("reg", ["delete", `${REGISTRY[browser]}\\${receipt.hostName}`, "/f"], { windowsHide: true });
    } catch { /* already unregistered */ }
  }
  await rm(root, { recursive: true, force: true });
  return Object.freeze({ removed: Boolean(receipt), installRoot: root });
}
