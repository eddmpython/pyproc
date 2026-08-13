import { createHash, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionMemoryRegistry } from "../../scripts/executionMemory/executionMemoryRegistry.js";
import { canonicalExecutionMemoryJson } from "../../scripts/executionMemory/executionMemoryCanonical.js";
import { encodeStateBundle } from "../../src/state/index.js";
import { createEvidencePack, publishEvidencePack } from "../../scripts/verification/evidencePack.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function errorOf(operation) {
  try { await operation(); return null; }
  catch (error) { return error; }
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function machineImage(label) {
  const payload = Buffer.from(`machine:${label}`);
  const commit = `sha256:${hash(payload)}`;
  return encodeStateBundle(globalThis.crypto, {
    commit,
    meta: { manifest: `engine:${label}` },
    objects: new Map([[commit, payload]]),
    tag: null,
  });
}

function project() {
  return Object.freeze({
    workspaceId: "workspace:contract",
    commit: "commit:contract",
    treeSha256: `sha256:${"1".repeat(64)}`,
    diffSha256: `sha256:${"2".repeat(64)}`,
    untracked: false,
  });
}

function evidenceManifest(repository) {
  const address = (digit) => `sha256:${digit.repeat(64)}`;
  const repositoryIdentity = { commit: repository.commit, treeSha256: repository.treeSha256,
    diffSha256: repository.diffSha256, untracked: repository.untracked };
  return Object.freeze({
    producerVersion: "contract", projectId: "execution-memory", contractSha256: address("3"),
    scenarioCatalogSha256: address("4"), baselineCatalogSha256: address("5"),
    eyesSha256: address("6"), fixtureSha256: address("7"), policySha256: address("8"),
    browserFamily: "chromium", browserVersion: "contract", environmentId: "contract",
    viewportSha256: address("9"), locale: "en-US", timezoneId: "UTC",
    fontFingerprint: "contract-fonts", providerKind: "nativeCdp", perception: "apx.situation/1.0",
    repository: repositoryIdentity,
  });
}

export async function assertExecutionMemoryContract() {
  const sourceRoot = await mkdtemp(join(tmpdir(), "pyproc-execution-memory-source-"));
  const targetRoot = await mkdtemp(join(tmpdir(), "pyproc-execution-memory-target-"));
  try {
    const source = await ExecutionMemoryRegistry.open({ root: sourceRoot, secretValues: ["fixture-secret"] });
    assert((await errorOf(async () => source.artifacts.captureMachineImage({
      bytes: await machineImage("fixture-secret"), machineId: "machine:secret", lifecycle: "portable",
    })))?.code === "EXECUTION_MEMORY_SECRET", "configured secret 원문이 Machine image에 들어갔다");
    const permissions = await source.artifacts.capturePermissions({ pythonNetwork: "denied", browser: null });
    const firstMachine = await source.artifacts.captureMachineImage({
      bytes: await machineImage("first"), machineId: "machine:contract", lifecycle: "portable",
    });
    const first = await source.createSession({ executionSessionId: "session:contract", project: project(),
      machine: firstMachine, permissions });
    assert(first.revision === 1 && (await source.openSession("session:contract")).contentSha256 === first.contentSha256,
      "immutable first revision이 durable HEAD에서 다시 열리지 않았다");

    const coldBytes = await machineImage("cold");
    const portableCold = await source.artifacts.captureMachineImage({
      bytes: coldBytes, machineId: "machine:contract", lifecycle: "portable",
    });
    assert((await errorOf(() => source.artifacts.captureMachineImage({
      bytes: coldBytes, machineId: "machine:contract", lifecycle: "cold",
    })))?.code === "EXECUTION_MEMORY_COLD_RECEIPT_INVALID",
    "suspend receipt 없는 image가 cold Machine으로 표시됐다");
    const coldMachine = await source.artifacts.captureMachineImage({
      bytes: coldBytes, machineId: "machine:contract", lifecycle: "cold",
      coldReceipt: { machineId: "machine:contract", state: "cold", terminal: "suspended",
        generationId: portableCold.generation, environmentFingerprint: "engine:cold", cleanupPending: false },
    });
    await source.createSession({ executionSessionId: "session:portable-only", project: project(),
      machine: portableCold, permissions });
    const portableExport = await source.exportHandoff("session:portable-only", "portable-only-handoff");
    const portableDescriptor = JSON.parse(await readFile(join(portableExport.outputDir, "descriptor.json"), "utf8"));
    const leakedColdReceipt = await errorOf(() => readFile(join(portableExport.outputDir, "artifacts", "machine",
      `${portableCold.imageSha256}.cold.json`)));
    assert(portableDescriptor.inventory.coldReceipts.length === 0 && leakedColdReceipt?.code === "ENOENT",
      "portable-only handoff가 같은 image digest의 unrelated cold receipt를 운반했다");
    const suspendedWork = { state: "suspended", branch: "candidate:cold", checkpoint: "checkpoint:cold",
      outcomeUnknown: false, pendingIntentSha256: null };
    const suspended = await source.checkpointSession("session:contract", first.contentSha256,
      { machine: coldMachine, work: suspendedWork });
    assert(suspended.machine.lifecycle === "cold" && suspended.parents[0] === first.contentSha256,
      "verified suspend receipt가 cold session revision을 닫지 못했다");

    const secondMachine = await source.artifacts.captureMachineImage({
      bytes: await machineImage("second"), machineId: "machine:contract", lifecycle: "portable",
    });
    const work = { state: "active", branch: "candidate:verified", checkpoint: "checkpoint:2",
      outcomeUnknown: false, pendingIntentSha256: null };
    const second = await source.checkpointSession("session:contract", suspended.contentSha256,
      { machine: secondMachine, work });
    assert(second.parents[0] === suspended.contentSha256 && second.machine.generation !== first.machine.generation,
      "checkpoint revision이 정확한 parent와 새 Machine generation을 결속하지 않았다");
    assert((await errorOf(() => source.checkpointSession("session:contract", first.contentSha256,
      { machine: secondMachine, work })))?.code === "EXECUTION_MEMORY_HEAD_CONFLICT",
    "stale writer가 CAS session HEAD를 덮었다");

    const pack = createEvidencePack({ manifest: evidenceManifest(project()),
      scenarioRuns: [{ scenarioId: "execution-memory", required: true, terminal: "verified" }],
      findings: [], verdict: "verified" });
    const publication = await publishEvidencePack({ repositoryRoot: sourceRoot,
      outputDir: "packs/completed", pack });
    const evidence = await source.artifacts.captureEvidence(publication.outputDir);
    const completed = await source.completeSession("session:contract", second.contentSha256,
      { machine: secondMachine, evidence });
    assert(completed.work.state === "completed" && completed.evidence.verdict === "verified",
      "verified Evidence Pack이 completion truth를 닫지 못했다");
    assert((await errorOf(() => source.checkpointSession("session:contract", completed.contentSha256,
      { work: { ...work, state: "completed" }, evidence: null })))?.code
      === "EXECUTION_MEMORY_COMPLETION_UNVERIFIED", "Evidence Pack 없는 completed revision이 게시됐다");

    const exported = await source.exportHandoff("session:contract", "contract-handoff");
    assert(JSON.parse(await readFile(join(exported.outputDir, "descriptor.json"), "utf8"))
      .inventory.coldReceipts.includes(coldMachine.imageSha256),
    "cold revision handoff에서 exact suspend receipt inventory가 누락됐다");
    const target = await ExecutionMemoryRegistry.open({ root: targetRoot });
    assert((await errorOf(() => target.importHandoff(exported.outputDir, {
      trustedPublicKeyFile: exported.signerPublicKeyFile,
    })))?.code === "EXECUTION_MEMORY_PERMISSION", "서명만으로 permission이 승인됐다");
    const imported = await target.importHandoff(exported.outputDir, {
      trustedPublicKeyFile: exported.signerPublicKeyFile,
      approvedPermissionManifestSha256: exported.requestedPermissionManifestSha256,
    });
    assert(imported.contentSha256 === completed.contentSha256 && imported.revision === 4,
      "isolated registry가 정확한 signed revision chain을 이어받지 못했다");

    const retention = await source.retentionPlan();
    assert(retention.reachable.length === 5 && retention.orphaned.length === 0
      && retention.artifacts.machine.orphaned.length === 0
      && retention.artifacts.evidence.reachable.includes(completed.evidence.contentSha256),
      "retention reachability가 session parent chain을 보존하지 않았다");
    assert((await errorOf(() => source.artifacts.capturePermissions({ note: "fixture-secret" })))?.code
      === "EXECUTION_MEMORY_SECRET", "configured secret 원문이 permission sidecar에 들어갔다");

    const descriptorFile = join(exported.outputDir, "descriptor.json");
    const signatureFile = join(exported.outputDir, "signature.txt");
    const originalDescriptor = await readFile(descriptorFile, "utf8");
    const originalSignature = await readFile(signatureFile, "utf8");
    const descriptor = JSON.parse(originalDescriptor);
    descriptor.inventory.machineImages.push("f".repeat(64));
    descriptor.inventory.machineImages.sort();
    const privateKey = await readFile(join(sourceRoot, "identity", "ed25519-private.pem"), "utf8");
    await writeFile(descriptorFile, `${canonicalExecutionMemoryJson(descriptor)}\n`);
    await writeFile(signatureFile,
      `${sign(null, Buffer.from(canonicalExecutionMemoryJson(descriptor)), privateKey).toString("base64")}\n`);
    const excessRoot = await mkdtemp(join(tmpdir(), "pyproc-execution-memory-excess-"));
    try {
      const excess = await ExecutionMemoryRegistry.open({ root: excessRoot });
      assert((await errorOf(() => excess.importHandoff(exported.outputDir, {
        trustedPublicKeyFile: exported.signerPublicKeyFile,
        approvedPermissionManifestSha256: exported.requestedPermissionManifestSha256,
      })))?.code === "EXECUTION_MEMORY_REFERENCE_MISMATCH",
      "signed handoff의 unrelated artifact inventory가 import됐다");
    } finally {
      await rm(excessRoot, { recursive: true, force: true });
    }
    await writeFile(descriptorFile, originalDescriptor);
    await writeFile(signatureFile, originalSignature);
    const tamperedDescriptor = JSON.parse(originalDescriptor);
    tamperedDescriptor.headSha256 = "0".repeat(64);
    await writeFile(descriptorFile, JSON.stringify(tamperedDescriptor));
    const tamperedRoot = await mkdtemp(join(tmpdir(), "pyproc-execution-memory-tampered-"));
    try {
      const tampered = await ExecutionMemoryRegistry.open({ root: tamperedRoot });
      assert((await errorOf(() => tampered.importHandoff(exported.outputDir, {
        trustedPublicKeyFile: exported.signerPublicKeyFile,
        approvedPermissionManifestSha256: exported.requestedPermissionManifestSha256,
      })))?.code === "EXECUTION_MEMORY_SIGNATURE", "mutated handoff descriptor가 signature 검증을 통과했다");
    } finally {
      await rm(tamperedRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(targetRoot, { recursive: true, force: true });
  }
}
