// controlOperations.js - 기존 제품 동사를 언어 중립 operation과 성공 효과로 고정한다.

export const CONTROL_TOOL_OPERATIONS = Object.freeze({
  pythonRun: "machine.run",
  checkpointSave: "machine.checkpoint.save",
  checkpointRestore: "machine.checkpoint.restore",
  sandboxReset: "machine.reset",
  browserInspect: "automation.space.inspect",
  browserListTargets: "automation.target.list",
  browserOpen: "automation.target.open",
  browserAttach: "automation.session.attach",
  browserCommand: "automation.command",
  browserDetach: "automation.session.detach",
  browserObserve: "automation.observe",
  browserAct: "automation.act",
  browserArtifactRead: "artifact.read",
  browserArtifactDelete: "artifact.delete",
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
  if (operation === "automation.command") return input.expectedRisk === "read" ? "observed" : "applied";
  if (operation === "automation.act") {
    return Array.isArray(input.actions) && input.actions.every((action) => action?.expectedRisk === "read")
      ? "observed" : "applied";
  }
  if (operation === "machine.run" || operation.startsWith("machine.checkpoint.")
    || operation === "machine.reset" || operation === "automation.target.open"
    || operation === "automation.session.attach" || operation === "automation.session.detach"
    || operation === "artifact.delete") return "applied";
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
