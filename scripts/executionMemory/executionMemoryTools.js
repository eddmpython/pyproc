// executionMemoryTools.js - Control과 MCP가 공유하는 Execution Memory operation과 handler.
import { isAbsolute, relative, resolve } from "node:path";
import { createExecutionMemoryRegistry } from "./executionMemoryRegistry.js";
import { executionMemoryError } from "./executionMemoryCanonical.js";

const DIGEST = { type: "string", pattern: "^[0-9a-f]{64}$" };
const ADDRESS = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const SESSION_ID = { type: "string", pattern: "^session:[A-Za-z0-9._:-]{1,96}$" };
const PROJECT = Object.freeze({
  type: "object",
  properties: {
    workspaceId: { type: "string", minLength: 1 }, commit: { type: "string", minLength: 1 },
    treeSha256: ADDRESS, diffSha256: ADDRESS, untracked: { type: "boolean" },
  },
  required: ["workspaceId", "commit", "treeSha256", "diffSha256", "untracked"],
  additionalProperties: false,
});
const WORK = Object.freeze({
  type: "object",
  properties: {
    state: { type: "string", enum: ["active", "waitingApproval", "failed", "abandoned"] },
    branch: { anyOf: [{ type: "string" }, { type: "null" }] },
    checkpoint: { anyOf: [{ type: "string" }, { type: "null" }] },
    outcomeUnknown: { type: "boolean" }, pendingIntentSha256: { anyOf: [DIGEST, { type: "null" }] },
  },
  required: ["state", "branch", "checkpoint", "outcomeUnknown", "pendingIntentSha256"],
  additionalProperties: false,
});
const BROWSER_BOUNDARY = Object.freeze({
  type: "object",
  properties: {
    situation: { type: "object", additionalProperties: true }, cursor: { type: "integer", minimum: 0 },
    prefixSha256: DIGEST,
  },
  required: ["situation", "cursor", "prefixSha256"],
  additionalProperties: false,
});

export const EXECUTION_MEMORY_TOOLS = Object.freeze([
  Object.freeze({ name: "memoryCreate", description: "Create an immutable Execution Memory session from the current portable Machine image and verified links.",
    inputSchema: { type: "object", properties: { executionSessionId: SESSION_ID, project: PROJECT,
      machineId: { type: "string", minLength: 1 }, browser: BROWSER_BOUNDARY },
    required: ["executionSessionId", "project"], additionalProperties: false } }),
  Object.freeze({ name: "memoryCheckpoint", description: "Publish a CAS-guarded session revision from the current portable Machine image.",
    inputSchema: { type: "object", properties: { executionSessionId: SESSION_ID,
      expectedRevisionSha256: DIGEST, work: WORK, browser: BROWSER_BOUNDARY },
    required: ["executionSessionId", "expectedRevisionSha256", "work"], additionalProperties: false } }),
  Object.freeze({ name: "memoryComplete", description: "Complete a session only when a verified Evidence Pack matches its exact repository identity.",
    inputSchema: { type: "object", properties: { executionSessionId: SESSION_ID,
      expectedRevisionSha256: DIGEST, evidencePackDir: { type: "string", minLength: 1 } },
    required: ["executionSessionId", "expectedRevisionSha256", "evidencePackDir"], additionalProperties: false } }),
  Object.freeze({ name: "memoryOpen", description: "Open and reverify the current immutable Execution Memory revision.",
    inputSchema: { type: "object", properties: { executionSessionId: SESSION_ID },
      required: ["executionSessionId"], additionalProperties: false } }),
  Object.freeze({ name: "memoryList", description: "List durable Execution Memory session heads.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } }),
  Object.freeze({ name: "memoryInspect", description: "Inspect one verified session head and its immutable chain length.",
    inputSchema: { type: "object", properties: { executionSessionId: SESSION_ID },
      required: ["executionSessionId"], additionalProperties: false } }),
  Object.freeze({ name: "memoryExport", description: "Export a signed handoff descriptor and its existing-format sidecars under the configured root.",
    inputSchema: { type: "object", properties: { executionSessionId: SESSION_ID,
      outputPath: { type: "string", minLength: 1 } }, required: ["executionSessionId", "outputPath"],
      additionalProperties: false } }),
  Object.freeze({ name: "memoryImport", description: "Import a trusted handoff after a separate exact permission-manifest approval.",
    inputSchema: { type: "object", properties: { handoffDir: { type: "string", minLength: 1 },
      trustedPublicKeyFile: { type: "string", minLength: 1 }, approvedPermissionManifestSha256: DIGEST },
    required: ["handoffDir", "trustedPublicKeyFile", "approvedPermissionManifestSha256"],
    additionalProperties: false } }),
]);

function allowedPath(pathInput, roots, label) {
  if (typeof pathInput !== "string" || !isAbsolute(pathInput)) {
    throw executionMemoryError("EXECUTION_MEMORY_PATH", `${label} must be an absolute path`);
  }
  const target = resolve(pathInput);
  if (!roots.some((root) => {
    const rel = relative(root, target);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  })) throw executionMemoryError("EXECUTION_MEMORY_PATH", `${label} is outside configured roots`);
  return target;
}

function decodeMachineResult(result) {
  if (result?.kind !== "machineImage" || result.mimeType !== "application/x-pymachine"
    || typeof result.dataBase64 !== "string") {
    throw executionMemoryError("EXECUTION_MEMORY_MACHINE_INVALID", "Machine image provider returned an invalid result");
  }
  const bytes = Buffer.from(result.dataBase64, "base64");
  if (bytes.toString("base64") !== result.dataBase64 || bytes.byteLength !== result.byteLength) {
    throw executionMemoryError("EXECUTION_MEMORY_MACHINE_INVALID", "Machine image base64 is not canonical");
  }
  return bytes;
}

export async function createExecutionMemoryHandlers({
  root,
  pageBridge,
  permissionManifest,
  recordingConfig = null,
  recordingProvider = null,
  importRoots = [],
  secretValues = [],
}) {
  const registry = await createExecutionMemoryRegistry({ root, secretValues });
  const permissions = await registry.artifacts.capturePermissions(permissionManifest);
  const roots = Object.freeze([resolve(root), ...importRoots.map(resolve)]);

  const captureMachine = async (machineId, signal, requestId) => {
    const result = await pageBridge.dispatch("machine.image.export", {}, { signal, requestId: `${requestId}:image` });
    return registry.artifacts.captureMachineImage({ bytes: decodeMachineResult(result), machineId, lifecycle: "portable" });
  };
  const captureBrowser = async (input) => {
    if (!input) return null;
    const captureSelected = async (selectedRecording) => {
      if (!selectedRecording?.file || !selectedRecording.recordingId || !selectedRecording.finalSha256) {
        throw executionMemoryError("EXECUTION_MEMORY_RECORDING_REQUIRED",
          "a verified live recording snapshot or pinned replay recording is required for a browser boundary");
      }
      const situation = await registry.artifacts.captureSituation(input.situation);
      const recording = await registry.artifacts.captureRecording({
        file: selectedRecording.file,
        recording: selectedRecording.recording || null,
        recordingId: selectedRecording.recordingId,
        finalSha256: selectedRecording.finalSha256,
        cursor: input.cursor,
        prefixSha256: input.prefixSha256,
      });
      return Object.freeze({ ...situation, ...recording });
    };
    return typeof recordingProvider === "function"
      ? recordingProvider(captureSelected) : captureSelected(recordingConfig);
  };
  const captureEvidence = async (pathInput) => registry.artifacts.captureEvidence(
    allowedPath(pathInput, roots, "evidencePackDir"));

  return Object.freeze({
    registry,
    permissions,
    captureMachine,
    captureBrowser,
    captureEvidence,
    allowedImportPath: (pathInput, label) => allowedPath(pathInput, roots, label),
    handlers: Object.freeze({
      "memory.create": async (input, { signal, requestId }) => registry.createSession({
        executionSessionId: input.executionSessionId,
        project: input.project,
        machine: await captureMachine(input.machineId || "machine:primary", signal, requestId),
        browser: await captureBrowser(input.browser),
        permissions,
      }),
      "memory.checkpoint": async (input, { signal, requestId }) => {
        const current = await registry.openSession(input.executionSessionId);
        return registry.checkpointSession(input.executionSessionId, input.expectedRevisionSha256, {
          machine: await captureMachine(current.machine.machineId, signal, requestId),
          work: input.work,
          browser: input.browser === undefined ? current.browser : await captureBrowser(input.browser),
        });
      },
      "memory.complete": async (input, { signal, requestId }) => {
        const current = await registry.openSession(input.executionSessionId);
        const evidence = await captureEvidence(input.evidencePackDir);
        const machine = await captureMachine(current.machine.machineId, signal, requestId);
        return registry.completeSession(input.executionSessionId, input.expectedRevisionSha256, { machine, evidence });
      },
      "memory.open": (input) => registry.openSession(input.executionSessionId),
      "memory.list": () => registry.listSessions(),
      "memory.inspect": (input) => registry.inspectSession(input.executionSessionId),
      "memory.export": (input) => registry.exportHandoff(input.executionSessionId, input.outputPath),
      "memory.import": (input) => registry.importHandoff(
        allowedPath(input.handoffDir, roots, "handoffDir"),
        {
          trustedPublicKeyFile: allowedPath(input.trustedPublicKeyFile, roots, "trustedPublicKeyFile"),
          approvedPermissionManifestSha256: input.approvedPermissionManifestSha256,
        },
      ),
    }),
  });
}
