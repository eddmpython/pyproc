import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendAutomationRecordingEntry,
  AUTOMATION_RECORDING_MAX_ARTIFACT_BYTES,
  createAutomationRecording,
  loadAutomationRecording,
  sealAutomationRecording,
  verifyAutomationRecording,
} from "../../scripts/automationSpace/automationRecording.js";
import { AutomationSpaceRouter } from "../../scripts/automationSpace/automationSpace.js";
import { RecordingSpace } from "../../scripts/automationSpace/recordingSpace.js";
import { ReplaySpace } from "../../scripts/automationSpace/replaySpace.js";
import { ControlHost } from "../../scripts/controlProtocol/controlHost.js";
import { controlBase } from "../../scripts/controlProtocol/controlProtocol.js";
import { apxDigest } from "../../scripts/perception/apxCanonical.js";
import { assertApxObservation } from "../../scripts/perception/apxCatalog.js";

async function errorOf(operation) {
  try { await operation(); return null; } catch (error) { return error; }
}

export async function assertAutomationRecordingContract() {
  const root = await mkdtemp(join(tmpdir(), "pyprocRecordingContract-"));
  const file = join(root, "recording.json");
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const sha256 = createHash("sha256").update(png).digest("hex");
  const apxEntity = { entityRef: "entity:recorded_status", kind: "ui.status",
    semantic: { role: "status", name: "Saved", states: {} },
    provenance: { semantic: { mode: "reported", source: "fixture", trust: "page" } } };
  let apxObservationBody = {
    protocol: "apx", version: "1.0", representation: "apx.graph", profile: ["apx-core/1", "apx-web/1"],
    kind: "full", spaceRef: "space:recordingContract", targetRef: "target:recorded",
    sessionRef: "session:recorded", observationRef: "observation:recorded_status", documentEpoch: 1,
    capturedAt: "2026-08-12T00:00:00.000Z", page: { url: "https://recording.example/", title: "Recorded",
      viewport: { width: 800, height: 600, scale: 1 }, scroll: { x: 0, y: 0 } },
    channels: ["semantic"], entities: [apxEntity], relations: [], events: [], unresolved: [],
    completeness: { semantic: "complete", visual: "notRequested" },
    budget: { maxEntities: 20, maxRelations: 20, maxBytes: 16384, usedBytes: 0,
      truncated: false, omitted: { entities: 0, relations: 0, visualProbes: 0 } },
    integrity: { canonicalSha256: "0".repeat(64), graphSha256: apxDigest({ entities: [apxEntity], relations: [] }) },
  };
  for (let pass = 0; pass < 2; pass += 1) {
    apxObservationBody = { ...apxObservationBody, budget: { ...apxObservationBody.budget,
      usedBytes: Buffer.byteLength(JSON.stringify(apxObservationBody)) } };
  }
  const apxObservation = Object.freeze({ ...apxObservationBody, integrity: {
    ...apxObservationBody.integrity,
    canonicalSha256: apxDigest({ ...apxObservationBody,
      integrity: { ...apxObservationBody.integrity, canonicalSha256: null } }),
  } });
  assertApxObservation(apxObservation);
  const actionEvidence = Object.freeze({ evidenceRef: "evidence:recorded", actionRef: "action:recorded",
    beforeObservationRef: "observation:before", afterObservationRef: apxObservation.observationRef,
    effectOutcome: "applied", verification: Object.freeze({ state: "confirmed",
      postcondition: { entityAppeared: { role: "status", nameContains: "Saved" } },
      evidenceRefs: Object.freeze([apxEntity.entityRef]) }) });
  let effects = 0;
  const authorities = new WeakSet();
  const provider = {
    spaceId: "space:recordingContract",
    providerKind: "fakeSpace",
    operations: ["automation.space.inspect", "automation.observe", "automation.act"],
    capabilities: ["screenshot"],
    replayBoundary: "recordOnly",
    config: { targetOrigins: ["https://recording.example"], actions: ["snapshot", "screenshot"],
      rawMethods: [], maxRisk: "read" },
    authorize(operation) {
      const authority = { operation };
      authorities.add(authority);
      return authority;
    },
    execute(operation, input, { authority }) {
      assert.equal(authorities.has(authority), true);
      authorities.delete(authority);
      if (operation === "automation.space.inspect") return { transport: "fake" };
      effects += 1;
      if (input.fail) {
        const error = new Error("recorded unknown result");
        error.code = "RECORDED_UNKNOWN";
        error.outcome = "outcomeUnknown";
        error.retryable = false;
        error.actionability = { reason: "covered" };
        error.trace = { phase: "contract" };
        error.actionEvidence = { ...actionEvidence, effectOutcome: "outcomeUnknown",
          verification: { ...actionEvidence.verification, state: "outcomeUnknown" } };
        throw error;
      }
      if (operation === "automation.observe") {
        return input.representation === "apx.graph" ? apxObservation : { title: "recorded" };
      }
      if (input.evidence === true) return { actions: [{ result: { evidence: actionEvidence } }] };
      return { results: [{ kind: "screenshot", artifactRef: "artifact:recording_contract",
        mimeType: "image/png", byteLength: png.byteLength, sha256, dataBase64: png.toString("base64") }] };
    },
    async close() {},
  };
  try {
    const recordingRouter = new AutomationSpaceRouter(await RecordingSpace.open({ provider, file }));
    const locked = await errorOf(() => RecordingSpace.open({ provider, file, overwrite: true }));
    assert.equal(locked?.code, "AUTOMATION_RECORDING_LOCKED");
    const inspected = await recordingRouter.invoke("automation.space.inspect", {});
    assert.equal(inspected.recording.mode, "record");
    assert.deepEqual(await recordingRouter.invoke("automation.observe", { expectedRisk: "read" }), { title: "recorded" });
    assert.deepEqual(await recordingRouter.invoke("automation.observe", {
      expectedRisk: "read", representation: "apx.graph",
    }), apxObservation);
    const recordedEvidence = await recordingRouter.invoke("automation.act", { evidence: true });
    assert.deepEqual(recordedEvidence.actions[0].result.evidence, actionEvidence);
    const captured = await recordingRouter.invoke("automation.act", {
      actions: [{ kind: "screenshot", expectedRisk: "read" }],
    });
    assert.equal(captured.results[0].dataBase64, png.toString("base64"));
    const recordedError = await errorOf(() => recordingRouter.invoke("automation.act", { fail: true }));
    assert.equal(recordedError?.outcome, "outcomeUnknown");
    await recordingRouter.close();

    const recording = await loadAutomationRecording(file);
    const originalGeneration = recording.artifactGeneration;
    assert.equal(recording.entries.length, 5);
    assert.equal(recording.complete, true);
    assert.equal(Object.hasOwn(recording.artifacts["artifact:recording_contract"], "dataBase64"), false);
    assert.match(recording.artifacts["artifact:recording_contract"].file, /^[0-9a-f]{64}\.bin$/);
    assert.equal(JSON.parse(await readFile(file, "utf8")).finalSha256, recording.finalSha256);
    const replay = new ReplaySpace({ recording });
    const replayRouter = new AutomationSpaceRouter(replay);
    const replayInspect = await replayRouter.invoke("automation.space.inspect", {});
    assert.equal(replayInspect.space.providerKind, "replay");
    assert.equal(replayInspect.recording.cursor, 0);
    assert.deepEqual(await replayRouter.invoke("automation.observe", { expectedRisk: "read" }), { title: "recorded" });
    assert.deepEqual(await replayRouter.invoke("automation.observe", {
      expectedRisk: "read", representation: "apx.graph",
    }), apxObservation);
    const replayEvidence = await replayRouter.invoke("automation.act", { evidence: true });
    assert.deepEqual(replayEvidence.actions[0].result.evidence, actionEvidence);
    const checkpoint = replay.checkpoint();
    const replayCapture = await replayRouter.invoke("automation.act", {
      actions: [{ kind: "screenshot", expectedRisk: "read" }],
    });
    assert.equal(replayCapture.results[0].dataBase64, png.toString("base64"));
    replay.restore(checkpoint);
    assert.equal((await replayRouter.invoke("automation.act", {
      actions: [{ kind: "screenshot", expectedRisk: "read" }],
    })).results[0].dataBase64, png.toString("base64"));
    const replayError = await errorOf(() => replayRouter.invoke("automation.act", { fail: true }));
    assert.equal(replayError?.code, "RECORDED_UNKNOWN");
    assert.equal(replayError?.retryable, false);
    assert.deepEqual(replayError?.details?.actionability, { reason: "covered" });
    assert.deepEqual(replayError?.details?.trace, { phase: "contract" });
    assert.equal(replayError?.details?.actionEvidence?.verification?.state, "outcomeUnknown");
    assert.equal(effects, 5);
    const exhausted = await errorOf(() => replayRouter.invoke("automation.observe", { expectedRisk: "read" }));
    assert.equal(exhausted?.code, "AUTOMATION_REPLAY_EXHAUSTED");

    const tampered = structuredClone(recording);
    tampered.entries[0].terminal.output.title = "changed";
    assert.throws(() => verifyAutomationRecording(tampered), (error) => error.code === "AUTOMATION_RECORDING_MUTATED");
    const incomplete = createAutomationRecording({ provider: recording.provider, recordingId: "recording:incomplete" });
    appendAutomationRecordingEntry(incomplete, { operation: "automation.act", input: {},
      terminal: { ok: true, output: { kind: "screenshot", artifactRef: "artifact:missing" } },
      inlineArtifacts: [], artifactRefs: ["artifact:missing"] });
    sealAutomationRecording(incomplete);
    assert.throws(() => verifyAutomationRecording(incomplete),
      (error) => error.code === "AUTOMATION_RECORDING_ARTIFACT_MISSING");
    assert.throws(() => new ReplaySpace({ recording, cursor: 1, prefixSha256: "f".repeat(64) }),
      (error) => error.code === "AUTOMATION_REPLAY_CURSOR_INVALID");
    assert.throws(() => new ReplaySpace({ recording, cursor: 1 }),
      (error) => error.code === "AUTOMATION_REPLAY_CURSOR_INVALID");
    await replayRouter.close();

    const replacementSpace = await RecordingSpace.open({ provider, file, overwrite: true });
    await replacementSpace.close();
    const replacement = await loadAutomationRecording(file);
    assert.notEqual(replacement.artifactGeneration, originalGeneration);
    assert.equal(replacement.entries.length, 0);
    assert.equal(await errorOf(() => access(join(`${file}.artifacts`, originalGeneration))) !== null, true);

    const orphanFile = join(root, "orphan.json");
    await mkdir(`${orphanFile}.artifacts`);
    const preserved = join(`${orphanFile}.artifacts`, "preserve.txt");
    await writeFile(preserved, "private");
    const orphanRejected = await errorOf(() => RecordingSpace.open({ provider, file: orphanFile }));
    assert.equal(orphanRejected?.code, "AUTOMATION_RECORDING_EXISTS");
    assert.equal(await readFile(preserved, "utf8"), "private");

    const postEffectFile = join(root, "post-effect.json");
    let postEffectCount = 0;
    const postEffectProvider = {
      ...provider,
      spaceId: "space:postEffect",
      authorize(operation) { return { operation }; },
      execute() { postEffectCount += 1; return { invalid: () => true }; },
      async close() {},
    };
    const postEffectSpace = await RecordingSpace.open({ provider: postEffectProvider, file: postEffectFile });
    const postEffectRouter = new AutomationSpaceRouter(postEffectSpace);
    const postEffectError = await errorOf(() => postEffectRouter.invoke("automation.observe", {}));
    assert.equal(postEffectError?.code, "AUTOMATION_RECORDING_WRITE_FAILED");
    assert.equal(postEffectError?.outcome, "outcomeUnknown");
    const fatalError = await errorOf(() => postEffectRouter.invoke("automation.observe", {}));
    assert.equal(fatalError?.code, "AUTOMATION_RECORDING_UNAVAILABLE");
    assert.equal(fatalError?.outcome, "notSent");
    assert.equal(postEffectCount, 1);
    await postEffectRouter.close();

    const failedWriteFile = join(root, "failed-write.json");
    let failedWriteEffects = 0;
    const failedWriterProvider = {
      ...provider,
      spaceId: "space:failedWriter",
      authorize(operation) { return { operation }; },
      execute() { failedWriteEffects += 1; return { title: "effect completed" }; },
      async close() {},
    };
    const failedWriter = { async write() { throw new Error("disk unavailable"); }, async close() {} };
    const failedWriteSpace = await RecordingSpace.open({ provider: failedWriterProvider, file: failedWriteFile,
      writerFactory: async () => failedWriter });
    const failedWriteRouter = new AutomationSpaceRouter(failedWriteSpace);
    const failedWrite = await errorOf(() => failedWriteRouter.invoke("automation.observe", {}));
    assert.equal(failedWrite?.code, "AUTOMATION_RECORDING_WRITE_FAILED");
    assert.equal(failedWrite?.outcome, "outcomeUnknown");
    await errorOf(() => failedWriteRouter.invoke("automation.observe", {}));
    assert.equal(failedWriteEffects, 1);
    await failedWriteRouter.close();

    const orderedFile = join(root, "ordered.json");
    const orderedEffects = [];
    const orderedProvider = {
      ...provider,
      spaceId: "space:ordered",
      authorize(operation) { return { operation }; },
      async execute(operation, input) {
        await new Promise((resolve) => setTimeout(resolve, input.delayMs));
        orderedEffects.push(input.name);
        return { name: input.name };
      },
      async close() {},
    };
    const orderedRouter = new AutomationSpaceRouter(await RecordingSpace.open({ provider: orderedProvider,
      file: orderedFile }));
    const first = orderedRouter.invoke("automation.observe", { name: "first", delayMs: 20 });
    const second = orderedRouter.invoke("automation.observe", { name: "second", delayMs: 0 });
    assert.deepEqual(await Promise.all([first, second]), [{ name: "first" }, { name: "second" }]);
    await orderedRouter.close();
    assert.deepEqual(orderedEffects, ["first", "second"]);
    assert.deepEqual((await loadAutomationRecording(orderedFile)).entries.map((entry) => entry.input.name),
      ["first", "second"]);

    const chunkFile = join(root, "chunk-limit.json");
    let chunkEffects = 0;
    const chunkProvider = {
      ...provider,
      spaceId: "space:chunkLimit",
      operations: ["automation.space.inspect", "artifact.read"],
      authorize(operation) { return { operation }; },
      execute() {
        chunkEffects += 1;
        return { artifactRef: "artifact:oversized", kind: "screenshot", mimeType: "image/png",
          byteLength: AUTOMATION_RECORDING_MAX_ARTIFACT_BYTES + 1, sha256: "0".repeat(64),
          offset: 0, nextOffset: 1, eof: false, dataBase64: "AA==" };
      },
      async close() {},
    };
    const chunkRouter = new AutomationSpaceRouter(await RecordingSpace.open({ provider: chunkProvider, file: chunkFile }));
    const chunkError = await errorOf(() => chunkRouter.invoke("artifact.read", { artifactRef: "artifact:oversized" }));
    assert.equal(chunkError?.code, "AUTOMATION_RECORDING_WRITE_FAILED");
    assert.equal(chunkError?.outcome, "outcomeUnknown");
    await errorOf(() => chunkRouter.invoke("artifact.read", { artifactRef: "artifact:oversized" }));
    assert.equal(chunkEffects, 1);
    await chunkRouter.close();

    const drainFile = join(root, "drain.json");
    let effectReached = false;
    const drainProvider = {
      ...provider,
      spaceId: "space:drain",
      authorize(operation) { return { operation }; },
      async execute(operation, input, { signal }) {
        effectReached = true;
        await new Promise((resolve, reject) => signal.addEventListener("abort", () => {
          const error = new Error("effect outcome is unknown during shutdown");
          error.code = "DRAIN_OUTCOME_UNKNOWN";
          error.outcome = "outcomeUnknown";
          error.retryable = false;
          reject(error);
        }, { once: true }));
      },
      async close() {},
    };
    const drainRouter = new AutomationSpaceRouter(await RecordingSpace.open({ provider: drainProvider, file: drainFile }));
    const drainHost = new ControlHost({ operations: [{ name: "automation.act" }], handlers: {
      "automation.act": (input, context) => drainRouter.invoke("automation.act", input, context),
    } });
    const active = drainHost.request({ ...controlBase("request"), requestId: "recording:drain",
      operation: "automation.act", input: { actions: [] } });
    while (!effectReached) await new Promise((resolve) => setTimeout(resolve, 0));
    await drainHost.close("recording drain contract");
    const activeTerminal = await active;
    await drainRouter.close();
    const drainedRecording = await loadAutomationRecording(drainFile);
    assert.equal(activeTerminal.terminal.error.outcome, "outcomeUnknown");
    assert.equal(drainedRecording.entries[0].terminal.error.code, "DRAIN_OUTCOME_UNKNOWN");
    assert.equal(drainedRecording.entries[0].terminal.error.outcome, "outcomeUnknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
