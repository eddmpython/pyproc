import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActuationCoordinator } from "../../scripts/actuation/actuationCoordinator.js";
import { FileActuationStore } from "../../scripts/actuation/fileActuationStore.js";
import { actuationDigest } from "../../scripts/actuation/actuationCanonical.js";
import { PerceptionSpace } from "../../scripts/perception/perceptionSpace.js";
import {
  createReplayGraphEdge,
  createReplayGraphNode,
  createReplayGraphRevision,
} from "../../scripts/replayGraph/replayGraphCanonical.js";
import { ReplayGraphCoordinator } from "../../scripts/replayGraph/replayGraphCoordinator.js";

async function errorOf(operation) {
  try { await operation(); return null; }
  catch (error) { return error; }
}

function fixtureSensor({ checked = false, omitted = 0 } = {}) {
  return { capture: async () => ({ documentEpoch: 1,
    page: { url: "https://fixture.test", title: "Fixture",
      viewport: { width: 800, height: 600, scale: 1 }, scroll: { x: 0, y: 0 } },
    entities: [{ nativeRef: "native:save", locatorData: { backendNodeId: 1 }, kind: "ui.control",
      semantic: { role: checked ? "checkbox" : "button", name: checked ? "Keep" : "Save",
        states: { disabled: false, ...(checked ? { checked: true } : {}) }, sensitivity: "public" },
      structure: { frameNativeRef: "frame:main", nodeName: "BUTTON" },
      geometry: { rect: { x: 10, y: 10, width: 80, height: 30 }, viewportRatio: 1,
        paintOrder: 1, visible: true, occluded: false },
      interaction: { supportedActions: [checked ? "check" : "click"], actionable: true, reasons: [] },
      provenance: { semantic: { mode: "observed", source: "fixture", trust: "browser" },
        structure: { mode: "observed", source: "fixture", trust: "browser" },
        geometry: { mode: "observed", source: "fixture", trust: "browser" },
        interaction: { mode: "derived", source: "fixture", trust: "broker" } } }],
    relations: [], events: [], omitted: { entities: omitted }, completeness: { semantic: "complete", structure: "complete",
      geometry: "complete", interaction: "complete", network: "complete" },
  }), dropSession() {}, close() {} };
}

function denseSensor() {
  const entities = Array.from({ length: 1501 }, (_, index) => ({
    nativeRef: `native:dense:${index}`,
    locatorData: { backendNodeId: index + 1 },
    kind: "ui.control",
    semantic: { role: "button", name: index === 1500 ? "Save" : `Item ${index}`,
      states: { disabled: false }, sensitivity: "public" },
    structure: { frameNativeRef: "frame:main", nodeName: "BUTTON" },
    geometry: { rect: { x: index % 20, y: Math.floor(index / 20), width: 1, height: 1 },
      viewportRatio: 1, paintOrder: index, visible: true, occluded: false },
    interaction: { supportedActions: ["click"], actionable: true, reasons: [] },
    provenance: { semantic: { mode: "observed", source: "fixture", trust: "browser" },
      structure: { mode: "observed", source: "fixture", trust: "browser" },
      geometry: { mode: "observed", source: "fixture", trust: "browser" },
      interaction: { mode: "derived", source: "fixture", trust: "broker" } },
  }));
  return { capture: async () => ({ documentEpoch: 1,
    page: { url: "https://fixture.test", title: "Dense fixture",
      viewport: { width: 800, height: 600, scale: 1 }, scroll: { x: 0, y: 0 } },
    entities, relations: [], events: [], completeness: { semantic: "complete", structure: "complete",
      geometry: "complete", interaction: "complete", network: "complete" },
  }), dropSession() {}, close() {} };
}

async function situation({ checked = false, omitted = 0, now }) {
  let sequence = 0;
  const transition = { entityState: { entityRef: "entity:placeholder", disabled: false } };
  const perception = new PerceptionSpace({ sensor: fixtureSensor({ checked, omitted }), now: () => now,
    idFactory: () => `motor_${++sequence}`,
    locatorIssuer: () => `locator:motor_${sequence}`,
    capabilityPolicy: ({ action, entity }) => ({ risk: "externalEffect",
      expectedTransition: checked ? { entityState: { entityRef: entity.entityRef, checked: true } }
        : { entityState: { entityRef: entity.entityRef, disabled: false } } }) });
  const focus = { requirements: [{ requirementRef: "requirement:target",
    select: { role: checked ? "checkbox" : "button", name: checked ? "Keep" : "Save" },
    need: ["fact", "affordance"], cardinality: "one" }] };
  const capsule = await perception.observe({ protocolVersion: "1", spaceId: "space:motor",
    sessionId: "session:fixture", targetRef: "target:fixture" }, { representation: "apx.situation",
    focus, visual: { mode: "off" }, budget: { maxEntities: 20, maxRelations: 20, maxBytes: 65536 } });
  const affordance = capsule.affordances.find((entry) => entry.kind === "authorized");
  return { perception, capsule, affordance, transition };
}

export async function assertActuationProductContracts() {
  const root = await mkdtemp(join(tmpdir(), "pyproc-actuation-"));
  const now = Date.parse("2026-08-14T00:00:00.000Z");
  let providerCalls = 0;
  const automation = { spaceId: "space:motor", providerKind: "nativeCdp", capabilities: ["perception"],
    invoke: async (operation, input) => {
      assert.equal(operation, "automation.act");
      assert.equal(input.actions.length, 1);
      providerCalls += 1;
      return { state: "completed", actions: [{ result: { evidence: {
        evidenceRef: `evidence:motor_${providerCalls}`, effectOutcome: "applied",
        verification: { state: "confirmed" },
      } } }] };
    } };
  try {
    const store = await FileActuationStore.open(root);
    const motor = await ActuationCoordinator.open({ store, automation, now: () => now });
    const observed = await situation({ now });
    const entityRef = observed.capsule.requirements[0].entityRefs[0];
    const intent = { intent: "activate", target: { spaceRef: automation.spaceId, entityRef,
      worldRef: observed.capsule.worldRef, surfaceEpoch: "document:1" }, desired: { activated: true },
    preconditions: [], expectedTransition: { entityState: { entityRef, disabled: false } },
    authority: { actionCapabilityRef: observed.affordance.capabilityRef, approvalGrantRef: null,
      commitLeaseRef: null, controlLeaseRef: null },
    policy: { allowedActuatorKinds: ["browserInput"], allowPreContactFallback: true } };
    const result = await motor.execute({ sessionRef: { protocolVersion: "1", spaceId: automation.spaceId,
      sessionId: "session:fixture", targetRef: "target:fixture" }, situation: observed.capsule,
    requirementRef: "requirement:target", intent });
    assert.equal(result.terminal, "confirmed");
    assert.equal(result.receipt.effectWindow.providerCalls, 1);
    assert.equal(result.receipt.actionEvidenceRef, "evidence:motor_1");
    assert.equal(JSON.stringify(result.receipt).includes("locator:"), false);
    assert.equal((await motor.list()).length, 1);

    let denseIdentity = 0;
    let denseLocator = 0;
    const densePerception = new PerceptionSpace({ sensor: denseSensor(), now: () => now,
      idFactory: () => `dense_${++denseIdentity}`,
      locatorIssuer: () => `locator:dense_${++denseLocator}`,
      capabilityPolicy: () => ({ risk: "externalEffect", expectedTransition: {
        entityState: { entityRef: "entity:placeholder", disabled: false },
      } }) });
    const denseCapsule = await densePerception.observe({ protocolVersion: "1", spaceId: "space:motor",
      sessionId: "session:dense", targetRef: "target:dense" }, { representation: "apx.situation",
      focus: { requirements: [{ requirementRef: "requirement:denseSave",
        select: { role: "button", name: "Save" }, need: ["fact", "affordance"], cardinality: "one" }] },
      visual: { mode: "off" }, budget: { maxEntities: 20, maxRelations: 20, maxBytes: 65536 } });
    assert.equal(denseCapsule.requirements[0].state, "satisfied");
    assert.equal(denseCapsule.requirements[0].matched, 1);
    assert.equal(denseCapsule.completeness.inventory, "taskComplete");
    assert.equal(denseCapsule.budget.omitted.sourceEntities, 0);

    const truncated = await situation({ now, omitted: 1 });
    const truncatedEntityRef = truncated.capsule.requirements[0].entityRefs[0];
    assert.equal(truncated.capsule.completeness.inventory, "truncated");
    assert.equal(truncated.capsule.requirements[0].state, "unknown");
    const truncatedError = await errorOf(() => motor.execute({ sessionRef: { protocolVersion: "1",
      spaceId: automation.spaceId, sessionId: "session:fixture", targetRef: "target:fixture" },
    situation: truncated.capsule, requirementRef: "requirement:target", intent: { ...intent, target: {
      ...intent.target, entityRef: truncatedEntityRef, worldRef: truncated.capsule.worldRef,
    } } }));
    assert.equal(truncatedError?.code, "ACTUATION_PERCEPTION_INCOMPLETE");
    assert.equal(providerCalls, 1);

    const incomplete = structuredClone(observed.capsule);
    incomplete.requirements[0].state = "unknown";
    incomplete.unknowns.push({ unknownRef: "unknown:incomplete", requirementRef: "requirement:target",
      reason: "missingFact", evidenceRefs: [] });
    const error = await errorOf(() => motor.execute({ sessionRef: { protocolVersion: "1",
      spaceId: automation.spaceId, sessionId: "session:fixture", targetRef: "target:fixture" },
    situation: incomplete, requirementRef: "requirement:target", intent }));
    assert.equal(error?.code, "APX_SCHEMA_INVALID");
    assert.equal(providerCalls, 1);

    const selected = await situation({ checked: true, now });
    const selectedEntityRef = selected.capsule.requirements[0].entityRefs[0];
    const selectedIntent = { intent: "setSelected", target: { spaceRef: automation.spaceId,
      entityRef: selectedEntityRef, worldRef: selected.capsule.worldRef, surfaceEpoch: "document:1" },
    desired: { selected: true }, preconditions: [], expectedTransition: {}, authority: {
      actionCapabilityRef: selected.affordance.capabilityRef, approvalGrantRef: null,
      commitLeaseRef: null, controlLeaseRef: null }, policy: { allowedActuatorKinds: ["browserInput"],
      allowPreContactFallback: false } };
    const satisfied = await motor.execute({ sessionRef: { protocolVersion: "1", spaceId: automation.spaceId,
      sessionId: "session:fixture", targetRef: "target:fixture" }, situation: selected.capsule,
    requirementRef: "requirement:target", intent: selectedIntent });
    assert.equal(satisfied.terminal, "alreadySatisfied");
    assert.equal(satisfied.receipt.effectWindow.providerCalls, 0);
    assert.equal(providerCalls, 1);

    const inspected = await motor.inspect();
    const proposal = { changeKind: "probeOrder", patch: { order: ["semantic", "spatial"] },
      protectedInvariants: ["exactTarget"], coverage: { gaps: 0, negativeFailed: 0, replayFailed: 0 } };
    const promoted = await motor.promote({ expectedPolicySha256: inspected.policy.policySha256,
      corpusSha256: actuationDigest({ corpus: 1 }), evaluationManifestSha256: actuationDigest({ manifest: 1 }),
      proposal });
    assert.equal(promoted.policy.previousSha256, inspected.policy.policySha256);
    assert.equal((await motor.rollback({ expectedPolicySha256: promoted.policy.policySha256 })).policySha256,
      inspected.policy.policySha256);

    const replayNodeInput = { providerKind: "motorFixture", environmentSha256: actuationDigest({ environment: 1 }),
      policySha256: inspected.policy.policySha256, completeness: "complete", artifactSha256s: [],
      sessionRevisionSha256: null, pendingEffectSha256: null };
    const replayBefore = createReplayGraphNode({ ...replayNodeInput, state: { motor: "before" } });
    const replayAfter = createReplayGraphNode({ ...replayNodeInput, state: { motor: "after" } });
    const replayEdge = createReplayGraphEdge({ sourceNodeRef: replayBefore.nodeRef,
      targetNodeRef: replayAfter.nodeRef, operation: "motor.execute",
      input: { receiptSha256: result.receipt.receiptSha256 }, terminal: { ok: true,
        motorTerminal: result.terminal }, provenance: "syntheticFixture", effectClass: "recordedExternal",
      risk: "externalEffect", artifactRefs: [],
      transitionProof: { oracleSha256: actuationDigest({ oracle: "motor receipt" }) } });
    const replayGraph = createReplayGraphRevision({ graphId: "graph:motor-fixture", parentRootSha256: null,
      startNodeRefs: [replayBefore.nodeRef], nodes: [replayBefore, replayAfter], edges: [replayEdge], artifacts: [],
      unexploredActionClasses: [] });
    const replayCoordinator = new ReplayGraphCoordinator({ registry: {
      open: async (graphId, rootSha256) => {
        assert.equal(graphId, replayGraph.graphId);
        assert.equal(rootSha256, replayGraph.rootSha256);
        return replayGraph;
      },
    } });
    const opened = await replayCoordinator.open({ graphId: replayGraph.graphId,
      rootSha256: replayGraph.rootSha256 });
    const replayMotor = new ActuationCoordinator({ store, automation, replayGraph: replayCoordinator,
      now: () => now });
    const callsBeforeReplay = providerCalls;
    const replayed = await replayMotor.replay({ receiptSha256: result.receipt.receiptSha256,
      worldRef: opened.world.worldRef, expectedNodeRef: replayBefore.nodeRef });
    assert.equal(replayed.receipt.receiptSha256, result.receipt.receiptSha256);
    assert.equal(replayed.replay.edgeRef, replayEdge.edgeRef);
    assert.equal(replayed.replay.replayedEffect, false);
    assert.equal(replayed.providerCalls, 0);
    assert.equal(providerCalls, callsBeforeReplay);
    observed.perception.close();
    densePerception.close();
    truncated.perception.close();
    selected.perception.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
