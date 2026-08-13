// actuationCoordinator.js - situate, bind, route, one-shot effect, verify, seal을 한 Motor 수명주기로 묶는다.
import {
  ACTUATION_ERROR_CODES,
  actuationDigest,
  actuationError,
  createActuationEpisode,
  createActuationIntent,
  createActuationPlan,
  createActuationReceipt,
  createPolicyRevision,
  evaluateCorrection,
} from "./actuationCanonical.js";
import { chooseActuator } from "./actuatorBroker.js";
import { ActuationEffectWindow } from "./effectWindow.js";
import { compileSituationBinding } from "./situationBinding.js";

const DEFAULT_POLICY = Object.freeze({
  providerPreference: Object.freeze(["cooperative", "replay", "browserInput", "accessibility", "osInput"]),
  preContactFallbackBudget: 0,
  correctionBudget: 2,
  adapterVersions: Object.freeze({ cooperative: "1", browserInput: "1", replay: "1",
    accessibility: "1", osInput: "1" }),
});
const REDACTION_MANIFEST_SHA256 = actuationDigest({ format: "pyproc.actuationRedaction", version: 1,
  retained: ["digests", "terminal", "provider", "phase", "evidenceRefs"],
  excluded: ["secretValues", "providerHandles", "rawSemanticTree", "pixels"] });

function providerActuator(providerKind) {
  return providerKind === "nativeCdp" ? "browserInput"
    : providerKind === "frame" ? "cooperative" : providerKind === "replay" ? "replay" : null;
}

function evidenceFrom(output) {
  return output?.actions?.[0]?.result?.evidence || output?.results?.[0]?.evidence || null;
}

function terminalFrom(evidence) {
  return evidence?.verification?.state || "notObserved";
}

function errorTerminal(error) {
  if (error?.outcome === "outcomeUnknown") return "outcomeUnknown";
  if (error?.outcome === "rejected") return "rejected";
  return "notSent";
}

function effectOutcome(error, evidence) {
  const outcome = error?.outcome || evidence?.effectOutcome || "applied";
  return ["applied", "notSent", "rejected", "outcomeUnknown"].includes(outcome) ? outcome : "outcomeUnknown";
}

function cleanupSummary(errors) {
  return Object.freeze({ state: errors.length ? "incomplete" : "complete",
    failures: Object.freeze(errors.map((error) => String(error?.code || error?.message || "cleanup failed")).sort()) });
}

export class ActuationCoordinator {
  static async open(options = {}) {
    const coordinator = new ActuationCoordinator(options);
    await coordinator.store.initializePolicy(createPolicyRevision({ policy: DEFAULT_POLICY }));
    return coordinator;
  }

  constructor({ store, automation = null, replayGraph = null, valueBindings = {}, authorityValidator = null,
    cooperative = null, cleanup = null, now = () => Date.now() } = {}) {
    if (!store) throw new TypeError("ActuationCoordinator requires a durable store");
    if (automation && typeof automation.invoke !== "function") {
      throw new TypeError("ActuationCoordinator automation provider is invalid");
    }
    if (authorityValidator !== null && typeof authorityValidator !== "function") {
      throw new TypeError("ActuationCoordinator authorityValidator must be a function");
    }
    if (cleanup !== null && typeof cleanup !== "function") {
      throw new TypeError("ActuationCoordinator cleanup must be a function");
    }
    this.store = store;
    this.automation = automation;
    this.replayGraph = replayGraph;
    this.cooperative = cooperative;
    this.valueBindings = new Map(Object.entries(valueBindings));
    this.authorityValidator = authorityValidator;
    this.cleanup = cleanup;
    this.now = now;
  }

  async execute(input, context = {}) {
    if (!this.automation) throw actuationError(ACTUATION_ERROR_CODES.actuatorUnavailable,
      "Motor requires an enabled automation provider");
    const intent = createActuationIntent(input.intent);
    await this._assertAuthority(intent, context);
    const policy = await this.store.policy();
    const compiled = compileSituationBinding({ intent, situation: input.situation,
      requirementRef: input.requirementRef, destinationRequirementRef: input.destinationRequirementRef || null,
      providerKind: this.automation.providerKind, spaceId: this.automation.spaceId, now: this.now(),
      resolveValue: (valueRef) => this.valueBindings.get(valueRef) });
    const kind = providerActuator(this.automation.providerKind);
    const candidate = Object.freeze({ kind, providerId: this.automation.spaceId,
      adapterVersion: String(policy.policy.adapterVersions?.[kind] || "1"),
      supportedIntents: Object.freeze(["activate", "focus", "setValue", "setSelected", "setExpanded", "scrollTo",
        ...(this.automation.providerKind === "nativeCdp" ? ["dragTo"] : [])]),
      binding: compiled.binding, now: this.now(), healthy: true, authoritySatisfied: true,
      evidenceAvailable: this.automation.capabilities.includes("perception")
        && (kind !== "cooperative" || this.cooperative !== null), effectWindowRepresentable: true,
      semanticSetter: ["setValue", "setSelected", "setExpanded"].includes(intent.intent),
      additionalAuthority: false, postconditionEvidence: true, sharedInput: false });
    const decision = chooseActuator(intent, [candidate], policy.policy.providerPreference || []);
    const plan = createActuationPlan({ intent, binding: compiled.binding, decision,
      preflight: { situationSha256: input.situation.integrity.canonicalSha256,
        requirementRef: input.requirementRef, actionCapabilityRef: compiled.affordance.capabilityRef,
        targetAlreadySatisfied: compiled.alreadySatisfied },
      approach: [{ kind: "liveTargetResolution", budget: policy.policy.correctionBudget || 0 }],
      boundary: compiled.alreadySatisfied ? "none.alreadySatisfied" : "provider.effectDispatch",
      gestureEnvelope: compiled.alreadySatisfied ? [] : [{ kind: compiled.actionKind }],
      safetyRelease: intent.intent === "dragTo" ? [{ kind: "pointerUp" }] : [],
      verification: compiled.transition,
      budgets: { preContactFallback: Math.min(Number(policy.policy.preContactFallbackBudget) || 0,
        intent.policy.allowPreContactFallback ? 1 : 0) } });
    return this._perform({ input, context, intent, compiled, policy, decision, plan });
  }

  async _perform({ input, context, intent, compiled, policy, decision, plan }) {
    const window = new ActuationEffectWindow();
    const timeline = [{ phase: "preflight", at: this.now(), worldRef: intent.target.worldRef,
      situationSha256: input.situation.integrity.canonicalSha256 }];
    let output = null;
    let operationError = null;
    let evidence = null;
    if (!compiled.alreadySatisfied) {
      window.approach({ kind: "targetResolved", bindingSha256: compiled.binding.bindingSha256 });
      window.cross("provider.effectDispatch");
      window.sent({ kind: compiled.actionKind });
      timeline.push({ phase: "committedGesture", at: this.now(), worldRef: intent.target.worldRef });
      try {
        output = decision.selected.kind === "cooperative"
          ? await this.cooperative.execute({ input, intent, compiled, plan }, context)
          : await this.automation.invoke("automation.act", {
            sessionRef: input.sessionRef, actions: [compiled.action],
          }, { signal: context.signal, requestId: context.requestId || null });
        evidence = evidenceFrom(output);
      } catch (error) {
        operationError = error;
        evidence = error?.actionEvidence || null;
      }
    }
    const knownNotSent = compiled.alreadySatisfied || operationError?.outcome === "notSent";
    const effectWindow = window.finish({ boundaryCrossed: !knownNotSent,
      providerCalls: knownNotSent ? 0 : window.providerCalls });
    const terminal = compiled.alreadySatisfied ? "alreadySatisfied"
      : operationError ? errorTerminal(operationError) : terminalFrom(evidence);
    timeline.push({ phase: "verification", at: this.now(), worldRef: intent.target.worldRef,
      terminal, evidenceRef: evidence?.evidenceRef || null });
    const cleanupErrors = [];
    if (this.cleanup) {
      try { await this.cleanup({ intent, plan, terminal, output, error: operationError }, context); }
      catch (error) { cleanupErrors.push(error); }
    }
    const receipt = createActuationReceipt({ intent, binding: compiled.binding, plan, decision, effectWindow,
      terminal, effectOutcome: compiled.alreadySatisfied ? "notSent" : effectOutcome(operationError, evidence),
      actionEvidenceRef: evidence?.evidenceRef || null,
      cleanup: cleanupSummary(cleanupErrors) });
    const episode = createActuationEpisode({ receipt, worldRef: intent.target.worldRef,
      policyRevisionSha256: policy.policySha256,
      provider: { kind: decision.selected.kind, version: decision.selected.adapterVersion,
        environmentSha256: actuationDigest({ providerKind: this.automation.providerKind,
          spaceId: this.automation.spaceId }) }, timeline,
      failurePoint: terminal === "confirmed" || terminal === "alreadySatisfied" ? null
        : { phase: operationError ? "effect" : "verification",
          code: String(operationError?.code || "ACTUATION_POSTCONDITION_UNRESOLVED"),
          observedCause: operationError?.outcome === "notSent" },
      evidenceRefs: evidence?.evidenceRef ? [evidence.evidenceRef] : [],
      redactionManifestSha256: REDACTION_MANIFEST_SHA256,
      experienceState: cleanupErrors.length ? "incomplete" : "complete" });
    await this.store.record(receipt, episode);
    return Object.freeze({ receipt, episode, terminal,
      provider: Object.freeze({ kind: decision.selected.kind, providerId: decision.selected.providerId }) });
  }

  async replay({ receiptSha256, worldRef, expectedNodeRef }) {
    if (!this.replayGraph) throw actuationError(ACTUATION_ERROR_CODES.actuatorUnavailable,
      "Motor ReplayGraph adapter is unavailable");
    const receipt = await this.store.receipt(receiptSha256);
    const matches = this.replayGraph.edges({ worldRef }).filter((edge) => edge.operation === "motor.execute"
      && edge.input?.receiptSha256 === receiptSha256);
    if (matches.length !== 1) throw actuationError(matches.length > 1
      ? ACTUATION_ERROR_CODES.targetAmbiguous : ACTUATION_ERROR_CODES.perceptionIncomplete,
    "ReplayGraph requires one exact Motor receipt edge");
    const replay = this.replayGraph.traverse({ worldRef, capabilityRef: matches[0].capabilityRef, expectedNodeRef });
    return Object.freeze({ receipt, replay: Object.freeze({ edgeRef: replay.edgeRef,
      replayedEffect: replay.replayedEffect, targetNodeRef: replay.targetNodeRef }), providerCalls: 0 });
  }

  async inspect() {
    const [policy, records] = await Promise.all([this.store.policy(), this.store.list()]);
    return Object.freeze({ policy, records: records.length, provider: this.automation
      ? Object.freeze({ spaceId: this.automation.spaceId, providerKind: this.automation.providerKind,
        actuatorKind: providerActuator(this.automation.providerKind) }) : null,
    replayGraph: !!this.replayGraph });
  }

  list() { return this.store.list(); }

  evaluate(input) { return evaluateCorrection(input); }

  async promote({ expectedPolicySha256, corpusSha256, evaluationManifestSha256, proposal }) {
    const current = await this.store.policy();
    if (current.policySha256 !== expectedPolicySha256) {
      throw actuationError(ACTUATION_ERROR_CODES.policyStale, "Motor policy changed before evaluation");
    }
    const evaluation = evaluateCorrection({ basePolicySha256: expectedPolicySha256, corpusSha256,
      evaluationManifestSha256, proposal });
    const next = createPolicyRevision({ previousSha256: current.policySha256,
      policy: { ...current.policy, tactics: { ...(current.policy.tactics || {}),
        [proposal.changeKind]: proposal.patch } }, proposalSha256: evaluation.proposalSha256,
      evaluationSha256: evaluation.verdictSha256, state: "active" });
    await this.store.movePolicy(current.policySha256, next);
    return Object.freeze({ policy: next, evaluation });
  }

  async rollback({ expectedPolicySha256 }) {
    const current = await this.store.policy();
    if (current.policySha256 !== expectedPolicySha256 || !current.previousSha256) {
      throw actuationError(ACTUATION_ERROR_CODES.policyStale, "Motor policy has no matching rollback parent");
    }
    return this.store.rollbackPolicy(current.policySha256, current.previousSha256);
  }

  async _assertAuthority(intent, context) {
    const delegated = [intent.authority.approvalGrantRef, intent.authority.commitLeaseRef,
      intent.authority.controlLeaseRef].filter(Boolean);
    if (!delegated.length) return;
    if (!this.authorityValidator || await this.authorityValidator(intent, context) !== true) {
      throw actuationError(ACTUATION_ERROR_CODES.authorityRequired,
        "delegated authority references require an exact external validator");
    }
  }
}
