// controlApi.js - installed pyproc-control을 시작하고 제품 동사로 다루는 안정 Node.js API.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ControlRemoteError, ControlStdioClient } from "./controlClient.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 30000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000;
const DEFAULT_CANCEL_SETTLE_TIMEOUT_MS = 5000;
const MAX_DIAGNOSTIC_BYTES = 8000;
const CONTROL_SCRIPT = fileURLToPath(new URL("../pyprocControl.mjs", import.meta.url));

function positiveTimeout(value, label, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be positive`);
  return value;
}

function controlCommand(command) {
  if (command === undefined) return [process.execPath, CONTROL_SCRIPT];
  if (typeof command === "string" && command) return [command];
  if (Array.isArray(command) && command.length > 0
    && command.every((part) => typeof part === "string" && part)) return [...command];
  throw new TypeError("control command must be a non-empty string or string array");
}

function controlConfigPath(configPath) {
  if (typeof configPath !== "string" || !configPath) throw new TypeError("control configPath must be a non-empty string");
  return resolve(configPath);
}

function timeoutError(message) {
  return new ControlRemoteError({ code: "CONTROL_TIMEOUT", message, retryable: false,
    outcome: "outcomeUnknown" });
}

function settled(promise) {
  return promise.then((value) => ({ state: "resolved", value }),
    (error) => ({ state: "rejected", error }));
}

function delay(ms, value) {
  return new Promise((resolveDelay) => setTimeout(() => resolveDelay(value), ms));
}

function unwrap(result) {
  if (result.state === "rejected") throw result.error;
  return result.value;
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  if (await Promise.race([exited.then(() => true), delay(timeoutMs, false)])) return;
  child.kill("SIGTERM");
  if (await Promise.race([exited.then(() => true), delay(timeoutMs, false)])) return;
  child.kill("SIGKILL");
  await exited;
}

async function runCheck(configPath, options) {
  const command = controlCommand(options.command);
  const timeoutMs = positiveTimeout(options.timeoutMs, "control check timeoutMs", DEFAULT_STARTUP_TIMEOUT_MS);
  const child = spawn(command[0], [...command.slice(1), "--config", controlConfigPath(configPath), "--check"], {
    cwd: options.cwd || process.cwd(), env: options.env || process.env, windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-1024 * 1024); });
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-MAX_DIAGNOSTIC_BYTES); });
  const exit = new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  const outcome = await Promise.race([settled(exit), delay(timeoutMs, { state: "timeout" })]);
  if (outcome.state === "timeout") {
    child.kill("SIGTERM");
    await waitForExit(child, DEFAULT_SHUTDOWN_TIMEOUT_MS);
    throw timeoutError("pyproc-control preflight timed out");
  }
  const { code, signal } = unwrap(outcome);
  if (code !== 0) throw new Error(`pyproc-control preflight failed (${code ?? signal})\n${stderr}`);
  let report;
  try { report = JSON.parse(stdout); }
  catch (error) { throw new Error("pyproc-control preflight did not return JSON", { cause: error }); }
  if (!report || typeof report !== "object" || report.ok !== true) {
    throw new Error("pyproc-control preflight did not return an ok report");
  }
  return Object.freeze(report);
}

export { ControlRemoteError } from "./controlClient.js";

export class ControlRequest {
  constructor(client, requestId, result) {
    this.client = client;
    this.requestId = requestId;
    this.result = result;
    Object.freeze(this);
  }

  cancel(reason = "control client cancelled the request") {
    return this.client.cancel(this.requestId, reason);
  }

  async wait({ timeoutMs, cancelSettleTimeoutMs } = {}) {
    if (timeoutMs === undefined) return this.result;
    const deadlineMs = positiveTimeout(timeoutMs, "control request timeoutMs");
    const settleMs = positiveTimeout(cancelSettleTimeoutMs, "control cancelSettleTimeoutMs",
      this.client.cancelSettleTimeoutMs);
    const first = await Promise.race([settled(this.result), delay(deadlineMs, { state: "timeout" })]);
    if (first.state !== "timeout") return unwrap(first);
    try { await this.cancel("control request deadline reached"); }
    catch (error) {
      try { await this.client.close(); } catch (closeError) { void closeError; }
      throw timeoutError("control request deadline expired and cancellation could not be sent");
    }
    const terminal = await Promise.race([settled(this.result), delay(settleMs, { state: "timeout" })]);
    if (terminal.state !== "timeout") return unwrap(terminal);
    try { await this.client.close(); } catch (error) { void error; }
    throw timeoutError("control request did not settle after cancellation");
  }
}

export class PerceptionEntity {
  constructor(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("APX entity must be an object");
    }
    this.value = value;
    Object.freeze(this);
  }

  get entityRef() { return String(this.value.entityRef || ""); }
  get locatorRef() { return this.value.locatorRef === undefined ? null : String(this.value.locatorRef); }
  get kind() { return String(this.value.kind || ""); }
  get role() { return String(this.value.semantic?.role || ""); }
  get name() { return String(this.value.semantic?.name || ""); }
  get actionable() { return this.value.interaction?.actionable === true; }
}

export class PerceptionQueryResult {
  constructor(result) {
    if (!result?.output || !Array.isArray(result.output.entities)) {
      throw new TypeError("APX observation output must contain entities");
    }
    this.result = result;
    this.observation = result.output;
    this.matches = Object.freeze(result.output.entities.map((entity) => new PerceptionEntity(entity)));
    Object.freeze(this);
  }

  one() {
    const matched = Number.isInteger(this.observation.query?.matched)
      ? this.observation.query.matched : this.matches.length;
    if (matched !== 1 || this.matches.length !== 1) {
      const received = matched === 1 ? this.matches.length : matched;
      throw new Error(`APX query expected one entity, received ${received}`);
    }
    return this.matches[0];
  }
}

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function definedEntries(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export class PerceptionClient {
  constructor(client, sessionRef = null) {
    this.client = client;
    this.sessionRef = sessionRef === null ? null : Object.freeze({ ...plainObject(sessionRef, "sessionRef") });
    Object.freeze(this);
  }

  bind(sessionRef) {
    return new PerceptionClient(this.client, sessionRef);
  }

  _session(sessionRef) {
    const selected = sessionRef || this.sessionRef;
    if (!selected) throw new TypeError("APX perception requires an attached sessionRef");
    return plainObject(selected, "sessionRef");
  }

  observe(options = {}, requestOptions = {}) {
    const { sessionRef, ...observation } = plainObject(options, "APX observation options");
    return this.client.observe(this._session(sessionRef), {
      expectedRisk: "read", representation: "apx.graph", ...observation,
    }, requestOptions);
  }

  async query(query = {}, requestOptions = {}) {
    const { sessionRef, since, channels, budget, profile, ...attention } = plainObject(query, "APX query");
    const result = await this.observe(definedEntries({ sessionRef, since, channels, budget, profile,
      query: definedEntries(attention) }), requestOptions);
    return new PerceptionQueryResult(result);
  }

  act(kind, locatorRef, options = {}, requestOptions = {}) {
    if (typeof kind !== "string" || !kind) throw new TypeError("APX action kind must be a non-empty string");
    if (typeof locatorRef !== "string" || !locatorRef) throw new TypeError("APX locatorRef must be a non-empty string");
    const { sessionRef, expectedRisk = "externalEffect", verify, ...actionOptions } = plainObject(options,
      "APX action options");
    return this.client.act(this._session(sessionRef), [{ kind, locatorRef, expectedRisk, ...actionOptions,
      ...(verify === undefined ? {} : { verify: plainObject(verify, "verify") }) }], requestOptions);
  }

  async explainActionability(entityRef, options = {}) {
    const { sessionRef, ...requestOptions } = options;
    const result = await this.query({ sessionRef, entityRef,
      channels: ["semantic", "geometry", "interaction"] }, requestOptions);
    return result.one();
  }

  whatChanged(since, options = {}, requestOptions = {}) {
    return this.observe({ ...options, since }, requestOptions);
  }
}

export class PyProcControlClient extends ControlStdioClient {
  constructor({ process: ownedProcess = null, stderr = null,
    cancelSettleTimeoutMs = DEFAULT_CANCEL_SETTLE_TIMEOUT_MS,
    shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS, ...options } = {}) {
    super(options);
    this.process = ownedProcess;
    this.cancelSettleTimeoutMs = positiveTimeout(cancelSettleTimeoutMs,
      "control cancelSettleTimeoutMs", DEFAULT_CANCEL_SETTLE_TIMEOUT_MS);
    this.shutdownTimeoutMs = positiveTimeout(shutdownTimeoutMs,
      "control shutdownTimeoutMs", DEFAULT_SHUTDOWN_TIMEOUT_MS);
    this.diagnostics = "";
    this._productClosePromise = null;
    if (stderr) {
      stderr.setEncoding?.("utf8");
      stderr.on("data", (chunk) => { this.diagnostics = (this.diagnostics + chunk).slice(-MAX_DIAGNOSTIC_BYTES); });
    }
  }

  static async start(configPath, options = {}) {
    const command = controlCommand(options.command);
    const child = spawn(command[0], [...command.slice(1), "--config", controlConfigPath(configPath)], {
      cwd: options.cwd || process.cwd(), env: options.env || process.env, windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const client = new PyProcControlClient({
      readable: child.stdout, writable: child.stdin, stderr: child.stderr, process: child,
      peer: options.peer, maxAttachmentChunkBytes: options.maxAttachmentChunkBytes,
      cancelSettleTimeoutMs: options.cancelSettleTimeoutMs, shutdownTimeoutMs: options.shutdownTimeoutMs,
    });
    child.once("error", (error) => client._fail(error));
    const startupTimeoutMs = positiveTimeout(options.startupTimeoutMs,
      "control startupTimeoutMs", DEFAULT_STARTUP_TIMEOUT_MS);
    const ready = await Promise.race([settled(client.ready), delay(startupTimeoutMs, { state: "timeout" })]);
    if (ready.state === "timeout") {
      await client.close();
      throw timeoutError(`pyproc-control hello timed out\n${client.diagnostics}`);
    }
    try { unwrap(ready); }
    catch (error) { await client.close(); throw error; }
    return client;
  }

  static check(configPath, options = {}) {
    return runCheck(configPath, options);
  }

  requestAsync(operation, input = {}, { requestId, spaceId } = {}) {
    const id = requestId || `request:${++this._sequence}`;
    const result = super.request(operation, input, { requestId: id, spaceId });
    return new ControlRequest(this, id, result);
  }

  request(operation, input = {}, { timeoutMs, cancelSettleTimeoutMs, ...options } = {}) {
    return this.requestAsync(operation, input, options).wait({ timeoutMs, cancelSettleTimeoutMs });
  }

  runPython(code, options = {}) { return this.request("machine.run", { code }, options); }
  saveCheckpoint(options = {}) { return this.request("machine.checkpoint.save", {}, options); }
  restoreCheckpoint(index, options = {}) {
    return this.request("machine.checkpoint.restore", index === undefined ? {} : { index }, options);
  }
  reset(options = {}) { return this.request("machine.reset", {}, options); }
  inspectSpace(options = {}) { return this.request("automation.space.inspect", {}, options); }
  listTargets(options = {}) { return this.request("automation.target.list", {}, options); }
  openTarget(url, { expectedRisk, waitUntil = "commit", ...options } = {}) {
    return this.request("automation.target.open", { url, expectedRisk, waitUntil }, options);
  }
  attachSession(targetRef, options = {}) {
    return this.request("automation.session.attach", { targetRef }, options);
  }
  observe(sessionRef, observation = {}, options = {}) {
    return this.request("automation.observe", { sessionRef, ...observation }, options);
  }
  act(sessionRef, actions, options = {}) {
    return this.request("automation.act", { sessionRef, actions }, options);
  }
  command(sessionRef, method, params, { expectedRisk, ...options } = {}) {
    return this.request("automation.command", { sessionRef, method, params, expectedRisk }, options);
  }
  detachSession(sessionRef, options = {}) {
    return this.request("automation.session.detach", { sessionRef }, options);
  }
  readArtifact(artifactRef, { offset, maxBytes, ...options } = {}) {
    return this.request("artifact.read", { artifactRef,
      ...(offset === undefined ? {} : { offset }), ...(maxBytes === undefined ? {} : { maxBytes }) }, options);
  }
  deleteArtifact(artifactRef, options = {}) {
    return this.request("artifact.delete", { artifactRef }, options);
  }
  perception(sessionRef = null) { return new PerceptionClient(this, sessionRef); }

  async close() {
    if (this._productClosePromise) return this._productClosePromise;
    super.close();
    this._productClosePromise = this.process
      ? waitForExit(this.process, this.shutdownTimeoutMs) : Promise.resolve();
    return this._productClosePromise;
  }
}
