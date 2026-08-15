// experienceVerificationProduct.mjs - packed Control 제품으로 audit, verify, replay를 실제 Chromium에서 검증한다.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 300000);
const fixture = Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Eyes fixture</title>
  <style>#tap { width:64px; height:44px } @media(max-width:500px) { #tap { width:20px; height:20px } }</style></head>
  <body><p id="state" role="status">Ready</p><button id="tap" onclick="state.textContent='Saved'">Tap</button></body></html>`);
const visualReference = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lQyOhwAAAABJRU5ErkJggg==", "base64");
const visualReferenceSha = `sha256:${createHash("sha256").update(visualReference).digest("hex")}`;
const server = createServer((req, res) => {
  if (req.url === "/favicon.ico") { res.writeHead(204, { "Cache-Control": "no-store" }); res.end(); return; }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(fixture);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const targetOrigin = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;
function check(name, condition, info = "") {
  if (condition) { passed += 1; console.log(`  PASS ${name}${info ? ` (${info})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${info ? ` (${info})` : ""}`); }
}

const installed = await installPackedPyProc("pyprocExperienceVerification-");
const packageRoot = join(installed.appDir, "node_modules", "pyproc");
const configPath = join(installed.appDir, ".pyproc-eyes", "manifest.json");
const contractRoot = join(installed.appDir, "qa", "eyes");
const evidenceDir = join(installed.appDir, ".pyproc-eyes", "evidence-current");
let client = null;
try {
  const browser = process.env.PYPROC_BROWSER || undefined;
  run(binPath(installed.appDir, "pyproc-mcp"), ["init", "--recipe", "authorizedBrowser",
    "--project-root", installed.appDir, "--out", ".pyproc-eyes", "--engine-root", join(ROOT, "src", "runtime", "engines", "wasi", "owned", "core"),
    "--timeout-ms", String(TIMEOUT_MS), "--origin", targetOrigin, "--max-risk", "externalEffect",
    "--purpose", "verified-change-loop-product-gate", "--acknowledge-effects",
    "--viewport-width", "1280", "--viewport-height", "800", "--device-scale-factor", "1",
    "--action", "snapshot", "--action", "screenshot", "--action", "click",
    "--artifact-max-bytes", String(4 * 1024 * 1024),
    "--artifact-total-bytes", String(8 * 1024 * 1024), "--artifact-max-count", "8",
    ...(browser ? ["--browser", browser] : [])], { cwd: installed.appDir });
  const { PyProcControlClient } = await import(pathToFileURL(join(packageRoot,
    "scripts", "controlProtocol", "controlApi.js")).href);
  client = await PyProcControlClient.start(configPath, { cwd: installed.appDir, startupTimeoutMs: TIMEOUT_MS });

  const opened = await client.openTarget(`${targetOrigin}/product`, { expectedRisk: "externalEffect", waitUntil: "load" });
  const attached = await client.attachSession(opened.output.targetRef);
  const probed = await client.observe(attached.output, { expectedRisk: "read", representation: "apx.graph",
    channels: ["semantic", "environment"], visual: { mode: "off" } });
  await client.detachSession(attached.output);
  const environment = probed.output.page.environment;
  check("APX environment channel이 비교 가능한 실행 환경을 관찰",
    typeof environment?.locale === "string" && environment.fontFingerprint?.startsWith("font-metrics-v1:"),
  environment?.fontFingerprint);

  await mkdir(contractRoot, { recursive: true });
  const requirement = { requirementRef: "requirement:ready", select: { role: "status", name: "Ready" },
    need: ["fact"], cardinality: "one" };
  const tapRequirement = { requirementRef: "requirement:tap", select: { role: "button", name: "Tap" },
    need: ["fact"], cardinality: "one" };
  const savedRequirement = { requirementRef: "requirement:saved", select: { role: "status", name: "Saved" },
    need: ["fact"], cardinality: "one" };
  const experience = { schemaVersion: "1", project: { id: "installed-eyes" },
    target: { baseUrl: targetOrigin, allowedOrigins: [targetOrigin] },
    readiness: { scenarioRef: "ready", timeoutMs: 10000 },
    environments: [{ environmentId: "product", viewport: { width: 1280, height: 800,
      deviceScaleFactor: 1, mobile: false, touch: false }, ...environment }],
    scenarioCatalog: "scenarios.json", baselineCatalog: "baselines.json",
    policy: { console: "rejectUnexpectedError", network: "rejectUnexpectedFailure", visual: "boundedEvidence",
      externalEffects: "acknowledged", rejectSeverities: ["blocker", "major"], redactions: ["product-secret"],
      artifactQuota: { maxArtifacts: 8, maxArtifactBytes: 4194304, maxTotalBytes: 8388608 } } };
  const scenarios = { schemaVersion: "1", scenarios: [{ scenarioId: "ready", purpose: "Verify product readiness",
    route: "/product", fixturePath: "product.html",
    fixtureSha256: `sha256:${createHash("sha256").update(fixture).digest("hex")}`, required: true,
    readiness: { requirements: [requirement] }, steps: [{ stepId: "save", target: { role: "button", name: "Tap" },
      action: { kind: "click", expectedRisk: "externalEffect" },
      verify: { entityAppeared: { role: "status", name: "Saved" }, withinMs: 5000 } }],
    checkpoints: [{ checkpointId: "saved-state",
      focus: { requirements: [savedRequirement, tapRequirement] }, rules: [{ ruleId: "saved-visible", kind: "structural",
        check: "requirementSatisfied", requirementRef: "requirement:saved", severity: "blocker" },
      { ruleId: "save-confirmed", kind: "behavioral", check: "actionConfirmed", severity: "blocker" },
      { ruleId: "tap-target-size", kind: "structural", check: "minimumHitTarget",
        requirementRef: "requirement:tap", minimum: 44, severity: "major" },
      { ruleId: "composition-review", kind: "perceptual", check: "referenceReview",
        referenceSha256: visualReferenceSha, severity: "advisory" }] }],
    cleanup: { kind: "detach" } }] };
  const baselines = { schemaVersion: "1", references: [{ referenceId: "approved-composition",
    path: "approved-composition.png", sha256: visualReferenceSha, mimeType: "image/png",
    purpose: "Bound the advisory composition review" }] };
  await Promise.all([
    writeFile(join(contractRoot, "EYES.md"), "Calm, trustworthy product. Human intent is not machine authority.\n"),
    writeFile(join(contractRoot, "experience.json"), JSON.stringify(experience, null, 2)),
    writeFile(join(contractRoot, "scenarios.json"), JSON.stringify(scenarios, null, 2)),
    writeFile(join(contractRoot, "baselines.json"), JSON.stringify(baselines, null, 2)),
    writeFile(join(contractRoot, "product.html"), fixture),
    writeFile(join(contractRoot, "approved-composition.png"), visualReference),
  ]);

  const repository = { commit: "installed-fixture", treeSha256: `sha256:${"1".repeat(64)}`,
    diffSha256: `sha256:${"2".repeat(64)}`, untracked: false };
  const audited = await client.auditExperience(contractRoot, { repositoryRoot: installed.appDir,
    outputDir: ".pyproc-eyes/evidence-current", environmentId: "product", repository, timeoutMs: TIMEOUT_MS });
  const auditedPack = JSON.parse(Buffer.from(audited.attachments[0]?.bytes || []).toString("utf8"));
  check("installed JS API가 실제 Chromium audit와 canonical Evidence Pack 발행을 완료",
    audited.output.verdict === "verified" && audited.outcome === "applied"
      && audited.output.pack === undefined && audited.attachments.length === 1
      && audited.attachments[0].kind === "evidence.pack" && auditedPack.artifacts.length > 0
      && auditedPack.findings.some((finding) => finding.ruleId === "composition-review"
        && finding.state === "needsReview" && finding.severity === "advisory"),
  JSON.stringify({ verdict: audited.output.verdict, output: audited.output,
    findings: auditedPack.findings, artifacts: auditedPack.artifacts }));

  const replayed = await client.replayEvidencePack(evidenceDir, { timeoutMs: TIMEOUT_MS });
  check("Evidence Pack replay가 live provider effect 없이 동일 verdict를 재계산",
    replayed.output.verdict === "verified" && replayed.outcome === "observed"
      && replayed.output.contentSha256 === audited.output.contentSha256, JSON.stringify(replayed.output));
  const verified = await client.verifyExperience(evidenceDir, evidenceDir, { timeoutMs: TIMEOUT_MS });
  check("exact pack comparison이 persisting identity와 verified terminal을 보존",
    verified.output.verdict === "verified" && verified.output.comparison.comparable === true,
  JSON.stringify(verified.output));

  const viewportVerdicts = [{ environmentId: "desktop", verdict: audited.output.verdict }];
  await client.close();
  client = null;
  for (const profile of [
    { environmentId: "tablet", width: 1024, height: 768, mobile: false, touch: false,
      expectedVerdict: "verified" },
    { environmentId: "mobile", width: 390, height: 844, mobile: true, touch: true,
      expectedVerdict: "rejected" },
  ]) {
    const outputRoot = `.pyproc-eyes-${profile.environmentId}`;
    const profileConfig = join(installed.appDir, outputRoot, "manifest.json");
    run(binPath(installed.appDir, "pyproc-mcp"), ["init", "--recipe", "authorizedBrowser",
      "--project-root", installed.appDir, "--out", outputRoot, "--engine-root", join(ROOT, "src", "runtime", "engines", "wasi", "owned", "core"),
      "--timeout-ms", String(TIMEOUT_MS), "--origin", targetOrigin, "--max-risk", "externalEffect",
      "--purpose", `verified-change-loop-${profile.environmentId}`, "--acknowledge-effects",
      "--viewport-width", String(profile.width), "--viewport-height", String(profile.height),
      "--device-scale-factor", "1", ...(profile.mobile ? ["--mobile"] : []),
      ...(profile.touch ? ["--touch"] : []), "--action", "snapshot", "--action", "screenshot", "--action", "click",
      ...(browser ? ["--browser", browser] : [])], { cwd: installed.appDir });
    const profileClient = await PyProcControlClient.start(profileConfig,
      { cwd: installed.appDir, startupTimeoutMs: TIMEOUT_MS });
    try {
      const profileOpened = await profileClient.openTarget(`${targetOrigin}/product`,
        { expectedRisk: "externalEffect", waitUntil: "load" });
      const profileAttached = await profileClient.attachSession(profileOpened.output.targetRef);
      const profileProbe = await profileClient.observe(profileAttached.output, { expectedRisk: "read",
        representation: "apx.graph", channels: ["semantic", "environment"], visual: { mode: "off" } });
      await profileClient.detachSession(profileAttached.output);
      const profileRoot = join(installed.appDir, "qa", `eyes-${profile.environmentId}`);
      await mkdir(profileRoot, { recursive: true });
      const profileExperience = structuredClone(experience);
      profileExperience.environments = [{ environmentId: profile.environmentId,
        viewport: { width: profile.width, height: profile.height, deviceScaleFactor: 1,
          mobile: profile.mobile, touch: profile.touch }, ...profileProbe.output.page.environment }];
      await Promise.all([
        writeFile(join(profileRoot, "EYES.md"), "Responsive structural contract.\n"),
        writeFile(join(profileRoot, "experience.json"), JSON.stringify(profileExperience, null, 2)),
        writeFile(join(profileRoot, "scenarios.json"), JSON.stringify(scenarios, null, 2)),
        writeFile(join(profileRoot, "baselines.json"), JSON.stringify(baselines, null, 2)),
        writeFile(join(profileRoot, "product.html"), fixture),
        writeFile(join(profileRoot, "approved-composition.png"), visualReference),
      ]);
      const profileAudit = await profileClient.auditExperience(profileRoot, { repositoryRoot: installed.appDir,
        outputDir: `${outputRoot}/evidence-current`, environmentId: profile.environmentId,
        repository, timeoutMs: TIMEOUT_MS });
      const profilePack = JSON.parse(Buffer.from(profileAudit.attachments[0]?.bytes || []).toString("utf8"));
      viewportVerdicts.push({ environmentId: profile.environmentId, verdict: profileAudit.output.verdict,
        runs: profilePack.scenarioRuns.map((run) => ({ scenarioId: run.scenarioId, terminal: run.terminal,
          reason: run.reason, actions: run.actions, checkpoints: run.checkpoints })) });
    } finally {
      await profileClient.close();
    }
  }
  check("desktop과 tablet 정상 상태는 verified이고 mobile hit-target 결함은 rejected",
    viewportVerdicts.every((entry, index) => entry.verdict === ["verified", "verified", "rejected"][index]),
  JSON.stringify(viewportVerdicts));
  const cliReplay = JSON.parse(run(binPath(installed.appDir, "pyproc-control"), ["eyes", "replay",
    "--config", configPath, "--pack-dir", evidenceDir, "--timeout-ms", String(TIMEOUT_MS)],
  { cwd: installed.appDir }).stdout);
  check("installed CLI replay가 같은 verdict와 Evidence Pack attachment를 반환",
    cliReplay.output.verdict === "verified" && cliReplay.output.contentSha256 === audited.output.contentSha256
      && cliReplay.attachments[0]?.kind === "evidence.pack");
} catch (error) {
  check("Verified Change Loop 제품 흐름 예외 없음", false, String(error?.stack || error).slice(-1600));
} finally {
  await client?.close().catch(() => {});
  server.close();
  await rm(installed.tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
