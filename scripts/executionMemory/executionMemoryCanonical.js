// executionMemoryCanonical.js - immutable execution session revision의 canonical 계약.
import { createHash } from "node:crypto";

export const EXECUTION_MEMORY_FORMAT = "pyproc.executionMemoryRevision";
export const EXECUTION_MEMORY_VERSION = 1;
export const EXECUTION_MEMORY_STATES = Object.freeze([
  "active", "waitingApproval", "suspended", "completed", "failed", "abandoned",
]);
export const EXECUTION_MEMORY_DIGEST = /^[0-9a-f]{64}$/;
export const EXECUTION_MEMORY_ADDRESS = /^sha256:[0-9a-f]{64}$/;

const STATES = new Set(EXECUTION_MEMORY_STATES);
const REVISION_KEYS = new Set([
  "format", "version", "executionSessionId", "revision", "parents", "project", "machine", "work",
  "browser", "evidence", "permissions", "provenance", "contentSha256",
]);
const PROJECT_KEYS = new Set(["workspaceId", "commit", "treeSha256", "diffSha256", "untracked"]);
const MACHINE_KEYS = new Set(["machineId", "generation", "environment", "imageSha256", "lifecycle"]);
const WORK_KEYS = new Set(["state", "branch", "checkpoint", "outcomeUnknown", "pendingIntentSha256"]);
const BROWSER_KEYS = new Set([
  "situationRef", "situationSha256", "recordingId", "cursor", "prefixSha256", "finalSha256",
]);
const EVIDENCE_KEYS = new Set(["contentSha256", "verdict"]);
const PERMISSION_KEYS = new Set(["manifestSha256"]);
const PROVENANCE_KEYS = new Set(["createdAt", "source"]);

export function executionMemoryError(code, message, details = null) {
  return Object.assign(new Error(message), { code, details, outcome: "notSent", retryable: false });
}

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw executionMemoryError("EXECUTION_MEMORY_INVALID", `${label} must be an object`);
  }
  return value;
}

function exact(value, keys, label) {
  plain(value, label);
  for (const key of Object.keys(value)) if (!keys.has(key)) {
    throw executionMemoryError("EXECUTION_MEMORY_INVALID", `${label}.${key} is unknown`);
  }
  for (const key of keys) if (!Object.hasOwn(value, key)) {
    throw executionMemoryError("EXECUTION_MEMORY_INVALID", `${label}.${key} is required`);
  }
}

export function canonicalExecutionMemoryJson(value, depth = 0) {
  if (depth > 32) throw executionMemoryError("EXECUTION_MEMORY_INVALID", "canonical value exceeds the depth limit");
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalExecutionMemoryJson(entry, depth + 1)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalExecutionMemoryJson(value[key], depth + 1)}`).join(",")}}`;
  }
  throw executionMemoryError("EXECUTION_MEMORY_INVALID", "canonical value contains an unsupported type");
}

export function executionMemoryDigest(value) {
  return createHash("sha256").update(canonicalExecutionMemoryJson(value)).digest("hex");
}

export function executionMemoryBytes(revision) {
  const { contentSha256: _contentSha256, ...content } = revision;
  return Buffer.from(canonicalExecutionMemoryJson(content));
}

export function scanExecutionMemorySecrets(value, secretValues = [], path = "revision") {
  if (typeof value === "string") {
    for (const secret of secretValues) if (secret && value.includes(secret)) {
      throw executionMemoryError("EXECUTION_MEMORY_SECRET", `${path} contains configured secret material`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanExecutionMemorySecrets(entry, secretValues, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(password|passwd|token|access[_-]?token|api[_-]?key|cookie|set-cookie|authorization|client[_-]?secret|secret)$/i.test(key)) {
      throw executionMemoryError("EXECUTION_MEMORY_SECRET", `${path}.${key} is a forbidden secret field`);
    }
    scanExecutionMemorySecrets(child, secretValues, `${path}.${key}`);
  }
}

function boundedText(value, label, maximum) {
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw executionMemoryError("EXECUTION_MEMORY_INVALID", `${label} must contain 1 to ${maximum} characters`);
  }
}

export function createExecutionMemoryRevision({
  executionSessionId,
  revision,
  parents,
  project,
  machine,
  work,
  browser = null,
  evidence = null,
  permissions,
  provenance,
}) {
  const content = {
    format: EXECUTION_MEMORY_FORMAT,
    version: EXECUTION_MEMORY_VERSION,
    executionSessionId,
    revision,
    parents: [...parents],
    project: structuredClone(project),
    machine: structuredClone(machine),
    work: structuredClone(work),
    browser: browser === null ? null : structuredClone(browser),
    evidence: evidence === null ? null : structuredClone(evidence),
    permissions: structuredClone(permissions),
    provenance: structuredClone(provenance),
  };
  return validateExecutionMemoryRevision(Object.freeze({ ...content, contentSha256: executionMemoryDigest(content) }));
}

export function validateExecutionMemoryRevision(revision) {
  exact(revision, REVISION_KEYS, "revision");
  exact(revision.project, PROJECT_KEYS, "revision.project");
  exact(revision.machine, MACHINE_KEYS, "revision.machine");
  exact(revision.work, WORK_KEYS, "revision.work");
  exact(revision.permissions, PERMISSION_KEYS, "revision.permissions");
  exact(revision.provenance, PROVENANCE_KEYS, "revision.provenance");
  if (revision.browser !== null) exact(revision.browser, BROWSER_KEYS, "revision.browser");
  if (revision.evidence !== null) exact(revision.evidence, EVIDENCE_KEYS, "revision.evidence");

  if (revision.format !== EXECUTION_MEMORY_FORMAT || revision.version !== EXECUTION_MEMORY_VERSION
    || !/^session:[A-Za-z0-9._:-]{1,96}$/.test(String(revision.executionSessionId || ""))
    || !Number.isSafeInteger(revision.revision) || revision.revision < 1
    || !Array.isArray(revision.parents) || revision.parents.length > 1
    || revision.parents.some((parent) => !EXECUTION_MEMORY_DIGEST.test(parent))) {
    throw executionMemoryError("EXECUTION_MEMORY_INVALID", "revision envelope is invalid");
  }
  boundedText(revision.project.workspaceId, "revision.project.workspaceId", 512);
  boundedText(revision.project.commit, "revision.project.commit", 256);
  if (!EXECUTION_MEMORY_ADDRESS.test(revision.project.treeSha256)
    || !EXECUTION_MEMORY_ADDRESS.test(revision.project.diffSha256)
    || typeof revision.project.untracked !== "boolean") {
    throw executionMemoryError("EXECUTION_MEMORY_INVALID", "project identity is invalid");
  }
  boundedText(revision.machine.machineId, "revision.machine.machineId", 256);
  if (!EXECUTION_MEMORY_ADDRESS.test(revision.machine.generation)
    || !EXECUTION_MEMORY_DIGEST.test(revision.machine.environment)
    || !EXECUTION_MEMORY_DIGEST.test(revision.machine.imageSha256)
    || !["cold", "portable"].includes(revision.machine.lifecycle)) {
    throw executionMemoryError("EXECUTION_MEMORY_INVALID", "Machine link is invalid");
  }
  if (!STATES.has(revision.work.state) || typeof revision.work.outcomeUnknown !== "boolean"
    || (revision.work.branch !== null && (typeof revision.work.branch !== "string"
      || revision.work.branch.length > 1024))
    || (revision.work.checkpoint !== null && (typeof revision.work.checkpoint !== "string"
      || revision.work.checkpoint.length > 1024))) {
    throw executionMemoryError("EXECUTION_MEMORY_INVALID", "work state is invalid");
  }
  if (revision.work.state === "waitingApproval") {
    if (!EXECUTION_MEMORY_DIGEST.test(String(revision.work.pendingIntentSha256 || ""))) {
      throw executionMemoryError("EXECUTION_MEMORY_INVALID", "waitingApproval requires an exact pending intent");
    }
  } else if (revision.work.pendingIntentSha256 !== null) {
    throw executionMemoryError("EXECUTION_MEMORY_INVALID", "pending intent is allowed only while waitingApproval");
  }
  if (["suspended", "completed"].includes(revision.work.state) && revision.work.outcomeUnknown) {
    throw executionMemoryError("EXECUTION_MEMORY_OUTCOME_UNKNOWN", "unknown external effect blocks a safe terminal");
  }
  if (revision.work.state === "suspended" && revision.machine.lifecycle !== "cold") {
    throw executionMemoryError("EXECUTION_MEMORY_SUSPEND_UNVERIFIED", "suspended requires a cold Machine");
  }
  if (revision.browser !== null) {
    if (!/^situation:[0-9a-f]{64}$/.test(revision.browser.situationRef)
      || !EXECUTION_MEMORY_DIGEST.test(revision.browser.situationSha256)
      || typeof revision.browser.recordingId !== "string" || !revision.browser.recordingId
      || revision.browser.recordingId.length > 256
      || !Number.isSafeInteger(revision.browser.cursor) || revision.browser.cursor < 0
      || !EXECUTION_MEMORY_DIGEST.test(revision.browser.prefixSha256)
      || !EXECUTION_MEMORY_DIGEST.test(revision.browser.finalSha256)) {
      throw executionMemoryError("EXECUTION_MEMORY_INVALID", "browser boundary is invalid");
    }
  }
  if (revision.evidence !== null && (!EXECUTION_MEMORY_DIGEST.test(revision.evidence.contentSha256)
    || !["verified", "rejected", "incomplete"].includes(revision.evidence.verdict))) {
    throw executionMemoryError("EXECUTION_MEMORY_INVALID", "Evidence Pack link is invalid");
  }
  boundedText(revision.provenance.source, "revision.provenance.source", 128);
  if (!EXECUTION_MEMORY_DIGEST.test(revision.permissions.manifestSha256)
    || typeof revision.provenance.createdAt !== "string"
    || !Number.isFinite(Date.parse(revision.provenance.createdAt))
    || revision.provenance.createdAt.length > 64) {
    throw executionMemoryError("EXECUTION_MEMORY_INVALID", "permission or provenance link is invalid");
  }
  const { contentSha256, ...content } = revision;
  if (!EXECUTION_MEMORY_DIGEST.test(contentSha256) || executionMemoryDigest(content) !== contentSha256) {
    throw executionMemoryError("EXECUTION_MEMORY_MUTATED", "revision digest does not match its content");
  }
  return revision;
}
