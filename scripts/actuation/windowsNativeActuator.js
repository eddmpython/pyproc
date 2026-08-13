// windowsNativeActuator.js - cross-plane APX to UIA binding and proof-carrying native execution.
import { ACTUATION_ERROR_CODES, actuationDigest, actuationError, createTargetBinding }
  from "./actuationCanonical.js";

function fact(situation, entityRef, predicate) {
  const values = situation.facts.filter((entry) => entry.subjectRef === entityRef
    && entry.predicate === predicate && entry.state === "known");
  return values.length === 1 ? values[0].value : undefined;
}

function controlType(role) {
  const mapping = { button: "button", checkbox: "checkbox", radio: "radio", textbox: "textbox",
    combobox: "combobox", option: "listitem", treeitem: "treeitem", slider: "slider" };
  return mapping[role] || role;
}

export class WindowsNativeActuator {
  constructor({ nativeHost, leases, now = () => Date.now() } = {}) {
    if (!nativeHost || !leases) throw new TypeError("WindowsNativeActuator requires native host and leases");
    this.nativeHost = nativeHost;
    this.leases = leases;
    this.now = now;
    this.prepared = new Map();
  }

  async prepare({ intent, situation, compiled, applicationId, nativePostcondition }) {
    if (typeof applicationId !== "string" || !nativePostcondition
      || typeof nativePostcondition.name !== "string" || typeof nativePostcondition.controlType !== "string") {
      throw actuationError(ACTUATION_ERROR_CODES.intentInvalid,
        "native Motor execution requires applicationId and a semantic nativePostcondition");
    }
    const role = fact(situation, intent.target.entityRef, "semantic.role");
    const name = fact(situation, intent.target.entityRef, "semantic.name");
    if (typeof role !== "string" || typeof name !== "string") {
      throw actuationError(ACTUATION_ERROR_CODES.perceptionIncomplete,
        "native target requires one known semantic role and name");
    }
    const hostBinding = await this.nativeHost.bindApplication({ applicationId,
      surfaceEpoch: intent.target.surfaceEpoch.replace(/^document:/, "surface:"),
      target: { name, controlType: controlType(role) } });
    const canAccessibility = hostBinding.supportedIntents.includes(intent.intent)
      && intent.policy.allowedActuatorKinds.includes("accessibility");
    const canOsInput = intent.intent === "activate" && intent.policy.allowedActuatorKinds.includes("osInput")
      && typeof intent.authority.controlLeaseRef === "string";
    const kind = canAccessibility ? "accessibility" : canOsInput ? "osInput" : null;
    if (!kind) throw actuationError(ACTUATION_ERROR_CODES.actuatorUnavailable,
      "Windows target has no eligible semantic or physical actuator");
    const binding = createTargetBinding({ spaceRef: intent.target.spaceRef, worldRef: intent.target.worldRef,
      entityRef: intent.target.entityRef, surfaceEpoch: intent.target.surfaceEpoch, actuatorKind: kind,
      invariants: [...compiled.binding.invariants,
        { kind: "nativeApplication", sha256: actuationDigest({ applicationId }) }],
      candidateCount: hostBinding.candidateCount, uniqueness: hostBinding.uniqueness,
      freshUntil: Math.min(compiled.binding.freshUntil, this.now() + 5000),
      providerFenceSha256: actuationDigest({ applicationId,
        sourceSha256: this.nativeHost.verified.sourceSha256, semantic: { role, name } }) });
    this.prepared.set(binding.bindingSha256, { applicationId,
      surfaceEpoch: intent.target.surfaceEpoch.replace(/^document:/, "surface:"), hostBinding,
      nativePostcondition: Object.freeze({ name: nativePostcondition.name,
        controlType: nativePostcondition.controlType }), target: Object.freeze({ name,
          controlType: controlType(role) }) });
    return Object.freeze({ kind, providerId: `windows:${applicationId}`, adapterVersion: "1",
      supportedIntents: Object.freeze(kind === "osInput" ? ["activate"] : [...hostBinding.supportedIntents]),
      binding, now: this.now(), healthy: true, authoritySatisfied: kind === "accessibility"
        || typeof intent.authority.controlLeaseRef === "string", evidenceAvailable: true,
      effectWindowRepresentable: true,
      semanticSetter: kind === "accessibility" && ["setValue", "setSelected", "setExpanded"].includes(intent.intent),
      additionalAuthority: kind === "osInput", postconditionEvidence: true, sharedInput: kind === "osInput" });
  }

  async execute({ intent, plan }) {
    const prepared = this.prepared.get(plan.bindingSha256);
    this.prepared.delete(plan.bindingSha256);
    if (!prepared) throw actuationError(ACTUATION_ERROR_CODES.targetStale,
      "Windows target binding expired before execution");
    const common = { bindingRef: prepared.hostBinding.bindingRef, planSha256: plan.planSha256,
      intentSha256: intent.intentSha256, intent: intent.intent,
      surfaceEpoch: prepared.surfaceEpoch, postcondition: prepared.nativePostcondition };
    let output;
    if (plan.selectedActuator === "accessibility") {
      output = await this.nativeHost.executeAccessibility({ ...common, desired: intent.desired });
    } else {
      const record = this.leases.consume(intent.authority.controlLeaseRef, {
        applicationId: prepared.applicationId, intent, surfaceEpoch: prepared.surfaceEpoch,
      });
      output = await this.nativeHost.executeOsInput({ ...common, lease: {
        leaseRef: record.leaseRef, applicationId: record.applicationId, intentSha256: intent.intentSha256,
        surfaceEpoch: record.surfaceEpoch, expiresAt: record.expiresAt,
        userInputEpoch: record.userInputEpoch, cancelOnUserInput: record.cancelOnUserInput,
      } });
    }
    const evidenceRef = `evidence:${actuationDigest({ planSha256: plan.planSha256,
      terminal: output.terminal, evidence: output.evidence })}`;
    return Object.freeze({ output, evidence: Object.freeze({ evidenceRef,
      effectOutcome: output.effectOutcome, verification: Object.freeze({ state: output.terminal }) }) });
  }

  async preflight({ intent, plan }) {
    const prepared = this.prepared.get(plan.bindingSha256);
    if (!prepared) throw actuationError(ACTUATION_ERROR_CODES.targetStale,
      "Windows target binding expired before preflight");
    const rebound = await this.nativeHost.bindApplication({ applicationId: prepared.applicationId,
      surfaceEpoch: prepared.surfaceEpoch, target: prepared.target });
    if (plan.selectedActuator === "accessibility" && !rebound.supportedIntents.includes(intent.intent)) {
      throw actuationError(ACTUATION_ERROR_CODES.actuatorUnavailable,
        "Windows UI Automation pattern changed before effect");
    }
    prepared.hostBinding = rebound;
    if (plan.selectedActuator === "osInput") this.leases.assert(intent.authority.controlLeaseRef, {
      applicationId: prepared.applicationId, intent, surfaceEpoch: prepared.surfaceEpoch,
    });
    return Object.freeze({ bindingRef: rebound.bindingRef });
  }

  discard(bindingSha256) { this.prepared.delete(bindingSha256); }
}
