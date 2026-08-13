// effectTransactionPrototype.mjs - exact intent, signed approval, one-shot send의 최소 반증 모델.
import { createHash, sign, verify } from "node:crypto";

const DIGEST = /^[0-9a-f]{64}$/;
const STATES = new Set(["prepared", "rehearsed", "approved", "sending", "confirmed", "contradicted", "outcomeUnknown"]);

function failure(code, message, outcome = "notSent") {
  return Object.assign(new Error(message), { code, outcome, retryable: false });
}

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw failure("EFFECT_INVALID", `${label} must be an object`);
  return value;
}

function exact(value, keys, label) {
  plain(value, label);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw failure("EFFECT_INVALID", `${label}.${key} is unknown`);
  for (const key of keys) if (!Object.hasOwn(value, key)) throw failure("EFFECT_INVALID", `${label}.${key} is required`);
}

export function prototypeCanonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(prototypeCanonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${prototypeCanonical(value[key])}`).join(",")}}`;
  throw failure("EFFECT_INVALID", "canonical value is unsupported");
}

export function prototypeDigest(value) {
  return createHash("sha256").update(typeof value === "string" ? value : prototypeCanonical(value)).digest("hex");
}

function scanSecrets(value, secrets, path = "value") {
  if (typeof value === "string") {
    if (secrets.some((secret) => secret && value.includes(secret))) throw failure("EFFECT_SECRET", `${path} contains secret material`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((entry, index) => scanSecrets(entry, secrets, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(password|token|cookie|authorization|secret)$/i.test(key)) throw failure("EFFECT_SECRET", `${path}.${key} is forbidden`);
    scanSecrets(child, secrets, `${path}.${key}`);
  }
}

function withDigest(content) {
  return Object.freeze({ ...content, contentSha256: prototypeDigest(content) });
}

export function createPrototypeIntent(input, secrets = []) {
  exact(input, ["intentId", "operation", "destination", "payloadBindingSha256", "risk", "preconditions",
    "expectedTransition", "environmentSha256", "executionSessionId", "sessionRevisionSha256"], "EffectIntent");
  if (!/^intent:[A-Za-z0-9._:-]{1,96}$/.test(input.intentId)
    || input.operation !== "automation.act"
    || !DIGEST.test(input.payloadBindingSha256)
    || input.risk !== "externalEffect"
    || !DIGEST.test(input.environmentSha256)
    || !/^session:[A-Za-z0-9._:-]{1,96}$/.test(input.executionSessionId)
    || !DIGEST.test(input.sessionRevisionSha256)
    || !Array.isArray(input.preconditions) || input.preconditions.length < 1
    || !plain(input.destination, "EffectIntent.destination")
    || !plain(input.expectedTransition, "EffectIntent.expectedTransition")) {
    throw failure("EFFECT_INVALID", "EffectIntent envelope is invalid");
  }
  const content = Object.freeze({ format: "pyproc.effectIntent", version: 1, ...structuredClone(input) });
  scanSecrets(content, secrets);
  return withDigest(content);
}

export function createPrototypeGrant({ intent, authorityId, trustDomainSha256, expiresAt, nonce, policyVersion }, privateKey) {
  const content = {
    format: "pyproc.approvalGrant", version: 1, authorityId, trustDomainSha256,
    intentSha256: intent.contentSha256, destinationSha256: prototypeDigest(intent.destination), risk: intent.risk,
    sessionRevisionSha256: intent.sessionRevisionSha256, expiresAt, nonce, policyVersion,
  };
  const grant = withDigest(content);
  return Object.freeze({ ...grant, signature: sign(null, Buffer.from(prototypeCanonical(grant)), privateKey).toString("base64") });
}

function verifyGrant(grant, intent, { authorityId, publicKey, trustDomainSha256, now }) {
  exact(grant, ["format", "version", "authorityId", "trustDomainSha256", "intentSha256", "destinationSha256",
    "risk", "sessionRevisionSha256", "expiresAt", "nonce", "policyVersion", "contentSha256", "signature"], "ApprovalGrant");
  const { signature, contentSha256, ...content } = grant;
  const unsigned = { ...content, contentSha256 };
  if (grant.format !== "pyproc.approvalGrant" || grant.version !== 1 || grant.authorityId !== authorityId
    || grant.trustDomainSha256 !== trustDomainSha256 || grant.intentSha256 !== intent.contentSha256
    || grant.destinationSha256 !== prototypeDigest(intent.destination) || grant.risk !== intent.risk
    || grant.sessionRevisionSha256 !== intent.sessionRevisionSha256
    || contentSha256 !== prototypeDigest(content) || Date.parse(grant.expiresAt) <= now()
    || !verify(null, Buffer.from(prototypeCanonical(unsigned)), publicKey, Buffer.from(signature, "base64"))) {
    throw failure("EFFECT_APPROVAL_STALE", "approval does not authorize the exact current intent");
  }
  return Object.freeze(structuredClone(grant));
}

export class PrototypeEffectStore {
  constructor() { this.objects = new Map(); this.heads = new Map(); }
  put(revision) { this.objects.set(revision.contentSha256, structuredClone(revision)); }
  get(digest) { return structuredClone(this.objects.get(digest)); }
  head(transactionId) { return this.heads.get(transactionId) || null; }
  cas(transactionId, expected, revision) {
    if (this.head(transactionId) !== expected) throw failure("EFFECT_HEAD_CONFLICT", "transaction HEAD changed");
    this.put(revision);
    this.heads.set(transactionId, revision.contentSha256);
    return revision;
  }
}

function revisionFrom(prior, patch) {
  const content = {
    format: "pyproc.effectTransactionRevision", version: 1, transactionId: prior.transactionId,
    revision: prior.revision + 1, parentSha256: prior.contentSha256, intent: prior.intent,
    state: patch.state, rehearsals: patch.rehearsals ?? prior.rehearsals,
    approval: patch.approval === undefined ? prior.approval : patch.approval,
    lease: patch.lease === undefined ? prior.lease : patch.lease,
    receipt: patch.receipt === undefined ? prior.receipt : patch.receipt,
  };
  if (!STATES.has(content.state)) throw failure("EFFECT_INVALID", "transaction state is invalid");
  return withDigest(content);
}

export class PrototypeEffectRegistry {
  constructor({ store = new PrototypeEffectStore(), authorityId, publicKey, trustDomainSha256,
    secrets = [], now = () => Date.now() } = {}) {
    this.store = store;
    this.authorityId = authorityId;
    this.publicKey = publicKey;
    this.trustDomainSha256 = trustDomainSha256;
    this.secrets = [...secrets];
    this.now = now;
  }

  prepare(transactionId, input) {
    if (this.store.head(transactionId)) throw failure("EFFECT_EXISTS", "transaction already exists");
    const intent = createPrototypeIntent(input, this.secrets);
    const content = { format: "pyproc.effectTransactionRevision", version: 1, transactionId, revision: 1,
      parentSha256: null, intent, state: "prepared", rehearsals: [], approval: null, lease: null, receipt: null };
    const revision = withDigest(content);
    return this.store.cas(transactionId, null, revision);
  }

  open(transactionId) {
    const revision = this.store.get(this.store.head(transactionId));
    if (!revision) throw failure("EFFECT_NOT_FOUND", "transaction is unavailable");
    const { contentSha256, ...content } = revision;
    if (contentSha256 !== prototypeDigest(content)) throw failure("EFFECT_MUTATED", "transaction revision changed");
    return Object.freeze(revision);
  }

  rehearse(transactionId, expected, input) {
    const current = this.open(transactionId);
    if (current.contentSha256 !== expected) throw failure("EFFECT_HEAD_CONFLICT", "transaction HEAD changed");
    exact(input, ["coverage", "terminal", "sourceSha256", "evidenceSha256", "limitations"], "RehearsalReceipt");
    if (!["recorded", "cooperative", "computed", "liveReadOnly"].includes(input.coverage)
      || !["pass", "reject", "incomplete"].includes(input.terminal)
      || !DIGEST.test(input.sourceSha256) || !DIGEST.test(input.evidenceSha256)
      || !Array.isArray(input.limitations) || input.limitations.length < 1
      || input.limitations.some((item) => typeof item !== "string" || /live guarantee/i.test(item))) {
      throw failure("EFFECT_REHEARSAL_INVALID", "rehearsal receipt is not truthful");
    }
    const receipt = withDigest({ format: "pyproc.rehearsalReceipt", version: 1,
      intentSha256: current.intent.contentSha256, ...structuredClone(input), liveGuarantee: false });
    scanSecrets(receipt, this.secrets);
    return this.store.cas(transactionId, expected, revisionFrom(current, {
      state: "rehearsed", rehearsals: Object.freeze([...current.rehearsals, receipt]),
    }));
  }

  approve(transactionId, expected, grant) {
    const current = this.open(transactionId);
    if (current.contentSha256 !== expected) throw failure("EFFECT_HEAD_CONFLICT", "transaction HEAD changed");
    if (!current.rehearsals.some((receipt) => receipt.terminal === "pass")) {
      throw failure("EFFECT_REHEARSAL_REQUIRED", "approval requires a passing rehearsal");
    }
    const accepted = verifyGrant(grant, current.intent, this);
    scanSecrets(accepted, this.secrets);
    return this.store.cas(transactionId, expected, revisionFrom(current, { state: "approved", approval: accepted }));
  }

  async commit(transactionId, expected, { preflight, send, capture, crashAfterSend = false } = {}) {
    let current = this.open(transactionId);
    if (["confirmed", "contradicted", "outcomeUnknown"].includes(current.state)) return current;
    if (current.state === "sending") return this.recover(transactionId, current.contentSha256, capture);
    if (current.contentSha256 !== expected) throw failure("EFFECT_HEAD_CONFLICT", "transaction HEAD changed");
    if (current.state !== "approved") throw failure("EFFECT_STATE", "transaction is not approved");
    verifyGrant(current.approval, current.intent, this);
    const before = await preflight(current.intent);
    if (!before?.matched) throw failure("EFFECT_PREFLIGHT_MISMATCH", "live precondition changed");
    const lease = withDigest({ format: "pyproc.commitLease", version: 1,
      leaseId: `lease:${current.intent.intentId.slice(7)}`, intentSha256: current.intent.contentSha256,
      state: "sending", sendBudget: 1, reservedAt: new Date(this.now()).toISOString() });
    current = this.store.cas(transactionId, expected, revisionFrom(current, { state: "sending", lease }));
    let action;
    try { action = await send(current.intent); }
    catch (error) { return this._finishUnknown(current, before, error?.actionEvidence || null, capture); }
    if (crashAfterSend) throw failure("INJECTED_CRASH", "process stopped after effect send", "outcomeUnknown");
    if (!action?.evidence || !["confirmed", "contradicted", "outcomeUnknown"].includes(action.evidence.verification?.state)) {
      return this._finishUnknown(current, before, action?.evidence || null, capture);
    }
    const terminal = action.evidence.verification.state;
    if (terminal === "outcomeUnknown") return this._finishUnknown(current, before, action.evidence, capture);
    return this._finish(current, terminal, before, await capture(), action.evidence);
  }

  async recover(transactionId, expected, capture) {
    const current = this.open(transactionId);
    if (current.contentSha256 !== expected) throw failure("EFFECT_HEAD_CONFLICT", "transaction HEAD changed");
    if (current.state !== "sending") return current;
    return this._finishUnknown(current, null, null, capture);
  }

  async _finishUnknown(current, before, evidence, capture) {
    return this._finish(current, "outcomeUnknown", before, await capture(), evidence);
  }

  _finish(current, terminal, before, after, evidence) {
    const receipt = withDigest({ format: "pyproc.effectReceipt", version: 1,
      intentSha256: current.intent.contentSha256,
      rehearsalSha256: current.rehearsals[current.rehearsals.length - 1].contentSha256,
      approvalSha256: current.approval.contentSha256, leaseSha256: current.lease.contentSha256,
      beforeSha256: before?.situationSha256 || null, afterSha256: after?.situationSha256 || null,
      evidenceSha256: evidence ? prototypeDigest(evidence) : null,
      machineBeforeSha256: before?.machineSha256 || null, machineAfterSha256: after?.machineSha256 || null,
      sessionRevisionSha256: current.intent.sessionRevisionSha256, terminal,
    });
    scanSecrets(receipt, this.secrets);
    return this.store.cas(current.transactionId, current.contentSha256,
      revisionFrom(current, { state: terminal, lease: Object.freeze({ ...current.lease, state: "consumed" }), receipt }));
  }
}
