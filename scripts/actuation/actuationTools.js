// actuationTools.js - Proof-Carrying Motor의 Control/MCP operation과 closed input schemas.
import { ActuationCoordinator } from "./actuationCoordinator.js";
import { FileActuationStore } from "./fileActuationStore.js";
import { CooperativeActuator } from "./cooperativeActuator.js";

const DIGEST = Object.freeze({ type: "string", pattern: "^[0-9a-f]{64}$" });
const REF = Object.freeze({ type: "string", pattern: "^[a-z][A-Za-z0-9.]*:[A-Za-z0-9._:-]{1,192}$" });
const SESSION_REF = Object.freeze({ type: "object", properties: {
  protocolVersion: { type: "string", const: "1" }, spaceId: { type: "string", minLength: 1, maxLength: 256 },
  sessionId: { type: "string", minLength: 1, maxLength: 256 }, targetRef: { type: "string", minLength: 1, maxLength: 256 },
}, required: ["protocolVersion", "spaceId", "sessionId", "targetRef"], additionalProperties: false });
const PROPOSAL = Object.freeze({ type: "object", properties: {
  changeKind: { type: "string", enum: ["probeOrder", "approach", "gestureSegmentation", "actuatorTieBreak",
    "budgetAllocation"] },
  patch: { type: "object" },
  protectedInvariants: { type: "array", items: { type: "string" }, maxItems: 64 },
  coverage: { type: "object", properties: { gaps: { type: "integer", minimum: 0 },
    negativeFailed: { type: "integer", minimum: 0 }, replayFailed: { type: "integer", minimum: 0 } },
  required: ["gaps", "negativeFailed", "replayFailed"], additionalProperties: false },
}, required: ["changeKind", "patch", "protectedInvariants", "coverage"], additionalProperties: false });

export const ACTUATION_TOOLS = Object.freeze([
  Object.freeze({ name: "motorExecute", description: "Execute one absolute desired-state intent from an exact complete SituationCapsule, then return a proof-linked receipt and episode.",
    inputSchema: { type: "object", properties: { sessionRef: SESSION_REF, situation: { type: "object" },
      requirementRef: { type: "string", pattern: "^requirement:[A-Za-z0-9._:-]{1,128}$" },
      destinationRequirementRef: { type: "string", pattern: "^requirement:[A-Za-z0-9._:-]{1,128}$" },
      intent: { type: "object" } }, required: ["sessionRef", "situation", "requirementRef", "intent"],
    additionalProperties: false } }),
  Object.freeze({ name: "motorInspect", description: "Inspect the pinned Motor policy, current provider, and durable record count.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } }),
  Object.freeze({ name: "motorList", description: "List durable actuation receipt summaries without exposing provider handles or value payloads.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } }),
  Object.freeze({ name: "motorReplay", description: "Traverse the one exact ReplayGraph edge for a sealed Motor receipt without a live provider effect.",
    inputSchema: { type: "object", properties: { receiptSha256: DIGEST, worldRef: REF,
      expectedNodeRef: { type: "string", pattern: "^node:[0-9a-f]{64}$" } },
    required: ["receiptSha256", "worldRef", "expectedNodeRef"], additionalProperties: false } }),
  Object.freeze({ name: "motorPolicyEvaluate", description: "Evaluate one tactical correction against pinned effect-free coverage without promoting it.",
    inputSchema: { type: "object", properties: { basePolicySha256: DIGEST, corpusSha256: DIGEST,
      evaluationManifestSha256: DIGEST, proposal: PROPOSAL },
    required: ["basePolicySha256", "corpusSha256", "evaluationManifestSha256", "proposal"],
    additionalProperties: false } }),
  Object.freeze({ name: "motorPolicyPromote", description: "Promote one deterministic tactical correction with compare-and-swap after all coverage gates pass.",
    inputSchema: { type: "object", properties: { expectedPolicySha256: DIGEST, corpusSha256: DIGEST,
      evaluationManifestSha256: DIGEST, proposal: PROPOSAL },
    required: ["expectedPolicySha256", "corpusSha256", "evaluationManifestSha256", "proposal"],
    additionalProperties: false } }),
  Object.freeze({ name: "motorPolicyRollback", description: "Move the Motor policy HEAD back to its exact last-known-good parent.",
    inputSchema: { type: "object", properties: { expectedPolicySha256: DIGEST },
      required: ["expectedPolicySha256"], additionalProperties: false } }),
]);

export async function createActuationHandlers({ root, automationRouter = null, replayGraphProduct = null,
  appProduct = null, valueBindings = {}, authorityValidator = null, cleanup = null } = {}) {
  const store = await FileActuationStore.open(root);
  const cooperative = appProduct && automationRouter?.providerKind === "frame"
    ? new CooperativeActuator({ appCoordinator: appProduct.coordinator, automation: automationRouter }) : null;
  const coordinator = await ActuationCoordinator.open({ store, automation: automationRouter,
    replayGraph: replayGraphProduct?.coordinator || null, cooperative, valueBindings, authorityValidator, cleanup });
  return Object.freeze({ store, coordinator, handlers: Object.freeze({
    "motor.execute": (input, context) => coordinator.execute(input, context),
    "motor.inspect": () => coordinator.inspect(),
    "motor.list": () => coordinator.list(),
    "motor.replay": (input) => coordinator.replay(input),
    "motor.policy.evaluate": (input) => coordinator.evaluate(input),
    "motor.policy.promote": (input) => coordinator.promote(input),
    "motor.policy.rollback": (input) => coordinator.rollback(input),
  }) });
}
