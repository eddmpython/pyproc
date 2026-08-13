// controlAttachments.mjs - inline artifact를 검증된 protocol attachment로 승격한다.
import { createHash } from "node:crypto";

const ARTIFACT_REF = /^artifact:[A-Za-z0-9_-]+$/;

function inlineArtifactKind(owner, key, value) {
  if (key !== "dataBase64" || typeof value !== "string" || Object.hasOwn(owner, "offset")
    || !ARTIFACT_REF.test(String(owner.artifactRef || ""))) return null;
  if (owner.kind === "screenshot" && String(owner.mimeType || "").startsWith("image/")) {
    return "screen.capture";
  }
  if (owner.kind === "evidencePack"
    && owner.mimeType === "application/vnd.pyproc.evidence-pack+json") return "evidence.pack";
  return null;
}

function decodeBase64(value) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    const error = new Error("control attachment is not canonical base64");
    error.code = "CONTROL_ATTACHMENT_INVALID";
    throw error;
  }
  return bytes;
}

export function extractControlAttachments(payload) {
  const attachments = [];
  const byArtifact = new Map();
  const visit = (value) => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      const kind = inlineArtifactKind(value, key, child);
      if (!kind) {
        output[key] = visit(child);
        continue;
      }
      if (byArtifact.has(value.artifactRef)) continue;
      const bytes = decodeBase64(child);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (Number(value.byteLength) !== bytes.byteLength || value.sha256 !== sha256) {
        const error = new Error(`control attachment metadata mismatch: ${value.artifactRef}`);
        error.code = "CONTROL_ATTACHMENT_INVALID";
        throw error;
      }
      const attachment = Object.freeze({
        attachmentId: `attachment:${attachments.length + 1}`,
        kind,
        mimeType: value.mimeType,
        byteLength: bytes.byteLength,
        sha256,
        bytes,
        artifactRef: value.artifactRef,
      });
      byArtifact.set(value.artifactRef, attachment);
      attachments.push(attachment);
    }
    return output;
  };
  return Object.freeze({ output: visit(payload), attachments: Object.freeze(attachments) });
}

export function controlAttachmentDescriptors(attachments) {
  return Object.freeze(attachments.map(({ attachmentId, kind, mimeType, byteLength, sha256 }) => Object.freeze({
    attachmentId, kind, mimeType, byteLength, sha256,
  })));
}
