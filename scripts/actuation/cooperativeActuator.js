// cooperativeActuator.js - AppSpace typed local state plus independent APX transition evidence.
import { ActionEvidenceLoop } from "../perception/actionEvidence.js";

export class CooperativeActuator {
  constructor({ appCoordinator, automation, idFactory = () => crypto.randomUUID() } = {}) {
    if (!appCoordinator || typeof appCoordinator.actuateSession !== "function"
      || !automation || typeof automation.invoke !== "function"
      || typeof automation.assertActionContext !== "function") {
      throw new TypeError("CooperativeActuator requires AppSpace and FrameSpace authority");
    }
    this.app = appCoordinator;
    this.automation = automation;
    this.evidence = new ActionEvidenceLoop({ idFactory });
  }

  async execute({ input, intent, compiled }, context = {}) {
    this.automation.assertActionContext(input.sessionRef, compiled.action.actionContext, compiled.action);
    const target = { entityRef: intent.target.entityRef,
      role: this._knownFact(input.situation, intent.target.entityRef, "semantic.role"),
      name: this._knownFact(input.situation, intent.target.entityRef, "semantic.name") };
    const capture = ({ since }) => this.automation.invoke("automation.observe", {
      sessionRef: input.sessionRef,
      expectedRisk: "read",
      representation: "apx.graph",
      ...(since ? { since } : {}),
      channels: ["semantic", "structure", "geometry", "interaction", "events"],
      visual: { mode: "off" },
      budget: { maxEntities: 500, maxRelations: 1000, maxBytes: 512 * 1024 },
    }, { signal: context.signal, requestId: context.requestId || null });
    const result = await this.evidence.run({ actionRef: `action:${crypto.randomUUID()}`,
      postcondition: compiled.transition, signal: context.signal, capture,
      effect: () => this.app.actuateSession({ sessionRef: input.sessionRef, intent: intent.intent,
        target, desired: intent.desired }, context) });
    return Object.freeze({ actions: Object.freeze([Object.freeze({ result: Object.freeze({
      cooperative: result.effectResult,
      evidence: result.evidence,
    }) })]) });
  }

  _knownFact(situation, entityRef, predicate) {
    const matches = situation.facts.filter((fact) => fact.subjectRef === entityRef
      && fact.predicate === predicate && fact.state === "known");
    if (matches.length !== 1 || typeof matches[0].value !== "string") {
      throw new TypeError(`cooperative target requires one known ${predicate}`);
    }
    return matches[0].value;
  }
}
