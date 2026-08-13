import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApprovalGrant } from "../../scripts/effectTransaction/approvalGrant.js";
import { EffectTransactionRegistry } from "../../scripts/effectTransaction/effectTransactionRegistry.js";
import { createEffectReceipt, createEffectTransactionRevision, effectTransactionDigest }
  from "../../scripts/effectTransaction/effectTransactionCanonical.js";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function errorOf(operation) { try { await operation(); return null; } catch (error) { return error; } }
const digest = (value) => effectTransactionDigest(value);

function situationSha(label) { return digest(`situation:${label}`); }
function machine(label) {
  return Object.freeze({ imageSha256: digest(`image:${label}`), generation: `sha256:${digest(`generation:${label}`)}`,
    environment: digest("environment:contract") });
}
function actionEvidence(state = "confirmed") {
  return Object.freeze({ evidenceRef: `evidence:${state}`, actionRef: `action:${state}`,
    beforeObservationRef: `observation:${state}-before`, afterObservationRef: `observation:${state}-after`,
    effectOutcome: state === "outcomeUnknown" ? "outcomeUnknown" : "applied",
    verification: Object.freeze({ state, postcondition: { networkResponse: { method: "POST",
      urlPath: "/payments", status: 201 } }, evidenceRefs: Object.freeze([`event:${state}`]) }),
    effectWindow: Object.freeze({ startedAt: 1, endedAt: 2 }) });
}
function effectTemplate(secretEnv = null) {
  return Object.freeze({
    sessionRef: { protocolVersion: "1", spaceId: "space:native", sessionId: "session:browser", targetRef: "target:payment" },
    focus: { objective: "Commit the prepared payment", requirements: [{
      requirementRef: "requirement:submit", select: { role: "button", name: "Submit", actionable: true },
      need: ["fact", "affordance"], cardinality: "one",
    }] },
    actions: [{ kind: secretEnv ? "fill" : "click", requirementRef: "requirement:submit",
      expectedRisk: "externalEffect", ...(secretEnv ? { value: { secretEnv } } : {}),
      verify: { networkResponse: { method: "POST", urlPath: "/payments", status: 201 } } }],
  });
}
function prepareInput(transactionId, template = effectTemplate()) {
  return Object.freeze({ transactionId, intentId: `intent:${transactionId.slice(7)}`,
    destination: { origin: "https://payments.example.test", subjectSha256: digest("account:contract"),
      purpose: "Submit the approved contract fixture" }, effectTemplate: template,
    expectedTransition: { networkResponse: { method: "POST", urlPath: "/payments", status: 201 } },
    environmentSha256: digest("environment:contract"), executionSessionId: "session:contract",
    sessionRevisionSha256: digest("session:base") });
}
function rehearsal() {
  return Object.freeze({ coverage: "computed", terminal: "pass",
    source: { kind: "pythonBranch", contentSha256: digest("branch:contract") }, branch: "candidate:contract",
    checkpoint: "checkpoint:contract", situationSha256: null, evidenceRefs: ["oracle:contract"],
    limitations: ["Computed payload only; current browser and service acceptance remain unproven."] });
}

export async function assertEffectTransactionContract() {
  const root = await mkdtemp(join(tmpdir(), "pyproc-effect-transaction-"));
  const foreignRoot = await mkdtemp(join(tmpdir(), "pyproc-effect-transaction-foreign-"));
  const pair = generateKeyPairSync("ed25519");
  let now = Date.parse("2026-08-13T00:00:00.000Z");
  const authority = { authorityId: "operator:contract", publicKey: pair.publicKey };
  try {
    const registry = await EffectTransactionRegistry.open({ root, approvalAuthorities: [authority],
      secretBindings: { PAYMENT_SECRET: "fixture-secret-value" }, now: () => now,
      idFactory: (() => { let sequence = 0; return () => `contract-${++sequence}`; })() });
    let current = await registry.prepareTransaction(prepareInput("effect:contract", effectTemplate("PAYMENT_SECRET")));
    assert(current.state === "prepared" && current.intent.effectTemplate.actions[0].value.secretEnv === "PAYMENT_SECRET"
      && current.intent.effectTemplate.actions[0].value.bindingSha256.length === 64,
    "secret placeholder가 bounded binding으로 저장되지 않았다");
    const stored = await readFile(join(root, "effectTransactions", "objects", `${current.contentSha256}.json`));
    assert(!stored.includes(Buffer.from("fixture-secret-value")) && !stored.includes(Buffer.from("fixture-secret-value", "utf16le")),
      "secret 원문이 transaction object에 유출됐다");

    current = await registry.bindPendingSession("effect:contract", current.contentSha256, digest("session:pending"));
    current = await registry.addRehearsal("effect:contract", current.contentSha256, rehearsal());
    const trust = registry.inspectTrustDomain();
    const grant = createApprovalGrant({ intent: current.intent, authorityId: "operator:contract",
      trustDomainSha256: trust.trustDomainSha256, expiresAt: "2026-08-13T01:00:00.000Z",
      nonce: "nonce:contract", policyVersion: "contract/1" }, pair.privateKey);
    current = await registry.approveTransaction("effect:contract", current.contentSha256, grant);
    assert(current.state === "approved" && current.approval.contentSha256 === grant.contentSha256,
      "signed exact grant가 approved revision에 연결되지 않았다");

    const stale = await registry.prepareTransaction({ ...prepareInput("effect:stale"),
      sessionRevisionSha256: digest("session:changed") });
    let staleReady = await registry.bindPendingSession("effect:stale", stale.contentSha256, digest("session:stale-pending"));
    staleReady = await registry.addRehearsal("effect:stale", staleReady.contentSha256, rehearsal());
    assert((await errorOf(() => registry.approveTransaction("effect:stale", staleReady.contentSha256, grant)))?.code
      === "EFFECT_APPROVAL_STALE", "changed session revision이 old approval을 무효화하지 않았다");

    const foreign = await EffectTransactionRegistry.open({ root: foreignRoot, approvalAuthorities: [authority],
      now: () => now });
    let foreignCurrent = await foreign.prepareTransaction(prepareInput("effect:foreign"));
    foreignCurrent = await foreign.bindPendingSession("effect:foreign", foreignCurrent.contentSha256, digest("session:foreign-pending"));
    foreignCurrent = await foreign.addRehearsal("effect:foreign", foreignCurrent.contentSha256, rehearsal());
    assert((await errorOf(() => foreign.approveTransaction("effect:foreign", foreignCurrent.contentSha256, grant)))?.code
      === "EFFECT_APPROVAL_STALE", "foreign trust domain이 imported grant를 활성화했다");

    const expectedApproved = current.contentSha256;
    const before = { situationSha256: situationSha("before"), machineImageSha256: machine("before").imageSha256,
      machineGeneration: machine("before").generation, executionSessionRevisionSha256: digest("session:pending") };
    const contenders = await Promise.allSettled([1, 2].map(() =>
      registry.reserveCommit("effect:contract", expectedApproved, before)));
    const fulfilled = contenders.filter((entry) => entry.status === "fulfilled");
    assert(fulfilled.length === 1 && (await registry.openTransaction("effect:contract")).state === "sending",
      "concurrent contenders가 one-shot lease를 하나만 소비하지 않았다");
    current = fulfilled[0].value;
    current = await registry.recordEffectResult("effect:contract", current.contentSha256, {
      providerKind: "nativeCdp", terminal: "confirmed", afterSituationSha256: situationSha("after"),
      machineBefore: machine("before"), machineAfter: machine("after"), actionEvidence: [actionEvidence()], errorCode: null,
    });
    assert(current.state === "finalizing" && current.effectResult.terminal === "confirmed",
      "confirmed ActionEvidence가 finalizing result로 보존되지 않았다");
    current = await registry.bindTerminalSession("effect:contract", current.contentSha256, digest("session:terminal"));
    assert(current.state === "terminal", "terminal session revision이 effect result에 결속되지 않았다");
    assert((await errorOf(() => registry.sealTransaction("effect:contract", current.contentSha256,
      { contentSha256: digest("evidence:incomplete"), verdict: "incomplete" })))?.code === "EFFECT_EVIDENCE_UNVERIFIED",
    "incomplete Evidence Pack이 EffectReceipt를 봉인했다");
    current = await registry.sealTransaction("effect:contract", current.contentSha256,
      { contentSha256: digest("evidence:verified"), verdict: "verified" });
    assert(current.state === "sealed" && current.receipt.terminal === "confirmed"
      && current.receipt.rehearsalSha256.length === 1 && current.receipt.sessionTerminalSha256 === digest("session:terminal"),
    "sealed EffectReceipt가 required link를 잃었다");
    const { format: _receiptFormat, version: _receiptVersion, contentSha256: _receiptSha, ...receiptInput }
      = current.receipt;
    const wrongReceipt = createEffectReceipt({ ...receiptInput, intentSha256: digest("intent:wrong") });
    const { format: _revisionFormat, version: _revisionVersion, contentSha256: _revisionSha, ...revisionInput }
      = current;
    assert((await errorOf(async () => createEffectTransactionRevision({ ...revisionInput,
      receipt: wrongReceipt })))?.code === "EFFECT_TRANSACTION_INVALID",
    "content-addressed지만 다른 intent를 가리키는 EffectReceipt가 transaction chain을 닫았다");
    assert((await registry.listTransactions()).some((entry) => entry.transactionId === "effect:contract"
      && entry.sealed), "durable transaction list가 sealed HEAD를 다시 열지 못했다");

    now = Date.parse("2026-08-13T02:00:00.000Z");
    let expired = await registry.prepareTransaction(prepareInput("effect:expired"));
    expired = await registry.bindPendingSession("effect:expired", expired.contentSha256, digest("session:expired-pending"));
    expired = await registry.addRehearsal("effect:expired", expired.contentSha256, rehearsal());
    const expiredGrant = createApprovalGrant({ intent: expired.intent, authorityId: "operator:contract",
      trustDomainSha256: trust.trustDomainSha256, expiresAt: "2026-08-13T01:00:00.000Z",
      nonce: "nonce:expired", policyVersion: "contract/1" }, pair.privateKey);
    assert((await errorOf(() => registry.approveTransaction("effect:expired", expired.contentSha256, expiredGrant)))?.code
      === "EFFECT_APPROVAL_EXPIRED", "expired approval이 accepted 됐다");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(foreignRoot, { recursive: true, force: true });
  }
}
