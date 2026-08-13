// clientParityProbe.mjs - native와 MCP adapter가 같은 terminal, outcome, digest를 보존하는지 측정한다.
import { createHash } from "node:crypto";
import { controlTerminalStatus } from "../../../scripts/controlProtocol/controlError.js";
import { mcpToolResult } from "../../../scripts/controlProtocol/mcpControlAdapter.js";

const bytes = Buffer.from("machine-entrance-parity");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const response = mcpToolResult({
  terminal: { type: "response", output: { ok: true }, outcome: "observed",
    attachments: [{ attachmentId: "attachment:1", kind: "screenshot", mimeType: "image/png",
      byteLength: bytes.byteLength, sha256 }] },
  attachments: [{ attachmentId: "attachment:1", kind: "screenshot", mimeType: "image/png",
    byteLength: bytes.byteLength, sha256, bytes }],
});
const metadata = response._meta?.pyprocControl;
if (metadata?.terminal !== "completed" || metadata.outcome !== "observed"
  || metadata.attachments[0]?.sha256 !== sha256) {
  throw new Error("MCP adapter lost the native terminal or attachment digest");
}
if (controlTerminalStatus({ code: "CONTROL_CANCELLED", outcome: "outcomeUnknown" }) !== "outcomeUnknown"
  || controlTerminalStatus({ code: "BROWSER_CONTROL_PERMISSION_DENIED", outcome: "notSent" }) !== "rejected"
  || controlTerminalStatus({ code: "BROWSER_CONTROL_ACTION_FAILED", outcome: "applied",
    details: { completed: [{ index: 0 }] } }) !== "partial") {
  throw new Error("client terminal vocabulary diverged");
}
console.log("machine entrance client parity probe passed");
