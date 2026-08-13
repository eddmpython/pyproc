import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const binaryDir = resolve(here, "nativeHost", "target", "debug");
const hostPath = resolve(binaryDir, "pyproc-windows-motor-host.exe");
const fixturePath = resolve(binaryDir, "motor-fixture.exe");
const sourcePath = resolve(here, "nativeHost", "src", "main.rs");
const protocol = "pyproc.windowsMotorHost";
const digestA = "a".repeat(64);
const digestB = "b".repeat(64);
let passed = 0;

function check(name, operation) {
  return Promise.resolve().then(operation).then(() => {
    passed += 1;
    console.log(`  PASS ${name}`);
  });
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function waitForExit(child, timeout = 3000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => rejectExit(new Error("child process did not exit")), timeout);
    child.once("exit", (code) => { clearTimeout(timer); resolveExit(code); });
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await waitForExit(child).catch(() => child.kill("SIGKILL"));
}

async function launchFixture({ duplicate = false } = {}) {
  const child = spawn(fixturePath, duplicate ? ["--duplicate"] : [], {
    stdio: ["ignore", "pipe", "pipe"], windowsHide: false,
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const line = await new Promise((resolveLine, rejectLine) => {
    let stdout = "";
    const timer = setTimeout(() => rejectLine(new Error(`fixture readiness timed out: ${stderr}`)), 5000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf("\n");
      if (newline !== -1) {
        clearTimeout(timer);
        resolveLine(stdout.slice(0, newline).trim());
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      rejectLine(new Error(`fixture exited before readiness (${code}): ${stderr}`));
    });
  });
  await wait(150);
  return { child, ready: JSON.parse(line) };
}

class HostClient {
  constructor(bootstrapCapability) {
    this.bootstrapCapability = bootstrapCapability;
    this.sequence = 0;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.stderr = "";
    this.child = spawn(hostPath, [], {
      env: { ...process.env, PYPROC_NATIVE_BOOTSTRAP: bootstrapCapability },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => { this.stderr += chunk; });
    this.child.stdout.on("data", (chunk) => this.onData(chunk));
    this.child.once("exit", (code) => {
      for (const { reject } of this.pending.values()) {
        reject(new Error(`native host exited (${code}): ${this.stderr}`));
      }
      this.pending.clear();
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (this.buffer.length < length + 4) return;
      const response = JSON.parse(this.buffer.subarray(4, length + 4).toString("utf8"));
      this.buffer = this.buffer.subarray(length + 4);
      const pending = this.pending.get(response.requestId);
      if (!pending) throw new Error(`unexpected native response ${response.requestId}`);
      this.pending.delete(response.requestId);
      pending.resolve(response);
    }
  }

  request(operation, input = {}, bootstrapCapability) {
    const requestId = `request:${++this.sequence}`;
    const request = { protocol, version: 1, requestId, operation, input };
    if (bootstrapCapability !== undefined) request.bootstrapCapability = bootstrapCapability;
    const bytes = Buffer.from(JSON.stringify(request));
    const frame = Buffer.allocUnsafe(bytes.length + 4);
    frame.writeUInt32LE(bytes.length, 0);
    bytes.copy(frame, 4);
    return new Promise((resolveRequest, rejectRequest) => {
      this.pending.set(requestId, { resolve: resolveRequest, reject: rejectRequest });
      this.child.stdin.write(frame, (error) => {
        if (!error) return;
        this.pending.delete(requestId);
        rejectRequest(error);
      });
    });
  }

  async close() {
    if (this.child.exitCode !== null) return;
    this.child.stdin.end();
    await waitForExit(this.child).catch(() => stop(this.child));
  }
}

function bindInput(ready, target = { name: "Save", controlType: "button" }, surfaceEpoch = "surface:1") {
  return { processId: ready.processId, windowTitle: ready.windowTitle, surfaceEpoch, target };
}

function accessibilityInput(bindingRef, surfaceEpoch = "surface:1") {
  return { bindingRef, planSha256: digestA, intentSha256: digestB, intent: "activate", desired: {},
    surfaceEpoch, postcondition: { name: "saved", controlType: "text" } };
}

function osInput(bindingRef, ready, inputEpoch, leaseRef = "controlLease:valid", surfaceEpoch = "surface:1") {
  return { bindingRef, planSha256: digestA, intentSha256: digestB, intent: "activate", surfaceEpoch,
    lease: { leaseRef, intentSha256: digestB, surfaceEpoch, processId: ready.processId,
      expiresAt: Date.now() + 30_000, userInputEpoch: inputEpoch, cancelOnUserInput: true },
    postcondition: { name: "saved", controlType: "text" } };
}

function forbiddenNativeDetail(value) {
  const forbidden = new Set(["hwnd", "runtimeId", "coordinates", "coordinate", "x", "y"]);
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) return key;
    const nested = forbiddenNativeDetail(child);
    if (nested) return nested;
  }
  return null;
}

if (process.platform !== "win32") {
  console.log("Proof-Carrying Motor Windows native probe skipped outside Windows");
  process.exit(0);
}

console.log("Proof-Carrying Motor Windows native probe");
const source = await readFile(sourcePath, "utf8");
await check("native host has no network listener or shell command surface", () => {
  assert.equal(source.includes("std::net"), false);
  assert.equal(source.includes("Command::new"), false);
});

let fixture;
let substitute;
const client = new HostClient(randomBytes(32).toString("hex"));
try {
  fixture = await launchFixture();
  const hello = await client.request("hello", {}, client.bootstrapCapability);
  await check("single-use bootstrap authenticates only the first frame", async () => {
    assert.equal(hello.ok, true);
    const reused = await client.request("hello", {}, client.bootstrapCapability);
    assert.equal(reused.ok, false);
    assert.equal(reused.error.code, "NATIVE_BOOTSTRAP_INVALID");
  });

  const inspection = await client.request("inspect");
  await check("host reports UIA, physical observer, and no listener", () => {
    assert.equal(inspection.ok, true);
    assert.deepEqual({ accessibility: inspection.output.accessibility, osInput: inspection.output.osInput,
      observer: inspection.output.physicalUserInputObserver, listener: inspection.output.listener },
    { accessibility: true, osInput: true, observer: true, listener: false });
  });

  const bound = await client.request("bind", bindInput(fixture.ready));
  await check("foreground UIA binding is exact, unique, semantic, and handle-free", () => {
    assert.equal(bound.ok, true, JSON.stringify(bound));
    assert.equal(bound.output.candidateCount, 1);
    assert.equal(bound.output.uniqueness, "unique");
    assert.equal(bound.output.supportedIntents.includes("activate"), true);
    assert.equal(forbiddenNativeDetail(bound), null);
  });

  const accessibility = await client.request("executeAccessibility",
    accessibilityInput(bound.output.bindingRef));
  await check("UIA Invoke reaches the semantic postcondition", () => {
    assert.equal(accessibility.ok, true);
    assert.equal(accessibility.output.terminal, "confirmed");
    assert.equal(accessibility.output.providerCalls, 1);
  });

  const rawInput = osInput(bound.output.bindingRef, fixture.ready, bound.output.inputEpoch,
    "controlLease:raw-coordinate");
  rawInput.x = 20;
  await check("raw coordinate input is rejected before effect", async () => {
    const rejected = await client.request("executeOsInput", rawInput);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "NATIVE_INPUT_INVALID");
    assert.equal(rejected.error.outcome, "notSent");
  });

  await stop(fixture.child);
  fixture = await launchFixture();
  const osBinding = await client.request("bind", bindInput(fixture.ready, undefined, "surface:2"));
  assert.equal(osBinding.ok, true);

  await check("stale physical-input epoch revokes the lease before contact", async () => {
    const stale = await client.request("executeOsInput", osInput(osBinding.output.bindingRef, fixture.ready,
      osBinding.output.inputEpoch + 1, "controlLease:stale", "surface:2"));
    assert.equal(stale.ok, false);
    assert.equal(stale.error.code, "NATIVE_USER_PREEMPTED");
    assert.equal(stale.error.outcome, "notSent");
    const idle = await client.request("bind", bindInput(fixture.ready,
      { name: "idle", controlType: "text" }, "surface:2"));
    assert.equal(idle.ok, true);
  });

  const osRequest = osInput(osBinding.output.bindingRef, fixture.ready, osBinding.output.inputEpoch,
    "controlLease:one-shot", "surface:2");
  const physical = await client.request("executeOsInput", osRequest);
  await check("SendInput activates once under exact foreground and ControlLease", () => {
    assert.equal(physical.ok, true);
    assert.equal(physical.output.terminal, "confirmed");
    assert.equal(physical.output.providerCalls, 1);
    assert.equal(physical.output.safetyRelease, true);
  });

  await check("a consumed ControlLease cannot send a second effect", async () => {
    const replayed = await client.request("executeOsInput", osRequest);
    assert.equal(replayed.ok, false);
    assert.equal(replayed.error.code, "NATIVE_CONTROL_LEASE_CONSUMED");
    assert.equal(replayed.error.outcome, "notSent");
  });

  substitute = await launchFixture();
  await check("foreground window substitution blocks a stale process binding", async () => {
    const latest = await client.request("inspect");
    const rejected = await client.request("executeOsInput", osInput(osBinding.output.bindingRef, fixture.ready,
      latest.output.inputEpoch, "controlLease:substituted", "surface:2"));
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "NATIVE_FOREGROUND_MISMATCH");
    assert.equal(rejected.error.outcome, "notSent");
  });
  await stop(substitute.child);
  substitute = null;
  await stop(fixture.child);
  fixture = await launchFixture({ duplicate: true });

  await check("duplicate semantic candidates never produce a binding capability", async () => {
    const ambiguous = await client.request("bind", bindInput(fixture.ready, undefined, "surface:3"));
    assert.equal(ambiguous.ok, false);
    assert.equal(ambiguous.error.code, "NATIVE_TARGET_AMBIGUOUS");
    assert.equal(ambiguous.error.outcome, "notSent");
  });

  await check("unsupported UIA pattern cannot be reported as successful", async () => {
    const text = await client.request("bind", bindInput(fixture.ready,
      { name: "idle", controlType: "text" }, "surface:3"));
    assert.equal(text.ok, true);
    assert.equal(text.output.supportedIntents.includes("activate"), false);
    const rejected = await client.request("executeAccessibility",
      accessibilityInput(text.output.bindingRef, "surface:3"));
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "NATIVE_PATTERN_UNAVAILABLE");
    assert.equal(rejected.error.outcome, "notSent");
  });
} finally {
  await stop(substitute?.child);
  await stop(fixture?.child);
  await client.close();
}

console.log(`Proof-Carrying Motor Windows native probe: ${passed}/${passed} passed`);
