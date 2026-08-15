// machineNext.js - 한 Machine 첫 결과를 모든 공개 adapter의 같은 operation으로 표현한다.
import { resolve } from "node:path";
import { controlOperationForTool } from "../controlProtocol/controlOperations.js";

const FIRST_RESULT_CODE = "40 + 2";
const MCP_RUN_TOOL = "pythonRun";

function frozenArray(values) {
  return Object.freeze([...values]);
}

export function createMachineNext(configPath) {
  if (typeof configPath !== "string" || !configPath) {
    throw new TypeError("Machine next configPath must be a non-empty string");
  }
  const resolvedConfig = resolve(configPath);
  const input = Object.freeze({ code: FIRST_RESULT_CODE });
  const operation = controlOperationForTool(MCP_RUN_TOOL);
  if (!operation) throw new Error(`Control operation is missing for ${MCP_RUN_TOOL}`);

  const firstResult = Object.freeze({
    schemaVersion: 1,
    operation,
    input,
    shell: Object.freeze({
      command: "pyproc-control",
      arguments: frozenArray(["run", "--config", resolvedConfig, "--code", FIRST_RESULT_CODE]),
    }),
    javascript: Object.freeze({
      module: "pyproc/control",
      client: "PyProcControlClient",
      startMethod: "start",
      startArguments: frozenArray([resolvedConfig]),
      method: "runPython",
      arguments: frozenArray([FIRST_RESULT_CODE]),
    }),
    python: Object.freeze({
      module: "pyprocControl",
      client: "PyProcClient",
      startMethod: "start",
      startArguments: frozenArray([resolvedConfig]),
      method: "runPython",
      arguments: frozenArray([FIRST_RESULT_CODE]),
    }),
    mcp: Object.freeze({
      command: "pyproc-mcp",
      serverArguments: frozenArray(["--config", resolvedConfig]),
      tool: MCP_RUN_TOOL,
      arguments: input,
    }),
  });

  return Object.freeze({
    doctor: `pyproc-control doctor --config "${resolvedConfig}"`,
    start: `pyproc-control --config "${resolvedConfig}"`,
    run: `pyproc-control run --config "${resolvedConfig}" --code "${FIRST_RESULT_CODE}"`,
    mcp: `pyproc-mcp --config "${resolvedConfig}"`,
    firstResult,
  });
}
