import { strict as assert } from "node:assert";
import {
  actuationDigest,
  createActuationEpisode,
  createActuationIntent,
  createActuationPlan,
  createActuationReceipt,
  createPolicyRevision,
  createTargetBinding,
  evaluateCorrection,
} from "../../scripts/actuation/actuationCanonical.js";
import { chooseActuator } from "../../scripts/actuation/actuatorBroker.js";
import { ActuationEffectWindow } from "../../scripts/actuation/effectWindow.js";
import { ControlLease } from "../../scripts/actuation/controlLease.js";

async function errorOf(operation) {
  try { await operation(); return null; }
  catch (error) { return error; }
}

const digest = (label) => actuationDigest({ label });
const authority = Object.freeze({
  actionCapabilityRef: `capability:${digest("action")}`,
  approvalGrantRef: null,
  commitLeaseRef: null,
  controlLeaseRef: null,
});
const input = Object.freeze({
  intent: "activate",
  target: { spaceRef: "space:browser", entityRef: "entity:save", worldRef: "world:1",
    surfaceEpoch: "document:1" },
  desired: { activated: true },
  preconditions: [],
  expectedTransition: [{ kind: "entityState", entityRef: "entity:save", state: "disabled", equals: false }],
  authority,
  policy: { allowedActuatorKinds: ["replay", "browserInput"], allowPreContactFallback: true },
});

export async function assertActuationContracts() {
  const intent = createActuationIntent(input);
  assert.equal(intent.intentSha256, createActuationIntent({ ...input,
    policy: { allowPreContactFallback: true, allowedActuatorKinds: ["browserInput", "replay"] },
  }).intentSha256);

  for (const invalid of [
    { ...input, intent: "toggle" },
    { ...input, target: { ...input.target, x: 10 } },
    { ...input, target: { ...input.target, backendNodeId: 77 } },
    { ...input, weightedScore: 0.9 },
  ]) assert.equal((await errorOf(() => createActuationIntent(invalid)))?.code, "ACTUATION_INTENT_INVALID");

  const bindingInput = { ...intent.target, actuatorKind: "browserInput",
    invariants: [{ kind: "role", value: "button" }, { kind: "name", value: "Save" }],
    candidateCount: 1, uniqueness: "unique", freshUntil: 5000,
    providerFenceSha256: digest("provider-fence") };
  const binding = createTargetBinding(bindingInput);
  assert.match(binding.bindingRef, /^binding:[0-9a-f]{64}$/);
  assert.equal((await errorOf(() => createTargetBinding({ ...bindingInput,
    candidateCount: 2, uniqueness: "ambiguous" })))?.code, "ACTUATION_TARGET_AMBIGUOUS");

  const candidate = { kind: "browserInput", providerId: "native-cdp", adapterVersion: "1",
    supportedIntents: ["activate"], binding, now: 1000, healthy: true, authoritySatisfied: true,
    evidenceAvailable: true, effectWindowRepresentable: true, semanticSetter: false,
    additionalAuthority: false, postconditionEvidence: true, sharedInput: false };
  const replayBinding = createTargetBinding({ ...bindingInput, actuatorKind: "replay" });
  const decision = chooseActuator(intent, [{ ...candidate, kind: "replay", providerId: "replay",
    binding: replayBinding, semanticSetter: true, evidenceAvailable: false }, candidate],
  ["replay", "browserInput"]);
  assert.equal(decision.selected.kind, "browserInput");
  assert.deepEqual(decision.excluded[0].exclusionReasons, ["evidenceUnavailable"]);

  const plan = createActuationPlan({ intent, binding, decision, preflight: { topHit: true },
    boundary: "pointer.press", approach: [{ kind: "move" }],
    gestureEnvelope: [{ kind: "press" }, { kind: "release" }],
    safetyRelease: [{ kind: "release" }], verification: intent.expectedTransition,
    budgets: { corrections: 2 } });
  assert.match(plan.planRef, /^plan:[0-9a-f]{64}$/);

  const effectWindow = new ActuationEffectWindow();
  effectWindow.approach({ kind: "move" });
  effectWindow.cross("pointer.press");
  effectWindow.sent({ kind: "press" });
  assert.equal((await errorOf(() => effectWindow.approach({ kind: "retarget" })))?.code,
    "ACTUATION_GESTURE_ABORTED");
  assert.equal(effectWindow.release({ kind: "release" }), true);
  assert.equal(effectWindow.release({ kind: "release" }), false);
  assert.equal(effectWindow.finish().providerCalls, 1);

  let now = 1000;
  const lease = new ControlLease({ spaceRef: "space:desktop", applicationRef: "app:fixture",
    processRef: "process:42", windowRef: "window:main", surfaceEpoch: "surface:1",
    intentSha256: intent.intentSha256, devices: ["mouse", "keyboard"], foregroundRequired: true,
    expiresAt: 2000, cancelOnUserInput: true, sessionRevisionSha256: digest("session") },
  { now: () => now, idFactory: () => "1".repeat(32) });
  lease.activate({ windowRef: "window:main", surfaceEpoch: "surface:1" });
  lease.assert({ windowRef: "window:main", surfaceEpoch: "surface:1" });
  lease.userInput();
  assert.equal((await errorOf(() => lease.assert({ windowRef: "window:main", surfaceEpoch: "surface:1" })))?.code,
    "ACTUATION_CONTROL_REVOKED");
  now = 3000;
  assert.equal(lease.inspect().state, "revoked");

  const untouched = new ActuationEffectWindow().finish({ boundaryCrossed: false });
  const satisfiedReceipt = createActuationReceipt({ intent, binding, plan, decision,
    effectWindow: untouched, effectOutcome: "notSent", terminal: "alreadySatisfied" });
  assert.equal(satisfiedReceipt.effectWindow.providerCalls, 0);

  const receipt = createActuationReceipt({ intent, binding, plan, decision,
    effectWindow: effectWindow.inspect(), effectOutcome: "applied", terminal: "confirmed",
    actionEvidenceRef: "evidence:confirmed" });
  assert.equal(receipt.planSha256, plan.planSha256);
  assert.equal(JSON.stringify(receipt).includes("backendNodeId"), false);

  const episode = createActuationEpisode({ receipt, worldRef: "world:1",
    policyRevisionSha256: digest("policy"),
    provider: { kind: "browserInput", version: "1", environmentSha256: digest("environment") },
    timeline: [{ phase: "verification", worldRef: "world:1" }], evidenceRefs: ["evidence:confirmed"],
    robustnessSignals: [{ positive: true, perturbation: "movedBeforeContact",
      deterministicEvidenceRef: "evidence:confirmed" }], redactionManifestSha256: digest("redaction") });
  assert.match(episode.episodeRef, /^episode:[0-9a-f]{64}$/);

  const basePolicy = createPolicyRevision({ policy: { providerPreference: ["browserInput"] } });
  const evaluation = { basePolicySha256: basePolicy.policySha256, corpusSha256: digest("corpus"),
    evaluationManifestSha256: digest("evaluation"), proposal: { changeKind: "probeOrder",
      patch: { order: ["semantic", "spatial"] }, protectedInvariants: ["exactTarget"],
      coverage: { gaps: 0, negativeFailed: 0, replayFailed: 0 } } };
  assert.equal(evaluateCorrection(evaluation).verdictSha256,
    evaluateCorrection(structuredClone(evaluation)).verdictSha256);
  assert.equal((await errorOf(() => evaluateCorrection({ ...evaluation,
    proposal: { ...evaluation.proposal, changeKind: "constitution", patch: { authority: "optional" } } })))?.code,
  "ACTUATION_POLICY_REJECTED");
}
