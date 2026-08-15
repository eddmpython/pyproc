// executionMemoryArtifacts.js - 기존 Machine, APX, recording, Evidence Pack sidecar의 검증과 보존.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { decodeStateBundle, isStateBundle } from "../../src/state/index.js";
import { verifyKernelMachineImage } from "../../src/composition/kernelFactory.js";
import { parseSha256Address } from "../../src/runtime/contentDigest.js";
import {
  assertAutomationRecordingSelection,
  loadAutomationRecording,
  readAutomationRecordingArtifact,
  verifyAutomationRecording,
} from "../automationSpace/automationRecording.js";
import { assertSituationCapsule } from "../perception/situationCatalog.js";
import { evidencePackBytes, loadEvidencePack } from "../verification/evidencePack.js";
import {
  canonicalExecutionMemoryJson,
  executionMemoryDigest,
  executionMemoryError,
  scanExecutionMemorySecrets,
} from "./executionMemoryCanonical.js";

function digestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readOptional(file) {
  try { return await readFile(file); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function encodedSecrets(secretValues) {
  return secretValues.flatMap((secret) => [Buffer.from(secret, "utf8"), Buffer.from(secret, "utf16le")]);
}

function coldReceiptFor({ coldReceipt, machineId, generation, environment }) {
  if (!coldReceipt || coldReceipt.terminal !== "suspended" || coldReceipt.state !== "cold"
    || coldReceipt.machineId !== machineId || coldReceipt.generationId !== generation
    || coldReceipt.cleanupPending === true) {
    throw executionMemoryError("EXECUTION_MEMORY_COLD_RECEIPT_INVALID",
      "cold lifecycle requires a completed suspend receipt for the exact Machine generation");
  }
  const fingerprint = String(coldReceipt.environmentFingerprint || "");
  const fingerprintDigest = /^[0-9a-f]{64}$/.test(fingerprint)
    ? fingerprint : executionMemoryDigest(fingerprint);
  if (fingerprintDigest !== environment) {
    throw executionMemoryError("EXECUTION_MEMORY_COLD_RECEIPT_INVALID",
      "cold suspend receipt environment does not match the Machine image");
  }
  return Object.freeze({ format: "pyproc.executionMemoryColdReceipt", version: 1,
    machineId, state: "cold", terminal: "suspended", generationId: generation,
    environmentFingerprint: fingerprint, cleanupPending: false });
}

async function writeImmutable(file, bytes) {
  await mkdir(dirname(file), { recursive: true });
  try { await writeFile(file, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const current = await readFile(file);
    if (!current.equals(Buffer.from(bytes))) {
      throw executionMemoryError("EXECUTION_MEMORY_ARTIFACT_MUTATED", `content-addressed artifact changed: ${basename(file)}`);
    }
  }
}

async function inspectMachineImage(source) {
  if (isStateBundle(source)) {
    const decoded = await decodeStateBundle(globalThis.crypto, source);
    if (!decoded.commit) throw executionMemoryError("EXECUTION_MEMORY_MACHINE_INVALID", "Machine image has no generation commit");
    const manifest = typeof decoded.meta?.manifest === "string" ? decoded.meta.manifest : decoded.meta;
    return Object.freeze({ generation: decoded.commit, environment: executionMemoryDigest(manifest ?? null) });
  }
  let image;
  try { image = JSON.parse(source.toString("utf8")); }
  catch (error) {
    throw executionMemoryError("EXECUTION_MEMORY_MACHINE_INVALID", "Machine image is neither a state bundle nor kernel image", {
      cause: error?.code || String(error),
    });
  }
  const verified = await verifyKernelMachineImage(image);
  const environment = parseSha256Address(verified.manifest.environmentId);
  if (!environment) throw executionMemoryError("EXECUTION_MEMORY_MACHINE_INVALID", "Kernel Machine environment identity is invalid");
  return Object.freeze({ generation: verified.image.digest, environment });
}

export class ExecutionMemoryArtifacts {
  constructor({ store, secretValues = [] }) {
    this.store = store;
    this.secretValues = [...secretValues];
    this.secretBytes = encodedSecrets(this.secretValues);
  }

  assertBytesNoSecrets(bytes, label) {
    const source = Buffer.from(bytes);
    if (this.secretBytes.some((secret) => secret.byteLength > 0 && source.includes(secret))) {
      throw executionMemoryError("EXECUTION_MEMORY_SECRET", `${label} contains configured secret material`);
    }
  }

  async captureMachineImage({ bytes, machineId, lifecycle = "portable", coldReceipt = null }) {
    const source = Buffer.from(bytes);
    this.assertBytesNoSecrets(source, "Machine image");
    let inspected;
    try { inspected = await inspectMachineImage(source); }
    catch (error) {
      throw executionMemoryError("EXECUTION_MEMORY_MACHINE_INVALID", "Machine image integrity verification failed", {
        cause: `${error?.code || "ERROR"}: ${error?.message || String(error)}`,
      });
    }
    const imageSha256 = digestBytes(source);
    await writeImmutable(this.machinePath(imageSha256), source);
    if (lifecycle === "cold") {
      const receipt = coldReceiptFor({ coldReceipt, machineId: String(machineId),
        generation: inspected.generation, environment: inspected.environment });
      await writeImmutable(this.coldReceiptPath(imageSha256),
        Buffer.from(`${canonicalExecutionMemoryJson(receipt)}\n`));
    } else if (lifecycle !== "portable") {
      throw executionMemoryError("EXECUTION_MEMORY_MACHINE_INVALID",
        "captured Machine image lifecycle must be portable or cold");
    }
    return Object.freeze({ machineId: String(machineId), generation: inspected.generation,
      environment: inspected.environment, imageSha256, lifecycle });
  }

  async captureSituation(capsule) {
    assertSituationCapsule(capsule);
    scanExecutionMemorySecrets(capsule, this.secretValues, "SituationCapsule");
    const situationSha256 = capsule.integrity.canonicalSha256;
    const bytes = Buffer.from(`${canonicalExecutionMemoryJson(capsule)}\n`);
    await writeImmutable(this.situationPath(situationSha256), bytes);
    return Object.freeze({ situationRef: capsule.situationRef, situationSha256 });
  }

  async captureRecording({ file, recording: suppliedRecording = null,
    recordingId, cursor = 0, prefixSha256, finalSha256 }) {
    const recording = suppliedRecording || await loadAutomationRecording(file);
    if (suppliedRecording) verifyAutomationRecording(recording);
    scanExecutionMemorySecrets(recording, this.secretValues, "Automation Recording");
    assertAutomationRecordingSelection(recording, {
      recordingId, finalSha256, startCursor: cursor, ...(prefixSha256 ? { prefixSha256 } : {}),
    }, recording.provider.policy);
    const target = this.recordingPath(finalSha256);
    await mkdir(target, { recursive: true });
    const recordingBytes = suppliedRecording
      ? Buffer.from(`${JSON.stringify(recording, null, 2)}\n`) : await readFile(file);
    this.assertBytesNoSecrets(recordingBytes, "Automation Recording");
    await writeImmutable(join(target, "recording.json"), recordingBytes);
    for (const [artifactRef, artifact] of Object.entries(recording.artifacts)) {
      const bytes = await readAutomationRecordingArtifact(recording, artifactRef);
      this.assertBytesNoSecrets(bytes, `Automation Recording artifact ${artifactRef}`);
      if (typeof artifact.file === "string") {
        await writeImmutable(join(target, "recording.json.artifacts", recording.artifactGeneration, artifact.file), bytes);
      }
    }
    const copied = await loadAutomationRecording(join(target, "recording.json"));
    assertAutomationRecordingSelection(copied, {
      recordingId, finalSha256, startCursor: cursor, ...(prefixSha256 ? { prefixSha256 } : {}),
    }, copied.provider.policy);
    const expectedPrefix = cursor === 0 ? "0".repeat(64) : copied.entries[cursor - 1]?.sha256;
    return Object.freeze({ recordingId, cursor, prefixSha256: expectedPrefix, finalSha256 });
  }

  async captureEvidence(packDir) {
    const loaded = await loadEvidencePack(resolve(packDir));
    scanExecutionMemorySecrets(loaded.pack, this.secretValues, "Evidence Pack");
    const contentSha256 = loaded.pack.contentSha256;
    const target = this.evidencePath(contentSha256);
    const packBytes = evidencePackBytes(loaded.pack);
    this.assertBytesNoSecrets(packBytes, "Evidence Pack");
    await writeImmutable(join(target, "pack.json"), packBytes);
    for (const artifact of loaded.pack.artifacts) {
      const bytes = loaded.artifactBytes.get(artifact.sha256);
      this.assertBytesNoSecrets(bytes, `Evidence Pack artifact ${artifact.artifactRef}`);
      await writeImmutable(join(target, "artifacts", `${artifact.sha256}.bin`), bytes);
    }
    await loadEvidencePack(target);
    return Object.freeze({ contentSha256, verdict: loaded.pack.verdict });
  }

  async capturePermissions(manifest) {
    scanExecutionMemorySecrets(manifest, this.secretValues, "permission manifest");
    const manifestSha256 = executionMemoryDigest(manifest);
    await writeImmutable(this.permissionPath(manifestSha256), Buffer.from(`${canonicalExecutionMemoryJson(manifest)}\n`));
    return Object.freeze({ manifestSha256 });
  }

  async verifyRevision(revision) {
    const machineBytes = await readOptional(this.machinePath(revision.machine.imageSha256));
    if (!machineBytes || digestBytes(machineBytes) !== revision.machine.imageSha256) {
      throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISSING", "Machine image is missing or mutated");
    }
    let coldReceipt = null;
    if (revision.machine.lifecycle === "cold") {
      const receiptBytes = await readOptional(this.coldReceiptPath(revision.machine.imageSha256));
      if (!receiptBytes) throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISSING", "cold suspend receipt is missing");
      try { coldReceipt = JSON.parse(receiptBytes.toString("utf8")); }
      catch (error) { throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", "cold suspend receipt is invalid"); }
    }
    const machine = await this.captureMachineImage({
      bytes: machineBytes,
      machineId: revision.machine.machineId,
      lifecycle: revision.machine.lifecycle,
      coldReceipt,
    });
    if (machine.generation !== revision.machine.generation || machine.environment !== revision.machine.environment) {
      throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", "Machine generation or environment does not match");
    }
    const permissionBytes = await readOptional(this.permissionPath(revision.permissions.manifestSha256));
    if (!permissionBytes) throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISSING", "permission manifest is missing");
    const permission = JSON.parse(permissionBytes.toString("utf8"));
    if (executionMemoryDigest(permission) !== revision.permissions.manifestSha256) {
      throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", "permission manifest digest does not match");
    }
    scanExecutionMemorySecrets(permission, this.secretValues, "permission manifest");
    if (revision.browser) {
      const capsule = JSON.parse(await readFile(this.situationPath(revision.browser.situationSha256), "utf8")
        .catch(() => { throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISSING", "SituationCapsule is missing"); }));
      assertSituationCapsule(capsule);
      scanExecutionMemorySecrets(capsule, this.secretValues, "SituationCapsule");
      if (capsule.situationRef !== revision.browser.situationRef
        || capsule.integrity.canonicalSha256 !== revision.browser.situationSha256) {
        throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", "SituationCapsule pin does not match");
      }
      const recordingFile = join(this.recordingPath(revision.browser.finalSha256), "recording.json");
      const recording = await loadAutomationRecording(recordingFile).catch(() => {
        throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISSING", "Automation Recording is missing");
      });
      scanExecutionMemorySecrets(recording, this.secretValues, "Automation Recording");
      for (const artifactRef of Object.keys(recording.artifacts)) {
        this.assertBytesNoSecrets(await readAutomationRecordingArtifact(recording, artifactRef),
          `Automation Recording artifact ${artifactRef}`);
      }
      assertAutomationRecordingSelection(recording, {
        recordingId: revision.browser.recordingId,
        finalSha256: revision.browser.finalSha256,
        startCursor: revision.browser.cursor,
        prefixSha256: revision.browser.prefixSha256,
      }, recording.provider.policy);
    }
    if (revision.evidence) {
      const loaded = await loadEvidencePack(this.evidencePath(revision.evidence.contentSha256)).catch(() => {
        throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISSING", "Evidence Pack is missing");
      });
      scanExecutionMemorySecrets(loaded.pack, this.secretValues, "Evidence Pack");
      for (const [digest, bytes] of loaded.artifactBytes) {
        this.assertBytesNoSecrets(bytes, `Evidence Pack artifact ${digest}`);
      }
      if (loaded.pack.contentSha256 !== revision.evidence.contentSha256
        || loaded.pack.verdict !== revision.evidence.verdict) {
        throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", "Evidence Pack pin does not match");
      }
      if (revision.work.state === "completed" && loaded.pack.verdict !== "verified") {
        throw executionMemoryError("EXECUTION_MEMORY_COMPLETION_UNVERIFIED", "completed requires a verified Evidence Pack");
      }
      if (revision.work.state === "completed") {
        const project = loaded.pack.manifest.repository;
        if (project.commit !== revision.project.commit || project.treeSha256 !== revision.project.treeSha256
          || project.diffSha256 !== revision.project.diffSha256 || project.untracked !== revision.project.untracked) {
          throw executionMemoryError("EXECUTION_MEMORY_REFERENCE_MISMATCH", "Evidence Pack repository does not match the session project");
        }
      }
    } else if (revision.work.state === "completed") {
      throw executionMemoryError("EXECUTION_MEMORY_COMPLETION_UNVERIFIED", "completed requires a verified Evidence Pack");
    }
    return revision;
  }

  machinePath(digest) { return this.store.artifactPath("machine", `${digest}.pymachine`); }
  coldReceiptPath(digest) { return this.store.artifactPath("machine", `${digest}.cold.json`); }
  situationPath(digest) { return this.store.artifactPath("situation", `${digest}.json`); }
  recordingPath(digest) { return this.store.artifactPath("recording", digest); }
  evidencePath(digest) { return this.store.artifactPath("evidence", digest); }
  permissionPath(digest) { return this.store.artifactPath("permissions", `${digest}.json`); }

  async retentionPlan(revisions) {
    const expected = {
      machine: new Set(), situation: new Set(), recording: new Set(), evidence: new Set(), permissions: new Set(),
    };
    for (const revision of revisions) {
      expected.machine.add(`${revision.machine.imageSha256}.pymachine`);
      if (revision.machine.lifecycle === "cold") expected.machine.add(`${revision.machine.imageSha256}.cold.json`);
      expected.permissions.add(`${revision.permissions.manifestSha256}.json`);
      if (revision.browser) {
        expected.situation.add(`${revision.browser.situationSha256}.json`);
        expected.recording.add(revision.browser.finalSha256);
      }
      if (revision.evidence) expected.evidence.add(revision.evidence.contentSha256);
    }
    const result = {};
    for (const kind of Object.keys(expected)) {
      let entries = [];
      try { entries = await readdir(this.store.artifactPath(kind), { withFileTypes: true }); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
      const actual = entries.filter((entry) => entry.isFile() || entry.isDirectory()).map((entry) => entry.name).sort();
      result[kind] = Object.freeze({ reachable: Object.freeze([...expected[kind]].sort()),
        orphaned: Object.freeze(actual.filter((name) => !expected[kind].has(name))) });
    }
    return Object.freeze(result);
  }
}
