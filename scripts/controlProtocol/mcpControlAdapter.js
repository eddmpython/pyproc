// mcpControlAdapter.js - MCP tool 이름과 content block을 Control Protocol에만 투영한다.
import { controlBase } from "./controlProtocol.js";
import { controlOperationForTool } from "./controlOperations.js";
import { controlTerminalStatus } from "./controlError.js";

function mcpIdKey(value) {
  if (typeof value === "string") return `s:${value}`;
  if (Number.isSafeInteger(value)) return `n:${value}`;
  throw new TypeError("MCP request id must be a string or safe integer");
}

export class McpControlAdapter {
  constructor({ host, tools } = {}) {
    if (!host || typeof host.request !== "function") throw new TypeError("MCP control adapter requires a host");
    this.host = host;
    this.tools = Object.freeze([...tools]);
    this._toolNames = new Set(this.tools.map((tool) => tool.name));
    this._used = new Set();
    this._active = new Map();
    this._sequence = 0;
  }

  hasTool(tool) { return this._toolNames.has(tool); }

  async invoke(mcpRequestId, tool, input = {}) {
    if (!this.hasTool(tool)) throw new TypeError(`unknown tool: ${tool}`);
    const key = mcpIdKey(mcpRequestId);
    if (this._used.has(key)) {
      const error = new Error(`MCP request id was already used: ${String(mcpRequestId)}`);
      error.code = "CONTROL_REQUEST_DUPLICATE";
      throw error;
    }
    this._used.add(key);
    const requestId = `mcp:${++this._sequence}`;
    this._active.set(key, requestId);
    try {
      return await this.host.request({ ...controlBase("request"), requestId,
        operation: controlOperationForTool(tool), input });
    } finally {
      this._active.delete(key);
    }
  }

  cancel(mcpRequestId, reason) {
    let key;
    try { key = mcpIdKey(mcpRequestId); }
    catch (error) { return false; }
    const requestId = this._active.get(key);
    return requestId ? this.host.cancel(requestId, reason) : false;
  }
}

export function mcpToolResult(controlResult) {
  if (!controlResult?.terminal) throw new Error("control request produced no terminal frame");
  const terminal = controlResult.terminal;
  if (terminal.type === "error") {
    // Control Protocol은 provider 세부 정보를 details 아래 고정한다. 기존 MCP tool 계약은
    // pipeline 좌표를 top-level로 노출하므로 adapter에서만 평탄화한다.
    const { details, ...error } = terminal.error;
    const payload = { ...error, ...(details || {}) };
    return Object.freeze({
      content: Object.freeze([{ type: "text", text: JSON.stringify(payload, null, 1) }]),
      isError: true,
      _meta: Object.freeze({ pyprocControl: Object.freeze({
        terminal: controlTerminalStatus(terminal.error),
        outcome: terminal.error.outcome,
        retryable: terminal.error.retryable,
        attachments: Object.freeze([]),
      }) }),
    });
  }
  const attachmentMetadata = Object.freeze(controlResult.attachments.map((attachment) => Object.freeze({
    attachmentId: attachment.attachmentId,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    byteLength: attachment.byteLength,
    sha256: attachment.sha256,
  })));
  const attachmentContent = controlResult.attachments.map((attachment) => attachment.kind === "screen.capture"
    ? Object.freeze({ type: "image", data: Buffer.from(attachment.bytes).toString("base64"),
      mimeType: attachment.mimeType })
    : Object.freeze({ type: "resource", resource: Object.freeze({
      uri: `pyproc-artifact://${attachment.sha256}`,
      mimeType: attachment.mimeType,
      blob: Buffer.from(attachment.bytes).toString("base64"),
    }) }));
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text", text: JSON.stringify(terminal.output, null, 1) }),
      ...attachmentContent,
    ]),
    _meta: Object.freeze({ pyprocControl: Object.freeze({
      terminal: "completed",
      outcome: terminal.outcome,
      retryable: false,
      attachments: attachmentMetadata,
    }) }),
  });
}
