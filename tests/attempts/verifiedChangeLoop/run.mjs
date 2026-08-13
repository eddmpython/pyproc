// run.mjs - Initiative 2 deterministic prototype and negative campaign.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEvidencePack,
  compareEvidencePacks,
  confinedPath,
  evaluateCheckpoint,
  issueIdentity,
  redactEvidence,
  replayEvidencePack,
  scenarioTerminal,
  validateExperienceContract,
  verificationDigest,
} from "./prototype/verificationKernel.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const load = async (name) => JSON.parse(await readFile(join(FIXTURES, name), "utf8"));
const eyesText = await readFile(join(FIXTURES, "EYES.md"), "utf8");
const experience = await load("experience.json");
const scenarios = await load("scenarios.json");
const baselines = await load("baselines.json");
const fixtureBytes = await readFile(join(FIXTURES, "product.html"));
scenarios.scenarios[0].fixtureSha256 = `sha256:${verificationDigest(fixtureBytes.toString("utf8"))}`;

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) { passed += 1; console.log(`  PASS ${name}${detail ? ` (${detail})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`); }
}
function rejects(code, fn) {
  try { fn(); return false; } catch (error) { return error?.code === code; }
}

console.log("Verified Change Loop prototype campaign");
const contract = validateExperienceContract({ repositoryRoot: FIXTURES, eyesText, experience, scenarios, baselines });
check("strict contract preserves human prose as digest-only data", contract.eyesSha256.startsWith("sha256:")
  && !JSON.stringify(contract).includes("this-command-must-never-run"));
check("path escape is rejected before a provider exists", rejects("EYES_PATH_ESCAPE", () => confinedPath(FIXTURES, "../outside")));
const unknown = structuredClone(experience); unknown.surprise = true;
check("unknown contract field is rejected", rejects("EYES_CONTRACT_INVALID", () =>
  validateExperienceContract({ repositoryRoot: FIXTURES, eyesText, experience: unknown, scenarios, baselines })));
const broad = structuredClone(experience); broad.target.allowedOrigins = ["*"];
check("broad origin is rejected", rejects("EYES_CONTRACT_INVALID", () =>
  validateExperienceContract({ repositoryRoot: FIXTURES, eyesText, experience: broad, scenarios, baselines })));
const effectScenario = structuredClone(scenarios);
effectScenario.scenarios[0].steps.push({ stepId: "save", target: { role: "button", name: "Save", actionable: true },
  action: { kind: "click", expectedRisk: "externalEffect" } });
check("unacknowledged external effect is rejected", rejects("EYES_AUTHORITY_DENIED", () =>
  validateExperienceContract({ repositoryRoot: FIXTURES, eyesText, experience, scenarios: effectScenario, baselines })));

const situation = {
  requirements: [{ requirementRef: "requirement:ready", state: "satisfied",
    entityRefs: ["entity:ready-lineage"], claimRefs: ["claim:ready"] }],
  facts: [{ claimRef: "claim:ready", subjectRef: "entity:ready-lineage", predicate: "semantic.name", value: "Ready" }],
};
const checkpoint = scenarios.scenarios[0].checkpoints[0];
const good = evaluateCheckpoint({ projectId: experience.project.id, scenarioId: "ready", checkpoint,
  environmentId: "desktop", situation });
check("deterministic structural oracle verifies a satisfied requirement", !good.incomplete
  && good.evaluations[0].state === "pass" && scenarioTerminal({ required: true, checkpointResults: [good] }) === "verified");
const missing = evaluateCheckpoint({ projectId: experience.project.id, scenarioId: "ready", checkpoint,
  environmentId: "desktop", situation: { requirements: [], facts: [] } });
check("missing readiness remains incomplete", missing.incomplete
  && scenarioTerminal({ required: true, checkpointResults: [missing] }) === "incomplete");
const behaviorCheckpoint = { checkpointId: "saved", rules: [{ ruleId: "saved-confirmed", kind: "behavioral",
  check: "actionConfirmed", severity: "blocker" }] };
const appliedOnly = evaluateCheckpoint({ projectId: experience.project.id, scenarioId: "save",
  checkpoint: behaviorCheckpoint, environmentId: "desktop", situation, actionEvidence: {
    evidenceRef: "evidence:save", actionRef: "action:save", effectOutcome: "applied",
    verification: { state: "contradicted" },
  } });
check("applied click without business postcondition is rejected", scenarioTerminal({ required: true,
  checkpointResults: [appliedOnly], actionTerminals: ["applied"] }) === "rejected");
check("outcomeUnknown never becomes verified", scenarioTerminal({ required: true,
  checkpointResults: [good], actionTerminals: ["outcomeUnknown"] }) === "incomplete");

const firstIdentity = issueIdentity({ projectId: "p", scenarioId: "s", checkpointId: "c", ruleId: "r",
  entityLineage: "logical:save", environmentClass: "desktop" });
const movedIdentity = issueIdentity({ projectId: "p", scenarioId: "s", checkpointId: "c", ruleId: "r",
  entityLineage: "logical:save", environmentClass: "desktop" });
check("issue identity ignores coordinates and time", firstIdentity === movedIdentity);
const manifest = { projectId: "p", contractSha256: "a", scenarioCatalogSha256: "b", fixtureSha256: "c",
  browserFamily: "chromium", browserVersion: "151.0.4129.78", environmentId: "desktop",
  viewportSha256: "d", locale: "ko-KR", timezoneId: "Asia/Seoul", fontFingerprint: "fonts" };
const reference = { manifest, findings: [{ findingRef: firstIdentity, severity: "major", evidenceRefs: ["claim:a"] }], verdict: "rejected" };
const current = { manifest, findings: [{ findingRef: firstIdentity, severity: "minor", evidenceRefs: ["claim:b"] },
  { findingRef: "finding:new", severity: "major", evidenceRefs: ["claim:c"] }], verdict: "rejected" };
const compared = compareEvidencePacks(reference, current);
check("comparison classifies changed and introduced findings", compared.comparable
  && compared.findings.some((finding) => finding.classification === "changed")
  && compared.findings.some((finding) => finding.classification === "introduced"));
const mismatchPack = structuredClone(current); mismatchPack.manifest.browserVersion = "152.0.0.0";
check("browser mismatch is incomplete rather than a regression", compareEvidencePacks(reference, mismatchPack).terminal === "incomplete");

const redacted = redactEvidence({ authorization: "Bearer fixture-secret", url: "https://x.test/?token=fixture-secret",
  nested: ["value=fixture-secret"] }, experience.policy.redactions);
check("secrets are removed before pack assembly", !JSON.stringify(redacted).includes("fixture-secret"));
const pack = buildEvidencePack({ manifest, scenarioRuns: [{ scenarioId: "ready", terminal: "verified" }],
  findings: [], verdict: "verified" });
const replayed = replayEvidencePack(pack);
check("effect-free replay returns the same verdict and digest", replayed.verdict === "verified"
  && replayed.contentSha256 === pack.contentSha256);
const mutated = structuredClone(pack); mutated.scenarioRuns[0].terminal = "rejected";
check("pack byte mutation is rejected", rejects("EYES_PACK_MUTATED", () => replayEvidencePack(mutated)));
const artifactBytes = Buffer.from("bounded visual evidence");
const artifactSha256 = verificationDigest(artifactBytes.toString("utf8"));
const artifactPack = buildEvidencePack({ manifest, scenarioRuns: [{ scenarioId: "visual", terminal: "verified" }],
  findings: [], artifacts: [{ sha256: artifactSha256, byteLength: artifactBytes.byteLength,
    mimeType: "image/png", purpose: "unresolved entity crop" }], verdict: "verified" });
check("missing visual sidecar is rejected", rejects("EYES_ARTIFACT_MISSING", () => replayEvidencePack(artifactPack)));
const perceptual = evaluateCheckpoint({ projectId: "p", scenarioId: "visual", environmentId: "desktop",
  situation, checkpoint: { checkpointId: "visual", rules: [{ ruleId: "balance", kind: "perceptual",
    check: "referenceReview", severity: "advisory", referenceSha256: `sha256:${"a".repeat(64)}` }] } });
check("perceptual-only result cannot reject deterministic truth", perceptual.incomplete
  && scenarioTerminal({ required: true, checkpointResults: [perceptual] }) === "incomplete");
check("semantic scenario creates no screenshot artifact", pack.artifacts.length === 0);

console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
