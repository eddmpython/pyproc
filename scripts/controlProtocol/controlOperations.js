// controlOperations.js - 기존 제품 동사를 언어 중립 operation과 성공 효과로 고정한다.

export const CONTROL_TOOL_OPERATIONS = Object.freeze({
  pythonRun: "machine.run",
  machineImageExport: "machine.image.export",
  checkpointSave: "machine.checkpoint.save",
  checkpointRestore: "machine.checkpoint.restore",
  sandboxReset: "machine.reset",
  browserInspect: "automation.space.inspect",
  browserListTargets: "automation.target.list",
  browserOpen: "automation.target.open",
  browserClose: "automation.target.close",
  browserAttach: "automation.session.attach",
  browserCommand: "automation.command",
  browserDetach: "automation.session.detach",
  browserObserve: "automation.observe",
  browserAct: "automation.act",
  browserArtifactRead: "artifact.read",
  browserArtifactDelete: "artifact.delete",
  eyesAudit: "verification.audit",
  eyesVerify: "verification.verify",
  eyesReplay: "verification.replay",
  memoryCreate: "memory.create",
  memoryCheckpoint: "memory.checkpoint",
  memoryComplete: "memory.complete",
  memoryOpen: "memory.open",
  memoryList: "memory.list",
  memoryInspect: "memory.inspect",
  memoryExport: "memory.export",
  memoryImport: "memory.import",
  effectPrepare: "effect.prepare",
  effectRehearse: "effect.rehearse",
  effectApprove: "effect.approve",
  effectCommit: "effect.commit",
  effectInspect: "effect.inspect",
  effectList: "effect.list",
  effectSeal: "effect.seal",
  appAttach: "app.attach",
  appCheckpoint: "app.checkpoint",
  appBranch: "app.branch",
  appRestore: "app.restore",
  appAdopt: "app.adopt",
  appInspect: "app.inspect",
  appList: "app.list",
  appEffectStage: "app.effect.stage",
  appEffectFinalize: "app.effect.finalize",
  worldImportRecording: "world.import.recording",
  worldCreateApp: "world.create.app",
  worldCaptureAppBranch: "world.capture.app.branch",
  worldOpen: "world.open",
  worldInspect: "world.inspect",
  worldEdges: "world.edges",
  worldTraverse: "world.traverse",
  worldCheckpoint: "world.checkpoint",
  worldRestore: "world.restore",
  worldEvaluate: "world.evaluate",
  worldCoverage: "world.coverage",
  worldList: "world.list",
  motorExecute: "motor.execute",
  motorControlAcquire: "motor.control.acquire",
  motorControlRevoke: "motor.control.revoke",
  motorInspect: "motor.inspect",
  motorList: "motor.list",
  motorReplay: "motor.replay",
  motorPolicyEvaluate: "motor.policy.evaluate",
  motorPolicyPromote: "motor.policy.promote",
  motorPolicyRollback: "motor.policy.rollback",
});

const TOOL_FOR_OPERATION = Object.freeze(Object.fromEntries(
  Object.entries(CONTROL_TOOL_OPERATIONS).map(([tool, operation]) => [operation, tool]),
));

export function controlOperationForTool(tool) {
  return CONTROL_TOOL_OPERATIONS[tool] || null;
}

export function controlToolForOperation(operation) {
  return TOOL_FOR_OPERATION[operation] || null;
}

export function controlSuccessOutcome(operation, input = {}) {
  if (["memory.open", "memory.list", "memory.inspect", "effect.inspect", "effect.list",
    "app.inspect", "app.list", "world.inspect", "world.edges", "world.evaluate", "world.coverage",
    "world.list", "motor.inspect", "motor.list", "motor.replay", "motor.policy.evaluate"].includes(operation)) return "observed";
  if (operation === "verification.audit") return "applied";
  if (operation === "automation.command") return input.expectedRisk === "read" ? "observed" : "applied";
  if (operation === "automation.act") {
    return Array.isArray(input.actions) && input.actions.every((action) => action?.expectedRisk === "read")
      ? "observed" : "applied";
  }
  if (operation === "machine.run" || operation === "machine.image.export" || operation.startsWith("machine.checkpoint.")
    || operation === "machine.reset" || operation === "automation.target.open"
    || operation === "automation.session.attach" || operation === "automation.session.detach"
    || operation === "artifact.delete" || operation.startsWith("memory.") || operation.startsWith("effect.")
    || operation.startsWith("app.") || operation.startsWith("world.") || operation.startsWith("motor.")) return "applied";
  return "observed";
}

export function controlOperationCatalog(tools) {
  const operations = [];
  const seen = new Set();
  for (const tool of tools) {
    const operation = controlOperationForTool(tool.name);
    if (!operation) throw new Error(`control operation mapping is missing for tool: ${tool.name}`);
    if (seen.has(operation)) throw new Error(`duplicate control operation: ${operation}`);
    seen.add(operation);
    operations.push(Object.freeze({
      name: operation,
      operationVersion: 1,
      inputSchema: tool.inputSchema,
      toolName: tool.name,
    }));
  }
  return Object.freeze(operations);
}
