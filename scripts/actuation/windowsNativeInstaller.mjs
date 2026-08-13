// windowsNativeInstaller.mjs - explicit build, install, update, and removal for the optional Windows host.
import { execFile } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { verifyWindowsNativeInstallation, windowsNativeSourceSha256,
  WINDOWS_NATIVE_SOURCE_ROOT } from "./windowsNativeHost.js";

const execFileAsync = promisify(execFile);
const HOST_FILE = "pyproc-windows-motor-host.exe";
const RECEIPT_FILE = "windowsMotorHost.json";
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

async function rawConfig(configPath) {
  const resolved = resolve(configPath);
  let source;
  try { source = await readFile(resolved, "utf8"); }
  catch (error) { throw new Error(`cannot read pyproc config: ${resolved}`); }
  let value;
  try { value = JSON.parse(source); }
  catch (error) { throw new TypeError(`invalid pyproc config JSON: ${error.message}`); }
  return { resolved, value: object(value, "pyproc config") };
}

function nativeDraft(value) {
  const actuation = object(value.actuation, "actuation");
  const native = object(actuation.native, "actuation.native");
  if (native.enabled !== true) throw new TypeError("actuation.native.enabled must be true before setup");
  if (typeof native.installRoot !== "string" || !isAbsolute(native.installRoot)) {
    throw new TypeError("actuation.native.installRoot must be an absolute directory");
  }
  if (!Array.isArray(native.applications) || native.applications.length < 1) {
    throw new TypeError("actuation.native.applications requires at least one allowed application");
  }
  return native;
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, file);
}

async function packageVersion() {
  return JSON.parse(await readFile(join(PACKAGE_ROOT, "package.json"), "utf8")).version;
}

function ownedHostPath(installRoot, hostPath) {
  const root = resolve(installRoot);
  const host = resolve(hostPath);
  return relative(root, host) === HOST_FILE && basename(host) === HOST_FILE;
}

export async function setupWindowsNativeHost(configPath, { cargo = "cargo" } = {}) {
  if (process.platform !== "win32") throw new Error("Windows native Motor setup is available only on Windows");
  const config = await rawConfig(configPath);
  const native = nativeDraft(config.value);
  const installRoot = resolve(native.installRoot);
  const hostPath = join(installRoot, HOST_FILE);
  const receiptPath = join(installRoot, RECEIPT_FILE);
  await mkdir(installRoot, { recursive: true });
  if (!ownedHostPath(installRoot, hostPath)) throw new Error("native install path escaped its owned root");
  const buildRoot = await mkdtemp(join(tmpdir(), "pyproc-windows-motor-"));
  try {
    await execFileAsync(cargo, ["build", "--release", "--locked", "--manifest-path",
      join(WINDOWS_NATIVE_SOURCE_ROOT, "Cargo.toml"), "--target-dir", buildRoot], {
      cwd: WINDOWS_NATIVE_SOURCE_ROOT, windowsHide: true, maxBuffer: 8 * 1024 * 1024,
    });
    const built = join(buildRoot, "release", HOST_FILE);
    if (!(await stat(built)).isFile()) throw new Error("Cargo did not produce the Windows native host");
    await copyFile(built, hostPath);
    const binary = await readFile(hostPath);
    const sha256 = createHash("sha256").update(binary).digest("hex");
    const sourceSha256 = await windowsNativeSourceSha256();
    const sbomSha256 = createHash("sha256")
      .update(await readFile(join(WINDOWS_NATIVE_SOURCE_ROOT, "sbom.json"))).digest("hex");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const signature = sign(null, Buffer.from(sha256, "hex"), privateKey).toString("base64");
    const installation = Object.freeze({ hostPath, sha256, sourceSha256, sbomSha256, signature,
      publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64") });
    const receipt = Object.freeze({ protocol: "pyproc.windowsMotorInstallation", version: 1,
      packageVersion: await packageVersion(), platform: process.platform, arch: process.arch,
      build: Object.freeze({ cargoLocked: true, profile: "release" }), installation });
    await writeJsonAtomic(receiptPath, receipt);
    config.value.actuation.native = { ...native, enabled: true, installation };
    await writeJsonAtomic(config.resolved, config.value);
    const verified = await verifyWindowsNativeInstallation(config.value.actuation.native);
    return Object.freeze({ installed: true, configPath: config.resolved, installRoot, receiptPath,
      installation: verified });
  } catch (error) {
    await unlink(hostPath).catch(() => {});
    await unlink(receiptPath).catch(() => {});
    throw error;
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
}

export async function removeWindowsNativeHost(configPath) {
  const config = await rawConfig(configPath);
  const native = object(object(config.value.actuation, "actuation").native, "actuation.native");
  if (typeof native.installRoot !== "string" || !isAbsolute(native.installRoot)) {
    throw new TypeError("actuation.native.installRoot must be an absolute directory");
  }
  const installRoot = resolve(native.installRoot);
  const hostPath = native.installation?.hostPath || join(installRoot, HOST_FILE);
  if (!ownedHostPath(installRoot, hostPath)) throw new Error("native removal target escaped its owned root");
  const receiptPath = join(installRoot, RECEIPT_FILE);
  const removed = [];
  for (const file of [hostPath, receiptPath]) {
    try { await unlink(file); removed.push(file); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  config.value.actuation.native = { enabled: false, installRoot, applications: native.applications || [] };
  await writeJsonAtomic(config.resolved, config.value);
  return Object.freeze({ installed: false, configPath: config.resolved, installRoot,
    removed: Object.freeze(removed.sort()) });
}

export async function inspectWindowsNativeHostConfig(configPath) {
  const config = await rawConfig(configPath);
  const native = object(object(config.value.actuation, "actuation").native, "actuation.native");
  if (!native.enabled) return Object.freeze({ enabled: false, installed: false });
  const installation = await verifyWindowsNativeInstallation(native);
  return Object.freeze({ enabled: true, installed: true, installation });
}
