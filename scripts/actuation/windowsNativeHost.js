// windowsNativeHost.js - verified lifecycle and framed client for the optional Windows Motor host.
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTUATION_ERROR_CODES, actuationError } from "./actuationCanonical.js";

const PROTOCOL = "pyproc.windowsMotorHost";
const VERSION = 1;
const MAX_FRAME_BYTES = 1024 * 1024;
const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "native", "windowsHost");
const SOURCE_FILES = Object.freeze(["Cargo.toml", "Cargo.lock", "src/main.rs", "sbom.json"]);

function digestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function nativeFailure(code, message, details = null, outcome = "notSent") {
  const mapped = code === "NATIVE_TARGET_AMBIGUOUS" || code === "NATIVE_WINDOW_AMBIGUOUS"
    ? ACTUATION_ERROR_CODES.targetAmbiguous
    : code === "NATIVE_CONTROL_LEASE_INVALID" || code === "NATIVE_CONTROL_LEASE_CONSUMED"
      || code === "NATIVE_USER_PREEMPTED" ? ACTUATION_ERROR_CODES.controlRevoked
      : code === "NATIVE_BOOTSTRAP_INVALID" || code === "NATIVE_FRAME_INVALID"
        || code === "NATIVE_ASSET_TAMPERED" || code === "NATIVE_SIGNATURE_INVALID"
        || code === "NATIVE_INSTALLATION_MISSING"
        ? ACTUATION_ERROR_CODES.nativeIntegrity
        : code === "NATIVE_UIA_EFFECT_REJECTED" || code === "NATIVE_OS_INPUT_REJECTED"
          ? ACTUATION_ERROR_CODES.providerRejected : ACTUATION_ERROR_CODES.preflightFailed;
  return actuationError(mapped, message, { nativeCode: code, ...(details || {}) }, outcome);
}

export async function windowsNativeSourceSha256(sourceRoot = SOURCE_ROOT) {
  const hash = createHash("sha256");
  for (const relative of SOURCE_FILES) {
    const bytes = await readFile(resolve(sourceRoot, relative));
    const name = Buffer.from(relative);
    const nameLength = Buffer.allocUnsafe(4);
    nameLength.writeUInt32LE(name.byteLength);
    const byteLength = Buffer.allocUnsafe(8);
    byteLength.writeBigUInt64LE(BigInt(bytes.byteLength));
    hash.update(nameLength);
    hash.update(name);
    hash.update(byteLength);
    hash.update(bytes);
  }
  return hash.digest("hex");
}

export async function verifyWindowsNativeInstallation(native, { sourceRoot = SOURCE_ROOT } = {}) {
  if (process.platform !== "win32") throw nativeFailure("NATIVE_PLATFORM_UNSUPPORTED",
    "Windows native Motor is available only on Windows");
  if (!native?.enabled || !native.installation) throw nativeFailure("NATIVE_INSTALLATION_MISSING",
    "Windows native Motor is enabled but not installed");
  const installation = native.installation;
  let hostPath;
  try {
    hostPath = resolve(installation.hostPath);
    if (!(await stat(hostPath)).isFile()) throw new Error("not a regular file");
  } catch (error) {
    throw nativeFailure("NATIVE_INSTALLATION_MISSING", `Windows native host is unavailable: ${installation.hostPath}`);
  }
  const [binary, sourceSha256, sbom] = await Promise.all([readFile(hostPath), windowsNativeSourceSha256(sourceRoot),
    readFile(resolve(sourceRoot, "sbom.json"))]);
  const sha256 = digestBytes(binary);
  if (sha256 !== installation.sha256 || sourceSha256 !== installation.sourceSha256
    || digestBytes(sbom) !== installation.sbomSha256) {
    throw nativeFailure("NATIVE_ASSET_TAMPERED", "Windows native host or its pinned source revision changed");
  }
  let signatureValid = false;
  try {
    const publicKey = createPublicKey({ key: Buffer.from(installation.publicKey, "base64"),
      format: "der", type: "spki" });
    signatureValid = verify(null, Buffer.from(sha256, "hex"), publicKey,
      Buffer.from(installation.signature, "base64"));
  } catch (error) {
    signatureValid = false;
  }
  if (!signatureValid) throw nativeFailure("NATIVE_SIGNATURE_INVALID",
    "Windows native host installation signature is invalid");
  return Object.freeze({ hostPath, sha256, sourceSha256, sbomSha256: installation.sbomSha256,
    signatureValid: true,
    applications: native.applications.length, protocolVersion: VERSION });
}

export class WindowsNativeHostClient {
  static async open(native, options = {}) {
    const verified = await verifyWindowsNativeInstallation(native, options);
    const client = new WindowsNativeHostClient(native, verified);
    await client._authenticate();
    return client;
  }

  constructor(native, verified) {
    this.native = native;
    this.verified = verified;
    this.bootstrap = randomBytes(32).toString("hex");
    this.sequence = 0;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.stderr = "";
    this.closed = false;
    this.child = spawn(verified.hostPath, [], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYPROC_NATIVE_BOOTSTRAP: this.bootstrap,
        PYPROC_NATIVE_POLICY: JSON.stringify({ applications: native.applications }) } });
    this.child.stdout.on("data", (chunk) => this._onData(chunk));
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => { this.stderr = (this.stderr + chunk).slice(-8192); });
    this.child.once("exit", (code) => {
      const error = nativeFailure("NATIVE_HOST_EXITED", `Windows native host exited (${code}): ${this.stderr}`,
        null, "outcomeUnknown");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.closed = true;
    });
  }

  async _authenticate() {
    const response = await this.request("hello", {}, { bootstrapCapability: this.bootstrap });
    if (!response.authenticated) throw nativeFailure("NATIVE_BOOTSTRAP_INVALID",
      "Windows native host did not authenticate");
    this.bootstrap = null;
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.byteLength >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length < 1 || length > MAX_FRAME_BYTES) {
        this._failAll(nativeFailure("NATIVE_FRAME_INVALID", "Windows native response length is invalid",
          null, "outcomeUnknown"));
        return;
      }
      if (this.buffer.byteLength < length + 4) return;
      let response;
      try { response = JSON.parse(this.buffer.subarray(4, length + 4).toString("utf8")); }
      catch (error) {
        this._failAll(nativeFailure("NATIVE_FRAME_INVALID", "Windows native response JSON is invalid",
          null, "outcomeUnknown"));
        return;
      }
      this.buffer = this.buffer.subarray(length + 4);
      const pending = this.pending.get(response.requestId);
      if (!pending) {
        this._failAll(nativeFailure("NATIVE_FRAME_INVALID", "Windows native response request identity is unknown",
          null, "outcomeUnknown"));
        return;
      }
      this.pending.delete(response.requestId);
      if (response.protocol !== PROTOCOL || response.version !== VERSION || typeof response.ok !== "boolean") {
        pending.reject(nativeFailure("NATIVE_FRAME_INVALID", "Windows native response envelope is invalid",
          null, "outcomeUnknown"));
      } else if (!response.ok) {
        pending.reject(nativeFailure(response.error?.code || "NATIVE_PROVIDER_REJECTED",
          response.error?.message || "Windows native operation failed", null,
          response.error?.outcome || "outcomeUnknown"));
      } else pending.resolve(response.output);
    }
  }

  _failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    void this.close();
  }

  request(operation, input = {}, envelope = {}) {
    if (this.closed) return Promise.reject(nativeFailure("NATIVE_HOST_CLOSED", "Windows native host is closed"));
    const requestId = `request:${++this.sequence}`;
    const body = Buffer.from(JSON.stringify({ protocol: PROTOCOL, version: VERSION, requestId,
      operation, input, ...envelope }));
    if (body.byteLength > MAX_FRAME_BYTES) {
      return Promise.reject(nativeFailure("NATIVE_FRAME_INVALID", "Windows native request exceeds the byte limit"));
    }
    const frame = Buffer.allocUnsafe(body.byteLength + 4);
    frame.writeUInt32LE(body.byteLength, 0);
    body.copy(frame, 4);
    return new Promise((resolveRequest, rejectRequest) => {
      this.pending.set(requestId, { resolve: resolveRequest, reject: rejectRequest });
      this.child.stdin.write(frame, (error) => {
        if (!error) return;
        this.pending.delete(requestId);
        rejectRequest(nativeFailure("NATIVE_TRANSPORT_FAILED", String(error), null, "outcomeUnknown"));
      });
    });
  }

  inspect() { return this.request("inspect"); }

  bindApplication(input) { return this.request("bindApplication", input); }

  executeAccessibility(input) { return this.request("executeAccessibility", input); }

  executeOsInput(input) { return this.request("executeOsInput", input); }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.child.stdin.end();
    await new Promise((resolveClose) => {
      if (this.child.exitCode !== null) return resolveClose();
      const timer = setTimeout(() => { this.child.kill(); }, 2000);
      this.child.once("exit", () => { clearTimeout(timer); resolveClose(); });
    });
  }
}

export const WINDOWS_NATIVE_SOURCE_ROOT = SOURCE_ROOT;
