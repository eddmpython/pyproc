// effectTransactionTools.js - Control과 MCP가 공유하는 Rehearse-Commit operation과 strict schema.
import { readFile } from "node:fs/promises";
import { EffectTransactionCoordinator } from "./effectTransactionCoordinator.js";
import { createEffectTransactionRegistry } from "./effectTransactionRegistry.js";

const DIGEST = { type: "string", pattern: "^[0-9a-f]{64}$" };
const TRANSACTION_ID = { type: "string", pattern: "^effect:[A-Za-z0-9._:-]{1,96}$" };
const INTENT_ID = { type: "string", pattern: "^intent:[A-Za-z0-9._:-]{1,96}$" };
const SESSION_ID = { type: "string", pattern: "^session:[A-Za-z0-9._:-]{1,96}$" };
const DESTINATION = Object.freeze({ type: "object", properties: {
  origin: { type: "string", format: "uri", minLength: 1, maxLength: 2048 }, subjectSha256: DIGEST,
  purpose: { type: "string", minLength: 1, maxLength: 512 },
}, required: ["origin", "subjectSha256", "purpose"], additionalProperties: false });
const GRANT = Object.freeze({ type: "object", properties: {
  format: { type: "string", const: "pyproc.approvalGrant" }, version: { type: "integer", const: 1 },
  authorityId: { type: "string", minLength: 1, maxLength: 128 }, trustDomainSha256: DIGEST,
  intentSha256: DIGEST, destinationSha256: DIGEST, risk: { type: "string", const: "externalEffect" },
  sessionRevisionSha256: DIGEST, expiresAt: { type: "string", minLength: 1, maxLength: 64 },
  nonce: { type: "string", minLength: 1, maxLength: 256 }, policyVersion: { type: "string", minLength: 1, maxLength: 128 },
  contentSha256: DIGEST, signature: { type: "string", minLength: 40, maxLength: 512 },
}, required: ["format", "version", "authorityId", "trustDomainSha256", "intentSha256", "destinationSha256",
  "risk", "sessionRevisionSha256", "expiresAt", "nonce", "policyVersion", "contentSha256", "signature"],
additionalProperties: false });

export const EFFECT_TRANSACTION_TOOLS = Object.freeze([
  Object.freeze({ name: "effectPrepare", description: "Prepare an exact external-effect intent and move its Execution Session to waitingApproval.",
    inputSchema: { type: "object", properties: { transactionId: TRANSACTION_ID, intentId: INTENT_ID,
      executionSessionId: SESSION_ID, expectedSessionRevisionSha256: DIGEST, destination: DESTINATION,
      effectTemplate: { type: "object", additionalProperties: true },
      expectedTransition: { type: "object", additionalProperties: true } },
    required: ["transactionId", "intentId", "executionSessionId", "expectedSessionRevisionSha256", "destination",
      "effectTemplate", "expectedTransition"], additionalProperties: false } }),
  Object.freeze({ name: "effectRehearse", description: "Rehearse a prepared intent with exact computed or configured provider coverage and explicit limitations.",
    inputSchema: { type: "object", properties: { transactionId: TRANSACTION_ID, expectedRevisionSha256: DIGEST,
      mode: { type: "string", enum: ["computed", "provider"] }, code: { type: "string", minLength: 1, maxLength: 262144 },
      expectedValue: { anyOf: [{ type: "string", maxLength: 10000 }, { type: "null" }] },
      branch: { type: "string", minLength: 1, maxLength: 1024 } },
    required: ["transactionId", "expectedRevisionSha256", "mode"], additionalProperties: false } }),
  Object.freeze({ name: "effectApprove", description: "Accept a separately signed grant for the exact intent and local trust domain.",
    inputSchema: { type: "object", properties: { transactionId: TRANSACTION_ID,
      expectedRevisionSha256: DIGEST, grant: GRANT },
    required: ["transactionId", "expectedRevisionSha256", "grant"], additionalProperties: false } }),
  Object.freeze({ name: "effectCommit", description: "Recheck live APX preconditions, consume one durable lease, send once, and never auto-resend after the effect boundary.",
    inputSchema: { type: "object", properties: { transactionId: TRANSACTION_ID,
      expectedRevisionSha256: DIGEST }, required: ["transactionId", "expectedRevisionSha256"], additionalProperties: false } }),
  Object.freeze({ name: "effectInspect", description: "Open and verify one transaction with its next safe lifecycle action.",
    inputSchema: { type: "object", properties: { transactionId: TRANSACTION_ID },
      required: ["transactionId"], additionalProperties: false } }),
  Object.freeze({ name: "effectList", description: "List durable Rehearse-Commit transaction heads.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } }),
  Object.freeze({ name: "effectSeal", description: "Seal a terminal effect only with a matching verified Evidence Pack.",
    inputSchema: { type: "object", properties: { transactionId: TRANSACTION_ID,
      expectedRevisionSha256: DIGEST, evidencePackDir: { type: "string", minLength: 1 } },
    required: ["transactionId", "expectedRevisionSha256", "evidencePackDir"], additionalProperties: false } }),
]);

export async function createEffectTransactionHandlers({ root, approvalAuthorities, secretBindings,
  memoryProduct, automationRouter, pageBridge } = {}) {
  const authorities = await Promise.all(approvalAuthorities.map(async ({ authorityId, publicKeyFile }) =>
    Object.freeze({ authorityId, publicKey: await readFile(publicKeyFile, "utf8") })));
  const registry = await createEffectTransactionRegistry({ root, approvalAuthorities: authorities, secretBindings });
  const coordinator = new EffectTransactionCoordinator({ registry, memoryProduct, automationRouter, pageBridge });
  return Object.freeze({ registry, coordinator, handlers: Object.freeze({
    "effect.prepare": (input, context) => coordinator.prepare(input, context),
    "effect.rehearse": (input, context) => coordinator.rehearse(input, context),
    "effect.approve": (input) => coordinator.approve(input),
    "effect.commit": (input, context) => coordinator.commit(input, context),
    "effect.inspect": (input) => coordinator.inspect(input),
    "effect.list": () => coordinator.list(),
    "effect.seal": (input) => coordinator.seal(input),
  }) });
}
