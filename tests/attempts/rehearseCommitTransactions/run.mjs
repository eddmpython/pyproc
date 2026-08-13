import { generateKeyPairSync } from "node:crypto";
import {
  createPrototypeGrant,
  PrototypeEffectRegistry,
  PrototypeEffectStore,
  prototypeDigest,
} from "./effectTransactionPrototype.mjs";

const checks = [];
function check(name, pass, info = "") {
  checks.push({ name, pass: !!pass, info: String(info) });
  if (!pass) throw new Error(`${name}: ${info}`);
}
async function codeOf(operation) {
  try { await operation(); return ""; } catch (error) { return error?.code || String(error); }
}

let now = Date.parse("2026-08-13T00:00:00.000Z");
const clock = () => now;
const pair = generateKeyPairSync("ed25519");
const trustDomainSha256 = prototypeDigest("trust-domain-a");
const store = new PrototypeEffectStore();
const registry = new PrototypeEffectRegistry({ store, authorityId: "operator:finance", publicKey: pair.publicKey,
  trustDomainSha256, secrets: ["fixture-secret-value"], now: clock });
const baseIntent = {
  intentId: "intent:payment-7", operation: "automation.act",
  destination: { origin: "https://payments.example.test", accountDigest: prototypeDigest("account-7") },
  payloadBindingSha256: prototypeDigest("payment-payload-7"), risk: "externalEffect",
  preconditions: [{ requirementRef: "requirement:payment-ready", state: "satisfied" }],
  expectedTransition: { networkResponse: { method: "POST", urlPath: "/payments", status: 201 } },
  environmentSha256: prototypeDigest("environment-7"), executionSessionId: "session:payments",
  sessionRevisionSha256: prototypeDigest("session-revision-7"),
};

const prepared = registry.prepare("effect:payment-7", baseIntent);
check("EffectIntent is immutable and content-addressed", prepared.intent.contentSha256.length === 64
  && prepared.state === "prepared");
check("mutable caller fields are rejected",
  await codeOf(() => registry.prepare("effect:mutable", { ...baseIntent, intentId: "intent:mutable", note: "later" }))
  === "EFFECT_INVALID");
check("secret material is rejected before persistence",
  await codeOf(() => registry.prepare("effect:secret", { ...baseIntent, intentId: "intent:secret",
    destination: { origin: "https://example.test", label: "fixture-secret-value" } })) === "EFFECT_SECRET");

const rehearsed = registry.rehearse("effect:payment-7", prepared.contentSha256, {
  coverage: "recorded", terminal: "pass", sourceSha256: prototypeDigest("recording:payment"),
  evidenceSha256: prototypeDigest("rehearsal:evidence"),
  limitations: ["Recorded path only; current live acceptance remains unproven."],
});
check("rehearsal states exact coverage and limitation", rehearsed.rehearsals[0].coverage === "recorded"
  && rehearsed.rehearsals[0].liveGuarantee === false && rehearsed.rehearsals[0].limitations.length === 1);
check("rehearsal cannot claim a live guarantee", await codeOf(() => registry.rehearse("effect:payment-7",
  rehearsed.contentSha256, { coverage: "recorded", terminal: "pass", sourceSha256: prototypeDigest("source"),
    evidenceSha256: prototypeDigest("evidence"), limitations: ["Live guarantee"] })) === "EFFECT_REHEARSAL_INVALID");

const grant = createPrototypeGrant({ intent: rehearsed.intent, authorityId: "operator:finance", trustDomainSha256,
  expiresAt: "2026-08-13T01:00:00.000Z", nonce: "nonce:payment-7", policyVersion: "finance/1" }, pair.privateKey);
const approved = registry.approve("effect:payment-7", rehearsed.contentSha256, grant);
check("signed grant binds exact intent, destination, risk, and session", approved.state === "approved"
  && approved.approval.intentSha256 === approved.intent.contentSha256
  && approved.approval.sessionRevisionSha256 === baseIntent.sessionRevisionSha256);

const rejectedRegistry = new PrototypeEffectRegistry({ authorityId: "operator:finance", publicKey: pair.publicKey,
  trustDomainSha256, now: clock });
let rejected = rejectedRegistry.prepare("effect:rejected", { ...baseIntent, intentId: "intent:rejected" });
rejected = rejectedRegistry.rehearse("effect:rejected", rejected.contentSha256, {
  coverage: "recorded", terminal: "reject", sourceSha256: prototypeDigest("recording-rejected"),
  evidenceSha256: prototypeDigest("evidence-rejected"), limitations: ["Recorded path rejected the transition."],
});
const rejectedGrant = createPrototypeGrant({ intent: rejected.intent, authorityId: "operator:finance",
  trustDomainSha256, expiresAt: "2026-08-13T01:00:00.000Z", nonce: "nonce:rejected",
  policyVersion: "finance/1" }, pair.privateKey);
check("rejected rehearsal cannot reach approval", await codeOf(() => rejectedRegistry.approve("effect:rejected",
  rejected.contentSha256, rejectedGrant)) === "EFFECT_REHEARSAL_REQUIRED");

const changedRegistry = new PrototypeEffectRegistry({ authorityId: "operator:finance", publicKey: pair.publicKey,
  trustDomainSha256, now: clock });
const changed = changedRegistry.prepare("effect:changed", { ...baseIntent, intentId: "intent:changed",
  payloadBindingSha256: prototypeDigest("changed-payload") });
const changedRehearsed = changedRegistry.rehearse("effect:changed", changed.contentSha256, {
  coverage: "computed", terminal: "pass", sourceSha256: prototypeDigest("branch"),
  evidenceSha256: prototypeDigest("oracle"), limitations: ["Computed payload only; browser state remains unproven."],
});
check("changed payload makes old grant stale", await codeOf(() => changedRegistry.approve("effect:changed",
  changedRehearsed.contentSha256, grant)) === "EFFECT_APPROVAL_STALE");
const foreignRegistry = new PrototypeEffectRegistry({ authorityId: "operator:finance", publicKey: pair.publicKey,
  trustDomainSha256: prototypeDigest("trust-domain-b"), now: clock });
const foreign = foreignRegistry.prepare("effect:foreign", { ...baseIntent, intentId: "intent:foreign" });
const foreignRehearsed = foreignRegistry.rehearse("effect:foreign", foreign.contentSha256, {
  coverage: "computed", terminal: "pass", sourceSha256: prototypeDigest("branch"),
  evidenceSha256: prototypeDigest("oracle"), limitations: ["Computed payload only; live state remains unproven."],
});
check("new trust domain does not activate imported approval", await codeOf(() => foreignRegistry.approve("effect:foreign",
  foreignRehearsed.contentSha256, grant)) === "EFFECT_APPROVAL_STALE");

let sends = 0;
const capture = async () => ({ situationSha256: prototypeDigest(`situation-${sends}`),
  machineSha256: prototypeDigest(`machine-${sends}`) });
const send = async () => {
  sends += 1;
  return { evidence: { effectOutcome: "applied", verification: { state: "confirmed" } } };
};
const terminal = await registry.commit("effect:payment-7", approved.contentSha256, {
  preflight: async () => ({ matched: true, situationSha256: prototypeDigest("before"),
    machineSha256: prototypeDigest("machine-before") }), send, capture,
});
check("approved effect is sent once and confirmed", sends === 1 && terminal.state === "confirmed");
check("terminal retry returns receipt without another send", (await registry.commit("effect:payment-7",
  terminal.contentSha256, { preflight: async () => ({ matched: true }), send, capture })).contentSha256
  === terminal.contentSha256 && sends === 1);
check("EffectReceipt links all required objects", ["intentSha256", "rehearsalSha256", "approvalSha256", "leaseSha256",
  "beforeSha256", "afterSha256", "evidenceSha256", "machineBeforeSha256", "machineAfterSha256",
  "sessionRevisionSha256"].every((key) => terminal.receipt[key]));

const mismatchRegistry = new PrototypeEffectRegistry({ authorityId: "operator:finance", publicKey: pair.publicKey,
  trustDomainSha256, now: clock });
let mismatch = mismatchRegistry.prepare("effect:mismatch", { ...baseIntent, intentId: "intent:mismatch" });
mismatch = mismatchRegistry.rehearse("effect:mismatch", mismatch.contentSha256, {
  coverage: "computed", terminal: "pass", sourceSha256: prototypeDigest("branch-mismatch"),
  evidenceSha256: prototypeDigest("oracle-mismatch"), limitations: ["Browser state remains unproven."],
});
const mismatchGrant = createPrototypeGrant({ intent: mismatch.intent, authorityId: "operator:finance", trustDomainSha256,
  expiresAt: "2026-08-13T01:00:00.000Z", nonce: "nonce:mismatch", policyVersion: "finance/1" }, pair.privateKey);
mismatch = mismatchRegistry.approve("effect:mismatch", mismatch.contentSha256, mismatchGrant);
let mismatchSends = 0;
check("live precondition mismatch sends no effect", await codeOf(() => mismatchRegistry.commit("effect:mismatch",
  mismatch.contentSha256, { preflight: async () => ({ matched: false }), send: async () => { mismatchSends += 1; }, capture }))
  === "EFFECT_PREFLIGHT_MISMATCH" && mismatchSends === 0);

const crashRegistry = new PrototypeEffectRegistry({ authorityId: "operator:finance", publicKey: pair.publicKey,
  trustDomainSha256, now: clock });
let crash = crashRegistry.prepare("effect:crash", { ...baseIntent, intentId: "intent:crash" });
crash = crashRegistry.rehearse("effect:crash", crash.contentSha256, { coverage: "recorded", terminal: "pass",
  sourceSha256: prototypeDigest("recording-crash"), evidenceSha256: prototypeDigest("evidence-crash"),
  limitations: ["Recorded path only; current live acceptance remains unproven."] });
const crashGrant = createPrototypeGrant({ intent: crash.intent, authorityId: "operator:finance", trustDomainSha256,
  expiresAt: "2026-08-13T01:00:00.000Z", nonce: "nonce:crash", policyVersion: "finance/1" }, pair.privateKey);
crash = crashRegistry.approve("effect:crash", crash.contentSha256, crashGrant);
let crashSends = 0;
check("injected post-send crash preserves sending boundary", await codeOf(() => crashRegistry.commit("effect:crash",
  crash.contentSha256, { preflight: async () => ({ matched: true }), send: async () => { crashSends += 1;
    return { evidence: { verification: { state: "confirmed" } } }; }, capture, crashAfterSend: true }))
  === "INJECTED_CRASH" && crashRegistry.open("effect:crash").state === "sending" && crashSends === 1);
const recovered = await crashRegistry.recover("effect:crash", crashRegistry.open("effect:crash").contentSha256, capture);
check("recovery seals outcomeUnknown without resend", recovered.state === "outcomeUnknown" && crashSends === 1
  && recovered.receipt.terminal === "outcomeUnknown");

const raceStore = new PrototypeEffectStore();
const raceRegistry = new PrototypeEffectRegistry({ store: raceStore, authorityId: "operator:finance",
  publicKey: pair.publicKey, trustDomainSha256, now: clock });
let race = raceRegistry.prepare("effect:race", { ...baseIntent, intentId: "intent:race" });
race = raceRegistry.rehearse("effect:race", race.contentSha256, { coverage: "computed", terminal: "pass",
  sourceSha256: prototypeDigest("branch-race"), evidenceSha256: prototypeDigest("oracle-race"),
  limitations: ["Live state remains unproven."] });
race = raceRegistry.approve("effect:race", race.contentSha256, createPrototypeGrant({ intent: race.intent,
  authorityId: "operator:finance", trustDomainSha256, expiresAt: "2026-08-13T01:00:00.000Z",
  nonce: "nonce:race", policyVersion: "finance/1" }, pair.privateKey));
let raceSends = 0;
let releasePreflight;
const preflightBarrier = new Promise((resolve) => { releasePreflight = resolve; });
let arrivals = 0;
const racingPreflight = async () => { arrivals += 1; if (arrivals === 2) releasePreflight(); await preflightBarrier;
  return { matched: true }; };
const raceResults = await Promise.allSettled([1, 2].map(() => raceRegistry.commit("effect:race", race.contentSha256, {
  preflight: racingPreflight, send: async () => { raceSends += 1; return { evidence: { verification: { state: "confirmed" } } }; }, capture,
})));
check("concurrent commit contenders consume one lease", raceSends === 1
  && raceResults.filter((entry) => entry.status === "rejected" && entry.reason?.code === "EFFECT_HEAD_CONFLICT").length === 1);
check("prototype covers every graduation axis", checks.length >= 16, `${checks.length} checks`);

console.log(`PASS Rehearse-Commit attempt: ${checks.length} checks`);
