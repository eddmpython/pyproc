// effectTransactionCanonical.js - intent부터 sealed receipt까지 immutable transaction 형식을 고정한다.
import { createHash } from "node:crypto";
import { assertActionEvidence } from "../perception/actionEvidence.js";
import { validatePostcondition } from "../perception/postconditionVerifier.js";
import { validateSituationFocus } from "../perception/situationCatalog.js";
import { canonicalExecutionMemoryJson } from "../executionMemory/executionMemoryCanonical.js";

export const EFFECT_TRANSACTION_FORMAT = "pyproc.effectTransactionRevision";
export const EFFECT_TRANSACTION_VERSION = 1;
export const EFFECT_TRANSACTION_STATES = Object.freeze([
  "prepared", "rehearsed", "approved", "sending", "finalizing", "terminal", "sealed",
]);
export const EFFECT_TERMINALS = Object.freeze([
  "confirmed", "contradicted", "ambiguous", "notObserved", "outcomeUnknown",
]);
export const REHEARSAL_COVERAGE = Object.freeze(["recorded", "cooperative", "computed", "liveReadOnly"]);

const DIGEST = /^[0-9a-f]{64}$/;
const ADDRESS = /^sha256:[0-9a-f]{64}$/;
const STATES = new Set(EFFECT_TRANSACTION_STATES);
const TERMINALS = new Set(EFFECT_TERMINALS);
const COVERAGE = new Set(REHEARSAL_COVERAGE);
const REVISION_KEYS = new Set(["format", "version", "transactionId", "revision", "parents", "intent", "state",
  "rehearsals", "approval", "lease", "effectResult", "receipt", "session", "provenance", "contentSha256"]);
const INTENT_KEYS = new Set(["format", "version", "intentId", "operation", "destination", "payloadBindingSha256",
  "risk", "focus", "effectTemplate", "expectedTransition", "environmentSha256", "executionSessionId",
  "sessionRevisionSha256", "createdAt", "contentSha256"]);
const DESTINATION_KEYS = new Set(["origin", "subjectSha256", "purpose"]);
const REHEARSAL_KEYS = new Set(["format", "version", "intentSha256", "coverage", "terminal", "source",
  "branch", "checkpoint", "situationSha256", "evidenceRefs", "limitations", "liveGuarantee", "createdAt",
  "contentSha256"]);
const SOURCE_KEYS = new Set(["kind", "contentSha256"]);
const GRANT_KEYS = new Set(["format", "version", "authorityId", "trustDomainSha256", "intentSha256",
  "destinationSha256", "risk", "sessionRevisionSha256", "expiresAt", "nonce", "policyVersion",
  "contentSha256", "signature"]);
const LEASE_KEYS = new Set(["format", "version", "leaseId", "intentSha256", "state", "sendBudget", "before",
  "reservedAt", "contentSha256"]);
const BEFORE_KEYS = new Set(["situationSha256", "machineImageSha256", "machineGeneration",
  "executionSessionRevisionSha256"]);
const RESULT_KEYS = new Set(["format", "version", "intentSha256", "leaseSha256", "providerKind", "terminal",
  "beforeSituationSha256", "afterSituationSha256", "machineBefore", "machineAfter", "actionEvidence",
  "errorCode", "completedAt", "contentSha256"]);
const MACHINE_KEYS = new Set(["imageSha256", "generation", "environment"]);
const RECEIPT_KEYS = new Set(["format", "version", "transactionId", "intentSha256", "rehearsalSha256",
  "approvalSha256", "leaseSha256", "effectResultSha256", "evidencePackSha256", "sessionBaseSha256",
  "sessionPendingSha256", "sessionTerminalSha256", "terminal", "sealedAt", "contentSha256"]);
const SESSION_KEYS = new Set(["executionSessionId", "baseSha256", "pendingSha256", "terminalSha256"]);
const PROVENANCE_KEYS = new Set(["createdAt", "source"]);

export function effectTransactionError(code, message, details = null, outcome = "notSent") {
  return Object.assign(new Error(message), { code, details, outcome, retryable: false });
}

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", `${label} must be an object`);
  }
  return value;
}

function exact(value, keys, label) {
  plain(value, label);
  for (const key of Object.keys(value)) if (!keys.has(key)) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", `${label}.${key} is unknown`);
  }
  for (const key of keys) if (!Object.hasOwn(value, key)) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", `${label}.${key} is required`);
  }
}

function bounded(value, label, maximum) {
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", `${label} must contain 1 to ${maximum} characters`);
  }
}

function timestamp(value, label) {
  if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value))) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", `${label} is invalid`);
  }
}

function digest(value, label, { address = false, nullable = false } = {}) {
  if (nullable && value === null) return;
  if (!(address ? ADDRESS : DIGEST).test(String(value || ""))) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", `${label} is invalid`);
  }
}

export function effectTransactionDigest(value) {
  return createHash("sha256").update(canonicalExecutionMemoryJson(value)).digest("hex");
}

function contentAddressed(content) {
  return Object.freeze({ ...content, contentSha256: effectTransactionDigest(content) });
}

function assertContentAddress(value, keys, label) {
  exact(value, keys, label);
  const { contentSha256, ...content } = value;
  digest(contentSha256, `${label}.contentSha256`);
  if (effectTransactionDigest(content) !== contentSha256) {
    throw effectTransactionError("EFFECT_TRANSACTION_MUTATED", `${label} digest does not match its content`);
  }
}

export function scanEffectTransactionSecrets(value, secretValues = [], path = "transaction") {
  if (typeof value === "string") {
    for (const secret of secretValues) if (secret && value.includes(secret)) {
      throw effectTransactionError("EFFECT_TRANSACTION_SECRET", `${path} contains configured secret material`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanEffectTransactionSecrets(entry, secretValues, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(password|passwd|token|access[_-]?token|api[_-]?key|cookie|set-cookie|authorization|client[_-]?secret|secret)$/i.test(key)) {
      throw effectTransactionError("EFFECT_TRANSACTION_SECRET", `${path}.${key} is a forbidden secret field`);
    }
    scanEffectTransactionSecrets(child, secretValues, `${path}.${key}`);
  }
}

function validateDestination(value) {
  exact(value, DESTINATION_KEYS, "EffectIntent.destination");
  let url;
  try { url = new URL(value.origin); } catch (error) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "EffectIntent destination origin is invalid");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== value.origin || url.username || url.password) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "EffectIntent destination must be an exact HTTP(S) origin");
  }
  digest(value.subjectSha256, "EffectIntent.destination.subjectSha256");
  bounded(value.purpose, "EffectIntent.destination.purpose", 512);
}

export function createEffectIntent({ intentId, destination, payloadBindingSha256, focus, effectTemplate,
  expectedTransition, environmentSha256, executionSessionId, sessionRevisionSha256, createdAt }) {
  const content = {
    format: "pyproc.effectIntent", version: 1, intentId, operation: "automation.act",
    destination: structuredClone(destination), payloadBindingSha256, risk: "externalEffect",
    focus: structuredClone(focus), effectTemplate: structuredClone(effectTemplate),
    expectedTransition: structuredClone(expectedTransition), environmentSha256,
    executionSessionId, sessionRevisionSha256, createdAt,
  };
  return validateEffectIntent(contentAddressed(content));
}

export function validateEffectIntent(value) {
  assertContentAddress(value, INTENT_KEYS, "EffectIntent");
  if (value.format !== "pyproc.effectIntent" || value.version !== 1
    || !/^intent:[A-Za-z0-9._:-]{1,96}$/.test(String(value.intentId || ""))
    || value.operation !== "automation.act" || value.risk !== "externalEffect"
    || !/^session:[A-Za-z0-9._:-]{1,96}$/.test(String(value.executionSessionId || ""))) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "EffectIntent envelope is invalid");
  }
  validateDestination(value.destination);
  digest(value.payloadBindingSha256, "EffectIntent.payloadBindingSha256");
  validateSituationFocus(value.focus);
  plain(value.effectTemplate, "EffectIntent.effectTemplate");
  if (canonicalExecutionMemoryJson(value.effectTemplate).length > 256 * 1024) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "EffectIntent effect template exceeds the byte limit");
  }
  validatePostcondition(value.expectedTransition);
  digest(value.environmentSha256, "EffectIntent.environmentSha256");
  digest(value.sessionRevisionSha256, "EffectIntent.sessionRevisionSha256");
  timestamp(value.createdAt, "EffectIntent.createdAt");
  return value;
}

export function createRehearsalReceipt({ intentSha256, coverage, terminal, source, branch = null,
  checkpoint = null, situationSha256 = null, evidenceRefs = [], limitations, createdAt }) {
  const content = { format: "pyproc.rehearsalReceipt", version: 1, intentSha256, coverage, terminal,
    source: structuredClone(source), branch, checkpoint, situationSha256,
    evidenceRefs: [...evidenceRefs], limitations: [...limitations], liveGuarantee: false, createdAt };
  return validateRehearsalReceipt(contentAddressed(content));
}

export function validateRehearsalReceipt(value) {
  assertContentAddress(value, REHEARSAL_KEYS, "RehearsalReceipt");
  exact(value.source, SOURCE_KEYS, "RehearsalReceipt.source");
  if (value.format !== "pyproc.rehearsalReceipt" || value.version !== 1 || !COVERAGE.has(value.coverage)
    || !["pass", "reject", "incomplete"].includes(value.terminal) || value.liveGuarantee !== false
    || !Array.isArray(value.evidenceRefs) || value.evidenceRefs.length > 64
    || value.evidenceRefs.some((ref) => typeof ref !== "string" || !ref || ref.length > 256)
    || new Set(value.evidenceRefs).size !== value.evidenceRefs.length
    || !Array.isArray(value.limitations) || value.limitations.length < 1 || value.limitations.length > 16
    || value.limitations.some((entry) => typeof entry !== "string" || !entry || entry.length > 512)) {
    throw effectTransactionError("EFFECT_REHEARSAL_INVALID", "RehearsalReceipt envelope is invalid");
  }
  digest(value.intentSha256, "RehearsalReceipt.intentSha256");
  bounded(value.source.kind, "RehearsalReceipt.source.kind", 64);
  digest(value.source.contentSha256, "RehearsalReceipt.source.contentSha256");
  if (value.branch !== null) bounded(value.branch, "RehearsalReceipt.branch", 1024);
  if (value.checkpoint !== null) bounded(value.checkpoint, "RehearsalReceipt.checkpoint", 1024);
  digest(value.situationSha256, "RehearsalReceipt.situationSha256", { nullable: true });
  timestamp(value.createdAt, "RehearsalReceipt.createdAt");
  return value;
}

export function validateApprovalGrant(value) {
  exact(value, GRANT_KEYS, "ApprovalGrant");
  const { signature: _signature, contentSha256, ...content } = value;
  digest(contentSha256, "ApprovalGrant.contentSha256");
  if (effectTransactionDigest(content) !== contentSha256) {
    throw effectTransactionError("EFFECT_APPROVAL_INVALID", "ApprovalGrant digest does not match its content");
  }
  if (value.format !== "pyproc.approvalGrant" || value.version !== 1 || value.risk !== "externalEffect") {
    throw effectTransactionError("EFFECT_APPROVAL_INVALID", "ApprovalGrant envelope is invalid");
  }
  bounded(value.authorityId, "ApprovalGrant.authorityId", 128);
  bounded(value.nonce, "ApprovalGrant.nonce", 256);
  bounded(value.policyVersion, "ApprovalGrant.policyVersion", 128);
  for (const key of ["trustDomainSha256", "intentSha256", "destinationSha256", "sessionRevisionSha256"]) {
    digest(value[key], `ApprovalGrant.${key}`);
  }
  timestamp(value.expiresAt, "ApprovalGrant.expiresAt");
  if (typeof value.signature !== "string" || value.signature.length < 40 || value.signature.length > 512) {
    throw effectTransactionError("EFFECT_APPROVAL_INVALID", "ApprovalGrant signature is invalid");
  }
  return value;
}

export function createCommitLease({ leaseId, intentSha256, before, reservedAt }) {
  const content = { format: "pyproc.commitLease", version: 1, leaseId, intentSha256,
    state: "sending", sendBudget: 1, before: structuredClone(before), reservedAt };
  return validateCommitLease(contentAddressed(content));
}

export function validateCommitLease(value) {
  assertContentAddress(value, LEASE_KEYS, "CommitLease");
  exact(value.before, BEFORE_KEYS, "CommitLease.before");
  if (value.format !== "pyproc.commitLease" || value.version !== 1 || value.state !== "sending"
    || value.sendBudget !== 1 || !/^lease:[A-Za-z0-9._:-]{1,128}$/.test(String(value.leaseId || ""))) {
    throw effectTransactionError("EFFECT_LEASE_INVALID", "CommitLease envelope is invalid");
  }
  digest(value.intentSha256, "CommitLease.intentSha256");
  digest(value.before.situationSha256, "CommitLease.before.situationSha256");
  digest(value.before.machineImageSha256, "CommitLease.before.machineImageSha256");
  digest(value.before.machineGeneration, "CommitLease.before.machineGeneration", { address: true });
  digest(value.before.executionSessionRevisionSha256, "CommitLease.before.executionSessionRevisionSha256");
  timestamp(value.reservedAt, "CommitLease.reservedAt");
  return value;
}

function validateMachine(value, label) {
  exact(value, MACHINE_KEYS, label);
  digest(value.imageSha256, `${label}.imageSha256`);
  digest(value.generation, `${label}.generation`, { address: true });
  digest(value.environment, `${label}.environment`);
}

export function createEffectResult({ intentSha256, leaseSha256, providerKind, terminal,
  beforeSituationSha256, afterSituationSha256 = null, machineBefore, machineAfter,
  actionEvidence = [], errorCode = null, completedAt }) {
  const content = { format: "pyproc.effectResult", version: 1, intentSha256, leaseSha256, providerKind,
    terminal, beforeSituationSha256, afterSituationSha256, machineBefore: structuredClone(machineBefore),
    machineAfter: structuredClone(machineAfter), actionEvidence: structuredClone(actionEvidence), errorCode, completedAt };
  return validateEffectResult(contentAddressed(content));
}

export function validateEffectResult(value) {
  assertContentAddress(value, RESULT_KEYS, "EffectResult");
  if (value.format !== "pyproc.effectResult" || value.version !== 1 || !TERMINALS.has(value.terminal)
    || !Array.isArray(value.actionEvidence) || value.actionEvidence.length > 16) {
    throw effectTransactionError("EFFECT_RESULT_INVALID", "EffectResult envelope is invalid");
  }
  bounded(value.providerKind, "EffectResult.providerKind", 64);
  digest(value.intentSha256, "EffectResult.intentSha256");
  digest(value.leaseSha256, "EffectResult.leaseSha256");
  digest(value.beforeSituationSha256, "EffectResult.beforeSituationSha256");
  digest(value.afterSituationSha256, "EffectResult.afterSituationSha256", { nullable: true });
  validateMachine(value.machineBefore, "EffectResult.machineBefore");
  validateMachine(value.machineAfter, "EffectResult.machineAfter");
  value.actionEvidence.forEach(assertActionEvidence);
  if (value.terminal === "confirmed" && (!value.actionEvidence.length
    || value.actionEvidence.some((evidence) => evidence.verification.state !== "confirmed"))) {
    throw effectTransactionError("EFFECT_RESULT_INVALID", "confirmed result requires confirmed ActionEvidence");
  }
  if (value.terminal === "outcomeUnknown" && value.actionEvidence.some((evidence) =>
    evidence.verification.state === "confirmed")) {
    throw effectTransactionError("EFFECT_RESULT_INVALID", "unknown result contradicts confirmed ActionEvidence");
  }
  if (value.errorCode !== null) bounded(value.errorCode, "EffectResult.errorCode", 128);
  timestamp(value.completedAt, "EffectResult.completedAt");
  return value;
}

export function createEffectReceipt(input) {
  const content = { format: "pyproc.effectReceipt", version: 1, ...structuredClone(input) };
  return validateEffectReceipt(contentAddressed(content));
}

export function validateEffectReceipt(value) {
  assertContentAddress(value, RECEIPT_KEYS, "EffectReceipt");
  if (value.format !== "pyproc.effectReceipt" || value.version !== 1
    || !/^effect:[A-Za-z0-9._:-]{1,96}$/.test(String(value.transactionId || ""))
    || !Array.isArray(value.rehearsalSha256) || value.rehearsalSha256.length < 1
    || value.rehearsalSha256.some((entry) => !DIGEST.test(entry)) || !TERMINALS.has(value.terminal)) {
    throw effectTransactionError("EFFECT_RECEIPT_INVALID", "EffectReceipt envelope is invalid");
  }
  for (const key of ["intentSha256", "approvalSha256", "leaseSha256", "effectResultSha256",
    "evidencePackSha256", "sessionBaseSha256", "sessionPendingSha256", "sessionTerminalSha256"]) {
    digest(value[key], `EffectReceipt.${key}`);
  }
  timestamp(value.sealedAt, "EffectReceipt.sealedAt");
  return value;
}

export function createEffectTransactionRevision({ transactionId, revision, parents, intent, state, rehearsals,
  approval = null, lease = null, effectResult = null, receipt = null, session, provenance }) {
  const content = { format: EFFECT_TRANSACTION_FORMAT, version: EFFECT_TRANSACTION_VERSION, transactionId,
    revision, parents: [...parents], intent: structuredClone(intent), state,
    rehearsals: structuredClone(rehearsals), approval: approval === null ? null : structuredClone(approval),
    lease: lease === null ? null : structuredClone(lease),
    effectResult: effectResult === null ? null : structuredClone(effectResult),
    receipt: receipt === null ? null : structuredClone(receipt), session: structuredClone(session),
    provenance: structuredClone(provenance) };
  return validateEffectTransactionRevision(contentAddressed(content));
}

export function effectTransactionBytes(revision) {
  const { contentSha256: _contentSha256, ...content } = validateEffectTransactionRevision(revision);
  return Buffer.from(canonicalExecutionMemoryJson(content));
}

export function validateEffectTransactionRevision(value) {
  assertContentAddress(value, REVISION_KEYS, "EffectTransactionRevision");
  exact(value.session, SESSION_KEYS, "EffectTransactionRevision.session");
  exact(value.provenance, PROVENANCE_KEYS, "EffectTransactionRevision.provenance");
  if (value.format !== EFFECT_TRANSACTION_FORMAT || value.version !== EFFECT_TRANSACTION_VERSION
    || !/^effect:[A-Za-z0-9._:-]{1,96}$/.test(String(value.transactionId || ""))
    || !Number.isSafeInteger(value.revision) || value.revision < 1 || !STATES.has(value.state)
    || !Array.isArray(value.parents) || value.parents.length > 1
    || value.parents.some((entry) => !DIGEST.test(entry)) || !Array.isArray(value.rehearsals)
    || value.rehearsals.length > 64) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "EffectTransactionRevision envelope is invalid");
  }
  validateEffectIntent(value.intent);
  value.rehearsals.forEach((receipt) => {
    validateRehearsalReceipt(receipt);
    if (receipt.intentSha256 !== value.intent.contentSha256) {
      throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "rehearsal belongs to another intent");
    }
  });
  if (value.approval !== null) validateApprovalGrant(value.approval);
  if (value.lease !== null) validateCommitLease(value.lease);
  if (value.effectResult !== null) validateEffectResult(value.effectResult);
  if (value.receipt !== null) validateEffectReceipt(value.receipt);
  if (value.intent.executionSessionId !== value.session.executionSessionId
    || value.intent.sessionRevisionSha256 !== value.session.baseSha256) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "transaction session base does not match intent");
  }
  bounded(value.session.executionSessionId, "EffectTransactionRevision.session.executionSessionId", 104);
  digest(value.session.baseSha256, "EffectTransactionRevision.session.baseSha256");
  digest(value.session.pendingSha256, "EffectTransactionRevision.session.pendingSha256", { nullable: true });
  digest(value.session.terminalSha256, "EffectTransactionRevision.session.terminalSha256", { nullable: true });
  bounded(value.provenance.source, "EffectTransactionRevision.provenance.source", 128);
  timestamp(value.provenance.createdAt, "EffectTransactionRevision.provenance.createdAt");
  if (value.state === "prepared" && value.rehearsals.length !== 0) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "prepared transaction cannot contain rehearsals");
  }
  if (["rehearsed", "approved", "sending", "finalizing", "terminal", "sealed"].includes(value.state)
    && value.rehearsals.length < 1) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "rehearsed transaction requires a receipt");
  }
  if (["prepared", "rehearsed"].includes(value.state) && [value.approval, value.lease, value.effectResult, value.receipt]
    .some((entry) => entry !== null)) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "pre-approval transaction contains later state objects");
  }
  if (["approved", "sending", "finalizing", "terminal", "sealed"].includes(value.state)
    && (!value.approval || !value.session.pendingSha256)) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "approved transaction lacks grant or pending session");
  }
  if (value.approval && (value.approval.intentSha256 !== value.intent.contentSha256
    || value.approval.destinationSha256 !== effectTransactionDigest(value.intent.destination)
    || value.approval.risk !== value.intent.risk
    || value.approval.sessionRevisionSha256 !== value.intent.sessionRevisionSha256)) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "approval does not link the exact transaction intent");
  }
  if (["sending", "finalizing", "terminal", "sealed"].includes(value.state) && !value.lease) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "effect boundary lacks CommitLease");
  }
  if (value.state === "approved" && [value.lease, value.effectResult, value.receipt].some((entry) => entry !== null)) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "approved transaction contains post-send objects");
  }
  if (value.lease && (value.lease.intentSha256 !== value.intent.contentSha256
    || value.lease.before.executionSessionRevisionSha256 !== value.session.pendingSha256)) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "CommitLease does not link the exact pending intent");
  }
  if (["finalizing", "terminal", "sealed"].includes(value.state) && !value.effectResult) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "terminal transaction lacks EffectResult");
  }
  if (value.state === "sending" && [value.effectResult, value.receipt].some((entry) => entry !== null)) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "sending transaction contains terminal objects");
  }
  if (value.effectResult && (value.effectResult.intentSha256 !== value.intent.contentSha256
    || value.effectResult.leaseSha256 !== value.lease?.contentSha256
    || value.effectResult.beforeSituationSha256 !== value.lease?.before.situationSha256
    || value.effectResult.machineBefore.imageSha256 !== value.lease?.before.machineImageSha256
    || value.effectResult.machineBefore.generation !== value.lease?.before.machineGeneration)) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "EffectResult does not link the exact send boundary");
  }
  if (["terminal", "sealed"].includes(value.state) && !value.session.terminalSha256) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "terminal transaction lacks final session revision");
  }
  if (value.state === "finalizing" && (value.session.terminalSha256 !== null || value.receipt !== null)) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "finalizing transaction contains sealed state");
  }
  if (value.state === "terminal" && value.receipt !== null) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "terminal transaction contains an unsealed receipt");
  }
  if (value.state === "sealed" && !value.receipt) {
    throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "sealed transaction lacks EffectReceipt");
  }
  if (value.receipt) {
    const rehearsals = value.rehearsals.map((entry) => entry.contentSha256);
    if (value.receipt.transactionId !== value.transactionId
      || value.receipt.intentSha256 !== value.intent.contentSha256
      || canonicalExecutionMemoryJson(value.receipt.rehearsalSha256) !== canonicalExecutionMemoryJson(rehearsals)
      || value.receipt.approvalSha256 !== value.approval?.contentSha256
      || value.receipt.leaseSha256 !== value.lease?.contentSha256
      || value.receipt.effectResultSha256 !== value.effectResult?.contentSha256
      || value.receipt.sessionBaseSha256 !== value.session.baseSha256
      || value.receipt.sessionPendingSha256 !== value.session.pendingSha256
      || value.receipt.sessionTerminalSha256 !== value.session.terminalSha256
      || value.receipt.terminal !== value.effectResult?.terminal) {
      throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "EffectReceipt does not close the exact transaction chain");
    }
  }
  return value;
}
