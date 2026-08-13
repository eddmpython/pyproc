// executionMemoryRegistry.js - verified artifacts를 immutable session revision과 CAS HEAD로 연결한다.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  canonicalExecutionMemoryJson,
  createExecutionMemoryRevision,
  executionMemoryBytes,
  executionMemoryError,
  scanExecutionMemorySecrets,
  validateExecutionMemoryRevision,
} from "./executionMemoryCanonical.js";
import { ExecutionMemoryArtifacts } from "./executionMemoryArtifacts.js";
import { FileExecutionMemoryStore } from "./fileExecutionMemoryStore.js";

const HANDOFF_FORMAT = "pyproc.executionMemoryHandoff";
const HANDOFF_VERSION = 1;
const HANDOFF_MAX_DESCRIPTOR_BYTES = 16 * 1024 * 1024;
const INVENTORY_KEYS = Object.freeze([
  "machineImages", "coldReceipts", "situations", "recordings", "evidencePacks", "permissionManifests",
]);
const DIGEST = /^[0-9a-f]{64}$/;

function digestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readRevision(store, digest) {
  const bytes = await store.readObject(digest);
  if (!bytes || digestBytes(bytes) !== digest) {
    throw executionMemoryError("EXECUTION_MEMORY_OBJECT_MISSING", `revision object is missing or mutated: ${digest}`);
  }
  const content = JSON.parse(bytes.toString("utf8"));
  return validateExecutionMemoryRevision({ ...content, contentSha256: digest });
}

async function identity(root) {
  const directory = join(root, "identity");
  const privateFile = join(directory, "ed25519-private.pem");
  const publicFile = join(directory, "ed25519-public.pem");
  await mkdir(directory, { recursive: true });
  let existingPrivate = null;
  try { existingPrivate = await readFile(privateFile, "utf8"); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (existingPrivate) {
    const derivedPublic = createPublicKey(createPrivateKey(existingPrivate))
      .export({ type: "spki", format: "pem" });
    try { await writeFile(publicFile, derivedPublic, { flag: "wx", mode: 0o644 }); }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await readFile(publicFile, "utf8") !== derivedPublic) {
        throw executionMemoryError("EXECUTION_MEMORY_SIGNATURE", "local signing identity files do not match");
      }
    }
    return Object.freeze({ privateKey: existingPrivate, publicKey: derivedPublic, publicFile });
  }
  const pair = generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" });
  try { await writeFile(privateFile, privateKey, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (error?.code === "EEXIST") return identity(root);
    throw error;
  }
  try { await writeFile(publicFile, publicKey, { flag: "wx", mode: 0o644 }); }
  catch (error) {
    if (error?.code !== "EEXIST" || await readFile(publicFile, "utf8") !== publicKey) throw error;
  }
  return Object.freeze({ privateKey, publicKey, publicFile });
}

function safeTerminal(work, machine) {
  if (work.state === "suspended" && machine.lifecycle !== "cold") {
    throw executionMemoryError("EXECUTION_MEMORY_SUSPEND_UNVERIFIED", "suspended requires a cold Machine receipt");
  }
  if (["suspended", "completed"].includes(work.state) && work.outcomeUnknown) {
    throw executionMemoryError("EXECUTION_MEMORY_OUTCOME_UNKNOWN", "unknown external effect blocks a safe terminal");
  }
}

function validateInventory(inventory) {
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)
    || Object.keys(inventory).sort().join(",") !== [...INVENTORY_KEYS].sort().join(",")) {
    throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", "handoff inventory shape is invalid");
  }
  for (const key of INVENTORY_KEYS) {
    if (!Array.isArray(inventory[key]) || inventory[key].some((digest) => !DIGEST.test(String(digest)))) {
      throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", `handoff inventory ${key} is invalid`);
    }
    const canonical = [...new Set(inventory[key])].sort();
    if (canonical.join(",") !== inventory[key].join(",")) {
      throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", `handoff inventory ${key} is not canonical`);
    }
  }
  return inventory;
}

function inventoryForRevisions(revisions) {
  return Object.freeze({
    machineImages: Object.freeze([...new Set(revisions.map((revision) => revision.machine.imageSha256))].sort()),
    coldReceipts: Object.freeze([...new Set(revisions.flatMap((revision) =>
      revision.machine.lifecycle === "cold" ? [revision.machine.imageSha256] : []))].sort()),
    situations: Object.freeze([...new Set(revisions.flatMap((revision) =>
      revision.browser ? [revision.browser.situationSha256] : []))].sort()),
    recordings: Object.freeze([...new Set(revisions.flatMap((revision) =>
      revision.browser ? [revision.browser.finalSha256] : []))].sort()),
    evidencePacks: Object.freeze([...new Set(revisions.flatMap((revision) =>
      revision.evidence ? [revision.evidence.contentSha256] : []))].sort()),
    permissionManifests: Object.freeze([...new Set(revisions.map((revision) =>
      revision.permissions.manifestSha256))].sort()),
  });
}

function validateHandoffDescriptor(descriptor) {
  const keys = ["format", "version", "executionSessionId", "headSha256",
    "requestedPermissionManifestSha256", "revisions", "inventory"];
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)
    || Object.keys(descriptor).sort().join(",") !== keys.sort().join(",")
    || descriptor.format !== HANDOFF_FORMAT || descriptor.version !== HANDOFF_VERSION
    || !/^session:[A-Za-z0-9._:-]{1,96}$/.test(String(descriptor.executionSessionId || ""))
    || !DIGEST.test(String(descriptor.headSha256 || ""))
    || !DIGEST.test(String(descriptor.requestedPermissionManifestSha256 || ""))
    || !Array.isArray(descriptor.revisions) || descriptor.revisions.length < 1) {
    throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", "handoff descriptor is invalid");
  }
  validateInventory(descriptor.inventory);
  return descriptor;
}

export class ExecutionMemoryRegistry {
  static async open({ root, secretValues = [] }) {
    const store = await FileExecutionMemoryStore.open(root);
    return new ExecutionMemoryRegistry({ store, secretValues });
  }

  constructor({ store, secretValues = [], nowFactory = () => new Date().toISOString() }) {
    this.store = store;
    this.secretValues = [...secretValues].filter(Boolean);
    this.nowFactory = nowFactory;
    this.artifacts = new ExecutionMemoryArtifacts({ store, secretValues: this.secretValues });
  }

  async createSession({ executionSessionId, project, machine, permissions, browser = null, source = "control" }) {
    if (await this.store.readHead(executionSessionId)) {
      throw executionMemoryError("EXECUTION_MEMORY_SESSION_EXISTS", `session already exists: ${executionSessionId}`);
    }
    const work = Object.freeze({
      state: "active", branch: null, checkpoint: null, outcomeUnknown: false, pendingIntentSha256: null,
    });
    return this._publish(null, {
      executionSessionId, project, machine, work, browser, evidence: null, permissions,
      provenance: { createdAt: this.nowFactory(), source },
    });
  }

  async checkpointSession(executionSessionId, expectedRevisionSha256, {
    project,
    machine,
    work,
    browser,
    evidence,
    permissions,
    source = "control",
  } = {}) {
    const current = await this.openSession(executionSessionId);
    if (current.contentSha256 !== expectedRevisionSha256) {
      throw executionMemoryError("EXECUTION_MEMORY_HEAD_CONFLICT", `expected revision is stale: ${executionSessionId}`);
    }
    return this._publish(expectedRevisionSha256, {
      executionSessionId,
      project: project || current.project,
      machine: machine || current.machine,
      work: work || current.work,
      browser: browser === undefined ? current.browser : browser,
      evidence: evidence === undefined ? current.evidence : evidence,
      permissions: permissions || current.permissions,
      provenance: { createdAt: this.nowFactory(), source },
    });
  }

  async completeSession(executionSessionId, expectedRevisionSha256, { machine, evidence, source = "control" }) {
    const current = await this.openSession(executionSessionId);
    return this.checkpointSession(executionSessionId, expectedRevisionSha256, {
      machine,
      evidence,
      work: {
        state: "completed",
        branch: current.work.branch,
        checkpoint: current.work.checkpoint,
        outcomeUnknown: false,
        pendingIntentSha256: null,
      },
      source,
    });
  }

  async openSession(executionSessionId) {
    const head = await this.store.readHead(executionSessionId);
    if (!head) throw executionMemoryError("EXECUTION_MEMORY_SESSION_MISSING", `session is unavailable: ${executionSessionId}`);
    const revision = await readRevision(this.store, head);
    if (revision.executionSessionId !== executionSessionId) {
      throw executionMemoryError("EXECUTION_MEMORY_HEAD_CORRUPT", "session HEAD points at another session");
    }
    await this.artifacts.verifyRevision(revision);
    scanExecutionMemorySecrets(revision, this.secretValues);
    return revision;
  }

  async listSessions() {
    const sessions = [];
    for (const executionSessionId of await this.store.listSessionIds()) {
      const revision = await this.openSession(executionSessionId);
      sessions.push(Object.freeze({
        executionSessionId,
        revision: revision.revision,
        contentSha256: revision.contentSha256,
        state: revision.work.state,
        machineLifecycle: revision.machine.lifecycle,
        updatedAt: revision.provenance.createdAt,
      }));
    }
    return Object.freeze(sessions);
  }

  async inspectSession(executionSessionId) {
    const current = await this.openSession(executionSessionId);
    const chain = await this._chain(current);
    return Object.freeze({ current, chainLength: chain.length,
      handoffReady: current.work.outcomeUnknown === false });
  }

  async retentionPlan() {
    const reachable = new Set();
    const revisions = [];
    const visit = async (digest) => {
      if (!digest || reachable.has(digest)) return;
      reachable.add(digest);
      const revision = await readRevision(this.store, digest);
      revisions.push(revision);
      for (const parent of revision.parents) await visit(parent);
    };
    for (const sessionId of await this.store.listSessionIds()) await visit(await this.store.readHead(sessionId));
    const objects = await this.store.listObjectDigests();
    return Object.freeze({
      reachable: Object.freeze([...reachable].sort()),
      orphaned: Object.freeze(objects.filter((digest) => !reachable.has(digest))),
      artifacts: await this.artifacts.retentionPlan(revisions),
    });
  }

  async exportHandoff(executionSessionId, outputPath) {
    const current = await this.openSession(executionSessionId);
    if (current.work.outcomeUnknown) {
      throw executionMemoryError("EXECUTION_MEMORY_OUTCOME_UNKNOWN", "unknown external effect cannot be handed off");
    }
    const chain = await this._chain(current);
    const target = this.store.exportPath(outputPath);
    try { await stat(target); throw executionMemoryError("EXECUTION_MEMORY_EXPORT_EXISTS", "handoff output already exists"); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    const partial = `${target}.partial-${process.pid}-${randomBytes(8).toString("hex")}`;
    const signer = await identity(this.store.root);
    const inventory = inventoryForRevisions(chain);
    const descriptor = Object.freeze({
      format: HANDOFF_FORMAT,
      version: HANDOFF_VERSION,
      executionSessionId,
      headSha256: current.contentSha256,
      requestedPermissionManifestSha256: current.permissions.manifestSha256,
      revisions: Object.freeze(chain.map((revision) => Object.freeze({ ...revision }))),
      inventory,
    });
    scanExecutionMemorySecrets(descriptor, this.secretValues, "handoff");
    const descriptorBytes = Buffer.from(canonicalExecutionMemoryJson(descriptor));
    const signatureBase64 = sign(null, descriptorBytes, signer.privateKey).toString("base64");
    try {
      await mkdir(partial, { recursive: true });
      await writeFile(join(partial, "descriptor.json"), `${canonicalExecutionMemoryJson(descriptor)}\n`, { flag: "wx" });
      await writeFile(join(partial, "signature.txt"), `${signatureBase64}\n`, { flag: "wx" });
      await writeFile(join(partial, "signer-public.pem"), signer.publicKey, { flag: "wx" });
      await this._copyInventory(inventory, this.store.artifactPath(), join(partial, "artifacts"));
      await mkdir(dirname(target), { recursive: true });
      await rename(partial, target);
    } catch (error) {
      await rm(partial, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return Object.freeze({ outputDir: target, executionSessionId, headSha256: current.contentSha256,
      signerPublicKeyFile: signer.publicFile, requestedPermissionManifestSha256: current.permissions.manifestSha256 });
  }

  async importHandoff(handoffDir, {
    trustedPublicKeyFile,
    approvedPermissionManifestSha256,
  } = {}) {
    if (typeof handoffDir !== "string" || !isAbsolute(handoffDir)
      || typeof trustedPublicKeyFile !== "string" || !isAbsolute(trustedPublicKeyFile)) {
      throw executionMemoryError("EXECUTION_MEMORY_PATH", "handoff and trusted key paths must be absolute");
    }
    const root = resolve(handoffDir);
    const descriptorBytes = await readFile(join(root, "descriptor.json"));
    if (descriptorBytes.byteLength > HANDOFF_MAX_DESCRIPTOR_BYTES) {
      throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", "handoff descriptor exceeds the byte limit");
    }
    let descriptor;
    try { descriptor = validateHandoffDescriptor(JSON.parse(descriptorBytes.toString("utf8"))); }
    catch (error) {
      if (error?.code?.startsWith?.("EXECUTION_MEMORY_")) throw error;
      throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", "handoff descriptor JSON is invalid");
    }
    const signatureText = (await readFile(join(root, "signature.txt"), "utf8")).trim();
    const signature = Buffer.from(signatureText, "base64");
    if (signature.toString("base64") !== signatureText) {
      throw executionMemoryError("EXECUTION_MEMORY_SIGNATURE", "handoff signature is not canonical base64");
    }
    const embeddedPublic = await readFile(join(root, "signer-public.pem"), "utf8");
    const trustedPublic = await readFile(resolve(trustedPublicKeyFile), "utf8");
    if (embeddedPublic !== trustedPublic || !verify(null,
      Buffer.from(canonicalExecutionMemoryJson(descriptor)), trustedPublic, signature)) {
      throw executionMemoryError("EXECUTION_MEMORY_SIGNATURE", "handoff signer is untrusted or the descriptor changed");
    }
    if (descriptor.requestedPermissionManifestSha256 !== approvedPermissionManifestSha256) {
      throw executionMemoryError("EXECUTION_MEMORY_PERMISSION", "explicit permission approval does not match the handoff");
    }
    scanExecutionMemorySecrets(descriptor, this.secretValues, "handoff");
    if (await this.store.readHead(descriptor.executionSessionId)) {
      throw executionMemoryError("EXECUTION_MEMORY_SESSION_EXISTS", "handoff session already exists locally");
    }
    let expected = null;
    const revisions = [];
    for (const supplied of descriptor.revisions) {
      const revision = validateExecutionMemoryRevision(supplied);
      if (revision.executionSessionId !== descriptor.executionSessionId
        || revision.revision !== revisions.length + 1
        || revision.parents.length !== (expected ? 1 : 0)
        || (expected && revision.parents[0] !== expected)) {
        throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", "handoff revision chain is discontinuous");
      }
      revisions.push(revision);
      expected = revision.contentSha256;
    }
    if (expected !== descriptor.headSha256) {
      throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", "handoff HEAD does not match the revision chain");
    }
    if (canonicalExecutionMemoryJson(inventoryForRevisions(revisions))
      !== canonicalExecutionMemoryJson(descriptor.inventory)) {
      throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH",
        "handoff inventory contains missing or unrelated artifacts");
    }
    await this._copyInventory(descriptor.inventory, join(root, "artifacts"), this.store.artifactPath());
    for (const revision of revisions) {
      await this.artifacts.verifyRevision(revision);
      await this.store.writeObject(revision.contentSha256, executionMemoryBytes(revision));
    }
    await this.store.compareAndSwapHead(descriptor.executionSessionId, null, expected);
    return this.openSession(descriptor.executionSessionId);
  }

  async _publish(expectedHead, value) {
    const prior = expectedHead ? await this.openSession(value.executionSessionId) : null;
    if (prior && prior.contentSha256 !== expectedHead) {
      throw executionMemoryError("EXECUTION_MEMORY_HEAD_CONFLICT", "expected revision is stale");
    }
    safeTerminal(value.work, value.machine);
    const revision = createExecutionMemoryRevision({
      ...value,
      revision: prior ? prior.revision + 1 : 1,
      parents: prior ? [prior.contentSha256] : [],
    });
    scanExecutionMemorySecrets(revision, this.secretValues);
    await this.artifacts.verifyRevision(revision);
    await this.store.writeObject(revision.contentSha256, executionMemoryBytes(revision));
    await this.store.compareAndSwapHead(revision.executionSessionId, expectedHead, revision.contentSha256);
    return revision;
  }

  async _chain(current) {
    const chain = [];
    let revision = current;
    while (revision) {
      chain.push(revision);
      revision = revision.parents[0] ? await readRevision(this.store, revision.parents[0]) : null;
    }
    return chain.reverse();
  }

  async _copyInventory(inventory, sourceRoot, targetRoot) {
    validateInventory(inventory);
    const rows = [
      ["machine", inventory.machineImages, (digest) => `${digest}.pymachine`],
      ["machine", inventory.coldReceipts, (digest) => `${digest}.cold.json`],
      ["situation", inventory.situations, (digest) => `${digest}.json`],
      ["recording", inventory.recordings, (digest) => digest],
      ["evidence", inventory.evidencePacks, (digest) => digest],
      ["permissions", inventory.permissionManifests, (digest) => `${digest}.json`],
    ];
    for (const [kind, digests, nameOf] of rows) {
      for (const digest of digests) {
        const source = join(sourceRoot, kind, nameOf(digest));
        const target = join(targetRoot, kind, nameOf(digest));
        let targetExists = true;
        try { await stat(target); }
        catch (error) {
          if (error?.code !== "ENOENT") throw error;
          targetExists = false;
        }
        if (!targetExists) {
          await mkdir(dirname(target), { recursive: true });
          await cp(source, target, { recursive: true, errorOnExist: true, force: false });
        }
      }
    }
  }
}

export async function createExecutionMemoryRegistry(options) {
  return ExecutionMemoryRegistry.open(options);
}
