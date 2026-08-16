import { WEB_MACHINE_CORE_VECTORS } from "../vectors/coreVectors.js";

function errorCode(error) {
  return error?.code || error?.name || "UNKNOWN_ERROR";
}

async function capturedError(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error("expected operation to fail");
}

function imageContent() {
  const digest = `sha256:${"0".repeat(64)}`;
  const machine = (machineId, blobId) => ({
    machineId,
    adapterId: "fixture",
    adapterVersion: "1",
    snapshotScope: "portable",
    requiredCapabilities: [],
    permissions: { devices: [] },
    guestManifest: {},
    payload: { blobId },
  });
  return {
    format: "webmachine",
    schemaVersion: 1,
    groupId: "conformance",
    createdAt: 0,
    machines: [machine("b", "blob-b"), machine("a", "blob-a")],
    devices: [{ name: "disk", kind: "block", byteLength: 3, payload: { blobId: "blob-disk" } }],
    blobs: [
      { blobId: "blob-disk", byteLength: 3, digest },
      { blobId: "blob-b", byteLength: 2, digest },
      { blobId: "blob-a", byteLength: 1, digest },
    ],
  };
}

const signature = Object.freeze({
  version: 1,
  algorithm: "ECDSA-P256-SHA256",
  publicKey: Object.freeze({ kty: "EC", crv: "P-256", x: "x", y: "y" }),
  value: "00",
});

const scenarios = Object.freeze({
  async lifecycle(factory) {
    const fixture = factory.createFixture({ initialValue: 2 });
    const transcript = [(await fixture.machine.inspect()).state];
    transcript.push((await fixture.machine.boot()).state);
    transcript.push(await fixture.machine.request({ type: "get" }));
    transcript.push(await fixture.machine.request({ type: "increment", by: 3 }));
    transcript.push(errorCode(await capturedError(() => fixture.machine.snapshot())));
    transcript.push((await fixture.machine.pause()).state);
    transcript.push(errorCode(await capturedError(() => fixture.machine.request({ type: "get" }))));
    transcript.push((await fixture.machine.resume()).state);
    transcript.push((await fixture.machine.shutdown()).state);
    return transcript;
  },

  async adapterContract(factory) {
    const fixture = factory.createFixture({ missingMethod: "resume" });
    const error = await capturedError(() => fixture.machine.boot());
    return [errorCode(error), fixture.metrics.boots];
  },

  async devicePermission(factory) {
    const fixture = factory.createFixture({
      requiredDevices: [{ name: "console", kind: "console" }],
      permissions: [],
    });
    const error = await capturedError(() => fixture.machine.boot());
    return [errorCode(error), fixture.metrics.boots];
  },

  async serializedRequests(factory) {
    const fixture = factory.createFixture();
    await fixture.machine.boot();
    const first = fixture.machine.request({ type: "deferredIncrement", by: 1 });
    await fixture.waitForDeferredStart();
    const second = fixture.machine.request({ type: "increment", by: 1 });
    const beforeRelease = fixture.metrics.executions;
    fixture.releaseDeferred();
    const firstResult = await first;
    const secondResult = await second;
    return [beforeRelease, firstResult, secondResult, fixture.metrics.executions];
  },

  async portableImage(factory) {
    const fixture = factory.createFixture({ initialValue: 4, snapshotScope: "portable" });
    await fixture.machine.boot();
    await fixture.machine.request({ type: "increment", by: 3 });
    await fixture.machine.pause();
    const envelope = await fixture.machine.snapshot();
    await fixture.machine.shutdown();
    const cold = fixture.createColdMachine();
    const restored = await cold.restore(envelope);
    await cold.resume();
    return [
      envelope.schemaVersion,
      envelope.machineId,
      envelope.adapterId,
      envelope.adapterVersion,
      envelope.snapshotScope,
      restored.state,
      await cold.request({ type: "get" }),
    ];
  },

  async sessionImage(factory) {
    const fixture = factory.createFixture({ snapshotScope: "session" });
    await fixture.machine.boot();
    await fixture.machine.pause();
    const envelope = await fixture.machine.snapshot();
    await fixture.machine.shutdown();
    const error = await capturedError(() => fixture.createColdMachine().restore(envelope));
    return [envelope.snapshotScope, errorCode(error)];
  },

  async prestartAbort(factory) {
    const fixture = factory.createFixture();
    await fixture.machine.boot();
    const first = fixture.machine.request({ type: "deferredIncrement", by: 1 });
    await fixture.waitForDeferredStart();
    const controller = new AbortController();
    controller.abort();
    const second = fixture.machine.request({ type: "increment", by: 1 }, { signal: controller.signal });
    fixture.releaseDeferred();
    const firstResult = await first;
    const error = await capturedError(() => second);
    return [firstResult, errorCode(error), error.details?.retryable, fixture.metrics.executions];
  },

  async poststartAbort(factory) {
    const fixture = factory.createFixture();
    await fixture.machine.boot();
    const controller = new AbortController();
    const request = fixture.machine.request(
      { type: "deferredIncrement", by: 1 },
      { signal: controller.signal },
    );
    await fixture.waitForDeferredStart();
    controller.abort();
    const error = await capturedError(() => request);
    fixture.releaseDeferred();
    await fixture.machine.inspect();
    return [
      errorCode(error),
      error.details?.retryable,
      fixture.metrics.executions,
      await fixture.machine.request({ type: "get" }),
    ];
  },

  async imageManifest(factory) {
    const content = imageContent();
    const normalized = factory.createFixture().normalizeImageContent(content);
    const signed = factory.createFixture().createSignedImage(content, {
      contentDigest: `sha256:${"1".repeat(64)}`,
      signature,
    });
    const invalid = imageContent();
    invalid.machines[1].payload.blobId = "blob-b";
    const error = await capturedError(() => factory.createFixture().normalizeImageContent(invalid));
    const wrongLength = imageContent();
    wrongLength.devices[0].byteLength = 4;
    const lengthError = await capturedError(() => factory.createFixture().normalizeImageContent(wrongLength));
    return [
      normalized.machines.map((entry) => entry.machineId).join(","),
      normalized.devices.map((entry) => entry.name).join(","),
      normalized.blobs.map((entry) => entry.blobId).join(","),
      signed.signature.algorithm,
      errorCode(error),
      errorCode(lengthError),
    ];
  },
});

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateProtocolCoverage(requirements, vectors = WEB_MACHINE_CORE_VECTORS) {
  const known = new Set(requirements);
  if (known.size !== requirements.length) throw new Error("protocol requirement identifiers must be unique");
  const covered = new Set();
  for (const vector of vectors) {
    if (!scenarios[vector.scenario]) throw new Error(`${vector.id}: unknown scenario ${vector.scenario}`);
    for (const requirement of vector.covers) {
      if (!known.has(requirement)) throw new Error(`${vector.id}: unknown requirement ${requirement}`);
      covered.add(requirement);
    }
  }
  const missing = requirements.filter((requirement) => !covered.has(requirement));
  if (missing.length) throw new Error(`requirements without vectors: ${missing.join(", ")}`);
  return Object.freeze({ requirements: requirements.length, vectors: vectors.length });
}

export async function runVector(factory, vector) {
  const transcript = await scenarios[vector.scenario](factory);
  if (!sameValue(transcript, vector.expected)) {
    throw new Error(`${vector.id}: transcript ${JSON.stringify(transcript)} != ${JSON.stringify(vector.expected)}`);
  }
  return Object.freeze({ id: vector.id, transcript: Object.freeze(transcript) });
}

export async function runConformance(factory) {
  const results = [];
  for (const vector of WEB_MACHINE_CORE_VECTORS) results.push(await runVector(factory, vector));
  return Object.freeze(results);
}
