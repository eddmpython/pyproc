// evidencePack.js - canonical pack, exact comparison, atomic publish, effect-free replay.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalVerificationJson, verificationDigest, verificationError } from "./verificationCanonical.js";

export const EVIDENCE_PACK_FORMAT = "pyproc.evidencePack";
export const EVIDENCE_PACK_VERSION = 1;
export const EVIDENCE_PACK_MIME = "application/vnd.pyproc.evidence-pack+json";
const TERMINALS = new Set(["verified", "rejected", "incomplete"]);
const DIGEST = /^[0-9a-f]{64}$/;
const PREFIXED_DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_PACK_BYTES = 32 * 1024 * 1024;
const COMPARABILITY_KEYS = Object.freeze(["projectId", "contractSha256", "scenarioCatalogSha256",
  "baselineCatalogSha256", "fixtureSha256", "browserFamily", "browserVersion", "environmentId",
  "viewportSha256", "locale", "timezoneId", "fontFingerprint", "policySha256"]);
const PACK_KEYS = new Set(["format", "version", "manifest", "scenarioRuns", "findings", "artifacts",
  "comparison", "verdict", "generatedAt", "runId", "complete", "contentSha256"]);
const MANIFEST_KEYS = new Set(["producerVersion", "projectId", "contractSha256", "scenarioCatalogSha256",
  "baselineCatalogSha256", "eyesSha256", "fixtureSha256", "browserFamily", "browserVersion", "environmentId",
  "viewportSha256", "locale", "timezoneId", "fontFingerprint", "providerKind", "perception", "repository",
  "policySha256"]);
const ARTIFACT_KEYS = new Set(["artifactRef", "sha256", "byteLength", "mimeType", "purpose"]);
const REPOSITORY_KEYS = new Set(["commit", "treeSha256", "diffSha256", "untracked"]);

function fail(code, message) { throw verificationError(code, message); }
function plainObject(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, allowed, label) {
  if (!plainObject(value)) fail("EYES_PACK_INVALID", `${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail("EYES_PACK_INVALID", `${label}.${key} is unknown`);
  for (const key of allowed) if (!Object.hasOwn(value, key)) fail("EYES_PACK_INVALID", `${label}.${key} is required`);
}
function packContent(pack) {
  return { format: pack.format, version: pack.version, manifest: pack.manifest,
    scenarioRuns: pack.scenarioRuns, findings: pack.findings, artifacts: pack.artifacts,
    comparison: pack.comparison, verdict: pack.verdict };
}

export function createEvidencePack({ manifest, scenarioRuns, findings, artifacts = [], comparison = null,
  verdict, generatedAt = new Date().toISOString(), runId = `run:${randomBytes(16).toString("hex")}` }) {
  if (!TERMINALS.has(verdict)) fail("EYES_PACK_INVALID", "pack verdict is invalid");
  const content = Object.freeze({ format: EVIDENCE_PACK_FORMAT, version: EVIDENCE_PACK_VERSION,
    manifest: Object.freeze(structuredClone(manifest)), scenarioRuns: Object.freeze(structuredClone(scenarioRuns)),
    findings: Object.freeze(structuredClone(findings)), artifacts: Object.freeze(structuredClone(artifacts)),
    comparison: comparison === null ? null : Object.freeze(structuredClone(comparison)), verdict });
  return Object.freeze({ ...content, generatedAt, runId, complete: true,
    contentSha256: verificationDigest(content) });
}

export function evidencePackBytes(pack) {
  return Buffer.from(`${canonicalVerificationJson(pack)}\n`, "utf8");
}

export function evidencePackAttachment(pack) {
  const bytes = evidencePackBytes(pack);
  return Object.freeze({ kind: "evidencePack", mimeType: EVIDENCE_PACK_MIME,
    artifactRef: `artifact:evidence_${pack.contentSha256}`, byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"), dataBase64: bytes.toString("base64") });
}

export function compareEvidencePacks(reference, current) {
  const mismatch = COMPARABILITY_KEYS.filter((key) => reference.manifest[key] !== current.manifest[key]);
  if (mismatch.length) return Object.freeze({ comparable: false, terminal: "incomplete",
    mismatch: Object.freeze(mismatch), findings: Object.freeze([]) });
  const before = new Map(reference.findings.map((finding) => [finding.findingRef, finding]));
  const after = new Map(current.findings.map((finding) => [finding.findingRef, finding]));
  const findings = [];
  for (const [findingRef, finding] of after) {
    const old = before.get(findingRef);
    findings.push(Object.freeze({ findingRef, classification: !old ? "introduced"
      : old.severity !== finding.severity || old.state !== finding.state || old.kind !== finding.kind
        || verificationDigest(old.evidenceRefs) !== verificationDigest(finding.evidenceRefs)
        ? "changed" : "persisting" }));
  }
  for (const findingRef of before.keys()) if (!after.has(findingRef)) {
    findings.push(Object.freeze({ findingRef, classification: "resolved" }));
  }
  return Object.freeze({ comparable: true, terminal: current.verdict,
    mismatch: Object.freeze([]), findings: Object.freeze(findings) });
}

export function replayEvidencePack(pack, artifactBytes = new Map()) {
  if (!pack || typeof pack !== "object" || Array.isArray(pack) || pack.format !== EVIDENCE_PACK_FORMAT
    || pack.version !== EVIDENCE_PACK_VERSION || pack.complete !== true || !TERMINALS.has(pack.verdict)
    || !DIGEST.test(String(pack.contentSha256 || ""))) fail("EYES_PACK_INVALID", "evidence pack header is invalid");
  exactKeys(pack, PACK_KEYS, "pack");
  exactKeys(pack.manifest, MANIFEST_KEYS, "pack.manifest");
  exactKeys(pack.manifest.repository, REPOSITORY_KEYS, "pack.manifest.repository");
  for (const key of ["contractSha256", "scenarioCatalogSha256", "baselineCatalogSha256", "eyesSha256",
    "fixtureSha256", "viewportSha256", "policySha256"]) {
    if (!PREFIXED_DIGEST.test(String(pack.manifest[key] || ""))) fail("EYES_PACK_INVALID", `pack.manifest.${key} is invalid`);
  }
  for (const key of ["producerVersion", "projectId", "browserFamily", "browserVersion", "environmentId", "locale",
    "timezoneId", "fontFingerprint", "providerKind", "perception"]) {
    if (typeof pack.manifest[key] !== "string" || !pack.manifest[key]) fail("EYES_PACK_INVALID", `pack.manifest.${key} is invalid`);
  }
  if (typeof pack.manifest.repository.commit !== "string" || !pack.manifest.repository.commit
    || !PREFIXED_DIGEST.test(String(pack.manifest.repository.treeSha256 || ""))
    || !PREFIXED_DIGEST.test(String(pack.manifest.repository.diffSha256 || ""))
    || typeof pack.manifest.repository.untracked !== "boolean") {
    fail("EYES_PACK_INVALID", "pack.manifest.repository is invalid");
  }
  if (!pack.runId || Number.isNaN(Date.parse(pack.generatedAt))) fail("EYES_PACK_INVALID", "pack execution identity is invalid");
  if (verificationDigest(packContent(pack)) !== pack.contentSha256) fail("EYES_PACK_MUTATED", "evidence pack digest mismatch");
  if (!Array.isArray(pack.artifacts) || !Array.isArray(pack.scenarioRuns) || !Array.isArray(pack.findings)) {
    fail("EYES_PACK_INVALID", "evidence pack collections are invalid");
  }
  const artifactDigests = new Set();
  for (const artifact of pack.artifacts) {
    exactKeys(artifact, ARTIFACT_KEYS, "pack.artifacts[]");
    if (!artifact || typeof artifact !== "object" || !DIGEST.test(String(artifact.sha256 || ""))
      || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 0
      || artifact.artifactRef !== `artifact:sha_${artifact.sha256}`
      || typeof artifact.mimeType !== "string" || !artifact.mimeType
      || typeof artifact.purpose !== "string" || !artifact.purpose) {
      fail("EYES_PACK_INVALID", "evidence artifact descriptor is invalid");
    }
    if (artifactDigests.has(artifact.sha256)) fail("EYES_PACK_INVALID", "evidence artifact digest is duplicated");
    artifactDigests.add(artifact.sha256);
    const bytes = artifactBytes.get(artifact.sha256);
    if (!bytes || bytes.byteLength !== artifact.byteLength
      || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) {
      fail("EYES_ARTIFACT_MISSING", `evidence artifact is missing or mutated: ${artifact.sha256}`);
    }
  }
  if (pack.scenarioRuns.some((run) => !plainObject(run) || typeof run.scenarioId !== "string"
    || !TERMINALS.has(run.terminal))) fail("EYES_PACK_INVALID", "scenario terminal is invalid");
  if (pack.findings.some((finding) => !plainObject(finding) || typeof finding.findingRef !== "string"
    || !Array.isArray(finding.evidenceRefs))) fail("EYES_PACK_INVALID", "finding descriptor is invalid");
  const verdict = pack.scenarioRuns.some((run) => run.terminal === "incomplete") ? "incomplete"
    : pack.scenarioRuns.some((run) => run.terminal === "rejected") ? "rejected" : "verified";
  if (verdict !== pack.verdict) fail("EYES_VERDICT_DIVERGED", "stored verdict does not match scenario terminals");
  return Object.freeze({ verdict, contentSha256: pack.contentSha256,
    findingRefs: Object.freeze(pack.findings.map((finding) => finding.findingRef)) });
}

function confinedOutput(rootInput, outputInput) {
  if (typeof rootInput !== "string" || !isAbsolute(rootInput) || typeof outputInput !== "string"
    || !outputInput || isAbsolute(outputInput)) fail("EYES_PATH_INVALID", "pack output requires an absolute repositoryRoot and relative outputDir");
  const root = resolve(rootInput);
  const target = resolve(root, outputInput);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) fail("EYES_PATH_ESCAPE", "pack output escapes the repository root");
  return target;
}

export async function publishEvidencePack({ repositoryRoot, outputDir, pack, artifactBytes = new Map() }) {
  const lexicalTarget = confinedOutput(repositoryRoot, outputDir);
  const lexicalParent = dirname(lexicalTarget);
  const lexicalRoot = resolve(repositoryRoot);
  const root = await realpath(lexicalRoot);
  let parent = root;
  const parentSegments = relative(lexicalRoot, lexicalParent).split(sep).filter(Boolean);
  for (const segment of parentSegments) {
    const candidate = join(parent, segment);
    try { parent = await realpath(candidate); }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      try { await mkdir(candidate); }
      catch (mkdirError) { if (mkdirError?.code !== "EEXIST") throw mkdirError; }
      parent = await realpath(candidate);
    }
    const parentRel = relative(root, parent);
    if (parentRel.startsWith("..") || isAbsolute(parentRel)) {
      fail("EYES_PATH_ESCAPE", "pack output escapes the repository root through a symlink");
    }
  }
  const target = join(parent, basename(lexicalTarget));
  const partial = join(parent, `.${basename(target)}.partial-${randomBytes(8).toString("hex")}`);
  try {
    await mkdir(join(partial, "artifacts"), { recursive: true });
    for (const artifact of pack.artifacts) {
      const bytes = artifactBytes.get(artifact.sha256);
      if (!bytes) fail("EYES_ARTIFACT_MISSING", `artifact bytes are unavailable: ${artifact.sha256}`);
      await writeFile(join(partial, "artifacts", `${artifact.sha256}.bin`), bytes, { flag: "wx" });
    }
    await writeFile(join(partial, "pack.json"), evidencePackBytes(pack), { flag: "wx" });
    const rows = pack.scenarioRuns.map((run) => `| ${run.scenarioId} | ${run.required ? "yes" : "no"} | ${run.terminal} | ${run.reason || ""} |`).join("\n");
    const findingRows = pack.findings.map((finding) => `| ${finding.findingRef} | ${finding.severity} | ${finding.state} | ${finding.ruleId} |`).join("\n");
    const report = `# PyProc Evidence Pack\n\nVerdict: ${pack.verdict}\n\nDigest: ${pack.contentSha256}\n\n## Scenarios\n\n| Scenario | Required | Terminal | Reason |\n| --- | --- | --- | --- |\n${rows || "| none | no | incomplete | no scenario evidence |"}\n\n## Findings\n\n| Finding | Severity | State | Rule |\n| --- | --- | --- | --- |\n${findingRows || "| none | advisory | pass | none |"}\n`;
    await writeFile(join(partial, "report.md"), report, { flag: "wx" });
    await rename(partial, target);
    return Object.freeze({ outputDir: target, packFile: join(target, "pack.json"),
      contentSha256: pack.contentSha256, verdict: pack.verdict });
  } catch (error) {
    await rm(partial, { recursive: true, force: true }).catch(() => {});
    if (error?.code?.startsWith?.("EYES_")) throw error;
    throw verificationError("EYES_PACK_PUBLISH_FAILED", `evidence pack publish failed: ${error?.message || error}`);
  }
}

export async function loadEvidencePack(packDirInput) {
  if (typeof packDirInput !== "string" || !isAbsolute(packDirInput)) fail("EYES_PATH_INVALID", "packDir must be absolute");
  const packBytes = await readFile(join(resolve(packDirInput), "pack.json"));
  if (packBytes.byteLength > MAX_PACK_BYTES) fail("EYES_PACK_TOO_LARGE", "evidence pack exceeds the byte limit");
  let pack;
  try { pack = JSON.parse(packBytes.toString("utf8")); }
  catch (error) { fail("EYES_PACK_INVALID", "pack.json is invalid JSON"); }
  const artifactBytes = new Map();
  for (const artifact of pack.artifacts || []) {
    if (!artifact || typeof artifact !== "object" || !DIGEST.test(String(artifact.sha256 || ""))) {
      fail("EYES_PACK_INVALID", "evidence artifact digest is invalid");
    }
    try { artifactBytes.set(artifact.sha256, await readFile(join(resolve(packDirInput), "artifacts", `${artifact.sha256}.bin`))); }
    catch (error) { fail("EYES_ARTIFACT_MISSING", `evidence artifact is unavailable: ${artifact.sha256}`); }
  }
  replayEvidencePack(pack, artifactBytes);
  return Object.freeze({ pack: Object.freeze(pack), artifactBytes });
}
