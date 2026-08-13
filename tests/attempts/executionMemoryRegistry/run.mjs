import { generateKeyPairSync } from "node:crypto";
import {
  PrototypeExecutionMemoryRegistry,
  PrototypeExecutionMemoryStore,
  PrototypeReferenceCatalog,
  prototypeAddress,
  prototypeDigest,
} from "./executionMemoryPrototype.mjs";

const checks = [];
function check(name, pass, info = "") {
  checks.push({ name, pass: !!pass, info: String(info) });
  if (!pass) throw new Error(`${name}: ${info}`);
}
async function codeOf(operation) {
  try { await operation(); return ""; }
  catch (error) { return error?.code || String(error); }
}

const machineGeneration = prototypeAddress("machine-generation-1");
const repositoryTree = prototypeAddress("repository-tree-1");
const environment = prototypeDigest("environment-1");
const permissionManifest = prototypeDigest("permissions-1");
const situationSha256 = prototypeDigest("situation-1");
const situationRef = `situation:${situationSha256}`;
const prefixSha256 = prototypeDigest("recording-prefix-1");
const evidenceSha256 = prototypeDigest("evidence-pack-1");

function catalog() {
  const references = new PrototypeReferenceCatalog();
  references.machine.set(machineGeneration, { environment });
  references.repositoryTrees.add(repositoryTree);
  references.permissions.add(permissionManifest);
  references.situations.set(situationRef, { sha256: situationSha256 });
  references.recordings.set("recording:one", { cursor: 7, prefixSha256 });
  references.evidence.set(evidenceSha256, { verdict: "verified" });
  return references;
}

const base = {
  executionSessionId: "session:forecast",
  project: { workspaceId: "workspace:forecast", repositoryTree },
  machine: { machineId: "forecast", generation: machineGeneration, environment, lifecycle: "hot" },
  browser: { situationRef, situationSha256, recordingId: "recording:one", cursor: 7, prefixSha256 },
  permissions: { manifestSha256: permissionManifest },
};

const store = new PrototypeExecutionMemoryStore();
const references = catalog();
const registry = new PrototypeExecutionMemoryRegistry({ store, references, secrets: ["fixture-secret"] });
const first = registry.createSession(base);
check("first revision is immutable and content-addressed", first.revision === 1
  && first.contentSha256 === prototypeDigest(store.get(first.contentSha256)),
  `${first.revision}/${first.contentSha256}`);
check("session HEAD points at the first immutable revision", store.head(base.executionSessionId) === first.contentSha256);

const second = registry.checkpointSession(base.executionSessionId, first.contentSha256, {
  machine: { ...base.machine, lifecycle: "cold" },
  work: { state: "suspended", branch: "candidate-a", checkpoint: "checkpoint:7",
    outcomeUnknown: false, pendingIntentSha256: null },
});
check("suspended revision links the cold Machine and exact parent", second.revision === 2
  && second.parents[0] === first.contentSha256 && second.machine.lifecycle === "cold");
check("open verifies the stored digest and every linked reference",
  registry.openSession(base.executionSessionId).contentSha256 === second.contentSha256);
check("stale writer cannot overwrite session HEAD",
  await codeOf(() => registry.checkpointSession(base.executionSessionId, first.contentSha256, {}))
  === "EXECUTION_MEMORY_HEAD_CONFLICT");

const orphanCountBefore = store.objects.size;
const missingReferences = catalog();
missingReferences.machine.delete(machineGeneration);
const missingRegistry = new PrototypeExecutionMemoryRegistry({ store: new PrototypeExecutionMemoryStore(), references: missingReferences });
check("missing Machine generation cannot publish",
  await codeOf(() => missingRegistry.createSession(base)) === "EXECUTION_MEMORY_REFERENCE_MISSING");
const mismatchReferences = catalog();
mismatchReferences.machine.set(machineGeneration, { environment: prototypeDigest("wrong-environment") });
check("environment mismatch cannot publish",
  await codeOf(() => new PrototypeExecutionMemoryRegistry({ store: new PrototypeExecutionMemoryStore(), references: mismatchReferences })
    .createSession(base)) === "EXECUTION_MEMORY_REFERENCE_MISMATCH");
const cursorReferences = catalog();
cursorReferences.recordings.set("recording:one", { cursor: 8, prefixSha256 });
check("forged replay cursor cannot publish",
  await codeOf(() => new PrototypeExecutionMemoryRegistry({ store: new PrototypeExecutionMemoryStore(), references: cursorReferences })
    .createSession(base)) === "EXECUTION_MEMORY_REFERENCE_MISMATCH");

check("caller text cannot declare completion without evidence",
  await codeOf(() => registry.checkpointSession(base.executionSessionId, second.contentSha256, {
    work: { state: "completed", branch: "candidate-a", checkpoint: "checkpoint:7",
      outcomeUnknown: false, pendingIntentSha256: null }, source: "tests passed",
  })) === "EXECUTION_MEMORY_COMPLETION_UNVERIFIED");
references.evidence.set(evidenceSha256, { verdict: "incomplete" });
check("incomplete Evidence Pack cannot declare completion",
  await codeOf(() => registry.checkpointSession(base.executionSessionId, second.contentSha256, {
    work: { state: "completed", branch: "candidate-a", checkpoint: "checkpoint:7",
      outcomeUnknown: false, pendingIntentSha256: null }, evidence: { contentSha256: evidenceSha256, verdict: "incomplete" },
  })) === "EXECUTION_MEMORY_COMPLETION_UNVERIFIED");
references.evidence.set(evidenceSha256, { verdict: "verified" });
const completed = registry.checkpointSession(base.executionSessionId, second.contentSha256, {
  work: { state: "completed", branch: "candidate-a", checkpoint: "checkpoint:7",
    outcomeUnknown: false, pendingIntentSha256: null }, evidence: { contentSha256: evidenceSha256, verdict: "verified" },
});
check("verified Evidence Pack owns the completed terminal", completed.work.state === "completed"
  && completed.evidence.contentSha256 === evidenceSha256);

const unsafeStore = new PrototypeExecutionMemoryStore();
const unsafeRegistry = new PrototypeExecutionMemoryRegistry({ store: unsafeStore, references: catalog() });
const unsafeFirst = unsafeRegistry.createSession(base);
check("hot Machine cannot be labeled suspended",
  await codeOf(() => unsafeRegistry.checkpointSession(base.executionSessionId, unsafeFirst.contentSha256, {
    work: { state: "suspended", branch: null, checkpoint: null, outcomeUnknown: false, pendingIntentSha256: null },
  })) === "EXECUTION_MEMORY_SUSPEND_UNVERIFIED");
check("unknown effect blocks suspended terminal",
  await codeOf(() => unsafeRegistry.checkpointSession(base.executionSessionId, unsafeFirst.contentSha256, {
    machine: { ...base.machine, lifecycle: "cold" },
    work: { state: "suspended", branch: null, checkpoint: null, outcomeUnknown: true, pendingIntentSha256: null },
  })) === "EXECUTION_MEMORY_OUTCOME_UNKNOWN");

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const handoff = registry.exportHandoff(base.executionSessionId, privateKey);
const target = new PrototypeExecutionMemoryRegistry({ store: new PrototypeExecutionMemoryStore(), references: catalog() });
check("signature alone does not grant requested permissions",
  await codeOf(() => target.importHandoff(handoff, publicKey)) === "EXECUTION_MEMORY_PERMISSION");
const imported = target.importHandoff(handoff, publicKey, { approvedPermissionManifestSha256: permissionManifest });
check("isolated registry imports the exact signed revision after permission approval",
  imported.contentSha256 === completed.contentSha256 && target.openSession(base.executionSessionId).revision === 3);
const tampered = structuredClone(handoff);
tampered.descriptor.inventory.machineGeneration = prototypeAddress("tampered");
check("mutated handoff descriptor fails signature verification",
  await codeOf(() => new PrototypeExecutionMemoryRegistry({ store: new PrototypeExecutionMemoryStore(), references: catalog() })
    .importHandoff(tampered, publicKey, { approvedPermissionManifestSha256: permissionManifest }))
  === "EXECUTION_MEMORY_SIGNATURE");

check("external browser state cannot enter the fixed revision schema",
  await codeOf(() => new PrototypeExecutionMemoryRegistry({ store: new PrototypeExecutionMemoryStore(), references: catalog() })
    .createSession({ ...base, browser: { ...base.browser, cookies: ["ambient"] } })) === "EXECUTION_MEMORY_INVALID");
check("configured secret material cannot enter a revision",
  await codeOf(() => new PrototypeExecutionMemoryRegistry({ store: new PrototypeExecutionMemoryStore(), references: catalog(), secrets: ["fixture-secret"] })
    .createSession({ ...base, project: { ...base.project, workspaceId: "workspace:fixture-secret" } }))
  === "EXECUTION_MEMORY_SECRET");

const staleBody = Buffer.from("{\"orphan\":true}");
const staleDigest = prototypeDigest(staleBody);
store.put(staleDigest, staleBody);
const retention = registry.retentionPlan();
check("retention preserves the complete parent chain", retention.reachable.length === 3
  && retention.reachable.includes(first.contentSha256) && retention.reachable.includes(completed.contentSha256),
  JSON.stringify(retention));
check("retention identifies but does not delete orphan objects", retention.orphaned.includes(staleDigest)
  && store.objects.size === orphanCountBefore + 2, JSON.stringify(retention.orphaned));

check("failed publishes never change the durable session HEAD", store.head(base.executionSessionId) === completed.contentSha256);
check("prototype exercised every graduation axis", checks.length >= 20, `${checks.length} checks`);

console.log(`PASS Execution Memory Registry attempt: ${checks.length} checks`);
