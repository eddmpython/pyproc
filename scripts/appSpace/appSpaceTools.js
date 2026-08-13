// appSpaceTools.js - Transactional AppSpace Control/MCP surface와 strict schemas.
import { AppSpaceCoordinator } from "./appSpaceCoordinator.js";
import { createAppSpaceRegistry } from "./appSpaceRegistry.js";

const DIGEST = { type: "string", pattern: "^[0-9a-f]{64}$" };
const PAIR_ID = { type: "string", pattern: "^pair:[A-Za-z0-9._:-]{1,96}$" };
const APP_REF = { type: "string", pattern: "^app:[0-9a-f]{32}$" };
const SESSION_ID = { type: "string", pattern: "^session:[A-Za-z0-9._:-]{1,96}$" };
const FRAME_SESSION = Object.freeze({ type: "object", properties: {
  protocolVersion: { type: "string", const: "1" }, spaceId: { type: "string", minLength: 1, maxLength: 256 },
  sessionId: { type: "string", minLength: 1, maxLength: 256 }, targetRef: { type: "string", minLength: 1, maxLength: 256 },
}, required: ["protocolVersion", "spaceId", "sessionId", "targetRef"], additionalProperties: false });
const PAIR_CAPTURE = Object.freeze({ type: "object", properties: { appRef: APP_REF, pairId: PAIR_ID,
  executionSessionId: SESSION_ID, expectedSessionRevisionSha256: DIGEST,
  expectedActivePairSha256: { anyOf: [DIGEST, { type: "null" }] },
}, required: ["appRef", "pairId", "executionSessionId", "expectedSessionRevisionSha256",
  "expectedActivePairSha256"], additionalProperties: false });

export const APP_SPACE_TOOLS = Object.freeze([
  Object.freeze({ name: "appAttach", description: "Attach an explicitly configured cooperative app adapter in the current credentialless FrameSpace.",
    inputSchema: { type: "object", properties: { sessionRef: FRAME_SESSION }, required: ["sessionRef"], additionalProperties: false } }),
  Object.freeze({ name: "appCheckpoint", description: "Fence the app, capture its logical state and Machine checkpoint, publish one complete paired marker, and optionally establish the first active HEAD.",
    inputSchema: PAIR_CAPTURE }),
  Object.freeze({ name: "appBranch", description: "Publish an immutable paired candidate from an existing parent without changing the active app HEAD.",
    inputSchema: { type: "object", properties: { ...PAIR_CAPTURE.properties, parentPairId: PAIR_ID },
      required: [...PAIR_CAPTURE.required, "parentPairId"], additionalProperties: false } }),
  Object.freeze({ name: "appRestore", description: "Restore both logical app state and its in-process Machine checkpoint without adopting the candidate.",
    inputSchema: { type: "object", properties: { appRef: APP_REF, pairId: PAIR_ID }, required: ["appRef", "pairId"], additionalProperties: false } }),
  Object.freeze({ name: "appAdopt", description: "Restore a complete pair and move the active app HEAD with compare-and-swap, rolling back both sides on a race.",
    inputSchema: { type: "object", properties: { appRef: APP_REF, pairId: PAIR_ID,
      expectedActivePairSha256: { anyOf: [DIGEST, { type: "null" }] } },
    required: ["appRef", "pairId", "expectedActivePairSha256"], additionalProperties: false } }),
  Object.freeze({ name: "appInspect", description: "Inspect the live cooperative adapter and its verified active paired generation.",
    inputSchema: { type: "object", properties: { appRef: APP_REF }, required: ["appRef"], additionalProperties: false } }),
  Object.freeze({ name: "appList", description: "List complete paired generation markers and active status.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } }),
  Object.freeze({ name: "appEffectStage", description: "Stage only the public identity of an existing exact Rehearse-Commit intent in the cooperative outbox without sending it.",
    inputSchema: { type: "object", properties: { appRef: APP_REF,
      transactionId: { type: "string", pattern: "^effect:[A-Za-z0-9._:-]{1,96}$" },
      expectedTransactionRevisionSha256: DIGEST },
    required: ["appRef", "transactionId", "expectedTransactionRevisionSha256"], additionalProperties: false } }),
  Object.freeze({ name: "appEffectFinalize", description: "Finalize a staged outbox entry only from the exact terminal Rehearse-Commit transaction and receipt.",
    inputSchema: { type: "object", properties: { appRef: APP_REF,
      transactionId: { type: "string", pattern: "^effect:[A-Za-z0-9._:-]{1,96}$" },
      expectedTransactionRevisionSha256: DIGEST },
    required: ["appRef", "transactionId", "expectedTransactionRevisionSha256"], additionalProperties: false } }),
]);

export async function createAppSpaceHandlers({ root, config, memoryProduct, effectProduct,
  automationRouter, pageBridge, secretValues = [] } = {}) {
  const registry = await createAppSpaceRegistry({ root, secretValues, maxStateBytes: config.maxStateBytes });
  const coordinator = new AppSpaceCoordinator({ registry, memoryProduct, effectProduct, automationRouter,
    pageBridge, allowedApps: config.apps });
  return Object.freeze({ registry, coordinator, handlers: Object.freeze({
    "app.attach": (input, context) => coordinator.attach(input, context),
    "app.checkpoint": (input, context) => coordinator.checkpoint(input, context),
    "app.branch": (input, context) => coordinator.branch(input, context),
    "app.restore": (input, context) => coordinator.restore(input, context),
    "app.adopt": (input, context) => coordinator.adopt(input, context),
    "app.inspect": (input, context) => coordinator.inspect(input, context),
    "app.list": () => coordinator.list(),
    "app.effect.stage": (input, context) => coordinator.stageEffect(input, context),
    "app.effect.finalize": (input, context) => coordinator.finalizeEffect(input, context),
  }) });
}
