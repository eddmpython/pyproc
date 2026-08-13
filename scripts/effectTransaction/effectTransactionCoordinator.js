// effectTransactionCoordinator.js - existing Machine, APX, AutomationSpace, Execution Memory를 one-shot flow로 조립한다.
import { loadEvidencePack } from "../verification/evidencePack.js";
import { effectTransactionDigest, effectTransactionError } from "./effectTransactionCanonical.js";
import { bindEffectTemplate, materializeEffectTemplate } from "./effectInput.js";

const APX_OBSERVE_INPUT = Object.freeze({
  expectedRisk: "read",
  representation: "apx.situation",
  visual: Object.freeze({ mode: "off" }),
  budget: Object.freeze({ maxEntities: 500, maxRelations: 1000, maxBytes: 512 * 1024 }),
});

function exactProject(actual, expected) {
  return actual?.commit === expected.commit && actual?.treeSha256 === expected.treeSha256
    && actual?.diffSha256 === expected.diffSha256 && actual?.untracked === expected.untracked;
}

function hasMatchingEffectEvidence(pack, transaction) {
  return pack.scenarioRuns.some((run) => run.scenarioId === transaction.transactionId
    && run.terminal === "verified" && run.effectTransaction?.transactionId === transaction.transactionId
    && run.effectTransaction?.intentSha256 === transaction.intent.contentSha256
    && run.effectTransaction?.effectResultSha256 === transaction.effectResult?.contentSha256
    && run.effectTransaction?.sessionTerminalSha256 === transaction.session.terminalSha256);
}

function machineResult(link) {
  return Object.freeze({ imageSha256: link.imageSha256, generation: link.generation, environment: link.environment });
}

function actionEvidenceFrom(output, error = null) {
  const completed = [...(error?.completed || []), ...(output?.actions || [])];
  const evidence = completed.map((entry) => entry?.result?.evidence).filter(Boolean);
  if (error?.actionEvidence) evidence.push(error.actionEvidence);
  return Object.freeze([...new Map(evidence.map((entry) => [entry.evidenceRef, entry])).values()]);
}

function terminalFrom(evidence, error = null) {
  if (error?.outcome === "outcomeUnknown") return "outcomeUnknown";
  const states = evidence.map((entry) => entry.verification.state);
  if (!states.length) return error?.outcome === "notSent" ? "notObserved" : "outcomeUnknown";
  if (states.includes("outcomeUnknown")) return "outcomeUnknown";
  if (states.includes("contradicted")) return "contradicted";
  if (states.includes("ambiguous")) return "ambiguous";
  if (states.includes("notObserved")) return "notObserved";
  return states.every((state) => state === "confirmed") && !error ? "confirmed" : "outcomeUnknown";
}

function secretText(code, secretValues) {
  if (typeof code !== "string" || !code || code.length > 256 * 1024) {
    throw effectTransactionError("EFFECT_REHEARSAL_INVALID", "computed rehearsal code is invalid");
  }
  if (secretValues.some((secret) => secret && code.includes(secret))) {
    throw effectTransactionError("EFFECT_TRANSACTION_SECRET", "computed rehearsal code contains secret material");
  }
}

export class EffectTransactionCoordinator {
  constructor({ registry, memoryProduct, automationRouter, pageBridge, now = () => Date.now() } = {}) {
    if (!registry || !memoryProduct?.registry || !pageBridge?.dispatch) {
      throw new TypeError("effect transaction coordinator requires registry, Execution Memory, and Machine bridge");
    }
    this.registry = registry;
    this.memory = memoryProduct;
    this.automation = automationRouter;
    this.pageBridge = pageBridge;
    this.now = now;
  }

  async prepare(input, context = {}) {
    const session = await this.memory.registry.openSession(input.executionSessionId);
    if (session.contentSha256 !== input.expectedSessionRevisionSha256) {
      throw effectTransactionError("EFFECT_SESSION_CONFLICT", "Execution Session HEAD changed before intent preparation");
    }
    if (session.work.outcomeUnknown || session.work.state !== "active") {
      throw effectTransactionError("EFFECT_SESSION_STATE", "effect preparation requires an active known Execution Session");
    }
    let transaction = await this.registry.prepareTransaction({
      transactionId: input.transactionId,
      intentId: input.intentId,
      destination: input.destination,
      effectTemplate: input.effectTemplate,
      expectedTransition: input.expectedTransition,
      environmentSha256: session.machine.environment,
      executionSessionId: session.executionSessionId,
      sessionRevisionSha256: session.contentSha256,
      source: "control.prepare",
    });
    const machine = await this.memory.captureMachine(session.machine.machineId, context.signal,
      `${context.requestId || input.transactionId}:prepare`);
    const pending = await this.memory.registry.checkpointSession(session.executionSessionId, session.contentSha256, {
      machine,
      work: { state: "waitingApproval", branch: session.work.branch, checkpoint: session.work.checkpoint,
        outcomeUnknown: false, pendingIntentSha256: transaction.intent.contentSha256 },
      source: "effect.prepare",
    });
    transaction = await this.registry.bindPendingSession(transaction.transactionId, transaction.contentSha256,
      pending.contentSha256, "control.prepare");
    return Object.freeze({ transaction, trustDomain: this.registry.inspectTrustDomain(), executionSession: pending });
  }

  async rehearse(input, context = {}) {
    const transaction = await this.registry.openTransaction(input.transactionId);
    if (transaction.contentSha256 !== input.expectedRevisionSha256) {
      throw effectTransactionError("EFFECT_TRANSACTION_HEAD_CONFLICT", "transaction HEAD changed before rehearsal");
    }
    const receipt = input.mode === "computed"
      ? await this._computedRehearsal(transaction, input, context)
      : await this._providerRehearsal(transaction, context);
    return this.registry.addRehearsal(transaction.transactionId, transaction.contentSha256, receipt,
      `control.rehearse.${receipt.coverage}`);
  }

  approve(input) {
    return this.registry.approveTransaction(input.transactionId, input.expectedRevisionSha256, input.grant,
      "control.approve");
  }

  async commit(input, context = {}) {
    let transaction = await this.registry.openTransaction(input.transactionId);
    if (transaction.contentSha256 !== input.expectedRevisionSha256) {
      throw effectTransactionError("EFFECT_TRANSACTION_HEAD_CONFLICT", "transaction HEAD changed before commit");
    }
    if (["terminal", "sealed"].includes(transaction.state)) return transaction;
    if (transaction.state === "finalizing") return this._finalizeSession(transaction);
    if (transaction.state === "sending") {
      transaction = await this._recoverUnknown(transaction, context);
      return this._finalizeSession(transaction);
    }
    if (transaction.state !== "approved") {
      throw effectTransactionError("EFFECT_TRANSACTION_STATE", "commit requires an approved transaction");
    }
    if (!this.automation || this.automation.providerKind !== "nativeCdp") {
      throw effectTransactionError("EFFECT_LIVE_PROVIDER_REQUIRED", "live commit requires NativeCdpSpace");
    }
    const pendingSession = await this.memory.registry.openSession(transaction.session.executionSessionId);
    if (pendingSession.contentSha256 !== transaction.session.pendingSha256
      || pendingSession.work.pendingIntentSha256 !== transaction.intent.contentSha256) {
      throw effectTransactionError("EFFECT_SESSION_CONFLICT", "Execution Session no longer carries the approved intent");
    }
    await this._assertDestination(transaction, context);
    const beforeSituation = await this._observe(transaction.intent.effectTemplate, context, "before");
    const materialized = materializeEffectTemplate(transaction.intent.effectTemplate, {
      secretBindings: this.registry.store.secretBindings, bindingKey: this.registry.store.bindingKey,
    });
    const bound = bindEffectTemplate(transaction.intent.effectTemplate, beforeSituation,
      { materializedTemplate: materialized });
    const machineBefore = await this.memory.captureMachine(pendingSession.machine.machineId, context.signal,
      `${context.requestId || transaction.transactionId}:before`);
    transaction = await this.registry.reserveCommit(transaction.transactionId, transaction.contentSha256, {
      situationSha256: beforeSituation.integrity.canonicalSha256,
      machineImageSha256: machineBefore.imageSha256,
      machineGeneration: machineBefore.generation,
      executionSessionRevisionSha256: pendingSession.contentSha256,
    }, "control.commit");
    let output = null;
    let providerError = null;
    try {
      output = await this.automation.invoke("automation.act", bound.input, {
        signal: context.signal, requestId: `${context.requestId || transaction.transactionId}:effect`,
        recordingInput: bound.recordingInput,
      });
    } catch (error) { providerError = error; }
    let afterSituation = null;
    try { afterSituation = await this._observe(transaction.intent.effectTemplate, context, "after"); }
    catch (error) { providerError ||= error; }
    const evidence = actionEvidenceFrom(output, providerError);
    let terminal = terminalFrom(evidence, providerError);
    if (!afterSituation && terminal !== "outcomeUnknown") terminal = "outcomeUnknown";
    const machineAfter = await this.memory.captureMachine(pendingSession.machine.machineId, context.signal,
      `${context.requestId || transaction.transactionId}:after`);
    transaction = await this.registry.recordEffectResult(transaction.transactionId, transaction.contentSha256, {
      providerKind: this.automation.providerKind,
      terminal,
      afterSituationSha256: afterSituation?.integrity?.canonicalSha256 || null,
      machineBefore: machineResult(machineBefore),
      machineAfter: machineResult(machineAfter),
      actionEvidence: evidence,
      errorCode: providerError ? String(providerError.code || "PYPROC_INTERNAL") : null,
    }, "control.commit");
    return this._finalizeSession(transaction);
  }

  async seal(input) {
    const transaction = await this.registry.openTransaction(input.transactionId);
    if (transaction.contentSha256 !== input.expectedRevisionSha256) {
      throw effectTransactionError("EFFECT_TRANSACTION_HEAD_CONFLICT", "transaction HEAD changed before seal");
    }
    const path = this.memory.allowedImportPath(input.evidencePackDir, "evidencePackDir");
    const loaded = await loadEvidencePack(path);
    const session = await this.memory.registry.openSession(transaction.session.executionSessionId);
    if (!exactProject(loaded.pack.manifest.repository, session.project)) {
      throw effectTransactionError("EFFECT_EVIDENCE_MISMATCH", "Evidence Pack repository does not match the Execution Session");
    }
    if (!hasMatchingEffectEvidence(loaded.pack, transaction)) {
      throw effectTransactionError("EFFECT_EVIDENCE_MISMATCH",
        "Evidence Pack does not verify the exact effect result and terminal session");
    }
    const evidence = await this.registry.artifacts.captureEvidence(path);
    return this.registry.sealTransaction(transaction.transactionId, transaction.contentSha256, evidence,
      "control.seal");
  }

  open(input) { return this.registry.openTransaction(input.transactionId); }
  list() { return this.registry.listTransactions(); }

  async inspect(input) {
    const transaction = await this.registry.openTransaction(input.transactionId);
    return Object.freeze({ transaction, trustDomain: this.registry.inspectTrustDomain(),
      next: transaction.state === "prepared" || transaction.state === "rehearsed" ? "rehearseOrApprove"
        : transaction.state === "approved" ? "commit"
          : transaction.state === "sending" || transaction.state === "finalizing" ? "recoverWithoutResend"
            : transaction.state === "terminal" ? "seal" : "complete" });
  }

  async _observe(template, context, phase) {
    if (!this.automation) throw effectTransactionError("EFFECT_AUTOMATION_UNAVAILABLE", "browser provider is unavailable");
    return this.automation.invoke("automation.observe", { sessionRef: template.sessionRef,
      ...APX_OBSERVE_INPUT, focus: template.focus }, {
      signal: context.signal, requestId: `${context.requestId || "effect"}:observe:${phase}`,
    });
  }

  async _assertDestination(transaction, context) {
    const targetRef = transaction.intent.effectTemplate.sessionRef.targetRef;
    const targets = await this.automation.invoke("automation.target.list", {}, {
      signal: context.signal, requestId: `${context.requestId || transaction.transactionId}:destination`,
    });
    const matches = targets.filter((entry) => entry.targetRef === targetRef);
    let actualOrigin = null;
    try { actualOrigin = matches.length === 1 ? new URL(matches[0].url).origin : null; }
    catch (error) { actualOrigin = null; }
    if (actualOrigin !== transaction.intent.destination.origin) {
      throw effectTransactionError("EFFECT_DESTINATION_MISMATCH",
        "live target origin does not match the approved effect destination");
    }
  }

  async _computedRehearsal(transaction, input, context) {
    secretText(input.code, this.registry.store.secretValues);
    if (input.expectedValue !== null && (typeof input.expectedValue !== "string" || input.expectedValue.length > 10000)) {
      throw effectTransactionError("EFFECT_REHEARSAL_INVALID", "computed expectedValue is invalid");
    }
    const checkpoint = await this.pageBridge.dispatch("machine.checkpoint.save", {}, {
      signal: context.signal, requestId: `${context.requestId || transaction.transactionId}:checkpoint`,
    });
    let result;
    let terminal = "incomplete";
    try {
      result = await this.pageBridge.dispatch("machine.run", { code: input.code }, {
        signal: context.signal, requestId: `${context.requestId || transaction.transactionId}:computed`,
      });
      terminal = result.value === input.expectedValue ? "pass" : "reject";
    } finally {
      await this.pageBridge.dispatch("machine.checkpoint.restore", { index: checkpoint.index }, {
        signal: context.signal, requestId: `${context.requestId || transaction.transactionId}:restore`,
      });
    }
    const sourceSha256 = effectTransactionDigest({ codeSha256: effectTransactionDigest(input.code),
      expectedValue: input.expectedValue, actualValue: result?.value ?? null, checkpoint: checkpoint.index });
    return Object.freeze({ coverage: "computed", terminal,
      source: { kind: "pythonBranch", contentSha256: sourceSha256 },
      branch: input.branch || null, checkpoint: `checkpoint:${checkpoint.index}`, situationSha256: null,
      evidenceRefs: [`python:${sourceSha256}`],
      limitations: ["Computed state only; browser state and external service acceptance remain unproven."] });
  }

  async _providerRehearsal(transaction, context) {
    if (!this.automation) throw effectTransactionError("EFFECT_AUTOMATION_UNAVAILABLE", "browser provider is unavailable");
    const situation = await this._observe(transaction.intent.effectTemplate, context, "rehearsal");
    const providerKind = this.automation.providerKind;
    if (providerKind === "nativeCdp") {
      return Object.freeze({ coverage: "liveReadOnly", terminal: "pass",
        source: { kind: "liveSituation", contentSha256: situation.integrity.canonicalSha256 },
        branch: null, checkpoint: null, situationSha256: situation.integrity.canonicalSha256,
        evidenceRefs: [situation.situationRef],
        limitations: ["Live readiness only; no effect path was rehearsed and service acceptance remains unproven."] });
    }
    if (providerKind === "frame" && !this.automation.capabilities.includes("effectFreeRehearsal")) {
      return Object.freeze({ coverage: "cooperative", terminal: "incomplete",
        source: { kind: "frameSituation", contentSha256: situation.integrity.canonicalSha256 },
        branch: null, checkpoint: null, situationSha256: situation.integrity.canonicalSha256,
        evidenceRefs: [situation.situationRef],
        limitations: ["Cooperative state observed; the host cannot prove external effect isolation for this app revision."] });
    }
    const replay = providerKind === "replay";
    const bound = bindEffectTemplate(transaction.intent.effectTemplate, situation,
      { materializedTemplate: transaction.intent.effectTemplate, replay });
    let output;
    let error = null;
    try { output = await this.automation.invoke("automation.act", bound.input, {
      signal: context.signal, requestId: `${context.requestId || transaction.transactionId}:rehearsal-effect`,
      recordingInput: bound.recordingInput,
    }); } catch (caught) { error = caught; }
    const evidence = actionEvidenceFrom(output, error);
    const passed = !error && output?.state === "completed";
    const provider = this.automation.provider;
    const sourceSha256 = replay ? provider.recording.finalSha256
      : effectTransactionDigest({ providerKind, situationSha256: situation.integrity.canonicalSha256 });
    return Object.freeze({ coverage: replay ? "recorded" : "cooperative", terminal: passed ? "pass" : "reject",
      source: { kind: replay ? "automationRecording" : "cooperativeApp", contentSha256: sourceSha256 },
      branch: null, checkpoint: null, situationSha256: situation.integrity.canonicalSha256,
      evidenceRefs: evidence.map((entry) => entry.evidenceRef),
      limitations: [replay
        ? "Recorded path only; current live state, new input, and service acceptance remain unproven."
        : "Cooperative isolated state only; production service acceptance remains unproven."] });
  }

  async _recoverUnknown(transaction, context) {
    const pendingSession = await this.memory.registry.openSession(transaction.session.executionSessionId);
    let afterSituation = null;
    try { afterSituation = await this._observe(transaction.intent.effectTemplate, context, "recovery"); }
    catch (error) { afterSituation = null; }
    const machineAfter = await this.memory.captureMachine(pendingSession.machine.machineId, context.signal,
      `${context.requestId || transaction.transactionId}:recovery`);
    return this.registry.recordEffectResult(transaction.transactionId, transaction.contentSha256, {
      providerKind: this.automation?.providerKind || "unavailable", terminal: "outcomeUnknown",
      afterSituationSha256: afterSituation?.integrity?.canonicalSha256 || null,
      machineBefore: { imageSha256: transaction.lease.before.machineImageSha256,
        generation: transaction.lease.before.machineGeneration, environment: pendingSession.machine.environment },
      machineAfter: machineResult(machineAfter), actionEvidence: [], errorCode: "EFFECT_RECOVERED_AFTER_SEND_BOUNDARY",
    }, "control.recover");
  }

  async _finalizeSession(transaction) {
    const current = await this.memory.registry.openSession(transaction.session.executionSessionId);
    if (transaction.session.terminalSha256 && current.contentSha256 === transaction.session.terminalSha256) {
      return transaction.state === "finalizing"
        ? this.registry.bindTerminalSession(transaction.transactionId, transaction.contentSha256,
          current.contentSha256, "control.finalize") : transaction;
    }
    const after = transaction.effectResult.machineAfter;
    const alreadyFinalized = current.parents.includes(transaction.session.pendingSha256)
      && current.work.pendingIntentSha256 === null
      && current.machine.imageSha256 === after.imageSha256
      && current.machine.generation === after.generation
      && current.machine.environment === after.environment
      && current.work.outcomeUnknown === (transaction.effectResult.terminal === "outcomeUnknown");
    if (alreadyFinalized) {
      return this.registry.bindTerminalSession(transaction.transactionId, transaction.contentSha256,
        current.contentSha256, "control.finalize.recovered");
    }
    if (current.contentSha256 !== transaction.session.pendingSha256
      || current.work.pendingIntentSha256 !== transaction.intent.contentSha256) {
      throw effectTransactionError("EFFECT_SESSION_CONFLICT", "cannot finalize effect against a changed Execution Session");
    }
    const terminal = await this.memory.registry.checkpointSession(current.executionSessionId, current.contentSha256, {
      machine: { machineId: current.machine.machineId, generation: after.generation, environment: after.environment,
        imageSha256: after.imageSha256, lifecycle: "portable" },
      work: { state: transaction.effectResult.terminal === "outcomeUnknown" ? "failed" : "active",
        branch: current.work.branch, checkpoint: current.work.checkpoint,
        outcomeUnknown: transaction.effectResult.terminal === "outcomeUnknown", pendingIntentSha256: null },
      source: "effect.terminal",
    });
    return this.registry.bindTerminalSession(transaction.transactionId, transaction.contentSha256,
      terminal.contentSha256, "control.finalize");
  }
}
