import { createHash, sign, verify } from "node:crypto";

const FORMAT = "pyproc.executionMemoryRevision";
const VERSION = 1;
const SHA = /^[0-9a-f]{64}$/;
const ADDRESS = /^sha256:[0-9a-f]{64}$/;
const STATES = new Set(["active", "waitingApproval", "suspended", "completed", "failed", "abandoned"]);
const REVISION_KEYS = new Set([
  "format", "version", "executionSessionId", "revision", "parents", "project", "machine", "work",
  "browser", "evidence", "permissions", "provenance", "contentSha256",
]);

function memoryError(code, message) {
  return Object.assign(new Error(message), { code, outcome: "notSent", retryable: false });
}

function plain(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw memoryError("EXECUTION_MEMORY_INVALID", `${label} must be an object`);
  return value;
}

function exact(value, keys, label) {
  plain(value, label);
  for (const key of Object.keys(value)) if (!keys.has(key)) throw memoryError("EXECUTION_MEMORY_INVALID", `${label}.${key} is unknown`);
  for (const key of keys) if (!Object.hasOwn(value, key)) throw memoryError("EXECUTION_MEMORY_INVALID", `${label}.${key} is required`);
}

export function canonicalMemoryJson(value, depth = 0) {
  if (depth > 32) throw memoryError("EXECUTION_MEMORY_INVALID", "canonical value is too deep");
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalMemoryJson(item, depth + 1)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalMemoryJson(value[key], depth + 1)}`).join(",")}}`;
  throw memoryError("EXECUTION_MEMORY_INVALID", "canonical value contains an unsupported type");
}

function digest(value) {
  return createHash("sha256").update(canonicalMemoryJson(value)).digest("hex");
}

function scanSecrets(value, secrets, path = "revision") {
  if (typeof value === "string") {
    for (const secret of secrets) if (secret && value.includes(secret)) {
      throw memoryError("EXECUTION_MEMORY_SECRET", `${path} contains configured secret material`);
    }
    return;
  }
  if (Array.isArray(value)) return value.forEach((item, index) => scanSecrets(item, secrets, `${path}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(password|token|cookie|authorization|secret)$/i.test(key)) {
      throw memoryError("EXECUTION_MEMORY_SECRET", `${path}.${key} is a forbidden secret field`);
    }
    scanSecrets(child, secrets, `${path}.${key}`);
  }
}

function revisionContent(revision) {
  const { contentSha256: _contentSha256, ...content } = revision;
  return content;
}

function validateRevisionShape(revision) {
  exact(revision, REVISION_KEYS, "revision");
  if (revision.format !== FORMAT || revision.version !== VERSION
    || !/^session:[A-Za-z0-9._:-]{1,96}$/.test(revision.executionSessionId)
    || !Number.isSafeInteger(revision.revision) || revision.revision < 1
    || !Array.isArray(revision.parents) || revision.parents.length > 1
    || revision.parents.some((parent) => !SHA.test(parent))
    || !STATES.has(revision.work?.state) || !SHA.test(revision.contentSha256)) {
    throw memoryError("EXECUTION_MEMORY_INVALID", "revision envelope is invalid");
  }
  exact(revision.project, new Set(["workspaceId", "repositoryTree"]), "revision.project");
  exact(revision.machine, new Set(["machineId", "generation", "environment", "lifecycle"]), "revision.machine");
  exact(revision.work, new Set(["state", "branch", "checkpoint", "outcomeUnknown", "pendingIntentSha256"]), "revision.work");
  exact(revision.permissions, new Set(["manifestSha256"]), "revision.permissions");
  exact(revision.provenance, new Set(["createdAt", "source"]), "revision.provenance");
  if (revision.browser !== null) exact(revision.browser,
    new Set(["situationRef", "situationSha256", "recordingId", "cursor", "prefixSha256"]), "revision.browser");
  if (revision.evidence !== null) exact(revision.evidence, new Set(["contentSha256", "verdict"]), "revision.evidence");
  if (!ADDRESS.test(revision.project.repositoryTree) || !ADDRESS.test(revision.machine.generation)
    || !SHA.test(revision.machine.environment) || !SHA.test(revision.permissions.manifestSha256)
    || revision.contentSha256 !== digest(revisionContent(revision))) {
    throw memoryError("EXECUTION_MEMORY_MUTATED", "revision digest or content address is invalid");
  }
  return revision;
}

export class PrototypeReferenceCatalog {
  constructor() {
    this.machine = new Map();
    this.situations = new Map();
    this.recordings = new Map();
    this.evidence = new Map();
    this.permissions = new Set();
    this.repositoryTrees = new Set();
  }

  verify(revision) {
    const machine = this.machine.get(revision.machine.generation);
    if (!machine) throw memoryError("EXECUTION_MEMORY_REFERENCE_MISSING", "Machine generation is unavailable");
    if (machine.environment !== revision.machine.environment) {
      throw memoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", "Machine environment does not match the generation");
    }
    if (!this.repositoryTrees.has(revision.project.repositoryTree)
      || !this.permissions.has(revision.permissions.manifestSha256)) {
      throw memoryError("EXECUTION_MEMORY_REFERENCE_MISSING", "project tree or permission manifest is unavailable");
    }
    if (revision.browser) {
      const situation = this.situations.get(revision.browser.situationRef);
      const recording = this.recordings.get(revision.browser.recordingId);
      if (!situation || situation.sha256 !== revision.browser.situationSha256) {
        throw memoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", "SituationCapsule pin does not match");
      }
      if (!recording || recording.cursor !== revision.browser.cursor
        || recording.prefixSha256 !== revision.browser.prefixSha256) {
        throw memoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", "recording cursor pin does not match");
      }
    }
    const pack = revision.evidence ? this.evidence.get(revision.evidence.contentSha256) : null;
    if (revision.evidence && (!pack || pack.verdict !== revision.evidence.verdict)) {
      throw memoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", "Evidence Pack pin does not match");
    }
    if (revision.work.state === "completed" && pack?.verdict !== "verified") {
      throw memoryError("EXECUTION_MEMORY_COMPLETION_UNVERIFIED", "completed requires a verified Evidence Pack");
    }
    if (revision.work.state === "suspended" && revision.machine.lifecycle !== "cold") {
      throw memoryError("EXECUTION_MEMORY_SUSPEND_UNVERIFIED", "suspended requires a cold Machine generation");
    }
    if (["suspended", "completed"].includes(revision.work.state) && revision.work.outcomeUnknown) {
      throw memoryError("EXECUTION_MEMORY_OUTCOME_UNKNOWN", "unknown external effect blocks a safe terminal");
    }
    if (revision.work.state === "waitingApproval" && !SHA.test(String(revision.work.pendingIntentSha256 || ""))) {
      throw memoryError("EXECUTION_MEMORY_INVALID", "waitingApproval requires an exact pending intent");
    }
    if (revision.work.state !== "waitingApproval" && revision.work.pendingIntentSha256 !== null) {
      throw memoryError("EXECUTION_MEMORY_INVALID", "pending intent is allowed only while waitingApproval");
    }
    return revision;
  }
}

export class PrototypeExecutionMemoryStore {
  constructor() {
    this.objects = new Map();
    this.heads = new Map();
  }
  put(digestValue, bytes) {
    const source = Buffer.from(bytes);
    const current = this.objects.get(digestValue);
    if (current && !current.equals(source)) throw memoryError("EXECUTION_MEMORY_OBJECT_EXISTS", "immutable object changed");
    if (!current) this.objects.set(digestValue, source);
  }
  get(digestValue) { return this.objects.get(digestValue) || null; }
  head(sessionId) { return this.heads.get(sessionId) || null; }
  compareAndSwap(sessionId, expected, next) {
    const current = this.head(sessionId);
    if (current !== expected) throw memoryError("EXECUTION_MEMORY_HEAD_CONFLICT", "session HEAD changed");
    this.heads.set(sessionId, next);
  }
}

export class PrototypeExecutionMemoryRegistry {
  constructor({ store, references, now = () => "2026-08-13T00:00:00.000Z", secrets = [] }) {
    this.store = store;
    this.references = references;
    this.now = now;
    this.secrets = [...secrets];
  }

  createSession({ executionSessionId, project, machine, browser = null, permissions, source = "caller" }) {
    if (this.store.head(executionSessionId)) throw memoryError("EXECUTION_MEMORY_SESSION_EXISTS", "session already exists");
    return this._publish(null, {
      executionSessionId, project, machine,
      work: { state: "active", branch: null, checkpoint: null, outcomeUnknown: false, pendingIntentSha256: null },
      browser, evidence: null, permissions, provenance: { createdAt: this.now(), source },
    });
  }

  checkpointSession(executionSessionId, expectedHead, patch) {
    const current = this.openSession(executionSessionId);
    if (current.contentSha256 !== expectedHead) throw memoryError("EXECUTION_MEMORY_HEAD_CONFLICT", "expected revision is stale");
    const next = {
      executionSessionId,
      project: patch.project || current.project,
      machine: patch.machine || current.machine,
      work: patch.work || current.work,
      browser: patch.browser === undefined ? current.browser : patch.browser,
      evidence: patch.evidence === undefined ? current.evidence : patch.evidence,
      permissions: patch.permissions || current.permissions,
      provenance: { createdAt: this.now(), source: patch.source || "caller" },
    };
    return this._publish(expectedHead, next);
  }

  openSession(executionSessionId) {
    const head = this.store.head(executionSessionId);
    if (!head) throw memoryError("EXECUTION_MEMORY_SESSION_MISSING", "session is unavailable");
    const bytes = this.store.get(head);
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== head) {
      throw memoryError("EXECUTION_MEMORY_OBJECT_MISSING", "session HEAD object is missing or mutated");
    }
    const revision = validateRevisionShape({ ...JSON.parse(bytes.toString("utf8")), contentSha256: head });
    this.references.verify(revision);
    return revision;
  }

  exportHandoff(executionSessionId, privateKey) {
    const revision = this.openSession(executionSessionId);
    const descriptor = {
      format: "pyproc.executionMemoryHandoff", version: 1,
      executionSessionId, revisionSha256: revision.contentSha256,
      requestedPermissionManifestSha256: revision.permissions.manifestSha256,
      inventory: {
        machineGeneration: revision.machine.generation,
        situationSha256: revision.browser?.situationSha256 || null,
        recordingPrefixSha256: revision.browser?.prefixSha256 || null,
        evidenceSha256: revision.evidence?.contentSha256 || null,
      },
    };
    scanSecrets(descriptor, this.secrets, "handoff");
    const bytes = Buffer.from(canonicalMemoryJson(descriptor));
    return Object.freeze({ descriptor, revision, signatureBase64: sign(null, bytes, privateKey).toString("base64") });
  }

  importHandoff(bundle, publicKey, { approvedPermissionManifestSha256 } = {}) {
    exact(bundle, new Set(["descriptor", "revision", "signatureBase64"]), "handoff");
    if (Object.hasOwn(bundle.descriptor, "grantedPermissions")) {
      throw memoryError("EXECUTION_MEMORY_PERMISSION", "handoff cannot grant permissions");
    }
    const bytes = Buffer.from(canonicalMemoryJson(bundle.descriptor));
    if (!verify(null, bytes, publicKey, Buffer.from(bundle.signatureBase64, "base64"))) {
      throw memoryError("EXECUTION_MEMORY_SIGNATURE", "handoff signature is invalid");
    }
    if (approvedPermissionManifestSha256 !== bundle.descriptor.requestedPermissionManifestSha256) {
      throw memoryError("EXECUTION_MEMORY_PERMISSION", "explicit permission approval does not match");
    }
    const revision = validateRevisionShape(bundle.revision);
    if (revision.contentSha256 !== bundle.descriptor.revisionSha256) {
      throw memoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", "handoff revision pin does not match");
    }
    this.references.verify(revision);
    scanSecrets(bundle, this.secrets, "handoff");
    const revisionBytes = Buffer.from(canonicalMemoryJson(revisionContent(revision)));
    this.store.put(revision.contentSha256, revisionBytes);
    this.store.compareAndSwap(revision.executionSessionId, null, revision.contentSha256);
    return this.openSession(revision.executionSessionId);
  }

  retentionPlan() {
    const reachable = new Set();
    const visit = (address) => {
      if (!address || reachable.has(address)) return;
      reachable.add(address);
      const bytes = this.store.get(address);
      if (!bytes) return;
      const revision = JSON.parse(bytes.toString("utf8"));
      for (const parent of revision.parents || []) visit(parent);
    };
    for (const head of this.store.heads.values()) visit(head);
    return Object.freeze({ reachable: Object.freeze([...reachable].sort()),
      orphaned: Object.freeze([...this.store.objects.keys()].filter((address) => !reachable.has(address)).sort()) });
  }

  _publish(expectedHead, value) {
    const prior = expectedHead ? this.openSession(value.executionSessionId) : null;
    const body = {
      format: FORMAT, version: VERSION, executionSessionId: value.executionSessionId,
      revision: prior ? prior.revision + 1 : 1,
      parents: prior ? [prior.contentSha256] : [],
      project: structuredClone(value.project), machine: structuredClone(value.machine),
      work: structuredClone(value.work), browser: structuredClone(value.browser),
      evidence: structuredClone(value.evidence), permissions: structuredClone(value.permissions),
      provenance: structuredClone(value.provenance),
    };
    const revision = Object.freeze({ ...body, contentSha256: digest(body) });
    validateRevisionShape(revision);
    this.references.verify(revision);
    scanSecrets(revision, this.secrets);
    const bytes = Buffer.from(canonicalMemoryJson(revisionContent(revision)));
    this.store.put(revision.contentSha256, bytes);
    this.store.compareAndSwap(revision.executionSessionId, expectedHead, revision.contentSha256);
    return revision;
  }
}

export function prototypeAddress(label) {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

export function prototypeDigest(label) {
  return createHash("sha256").update(label).digest("hex");
}
