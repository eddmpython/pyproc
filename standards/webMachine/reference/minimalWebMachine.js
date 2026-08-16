// Web Machine Core v1의 별도 최소 구현이다.
// 제품 source를 import하지 않으며 conformance와 설명을 위한 의존성 없는 상태 머신만 포함한다.
const machineStates = new Set(["created", "running", "paused", "stopped", "failed"]);
const snapshotScopes = new Set(["portable", "session", "none"]);
const adapterMethods = ["boot", "pause", "resume", "snapshot", "restore", "shutdown", "request", "inspect"];
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

export class MinimalWebMachineError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "MinimalWebMachineError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new MinimalWebMachineError(code, message, details);
}

function snapshotBytes(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  fail("WEB_MACHINE_SNAPSHOT_INVALID", "snapshot payload must be bytes");
}

function normalizedCapabilities(adapter) {
  if (!adapter || typeof adapter !== "object"
    || adapterMethods.some((method) => typeof adapter[method] !== "function")) {
    fail("WEB_MACHINE_ADAPTER_INVALID", "adapter method is missing");
  }
  const snapshotScope = String(adapter.capabilities?.snapshotScope || "none");
  if (!snapshotScopes.has(snapshotScope)) fail("WEB_MACHINE_ADAPTER_INVALID", "snapshot scope is invalid");
  return Object.freeze({
    adapterVersion: String(adapter.capabilities?.adapterVersion || "0"),
    snapshotScope,
    pauseMode: String(adapter.capabilities?.pauseMode || "cooperative"),
    shutdownMode: String(adapter.capabilities?.shutdownMode || "terminate"),
    requiredDevices: Object.freeze((adapter.capabilities?.requiredDevices || [])
      .map((entry) => Object.freeze({ ...entry }))),
  });
}

function operationError(control, started) {
  if (started) {
    return new MinimalWebMachineError("WEB_MACHINE_OUTCOME_UNKNOWN", "operation outcome is unknown", {
      retryable: false,
      cause: control?.signal?.reason?.name === "TimeoutError" ? "timeout" : "aborted",
    });
  }
  return new MinimalWebMachineError("WEB_MACHINE_OPERATION_ABORTED", "operation aborted", { retryable: true });
}

export class MinimalWebMachineHost {
  #adapters = new Map();
  #devices = new Map();
  #machines = new Map();
  #idFactory;

  constructor({ devices = {}, idFactory } = {}) {
    if (typeof idFactory !== "function") throw new TypeError("idFactory is required");
    this.#idFactory = idFactory;
    for (const [name, device] of Object.entries(devices)) this.registerDevice(name, device);
  }

  registerAdapter(adapterId, factory) {
    if (typeof adapterId !== "string" || !adapterId || typeof factory !== "function") {
      throw new TypeError("adapterId and factory are required");
    }
    this.#adapters.set(adapterId, factory);
    return this;
  }

  registerDevice(name, device) {
    if (typeof name !== "string" || !name || !device || typeof device.kind !== "string") {
      throw new TypeError("device name and kind are required");
    }
    this.#devices.set(name, device);
    return this;
  }

  createMachine({ machineId, adapterId, manifest = {}, permissions = { devices: [] } }) {
    if (this.#machines.has(machineId)) fail("WEB_MACHINE_DUPLICATE", "machine already exists");
    if (!this.#adapters.has(adapterId)) fail("WEB_MACHINE_ADAPTER_UNAVAILABLE", "adapter is unavailable");
    const machine = new MinimalMachine(this, {
      machineId,
      adapterId,
      manifest,
      permissions,
      instanceId: String(this.#idFactory()),
    });
    this.#machines.set(machineId, machine);
    return machine;
  }

  createAdapter(adapterId) {
    const factory = this.#adapters.get(adapterId);
    if (!factory) fail("WEB_MACHINE_ADAPTER_UNAVAILABLE", "adapter is unavailable");
    const adapter = factory();
    return { adapter, capabilities: normalizedCapabilities(adapter) };
  }

  openContext(machine, capabilities) {
    const allowed = new Set(machine.permissions.devices);
    const devices = {};
    for (const requirement of capabilities.requiredDevices) {
      const name = String(requirement.name || "");
      if (!allowed.has(name)) fail("WEB_MACHINE_DEVICE_PERMISSION_DENIED", `device permission denied: ${name}`);
      const device = this.#devices.get(name);
      if (!device) fail("WEB_MACHINE_DEVICE_MISSING", `device missing: ${name}`);
      if (requirement.kind && requirement.kind !== device.kind) {
        fail("WEB_MACHINE_DEVICE_KIND_UNSUPPORTED", `device kind mismatch: ${name}`);
      }
      if (requirement.mode && requirement.mode !== device.mode) {
        fail("WEB_MACHINE_DEVICE_MODE_UNSUPPORTED", `device mode mismatch: ${name}`);
      }
      devices[name] = device;
    }
    return Object.freeze({
      machineId: machine.machineId,
      devices: Object.freeze(devices),
      permissions: Object.freeze({ devices: Object.freeze([...allowed]) }),
    });
  }
}

class MinimalMachine {
  #host;
  #adapter = null;
  #capabilities = null;
  #context = null;
  #tail = Promise.resolve();
  #history = [];

  constructor(host, { machineId, adapterId, manifest, permissions, instanceId }) {
    this.#host = host;
    this.machineId = machineId;
    this.adapterId = adapterId;
    this.manifest = { ...manifest };
    this.permissions = { devices: [...(permissions.devices || [])] };
    this.instanceId = instanceId;
    this.state = "created";
    this.#history.push({ event: "created", state: "created" });
  }

  #expect(states, operation) {
    if (!states.includes(this.state)) {
      fail("WEB_MACHINE_INVALID_STATE", `${operation} is not allowed while ${this.state}`, {
        expected: states,
        actual: this.state,
      });
    }
  }

  #setState(state, event) {
    if (!machineStates.has(state)) throw new TypeError("unknown machine state");
    this.state = state;
    this.#history.push({ event, state });
  }

  #enqueue(operation, action, { control } = {}) {
    let started = false;
    let settled = false;
    let resolveCaller;
    let rejectCaller;
    const caller = new Promise((resolve, reject) => {
      resolveCaller = resolve;
      rejectCaller = reject;
    });
    const settle = (method, value) => {
      if (settled) return;
      settled = true;
      method(value);
    };
    const onAbort = () => settle(rejectCaller, operationError(control, started));
    control?.signal?.addEventListener("abort", onAbort, { once: true });
    if (control?.signal?.aborted) onAbort();
    const task = this.#tail.then(async () => {
      if (control?.signal?.aborted) {
        control.signal.removeEventListener("abort", onAbort);
        settle(rejectCaller, operationError(control, false));
        return;
      }
      started = true;
      try {
        const result = await action();
        settle(resolveCaller, result);
      } catch (error) {
        settle(rejectCaller, error);
      } finally {
        control?.signal?.removeEventListener("abort", onAbort);
      }
    });
    this.#tail = task.catch((error) => settle(rejectCaller, error));
    return caller;
  }

  boot(control) {
    return this.#enqueue("boot", async () => {
      this.#expect(["created", "stopped"], "boot");
      const created = this.#host.createAdapter(this.adapterId);
      const context = this.#host.openContext(this, created.capabilities);
      this.#adapter = created.adapter;
      this.#capabilities = created.capabilities;
      this.#context = context;
      try {
        await this.#adapter.boot(context, this.manifest, control);
        this.#setState("running", "booted");
        return this.inspectNow();
      } catch (error) {
        this.#setState("failed", "bootFailed");
        throw error;
      }
    }, { control });
  }

  pause(control) {
    return this.#enqueue("pause", async () => {
      this.#expect(["running"], "pause");
      await this.#adapter.pause(control);
      this.#setState("paused", "paused");
      return this.inspectNow();
    }, { control });
  }

  resume(control) {
    return this.#enqueue("resume", async () => {
      this.#expect(["paused"], "resume");
      await this.#adapter.resume(control);
      this.#setState("running", "resumed");
      return this.inspectNow();
    }, { control });
  }

  request(message, control) {
    return this.#enqueue("request", async () => {
      this.#expect(["running"], "request");
      return this.#adapter.request(message, control);
    }, { control });
  }

  snapshot(control) {
    return this.#enqueue("snapshot", async () => {
      this.#expect(["paused"], "snapshot");
      if (this.#capabilities.snapshotScope === "none") {
        fail("WEB_MACHINE_SNAPSHOT_UNSUPPORTED", "snapshot is unsupported");
      }
      return Object.freeze({
        schemaVersion: 1,
        machineId: this.machineId,
        adapterId: this.adapterId,
        adapterVersion: this.#capabilities.adapterVersion,
        snapshotScope: this.#capabilities.snapshotScope,
        originInstanceId: this.instanceId,
        payload: snapshotBytes(await this.#adapter.snapshot(control)),
      });
    }, { control });
  }

  restore(envelope, control) {
    return this.#enqueue("restore", async () => {
      this.#expect(["created", "paused", "stopped"], "restore");
      if (!envelope || envelope.schemaVersion !== 1) fail("WEB_MACHINE_SNAPSHOT_INVALID", "schema mismatch");
      if (envelope.machineId !== this.machineId || envelope.adapterId !== this.adapterId) {
        fail("WEB_MACHINE_SNAPSHOT_INCOMPATIBLE", "snapshot identity mismatch");
      }
      const cold = this.state === "created" || this.state === "stopped";
      if (cold && envelope.snapshotScope !== "portable") {
        fail("WEB_MACHINE_SNAPSHOT_SCOPE", "only portable snapshots can be cold restored");
      }
      if (cold) {
        const created = this.#host.createAdapter(this.adapterId);
        const context = this.#host.openContext(this, created.capabilities);
        if (created.capabilities.adapterVersion !== envelope.adapterVersion
          || created.capabilities.snapshotScope !== envelope.snapshotScope) {
          fail("WEB_MACHINE_SNAPSHOT_INCOMPATIBLE", "adapter capability mismatch");
        }
        this.#adapter = created.adapter;
        this.#capabilities = created.capabilities;
        this.#context = context;
      } else if (envelope.snapshotScope === "session" && envelope.originInstanceId !== this.instanceId) {
        fail("WEB_MACHINE_SNAPSHOT_SCOPE", "snapshot belongs to another instance");
      }
      await this.#adapter.restore(snapshotBytes(envelope.payload), this.#context, this.manifest, control);
      this.#setState("paused", "restored");
      return this.inspectNow();
    }, { control });
  }

  shutdown(control) {
    return this.#enqueue("shutdown", async () => {
      this.#expect(["created", "running", "paused", "failed"], "shutdown");
      if (this.#adapter) await this.#adapter.shutdown(control);
      this.#adapter = null;
      this.#context = null;
      this.#setState("stopped", "shutdown");
      return this.inspectNow();
    }, { control });
  }

  inspect() {
    return this.#enqueue("inspect", async () => this.inspectNow());
  }

  inspectNow() {
    return {
      machineId: this.machineId,
      adapterId: this.adapterId,
      instanceId: this.instanceId,
      state: this.state,
      capabilities: this.#capabilities ? { ...this.#capabilities } : null,
      guest: this.#adapter ? this.#adapter.inspect() : null,
      history: this.#history.map((entry) => ({ ...entry })),
    };
  }
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(value || {}).sort().join(",");
  const expected = [...keys].sort().join(",");
  if (actual !== expected) fail("WEB_MACHINE_IMAGE_MANIFEST_INVALID", `${label} key mismatch`);
}

const utf8Encoder = new TextEncoder();

function compareUtf8(left, right) {
  const leftBytes = utf8Encoder.encode(String(left));
  const rightBytes = utf8Encoder.encode(String(right));
  const length = Math.min(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index++) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }
  return leftBytes.byteLength - rightBytes.byteLength;
}

function sortNames(values, key) {
  return [...values].sort((left, right) => compareUtf8(left[key], right[key]));
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value || value.length > 256) {
    fail("WEB_MACHINE_IMAGE_MANIFEST_INVALID", `${label} must be a non-empty string`);
  }
  return value;
}

function stringList(value, label) {
  if (!Array.isArray(value)) fail("WEB_MACHINE_IMAGE_MANIFEST_INVALID", `${label} must be an array`);
  const copied = value.map((entry, index) => requiredString(entry, `${label}[${index}]`));
  if (new Set(copied).size !== copied.length) fail("WEB_MACHINE_IMAGE_MANIFEST_INVALID", `${label} must be unique`);
  return copied.sort(compareUtf8);
}

function jsonValue(value, label) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry, index) => jsonValue(entry, `${label}[${index}]`));
  if (value && typeof value === "object") {
    const copied = {};
    for (const key of Object.keys(value).sort()) copied[key] = jsonValue(value[key], `${label}.${key}`);
    return copied;
  }
  fail("WEB_MACHINE_IMAGE_MANIFEST_INVALID", `${label} must contain only JSON values`);
}

function machineRecord(value, index) {
  exactKeys(value, [
    "machineId", "adapterId", "adapterVersion", "snapshotScope", "requiredCapabilities",
    "permissions", "guestManifest", "payload",
  ], `machines[${index}]`);
  exactKeys(value.permissions, ["devices"], `machines[${index}].permissions`);
  exactKeys(value.payload, ["blobId"], `machines[${index}].payload`);
  if (value.snapshotScope !== "portable") fail("WEB_MACHINE_IMAGE_MANIFEST_INVALID", "machine scope must be portable");
  const guestManifest = jsonValue(value.guestManifest, `machines[${index}].guestManifest`);
  if (!guestManifest || Array.isArray(guestManifest) || typeof guestManifest !== "object") {
    fail("WEB_MACHINE_IMAGE_MANIFEST_INVALID", "guest manifest must be an object");
  }
  return {
    machineId: requiredString(value.machineId, "machineId"),
    adapterId: requiredString(value.adapterId, "adapterId"),
    adapterVersion: requiredString(value.adapterVersion, "adapterVersion"),
    snapshotScope: "portable",
    requiredCapabilities: stringList(value.requiredCapabilities, "requiredCapabilities"),
    permissions: { devices: stringList(value.permissions.devices, "permissions.devices") },
    guestManifest,
    payload: { blobId: requiredString(value.payload.blobId, "payload.blobId") },
  };
}

function deviceRecord(value, index) {
  exactKeys(value, ["name", "kind", "byteLength", "payload"], `devices[${index}]`);
  exactKeys(value.payload, ["blobId"], `devices[${index}].payload`);
  if (value.kind !== "block" || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1) {
    fail("WEB_MACHINE_IMAGE_MANIFEST_INVALID", "device record mismatch");
  }
  return {
    name: requiredString(value.name, "device.name"),
    kind: "block",
    byteLength: value.byteLength,
    payload: { blobId: requiredString(value.payload.blobId, "device.payload.blobId") },
  };
}

function blobRecord(value, index) {
  exactKeys(value, ["blobId", "byteLength", "digest"], `blobs[${index}]`);
  if (!Number.isSafeInteger(value.byteLength) || value.byteLength < 0 || !digestPattern.test(value.digest)) {
    fail("WEB_MACHINE_IMAGE_MANIFEST_INVALID", "blob record mismatch");
  }
  return {
    blobId: requiredString(value.blobId, "blob.blobId"),
    byteLength: value.byteLength,
    digest: value.digest,
  };
}

export function normalizeMinimalImageContent(value) {
  exactKeys(value, ["format", "schemaVersion", "groupId", "createdAt", "machines", "devices", "blobs"], "content");
  if (value.format !== "webmachine" || value.schemaVersion !== 1 || !Array.isArray(value.machines)
    || !value.machines.length || !Array.isArray(value.devices) || !Array.isArray(value.blobs)
    || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) {
    fail("WEB_MACHINE_IMAGE_MANIFEST_INVALID", "image identity mismatch");
  }
  const machines = sortNames(value.machines.map(machineRecord), "machineId");
  const devices = sortNames(value.devices.map(deviceRecord), "name");
  const blobs = sortNames(value.blobs.map(blobRecord), "blobId");
  const references = [
    ...machines.map((entry) => entry.payload?.blobId),
    ...devices.map((entry) => entry.payload?.blobId),
  ];
  if (new Set(machines.map((entry) => entry.machineId)).size !== machines.length
    || new Set(devices.map((entry) => entry.name)).size !== devices.length
    || new Set(blobs.map((entry) => entry.blobId)).size !== blobs.length
    || new Set(references).size !== references.length
    || references.length !== blobs.length
    || references.some((reference) => !blobs.some((entry) => entry.blobId === reference))
    || devices.some((device) => blobs.find((blob) => blob.blobId === device.payload.blobId)?.byteLength !== device.byteLength)) {
    fail("WEB_MACHINE_IMAGE_MANIFEST_INVALID", "portable image graph mismatch");
  }
  return Object.freeze({
    format: "webmachine",
    schemaVersion: 1,
    groupId: requiredString(value.groupId, "groupId"),
    createdAt: value.createdAt,
    machines: Object.freeze(machines),
    devices: Object.freeze(devices),
    blobs: Object.freeze(blobs),
  });
}

export function createMinimalSignedImage(content, { contentDigest, signature }) {
  const normalized = normalizeMinimalImageContent(content);
  exactKeys(signature, ["version", "algorithm", "publicKey", "value"], "signature");
  exactKeys(signature.publicKey, ["kty", "crv", "x", "y"], "signature.publicKey");
  if (!digestPattern.test(contentDigest || "") || signature?.version !== 1
    || signature.algorithm !== "ECDSA-P256-SHA256" || signature.publicKey?.kty !== "EC"
    || signature.publicKey?.crv !== "P-256" || typeof signature.publicKey.x !== "string"
    || typeof signature.publicKey.y !== "string" || !/^(?:[0-9a-f]{2})+$/u.test(signature.value || "")) {
    fail("WEB_MACHINE_IMAGE_MANIFEST_INVALID", "signed image structure mismatch");
  }
  return Object.freeze({
    ...normalized,
    integrity: Object.freeze({ algorithm: "SHA-256", contentDigest }),
    signature: Object.freeze({ ...signature, publicKey: Object.freeze({ ...signature.publicKey }) }),
  });
}

function fixtureGuest({ options, metrics, deferred }) {
  let value = Number(options.initialValue || 0);
  return {
    capabilities: {
      adapterVersion: "1",
      snapshotScope: options.snapshotScope || "portable",
      pauseMode: "strong",
      shutdownMode: "terminate",
      requiredDevices: options.requiredDevices || [],
    },
    async boot() { metrics.boots += 1; },
    async pause() {},
    async resume() {},
    async snapshot() { return new TextEncoder().encode(JSON.stringify({ value })); },
    async restore(payload) { value = JSON.parse(new TextDecoder().decode(payload)).value; },
    async shutdown() {},
    async request(message) {
      if (message.type === "get") return value;
      if (message.type === "increment") { metrics.executions += 1; value += Number(message.by || 1); return value; }
      if (message.type === "deferredIncrement") {
        metrics.executions += 1;
        value += Number(message.by || 1);
        deferred.started();
        await deferred.wait;
        return value;
      }
      throw new TypeError("unsupported fixture request");
    },
    inspect() { return { value }; },
  };
}

function conformanceFixture(options = {}) {
  const metrics = { boots: 0, executions: 0 };
  let startedResolve;
  let releaseResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const wait = new Promise((resolve) => { releaseResolve = resolve; });
  const adapterFactory = () => {
    const adapter = fixtureGuest({ options, metrics, deferred: { started: startedResolve, wait } });
    if (options.missingMethod) delete adapter[options.missingMethod];
    return adapter;
  };
  let instanceSequence = 0;
  const makeHost = () => new MinimalWebMachineHost({
    devices: options.devices || { console: { kind: "console" } },
    idFactory: () => `reference-${++instanceSequence}`,
  }).registerAdapter("fixture", adapterFactory);
  const createMachine = (host = makeHost()) => host.createMachine({
    machineId: "machine",
    adapterId: "fixture",
    manifest: { initialValue: options.initialValue || 0 },
    permissions: { devices: options.permissions || [] },
  });
  return {
    machine: createMachine(),
    metrics,
    waitForDeferredStart: () => started,
    releaseDeferred: () => releaseResolve(),
    createColdMachine: () => createMachine(),
    normalizeImageContent: normalizeMinimalImageContent,
    createSignedImage: createMinimalSignedImage,
  };
}

export function createReferenceConformanceFactory() {
  return Object.freeze({ createFixture: conformanceFixture });
}
