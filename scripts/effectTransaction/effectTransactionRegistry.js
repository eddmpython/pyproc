// effectTransactionRegistry.js - immutable transaction revision과 durable one-shot lease를 전이한다.
import { randomBytes } from "node:crypto";
import {
  createCommitLease,
  createEffectIntent,
  createEffectReceipt,
  createEffectResult,
  createEffectTransactionRevision,
  createRehearsalReceipt,
  effectTransactionError,
  scanEffectTransactionSecrets,
  validateEffectTransactionRevision,
} from "./effectTransactionCanonical.js";
import { normalizeEffectTemplate, validateStoredEffectTemplate } from "./effectInput.js";
import { verifyApprovalGrant } from "./approvalGrant.js";
import { FileEffectTransactionStore } from "./fileEffectTransactionStore.js";
import { ExecutionMemoryArtifacts } from "../executionMemory/executionMemoryArtifacts.js";

function nowIso(now) { return new Date(now()).toISOString(); }

function nextRevision(current, patch, now, source) {
  return createEffectTransactionRevision({
    transactionId: current.transactionId,
    revision: current.revision + 1,
    parents: [current.contentSha256],
    intent: current.intent,
    state: patch.state,
    rehearsals: patch.rehearsals ?? current.rehearsals,
    approval: patch.approval === undefined ? current.approval : patch.approval,
    lease: patch.lease === undefined ? current.lease : patch.lease,
    effectResult: patch.effectResult === undefined ? current.effectResult : patch.effectResult,
    receipt: patch.receipt === undefined ? current.receipt : patch.receipt,
    session: patch.session ?? current.session,
    provenance: { createdAt: nowIso(now), source },
  });
}

function expected(current, expectedSha256) {
  if (current.contentSha256 !== expectedSha256) {
    throw effectTransactionError("EFFECT_TRANSACTION_HEAD_CONFLICT", "transaction HEAD changed",
      { expected: expectedSha256, actual: current.contentSha256 });
  }
}

function state(current, allowed) {
  if (!allowed.includes(current.state)) {
    throw effectTransactionError("EFFECT_TRANSACTION_STATE", `transaction state ${current.state} is not allowed`);
  }
}

export class EffectTransactionRegistry {
  static async open(options = {}) {
    const store = await FileEffectTransactionStore.open(options.root, {
      approvalAuthorities: options.approvalAuthorities,
      secretBindings: options.secretBindings,
    });
    return new EffectTransactionRegistry({ store, now: options.now, idFactory: options.idFactory });
  }

  constructor({ store, now = () => Date.now(), idFactory = () => randomBytes(16).toString("hex") } = {}) {
    if (!(store instanceof FileEffectTransactionStore)) throw new TypeError("EffectTransactionRegistry requires its file store");
    if (typeof now !== "function" || typeof idFactory !== "function") throw new TypeError("effect registry clocks are invalid");
    this.store = store;
    this.artifacts = new ExecutionMemoryArtifacts({ store: store.store, secretValues: store.secretValues });
    this.now = now;
    this.idFactory = idFactory;
  }

  inspectTrustDomain() { return this.store.inspectTrustDomain(); }

  async prepareTransaction({ transactionId, intentId, destination, effectTemplate, expectedTransition,
    environmentSha256, executionSessionId, sessionRevisionSha256, source = "control" }) {
    if (await this.store.read(transactionId)) throw effectTransactionError("EFFECT_TRANSACTION_EXISTS", "transaction already exists");
    const normalized = normalizeEffectTemplate(effectTemplate, {
      secretBindings: this.store.secretBindings,
      bindingKey: this.store.bindingKey,
    });
    validateStoredEffectTemplate(normalized.template, { expectedTransition });
    const intent = createEffectIntent({ intentId, destination, payloadBindingSha256: normalized.payloadBindingSha256,
      focus: normalized.template.focus, effectTemplate: normalized.template, expectedTransition,
      environmentSha256, executionSessionId, sessionRevisionSha256, createdAt: nowIso(this.now) });
    const revision = createEffectTransactionRevision({ transactionId, revision: 1, parents: [], intent,
      state: "prepared", rehearsals: [], session: { executionSessionId, baseSha256: sessionRevisionSha256,
        pendingSha256: null, terminalSha256: null }, provenance: { createdAt: nowIso(this.now), source } });
    scanEffectTransactionSecrets(revision, this.store.secretValues);
    return this.store.publish(transactionId, null, revision);
  }

  async bindPendingSession(transactionId, expectedSha256, pendingSha256, source = "control") {
    const current = await this.openTransaction(transactionId);
    expected(current, expectedSha256);
    state(current, ["prepared", "rehearsed"]);
    if (!/^[0-9a-f]{64}$/.test(String(pendingSha256 || ""))) {
      throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "pending Execution Session revision is invalid");
    }
    if (current.session.pendingSha256 && current.session.pendingSha256 !== pendingSha256) {
      throw effectTransactionError("EFFECT_SESSION_CONFLICT", "transaction already binds another pending session revision");
    }
    const revision = nextRevision(current, { state: current.state,
      session: { ...current.session, pendingSha256 } }, this.now, source);
    return this.store.publish(transactionId, expectedSha256, revision);
  }

  async addRehearsal(transactionId, expectedSha256, input, source = "control") {
    const current = await this.openTransaction(transactionId);
    expected(current, expectedSha256);
    state(current, ["prepared", "rehearsed"]);
    const receipt = createRehearsalReceipt({ ...input, intentSha256: current.intent.contentSha256,
      createdAt: nowIso(this.now) });
    scanEffectTransactionSecrets(receipt, this.store.secretValues);
    const rehearsals = [...current.rehearsals, receipt];
    const revision = nextRevision(current, { state: "rehearsed", rehearsals }, this.now, source);
    return this.store.publish(transactionId, expectedSha256, revision);
  }

  async approveTransaction(transactionId, expectedSha256, grant, source = "control") {
    const current = await this.openTransaction(transactionId);
    expected(current, expectedSha256);
    state(current, ["rehearsed"]);
    if (!current.session.pendingSha256) throw effectTransactionError("EFFECT_SESSION_PENDING_REQUIRED",
      "approval requires a waiting Execution Session revision");
    if (!current.rehearsals.some((receipt) => receipt.terminal === "pass" && receipt.coverage !== "liveReadOnly")) {
      throw effectTransactionError("EFFECT_REHEARSAL_REQUIRED", "approval requires a passing effect-free rehearsal");
    }
    const accepted = verifyApprovalGrant(grant, current.intent, {
      authorities: this.store.authorities, trustDomainSha256: this.store.trustDomainSha256, now: this.now,
    });
    scanEffectTransactionSecrets(accepted, this.store.secretValues);
    await this.store.consumeApprovalNonce(accepted);
    const revision = nextRevision(current, { state: "approved", approval: accepted }, this.now, source);
    return this.store.publish(transactionId, expectedSha256, revision);
  }

  async reserveCommit(transactionId, expectedSha256, before, source = "control") {
    const current = await this.openTransaction(transactionId);
    expected(current, expectedSha256);
    state(current, ["approved"]);
    verifyApprovalGrant(current.approval, current.intent, {
      authorities: this.store.authorities, trustDomainSha256: this.store.trustDomainSha256, now: this.now,
    });
    if (before.executionSessionRevisionSha256 !== current.session.pendingSha256) {
      throw effectTransactionError("EFFECT_SESSION_CONFLICT", "live session revision does not match the approved pending revision");
    }
    const lease = createCommitLease({ leaseId: `lease:${this.idFactory()}`, intentSha256: current.intent.contentSha256,
      before, reservedAt: nowIso(this.now) });
    const revision = nextRevision(current, { state: "sending", lease }, this.now, source);
    return this.store.publish(transactionId, expectedSha256, revision);
  }

  async recordEffectResult(transactionId, expectedSha256, input, source = "control") {
    const current = await this.openTransaction(transactionId);
    expected(current, expectedSha256);
    state(current, ["sending"]);
    const effectResult = createEffectResult({ ...input, intentSha256: current.intent.contentSha256,
      leaseSha256: current.lease.contentSha256, beforeSituationSha256: current.lease.before.situationSha256,
      machineBefore: { imageSha256: current.lease.before.machineImageSha256,
        generation: current.lease.before.machineGeneration, environment: input.machineBefore.environment },
      completedAt: nowIso(this.now) });
    scanEffectTransactionSecrets(effectResult, this.store.secretValues);
    const revision = nextRevision(current, { state: "finalizing", effectResult }, this.now, source);
    return this.store.publish(transactionId, expectedSha256, revision);
  }

  async bindTerminalSession(transactionId, expectedSha256, terminalSha256, source = "control") {
    const current = await this.openTransaction(transactionId);
    expected(current, expectedSha256);
    state(current, ["finalizing"]);
    if (!/^[0-9a-f]{64}$/.test(String(terminalSha256 || ""))) {
      throw effectTransactionError("EFFECT_SESSION_CONFLICT", "terminal Execution Session revision is invalid");
    }
    const revision = nextRevision(current, { state: "terminal",
      session: { ...current.session, terminalSha256 } }, this.now, source);
    return this.store.publish(transactionId, expectedSha256, revision);
  }

  async sealTransaction(transactionId, expectedSha256, evidence, source = "control") {
    const current = await this.openTransaction(transactionId);
    expected(current, expectedSha256);
    state(current, ["terminal"]);
    if (!evidence || evidence.verdict !== "verified" || !/^[0-9a-f]{64}$/.test(String(evidence.contentSha256 || ""))) {
      throw effectTransactionError("EFFECT_EVIDENCE_UNVERIFIED", "seal requires a verified Evidence Pack");
    }
    const receipt = createEffectReceipt({ transactionId, intentSha256: current.intent.contentSha256,
      rehearsalSha256: current.rehearsals.map((entry) => entry.contentSha256),
      approvalSha256: current.approval.contentSha256, leaseSha256: current.lease.contentSha256,
      effectResultSha256: current.effectResult.contentSha256, evidencePackSha256: evidence.contentSha256,
      sessionBaseSha256: current.session.baseSha256, sessionPendingSha256: current.session.pendingSha256,
      sessionTerminalSha256: current.session.terminalSha256, terminal: current.effectResult.terminal,
      sealedAt: nowIso(this.now) });
    scanEffectTransactionSecrets(receipt, this.store.secretValues);
    const revision = nextRevision(current, { state: "sealed", receipt }, this.now, source);
    return this.store.publish(transactionId, expectedSha256, revision);
  }

  async openTransaction(transactionId) {
    const revision = await this.store.read(transactionId);
    if (!revision) throw effectTransactionError("EFFECT_TRANSACTION_NOT_FOUND", `transaction is unavailable: ${transactionId}`);
    validateEffectTransactionRevision(revision);
    validateStoredEffectTemplate(revision.intent.effectTemplate, { expectedTransition: revision.intent.expectedTransition });
    scanEffectTransactionSecrets(revision, this.store.secretValues);
    return revision;
  }

  async listTransactions() {
    const summaries = [];
    for (const transactionId of await this.store.listTransactionIds()) {
      const revision = await this.openTransaction(transactionId);
      summaries.push(Object.freeze({ transactionId, state: revision.state, revision: revision.revision,
        contentSha256: revision.contentSha256, intentSha256: revision.intent.contentSha256,
        terminal: revision.effectResult?.terminal || null, sealed: revision.state === "sealed" }));
    }
    return Object.freeze(summaries);
  }
}

export async function createEffectTransactionRegistry(options) {
  return EffectTransactionRegistry.open(options);
}
