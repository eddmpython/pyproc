import { strict as assert } from "node:assert";
import {
  ControlLease,
  EffectWindow,
  chooseActuator,
  createBinding,
  createEpisode,
  createIntent,
  createPlan,
  createReceipt,
  digest,
  evaluateCorrection,
} from "./motorPrototype.mjs";

let passed = 0;
async function check(name, operation) {
  await operation();
  passed += 1;
  console.log(`  PASS ${name}`);
}
async function errorOf(operation) { try { await operation(); return null; } catch (error) { return error; } }

const fixedDigest = (label) => digest({ label });
const authority = { actionCapabilityRef: `capability:${fixedDigest("capability")}`,
  approvalGrantRef: null, commitLeaseRef: null, controlLeaseRef: null };
const intentInput = { intent: "activate", target: { spaceRef: "space:browser", entityRef: "entity:save",
  worldRef: "world:1", surfaceEpoch: "document:1" }, desired: { activated: true }, preconditions: [],
expectedTransition: [{ kind: "entityState", entityRef: "entity:save", state: "disabled", equals: false }],
authority, policy: { allowedActuatorKinds: ["replay", "browserInput"], allowPreContactFallback: true } };

console.log("Proof-Carrying Motor M0 probe");

await check("absolute intent is canonical across object insertion order", async () => {
  const first = createIntent(intentInput);
  const second = createIntent({ policy: { allowPreContactFallback: true,
    allowedActuatorKinds: ["browserInput", "replay"] }, authority, expectedTransition: intentInput.expectedTransition,
  preconditions: [], desired: { activated: true }, target: intentInput.target, intent: "activate" });
  assert.equal(first.intentSha256, second.intentSha256);
});

await check("relative verbs, raw coordinates, provider handles, and unknown fields fail closed", async () => {
  for (const mutated of [
    { ...intentInput, intent: "toggle" },
    { ...intentInput, target: { ...intentInput.target, x: 10 } },
    { ...intentInput, target: { ...intentInput.target, backendNodeId: 77 } },
    { ...intentInput, weightedScore: 0.99 },
  ]) assert.equal((await errorOf(() => createIntent(mutated)))?.code, "ACTUATION_INTENT_INVALID");
});

const intent = createIntent(intentInput);
const bindingInput = { spaceRef: intent.target.spaceRef, worldRef: intent.target.worldRef,
  entityRef: intent.target.entityRef, surfaceEpoch: intent.target.surfaceEpoch, actuatorKind: "browserInput",
  invariants: [{ kind: "role", value: "button" }, { kind: "name", value: "Save" }], candidateCount: 1,
  uniqueness: "unique", freshUntil: 5000, providerFenceSha256: fixedDigest("provider-fence") };
const binding = createBinding(bindingInput);

await check("target binding requires exact uniqueness and multiple invariant axes", async () => {
  assert.match(binding.bindingRef, /^binding:[0-9a-f]{64}$/);
  assert.equal((await errorOf(() => createBinding({ spaceRef: intent.target.spaceRef,
    worldRef: intent.target.worldRef, entityRef: intent.target.entityRef,
    surfaceEpoch: intent.target.surfaceEpoch, actuatorKind: "browserInput",
    invariants: [{ kind: "role", value: "button" }, { kind: "name", value: "Save" }],
    candidateCount: 2, uniqueness: "ambiguous", freshUntil: 5000,
    providerFenceSha256: fixedDigest("provider-fence") })))?.code, "ACTUATION_TARGET_AMBIGUOUS");
});

const baseCandidate = { kind: "browserInput", providerId: "native-cdp", adapterVersion: "1",
  supportedIntents: ["activate"], binding, now: 1000, healthy: true, authoritySatisfied: true,
  evidenceAvailable: true, effectWindowRepresentable: true, semanticSetter: false,
  additionalAuthority: false, postconditionEvidence: true, sharedInput: false };

await check("broker uses hard eligibility before deterministic lexicographic choice", async () => {
  const replayBinding = createBinding({ ...bindingInput, actuatorKind: "replay" });
  const decision = chooseActuator(intent, [
    { ...baseCandidate, kind: "replay", providerId: "replay", binding: replayBinding,
      semanticSetter: true, evidenceAvailable: false },
    baseCandidate,
  ], ["replay", "browserInput"]);
  assert.equal(decision.selected.kind, "browserInput");
  assert.deepEqual(decision.excluded[0].exclusionReasons, ["evidenceUnavailable"]);
});

const decision = chooseActuator(intent, [baseCandidate], ["browserInput"]);
const plan = createPlan(intent, binding, decision, { intentSha256: intent.intentSha256,
  bindingSha256: binding.bindingSha256, preflight: { topHit: true }, boundary: "pointer.press",
  approach: [{ kind: "move" }], gestureEnvelope: [{ kind: "press" }, { kind: "release" }],
  safetyRelease: [{ kind: "release" }], budgets: { corrections: 2 } });

await check("effect window freezes after contact and permits only one safety release", async () => {
  const window = new EffectWindow();
  window.approach({ kind: "move" });
  window.cross("pointer.press");
  window.sent({ kind: "press" });
  assert.equal((await errorOf(() => window.approach({ kind: "retarget" })))?.code, "ACTUATION_GESTURE_ABORTED");
  assert.equal(window.release({ kind: "release" }), true);
  assert.equal(window.release({ kind: "release" }), false);
  const closed = window.close();
  assert.equal(closed.crossed, true);
  assert.equal(closed.providerCalls, 1);
});

await check("ControlLease is scoped and physical user input permanently revokes it", async () => {
  let time = 1000;
  const lease = new ControlLease({ spaceRef: "space:desktop", applicationRef: "app:fixture",
    processRef: "process:42", windowRef: "window:main", surfaceEpoch: "surface:1",
    intentSha256: intent.intentSha256, devices: ["mouse", "keyboard"], foregroundRequired: true,
    expiresAt: 2000, cancelOnUserInput: true, sessionRevisionSha256: fixedDigest("session") },
  { now: () => time, idFactory: () => "1".repeat(32) });
  lease.activate({ windowRef: "window:main", surfaceEpoch: "surface:1" });
  lease.assert({ windowRef: "window:main", surfaceEpoch: "surface:1" });
  lease.userInput();
  assert.equal((await errorOf(() => lease.assert({ windowRef: "window:main", surfaceEpoch: "surface:1" })))?.code,
    "ACTUATION_CONTROL_REVOKED");
  time = 3000;
  assert.equal(lease.inspect().state, "revoked");
});

await check("already-satisfied receipt proves that no effect boundary was crossed", async () => {
  const window = new EffectWindow();
  const receipt = createReceipt({ intent, binding, plan, decision, effectWindow: window.close(),
    terminal: "alreadySatisfied" });
  assert.equal(receipt.effectWindow.crossed, false);
  assert.equal(receipt.effectWindow.providerCalls, 0);
});

let confirmedReceipt;
await check("confirmed receipt closes intent, binding, plan, route, effect window, and evidence lineage", async () => {
  const window = new EffectWindow();
  window.cross("pointer.press");
  window.sent({ kind: "press" });
  window.release({ kind: "release" });
  confirmedReceipt = createReceipt({ intent, binding, plan, decision, effectWindow: window.close(),
    terminal: "confirmed", actionEvidenceRef: "evidence:confirmed" });
  assert.equal(confirmedReceipt.planSha256, plan.planSha256);
  assert.match(confirmedReceipt.receiptSha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(confirmedReceipt).includes("backendNodeId"), false);
});

await check("only deterministic confirmed perturbations can become positive signals", async () => {
  const common = { receipt: confirmedReceipt, policyRevisionSha256: fixedDigest("policy"),
    provider: { kind: "browserInput", version: "1", environmentSha256: fixedDigest("environment") },
    timeline: [{ phase: "verification", worldRef: "world:1" }], evidenceRefs: ["evidence:confirmed"],
    redactionManifestSha256: fixedDigest("redaction") };
  const episode = createEpisode({ ...common, robustnessSignals: [{ positive: true,
    perturbation: "movedBeforeContact", deterministicEvidenceRef: "evidence:confirmed" }] });
  assert.match(episode.episodeSha256, /^[0-9a-f]{64}$/);
  assert.equal((await errorOf(() => createEpisode({ ...common,
    receipt: { ...confirmedReceipt, terminal: "outcomeUnknown" }, robustnessSignals: [{ positive: true,
      perturbation: "transportLost", deterministicEvidenceRef: "evidence:unknown" }] })))?.code,
  "ACTUATION_POLICY_REJECTED");
});

await check("policy promotion is deterministic and constitution changes are rejected", async () => {
  const input = { basePolicySha256: fixedDigest("base"), corpusSha256: fixedDigest("corpus"),
    evaluationManifestSha256: fixedDigest("evaluation"), proposal: { changeKind: "probeOrder",
      patch: { order: ["semantic", "spatial"] }, protectedInvariants: ["exactTarget"],
      coverage: { gaps: 0, negativeFailed: 0, replayFailed: 0 } } };
  assert.equal(evaluateCorrection(input).verdictSha256, evaluateCorrection(structuredClone(input)).verdictSha256);
  const rejected = await errorOf(() => evaluateCorrection({ ...input,
    proposal: { ...input.proposal, changeKind: "constitution", patch: { authority: "optional" } } }));
  assert.equal(rejected?.code, "ACTUATION_POLICY_REJECTED");
});

console.log(`\n결과: GREEN (${passed}/${passed})`);
