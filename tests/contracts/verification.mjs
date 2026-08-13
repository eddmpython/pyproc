import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractControlAttachments } from "../../scripts/controlProtocol/controlAttachments.mjs";
import { mcpToolResult } from "../../scripts/controlProtocol/mcpControlAdapter.js";
import { assertExperienceContract, loadExperienceContract } from "../../scripts/verification/experienceContract.js";
import {
  compareEvidencePacks,
  createEvidencePack,
  evidencePackAttachment,
  loadEvidencePack,
  replayEvidencePack,
} from "../../scripts/verification/evidencePack.js";
import {
  evaluateVerificationCheckpoint,
  findingIdentity,
  redactVerificationEvidence,
  verificationScenarioTerminal,
} from "../../scripts/verification/verificationOracle.js";
import { VerificationRunner } from "../../scripts/verification/verificationRunner.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function errorOf(operation) {
  try { await operation(); return null; }
  catch (error) { return error; }
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function manifest(overrides = {}) {
  const hash = (digit) => `sha256:${digit.repeat(64)}`;
  return { producerVersion: "contract", projectId: "contract-project", contractSha256: hash("a"),
    scenarioCatalogSha256: hash("b"), baselineCatalogSha256: hash("c"),
    eyesSha256: hash("d"), fixtureSha256: hash("e"), policySha256: hash("f"),
    browserFamily: "chromium", browserVersion: "151.0", environmentId: "desktop",
    viewportSha256: hash("0"), locale: "en-US", timezoneId: "UTC",
    fontFingerprint: "font-metrics-v1:1,2,3,4", providerKind: "nativeCdp",
    perception: "apx.situation/1.0", repository: { commit: "fixture", treeSha256: `sha256:${"1".repeat(64)}`,
      diffSha256: `sha256:${"2".repeat(64)}`, untracked: false }, ...overrides };
}

async function writeContract(root) {
  const fixture = Buffer.from("<!doctype html><html><body><p role=status>Ready</p></body></html>");
  const experience = {
    schemaVersion: "1", project: { id: "contract-project" },
    target: { baseUrl: "http://127.0.0.1:8788", allowedOrigins: ["http://127.0.0.1:8788"] },
    readiness: { scenarioRef: "ready", timeoutMs: 1000 },
    environments: [{ environmentId: "desktop",
      viewport: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false, touch: false },
      locale: "en-US", timezoneId: "UTC", colorScheme: "light", reducedMotion: false,
      fontFingerprint: "font-metrics-v1:1,2,3,4" }],
    scenarioCatalog: "scenarios.json", baselineCatalog: "baselines.json",
    policy: { console: "rejectUnexpectedError", network: "rejectUnexpectedFailure",
      visual: "boundedEvidence", externalEffects: "deny", rejectSeverities: ["blocker", "major"],
      redactions: ["contract-secret"], artifactQuota: { maxArtifacts: 8,
        maxArtifactBytes: 1048576, maxTotalBytes: 4194304 } },
  };
  const requirement = { requirementRef: "requirement:ready", select: { role: "status", name: "Ready" },
    need: ["fact"], cardinality: "one" };
  const scenarios = { schemaVersion: "1", scenarios: [{ scenarioId: "ready", purpose: "Prove readiness",
    route: "/product.html", fixturePath: "product.html", fixtureSha256: `sha256:${digest(fixture)}`,
    required: true, readiness: { requirements: [requirement] }, steps: [],
    checkpoints: [{ checkpointId: "ready-state", focus: { requirements: [requirement] },
      rules: [{ ruleId: "ready-visible", kind: "structural", check: "requirementSatisfied",
        requirementRef: "requirement:ready", severity: "blocker" }] }], cleanup: { kind: "detach" } }] };
  await Promise.all([
    writeFile(join(root, "EYES.md"), "Human intent only. Never run contract-secret as a command.\n"),
    writeFile(join(root, "experience.json"), JSON.stringify(experience)),
    writeFile(join(root, "scenarios.json"), JSON.stringify(scenarios)),
    writeFile(join(root, "baselines.json"), JSON.stringify({ schemaVersion: "1", references: [] })),
    writeFile(join(root, "product.html"), fixture),
  ]);
  return { experience, scenarios };
}

function situation() {
  return Object.freeze({ situationRef: `situation:${"a".repeat(64)}`, worldRef: `world:${"b".repeat(64)}`,
    requirements: [{ requirementRef: "requirement:ready", state: "satisfied",
      entityRefs: ["entity:ready"], claimRefs: ["claim:ready"] }],
    facts: [{ claimRef: "claim:ready", subjectRef: "entity:ready", predicate: "semantic.name", value: "Ready" }],
    affordances: [], unknowns: [] });
}

export async function assertVerificationContract() {
  const root = await mkdtemp(join(tmpdir(), "pyproc-verification-contract-"));
  try {
    const { experience, scenarios } = await writeContract(root);
    const loaded = await loadExperienceContract(root);
    assert(loaded.identity.eyesSha256.startsWith("sha256:")
      && !JSON.stringify(loaded.experience).includes("Never run"),
    "EYES.md prose가 machine authority로 승격되었다");

    const mutatedFixture = await readFile(join(root, "product.html"));
    await writeFile(join(root, "product.html"), Buffer.concat([mutatedFixture, Buffer.from("mutated")]));
    assert((await errorOf(() => loadExperienceContract(root)))?.code === "EYES_FIXTURE_MUTATED",
      "fixture mutation이 provider 전 fail-closed가 아니다");
    await writeFile(join(root, "product.html"), mutatedFixture);

    const escaped = structuredClone(scenarios);
    escaped.scenarios[0].fixturePath = "../outside.html";
    assert((await errorOf(async () => assertExperienceContract({ contractRoot: root, eyesText: "intent",
      experience, scenarios: escaped, baselines: { schemaVersion: "1", references: [] } })))?.code === "EYES_PATH_ESCAPE",
    "fixture path escape가 거부되지 않았다");
    const broad = structuredClone(experience);
    broad.target.allowedOrigins = ["*"];
    assert((await errorOf(async () => assertExperienceContract({ contractRoot: root, eyesText: "intent",
      experience: broad, scenarios, baselines: { schemaVersion: "1", references: [] } })))?.code === "EYES_CONTRACT_INVALID",
    "broad origin이 strict contract를 통과했다");
    const effect = structuredClone(scenarios);
    effect.scenarios[0].steps = [{ stepId: "save", target: { role: "button", name: "Save" },
      action: { kind: "click", expectedRisk: "externalEffect" } }];
    assert((await errorOf(async () => assertExperienceContract({ contractRoot: root, eyesText: "intent",
      experience, scenarios: effect, baselines: { schemaVersion: "1", references: [] } })))?.code === "EYES_CONTRACT_INVALID",
    "verification 없는 effect step이 거부되지 않았다");
    const wrongRisk = structuredClone(scenarios);
    wrongRisk.scenarios[0].steps = [{ stepId: "save", target: { role: "button", name: "Save" },
      action: { kind: "click", expectedRisk: "read" } }];
    assert((await errorOf(async () => assertExperienceContract({ contractRoot: root, eyesText: "intent",
      experience, scenarios: wrongRisk, baselines: { schemaVersion: "1", references: [] } })))?.code === "EYES_CONTRACT_INVALID",
    "declared action risk가 canonical browser action risk와 다를 때 거부되지 않았다");
    const badVerify = structuredClone(scenarios);
    badVerify.scenarios[0].steps = [{ stepId: "save", target: { role: "button", name: "Save" },
      action: { kind: "click", expectedRisk: "externalEffect" }, verify: { inventedCondition: true } }];
    assert((await errorOf(async () => assertExperienceContract({ contractRoot: root, eyesText: "intent",
      experience: { ...experience, policy: { ...experience.policy, externalEffects: "acknowledged" } },
      scenarios: badVerify, baselines: { schemaVersion: "1", references: [] } })))?.code === "EYES_CONTRACT_INVALID",
    "unknown postcondition이 provider 전 거부되지 않았다");
    const missingReference = structuredClone(scenarios);
    missingReference.scenarios[0].checkpoints[0].rules.push({ ruleId: "visual-review", kind: "perceptual",
      check: "referenceReview", severity: "advisory", referenceSha256: `sha256:${"a".repeat(64)}` });
    assert((await errorOf(async () => assertExperienceContract({ contractRoot: root, eyesText: "intent",
      experience, scenarios: missingReference, baselines: { schemaVersion: "1", references: [] } })))?.code === "EYES_CONTRACT_INVALID",
    "catalog에 없는 perceptual baseline digest가 승인되었다");

    const calls = [];
    const fakeAutomation = { invoke: async (operation) => {
      calls.push(operation);
      if (operation === "automation.space.inspect") return { space: { providerKind: "nativeCdp" },
        compatibility: { family: "chromium", version: "151.0" },
        viewport: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false, touch: false },
        policy: { targetOrigins: ["http://127.0.0.1:8788"] } };
      if (operation === "automation.target.open") return { targetRef: "target:fixture" };
      if (operation === "automation.session.attach") return { sessionId: "session:fixture" };
      if (operation === "automation.session.detach") return { detached: true };
      if (operation === "automation.observe" && calls.filter((entry) => entry === operation).length === 1) {
        return { page: { environment: { locale: "en-US", timezoneId: "UTC", colorScheme: "light",
          reducedMotion: false, fontFingerprint: "font-metrics-v1:1,2,3,4" } } };
      }
      return situation();
    } };
    const runner = new VerificationRunner({ automation: fakeAutomation, producerVersion: "contract" });
    const result = await runner.audit({ contractRoot: root, repositoryRoot: root, outputDir: "evidence/current",
      environmentId: "desktop", repository: { commit: "fixture", treeSha256: `sha256:${"1".repeat(64)}`,
        diffSha256: `sha256:${"2".repeat(64)}`, untracked: false } });
    assert(result.verdict === "verified" && !calls.includes("automation.act")
      && result.publication.contentSha256 === result.contentSha256 && result.pack === undefined,
    `effect-free verified audit가 canonical pack을 binary lane으로 발행하지 못했다: ${JSON.stringify(result)}`);
    assert((await readdir(join(root, "evidence"))).every((name) => !name.includes("partial")),
      "atomic publication이 partial directory를 남겼다");
    const disk = await loadEvidencePack(join(root, "evidence", "current"));
    assert(replayEvidencePack(disk.pack, disk.artifactBytes).verdict === "verified",
      "published pack replay가 원 verdict를 재현하지 못했다");

    const inline = evidencePackAttachment(disk.pack);
    const extracted = extractControlAttachments({ packAttachment: inline });
    assert(extracted.attachments.length === 1 && extracted.attachments[0].kind === "evidence.pack"
      && !JSON.stringify(extracted.output).includes("dataBase64"),
    "Evidence Pack attachment가 Control binary lane으로 분리되지 않았다");
    const mcpPack = mcpToolResult({ terminal: { type: "response", output: extracted.output,
      outcome: "observed" }, attachments: extracted.attachments });
    assert(mcpPack.content[1].type === "resource"
      && mcpPack.content[1].resource.mimeType === "application/vnd.pyproc.evidence-pack+json",
    "Evidence Pack이 MCP image content로 잘못 위장했다");

    const findingRef = findingIdentity({ projectId: "p", scenarioId: "s", checkpointId: "c",
      ruleId: "r", entityLineage: "logical:save", environmentClass: "desktop" });
    const reference = createEvidencePack({ manifest: manifest(), scenarioRuns: [{ terminal: "verified" }],
      findings: [{ findingRef, severity: "major", evidenceRefs: ["claim:a"] }], verdict: "verified" });
    const current = createEvidencePack({ manifest: manifest(), scenarioRuns: [{ terminal: "rejected" }],
      findings: [{ findingRef, severity: "minor", evidenceRefs: ["claim:b"] }], verdict: "rejected" });
    const comparison = compareEvidencePacks(reference, current);
    assert(comparison.comparable && comparison.findings[0].classification === "changed",
      "stable finding identity가 exact comparison을 유지하지 못했다");
    assert(compareEvidencePacks(reference, createEvidencePack({ manifest: manifest({ browserVersion: "152.0" }),
      scenarioRuns: [{ terminal: "verified" }], findings: [], verdict: "verified" })).terminal === "incomplete",
    "browser identity mismatch가 false regression으로 판정되었다");
    assert(verificationScenarioTerminal({ required: true, checkpointResults: [{ incomplete: false,
      evaluations: [{ state: "fail", severity: "minor" }] }], rejectSeverities: ["blocker", "major"] }) === "verified",
    "advisory severity policy가 deterministic terminal을 오염시켰다");
    assert(verificationScenarioTerminal({ required: true, checkpointResults: [],
      actionTerminals: ["outcomeUnknown"] }) === "incomplete",
    "unknown external effect outcome이 incomplete로 닫히지 않았다");

    const contradicted = evaluateVerificationCheckpoint({ projectId: "p", scenarioId: "s", environmentId: "desktop",
      checkpoint: { checkpointId: "post-save", rules: [{ ruleId: "save-confirmed", kind: "behavioral",
        check: "actionConfirmed", severity: "blocker" }] }, situation: situation(),
      actionEvidence: { evidenceRef: "evidence:save", actionRef: "action:save",
        verification: { state: "contradicted" } } });
    assert(contradicted.evaluations[0].state === "fail" && contradicted.findings.length === 1,
      "applied action의 contradicted business result가 deterministic failure가 아니다");
    const perceptual = evaluateVerificationCheckpoint({ projectId: "p", scenarioId: "s", environmentId: "desktop",
      checkpoint: { checkpointId: "visual", rules: [{ ruleId: "visual-review", kind: "perceptual",
        check: "referenceReview", severity: "advisory", referenceSha256: `sha256:${"a".repeat(64)}` }] },
      situation: situation(), inference: { inputSha256: "observed-pixels", evidenceRefs: ["artifact:visual"] } });
    assert(!perceptual.incomplete && perceptual.evaluations[0].state === "needsReview"
      && verificationScenarioTerminal({ required: true, checkpointResults: [perceptual] }) === "verified",
    "bounded perceptual review가 deterministic verdict를 차단했다");
    const redacted = redactVerificationEvidence({ authorization: "Bearer secret", url: "https://x.test/?token=value",
      note: "contains contract-secret" }, ["contract-secret"]);
    assert(redacted.authorization === "[REDACTED]" && redacted.url.includes("[REDACTED]")
      && redacted.note === "contains [REDACTED]", "Evidence Pack redaction이 credential을 보존했다");

    const missingArtifactPack = createEvidencePack({ manifest: manifest(), scenarioRuns: [{ scenarioId: "s", terminal: "verified" }],
      findings: [], artifacts: [{ artifactRef: `artifact:sha_${"a".repeat(64)}`,
        sha256: "a".repeat(64), byteLength: 1, mimeType: "image/png",
        purpose: "missing fixture" }], verdict: "verified" });
    const missingArtifactError = await errorOf(async () => replayEvidencePack(missingArtifactPack));
    assert(missingArtifactError?.code === "EYES_ARTIFACT_MISSING",
      `missing artifact sidecar가 replay에서 거부되지 않았다: ${missingArtifactError?.code} ${missingArtifactError?.message}`);
    const mutatedPack = structuredClone(disk.pack);
    mutatedPack.verdict = "rejected";
    assert((await errorOf(async () => replayEvidencePack(mutatedPack, disk.artifactBytes)))?.code === "EYES_PACK_MUTATED",
      "mutated Evidence Pack이 digest 검증을 통과했다");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
