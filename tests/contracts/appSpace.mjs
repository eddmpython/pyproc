import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPairedGeneration, pairedGenerationBytes }
  from "../../scripts/appSpace/appSpaceCanonical.js";
import { AppSpaceCoordinator } from "../../scripts/appSpace/appSpaceCoordinator.js";
import { AppSpaceRegistry } from "../../scripts/appSpace/appSpaceRegistry.js";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function errorOf(operation) { try { await operation(); return null; } catch (error) { return error; } }
const digest = (value) => createHash("sha256").update(String(value)).digest("hex");

const identity = Object.freeze({ appId: "contract.app", origin: "https://app.example.test",
  adapterVersion: "1.0.0", stateSchema: "contract/1" });
const sessionRef = Object.freeze({ protocolVersion: "1", spaceId: "space:frame",
  sessionId: "frame:contract", targetRef: "target:contract" });
const session = Object.freeze({ executionSessionId: "session:contract", contentSha256: digest("session"),
  machine: Object.freeze({ machineId: "machine:contract" }),
  work: Object.freeze({ state: "active", outcomeUnknown: false }) });

function machineLink(label = "contract") {
  return Object.freeze({ checkpointIndex: 1, imageSha256: digest(`image:${label}`),
    generation: `sha256:${digest(`generation:${label}`)}`, environment: digest("environment") });
}

function sessionLink() {
  return Object.freeze({ executionSessionId: session.executionSessionId, revisionSha256: session.contentSha256 });
}

function makeHarness(registry) {
  let appState = { value: "base" };
  let appRevision = 1;
  let quiesced = false;
  let fence = null;
  let machineValue = "machine-base";
  let nextCheckpoint = 0;
  const checkpoints = new Map();
  const outbox = [];
  const bridge = { async dispatch(operation, input) {
    if (operation === "app.describe") return { identity, revision: `apprev:${appRevision}`, quiesced,
      capabilities: ["exportState", "importState", "stageEffect", "finalizeEffect"] };
    if (operation === "app.quiesce") {
      if (input.expectedRevision !== `apprev:${appRevision}` || quiesced) throw Object.assign(new Error("race"),
        { code: "APP_SPACE_REVISION_CONFLICT" });
      quiesced = true;
      fence = `fence:${appRevision}`;
      return { revision: `apprev:${appRevision}`, fence };
    }
    if (operation === "app.export") {
      if (!quiesced || input.fence !== fence || input.expectedRevision !== `apprev:${appRevision}`) {
        throw Object.assign(new Error("invalid fence"), { code: "APP_SPACE_FENCE_INVALID" });
      }
      return { identity, revision: `apprev:${appRevision}`, state: structuredClone(appState),
        outbox: structuredClone(outbox), scope: ["domainStore", "effectOutbox"] };
    }
    if (operation === "app.import") {
      if (!quiesced || input.fence !== fence) throw Object.assign(new Error("invalid fence"),
        { code: "APP_SPACE_FENCE_INVALID" });
      appState = structuredClone(input.snapshot.state);
      outbox.splice(0, outbox.length, ...structuredClone(input.snapshot.outbox));
      appRevision += 1;
      return { revision: `apprev:${appRevision}` };
    }
    if (operation === "app.resume") {
      if (!quiesced || input.fence !== fence) throw Object.assign(new Error("invalid fence"),
        { code: "APP_SPACE_FENCE_INVALID" });
      quiesced = false;
      fence = null;
      return { resumed: true, revision: `apprev:${appRevision}` };
    }
    if (operation === "app.stageEffect") {
      outbox.push({ intentSha256: input.effect.intentSha256, state: "staged", terminal: null,
        effectReceiptSha256: null });
      appRevision += 1;
      return { staged: true, revision: `apprev:${appRevision}` };
    }
    if (operation === "machine.checkpoint.save") {
      const index = ++nextCheckpoint;
      checkpoints.set(index, machineValue);
      return { index, changedPages: 1, kind: "delta" };
    }
    if (operation === "machine.checkpoint.restore") {
      if (!checkpoints.has(input.index)) throw new Error("checkpoint unavailable");
      machineValue = checkpoints.get(input.index);
      return { index: input.index, pagesWritten: 1, rehashed: true };
    }
    throw new Error(`unexpected operation: ${operation}`);
  } };
  const effect = Object.freeze({ transactionId: "effect:contract", state: "prepared",
    contentSha256: digest("effect-revision"), intent: Object.freeze({ contentSha256: digest("intent"),
      destination: Object.freeze({ origin: identity.origin }), risk: "externalEffect" }) });
  const coordinator = new AppSpaceCoordinator({ registry,
    memoryProduct: { registry: { openSession: async () => session },
      captureMachine: async () => ({ imageSha256: digest(`image:${machineValue}`),
        generation: `sha256:${digest(`generation:${machineValue}`)}`, environment: digest("environment") }) },
    effectProduct: { registry: { openTransaction: async () => effect } },
    automationRouter: { providerKind: "frame", invoke: async () => [{ targetRef: sessionRef.targetRef,
      url: `${identity.origin}/workspace` }] }, pageBridge: bridge, allowedApps: [identity] });
  return { coordinator, effect, setApp(value) { appState = { value }; appRevision += 1; },
    setMachine(value) { machineValue = value; }, state() { return { app: appState.value, machine: machineValue,
      outbox: structuredClone(outbox), quiesced }; } };
}

export async function assertAppSpaceContract() {
  const root = await mkdtemp(join(tmpdir(), "pyproc-app-space-"));
  try {
    const registry = await AppSpaceRegistry.open({ root, secretValues: ["fixture-secret"], maxStateBytes: 4096 });
    const valid = registry.snapshot({ identity, revision: "apprev:1", state: { value: "base" }, outbox: [],
      scope: ["domainStore"] });
    assert(valid.stateSha256 === digest('{"value":"base"}') && valid.identity.stateSchema === "contract/1",
      "logical app state가 canonical snapshot으로 닫히지 않았다");
    assert((await errorOf(async () => registry.snapshot({ identity, revision: "apprev:2",
      state: { token: "redacted" }, outbox: [], scope: ["domainStore"] })))?.code === "APP_SPACE_SECRET"
      && (await errorOf(async () => registry.snapshot({ identity, revision: "apprev:2",
        state: { value: "fixture-secret" }, outbox: [], scope: ["domainStore"] })))?.code === "APP_SPACE_SECRET",
    "forbidden state key 또는 configured secret가 snapshot에 들어갔다");

    const markerless = createPairedGeneration({ pairId: "pair:markerless", parentPairSha256: null,
      app: valid, machine: machineLink("markerless"), session: sessionLink(),
      createdAt: "2026-08-13T00:00:00.000Z", source: "contract" });
    await registry.store.store.writeObject(markerless.contentSha256, pairedGenerationBytes(markerless));
    assert((await errorOf(() => registry.openPair("pair:markerless")))?.code === "APP_SPACE_PAIR_NOT_FOUND"
      && !(await registry.list()).some((entry) => entry.pairId === "pair:markerless"),
    "completion marker 없는 paired object가 활성 후보로 노출됐다");

    const harness = makeHarness(registry);
    const attached = await harness.coordinator.attach({ sessionRef });
    const base = await harness.coordinator.checkpoint({ appRef: attached.appRef, pairId: "pair:base",
      executionSessionId: session.executionSessionId, expectedSessionRevisionSha256: session.contentSha256,
      expectedActivePairSha256: null });
    harness.setApp("candidate-one");
    harness.setMachine("machine-one");
    const first = await harness.coordinator.branch({ appRef: attached.appRef, pairId: "pair:first",
      parentPairId: "pair:base", executionSessionId: session.executionSessionId,
      expectedSessionRevisionSha256: session.contentSha256,
      expectedActivePairSha256: base.pair.contentSha256 });
    await harness.coordinator.restore({ appRef: attached.appRef, pairId: "pair:base" });
    assert(harness.state().app === "base" && harness.state().machine === "machine-base"
      && harness.state().quiesced === false, "restore가 app과 Machine을 같은 pair로 복원하지 않았다");

    harness.setApp("candidate-two");
    harness.setMachine("machine-two");
    const second = await harness.coordinator.branch({ appRef: attached.appRef, pairId: "pair:second",
      parentPairId: "pair:base", executionSessionId: session.executionSessionId,
      expectedSessionRevisionSha256: session.contentSha256,
      expectedActivePairSha256: base.pair.contentSha256 });
    await harness.coordinator.adopt({ appRef: attached.appRef, pairId: first.pair.pairId,
      expectedActivePairSha256: base.pair.contentSha256 });
    const stale = await errorOf(() => harness.coordinator.adopt({ appRef: attached.appRef,
      pairId: second.pair.pairId, expectedActivePairSha256: base.pair.contentSha256 }));
    assert(stale?.code === "APP_SPACE_HEAD_CONFLICT" && harness.state().app === "candidate-one"
      && harness.state().machine === "machine-one" && (await registry.active(identity.appId)).pairId === "pair:first",
    "stale adopt race가 app, Machine, active HEAD를 이전 pair로 롤백하지 않았다");

    const staged = await harness.coordinator.stageEffect({ appRef: attached.appRef,
      transactionId: harness.effect.transactionId,
      expectedTransactionRevisionSha256: harness.effect.contentSha256 });
    assert(staged.sent === false && harness.state().outbox[0].intentSha256 === harness.effect.intent.contentSha256,
      "AppSpace outbox staging이 기존 effect identity만 기록하거나 no-send를 지키지 않았다");
    assert((await errorOf(() => harness.coordinator.attach({ sessionRef: { ...sessionRef,
      targetRef: "target:foreign" } })))?.code === "APP_SPACE_IDENTITY_MISMATCH",
    "configured exact app origin 밖의 FrameSpace target이 연결됐다");

    const permissive = await AppSpaceRegistry.open({ root, maxStateBytes: 4096 });
    const leaked = permissive.snapshot({ identity, revision: "apprev:secret", state: { value: "fixture-secret" },
      outbox: [], scope: ["domainStore"] });
    await permissive.createCandidate({ pairId: "pair:secret", parentPairSha256: null, snapshot: leaked,
      machine: machineLink("secret"), session: sessionLink() });
    assert((await errorOf(() => registry.openPair("pair:secret")))?.code === "APP_SPACE_SECRET",
      "새 trust configuration이 기존 pair의 configured secret를 다시 검증하지 않았다");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
