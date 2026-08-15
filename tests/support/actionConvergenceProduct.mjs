// actionConvergenceProduct.mjs - 설치 제품의 bounded action convergence 제품 실측.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 300000);
const keepEvidence = process.env.PYPROC_KEEP_ATTEMPT_EVIDENCE === "1";
const scenarios = Object.freeze([
  Object.freeze({ name: "sameDocumentStale", expectSuccess: true, reason: "staleTarget", effects: 1 }),
  Object.freeze({ name: "ambiguousTarget", expectSuccess: false, reason: "ambiguousTarget", effects: 0 }),
  Object.freeze({ name: "transientOcclusion", expectSuccess: true, reason: "occlusionCleared", effects: 1 }),
  Object.freeze({ name: "persistentOcclusion", expectSuccess: false, reason: "actionabilityTimeout", effects: 0 }),
  Object.freeze({ name: "navigationReplacement", expectSuccess: true, reason: "documentReplacement", effects: 1 }),
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function page(scenario, replacement = false) {
  const targetName = scenario === "navigationReplacement" ? "Continue" : "Commit";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Action convergence ${scenario}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 18px system-ui; background: #eef4ff; color: #15223b; }
    main { position: relative; width: 520px; min-height: 260px; padding: 32px; border-radius: 20px; background: white; box-shadow: 0 16px 50px #3453aa33; }
    button { margin: 8px; padding: 12px 22px; font: inherit; }
    #target-zone { position: relative; display: inline-block; }
    #overlay { position: absolute; z-index: 3; inset: 0; display: grid; place-items: center; background: #b42318e6; color: white; border-radius: 8px; }
    output { display: block; margin: 24px 8px 0; font-weight: 700; }
  </style>
</head>
<body>
<main>
  <h1>${scenario}</h1>
  ${replacement ? "" : '<button id="arm" type="button">Arm change</button>'}
  <span id="target-zone"><button id="target" type="button">${targetName}</button></span>
  <output id="status" role="status">ready</output>
</main>
<script>
  const scenario = ${JSON.stringify(scenario)};
  const status = document.getElementById("status");
  function bind(button) {
    button.addEventListener("click", async () => {
      await fetch("/effect?scenario=" + encodeURIComponent(scenario), { method: "POST" });
      status.textContent = "done";
    });
  }
  bind(document.getElementById("target"));
  const arm = document.getElementById("arm");
  if (arm) arm.addEventListener("click", () => {
    const zone = document.getElementById("target-zone");
    if (scenario === "sameDocumentStale") {
      zone.innerHTML = '<button id="target" type="button">Commit</button>';
      bind(document.getElementById("target"));
    } else if (scenario === "ambiguousTarget") {
      zone.innerHTML = '<button type="button">Commit</button><button type="button">Commit</button>';
      for (const button of zone.querySelectorAll("button")) bind(button);
    } else if (scenario === "transientOcclusion" || scenario === "persistentOcclusion") {
      const overlay = document.createElement("span");
      overlay.id = "overlay";
      overlay.textContent = "blocked";
      zone.append(overlay);
      if (scenario === "transientOcclusion") setTimeout(() => overlay.remove(), 1200);
    } else if (scenario === "navigationReplacement") {
      location.href = "/scenario/navigationReplacement/replacement";
    }
    status.textContent = "armed";
  });
</script>
</body>
</html>`;
}

const effectCounts = new Map();
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/effect" && request.method === "POST") {
    const scenario = url.searchParams.get("scenario");
    effectCounts.set(scenario, (effectCounts.get(scenario) || 0) + 1);
    response.writeHead(204, { "Cache-Control": "no-store" });
    response.end();
    return;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const scenario = parts[0] === "scenario" ? parts[1] : "sameDocumentStale";
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(page(scenario, parts[2] === "replacement"));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const installed = await installPackedPyProc("pyprocActionConvergence-");
const evidenceDir = join(installed.tmp, "action-convergence-evidence");
await mkdir(evidenceDir, { recursive: true });
const configPath = join(installed.appDir, ".pyproc-action-convergence", "manifest.json");
const cli = binPath(installed.appDir, "pyproc-mcp");
const browser = process.env.PYPROC_BROWSER || undefined;
let client = null;
const measurements = [];

async function screenshot(sessionRef, name) {
  const captured = await client.act(sessionRef, [
    { kind: "screenshot", format: "png", expectedRisk: "read" },
  ]);
  const attachment = captured.attachments[0];
  assert(attachment?.mimeType === "image/png", `${name}: PNG attachment가 없다`);
  const file = join(evidenceDir, `${name}.png`);
  await writeFile(file, Buffer.from(attachment.bytes));
  await client.deleteArtifact(captured.output.actions[0].result.artifactRef);
  return file;
}

try {
  run(cli, ["init", "--recipe", "authorizedBrowser", "--project-root", installed.appDir,
    "--out", ".pyproc-action-convergence",
    "--engine-root", join(ROOT, "src", "runtime", "engines", "wasi", "owned", "core"),
    "--timeout-ms", String(TIMEOUT_MS), "--origin", origin, "--max-risk", "externalEffect",
    "--purpose", "bounded action convergence probe", "--acknowledge-effects",
    "--action", "snapshot", "--action", "screenshot", "--action", "click",
    ...(browser ? ["--browser", browser] : [])], { cwd: installed.appDir });
  const installedRequire = createRequire(join(installed.appDir, "probeEntry.mjs"));
  const controlEntry = installedRequire.resolve("pyproc/control");
  const { PyProcControlClient } = await import(pathToFileURL(controlEntry).href);
  client = await PyProcControlClient.start(configPath, { cwd: installed.appDir,
    startupTimeoutMs: TIMEOUT_MS, shutdownTimeoutMs: 5000 });

  for (const scenario of scenarios) {
    effectCounts.set(scenario.name, 0);
    const opened = await client.openTarget(`${origin}/scenario/${scenario.name}`, {
      expectedRisk: "externalEffect", waitUntil: "load",
    });
    const attached = await client.attachSession(opened.output.targetRef);
    const eyes = client.perception(attached.output);
    try {
      const situation = await eyes.situate({ objective: "Commit exactly once after the screen changes", requirements: [{
        requirementRef: "requirement:target",
        select: { role: "button", name: scenario.name === "navigationReplacement" ? "Continue" : "Commit",
          actionable: true },
        need: ["fact", "affordance"], cardinality: "one",
      }] }, { visual: { mode: "off" }, budget: { maxEntities: 100, maxRelations: 200, maxBytes: 262144 } });
      const affordance = situation.requirement("requirement:target").oneAffordance("click");
      await client.act(attached.output, [
        { kind: "click", selector: "#arm", expectedRisk: "externalEffect" },
      ]);
      if (scenario.name === "navigationReplacement") await delay(350);
      const armedScreenshot = await screenshot(attached.output, `${scenario.name}-armed`);
      const startedAt = Date.now();
      let acted = null;
      let failure = null;
      try {
        acted = await eyes.actAffordance(affordance, {
          intent: "Commit only through the original authority",
          timeoutMs: scenario.name === "persistentOcclusion" ? 600 : 5000,
          verify: { entityAppeared: { role: "status", name: "done" }, withinMs: 5000 },
        });
      } catch (error) {
        failure = error;
      }
      const durationMs = Date.now() - startedAt;
      const terminalScreenshot = await screenshot(attached.output, `${scenario.name}-terminal`);
      const convergence = acted?.output?.actions?.[0]?.convergence || failure?.details?.convergence || null;
      measurements.push(Object.freeze({
        scenario: scenario.name,
        success: !!acted,
        durationMs,
        effects: effectCounts.get(scenario.name) || 0,
        convergence,
        error: failure ? { code: failure.code, outcome: failure.outcome,
          retryable: failure.retryable, details: failure.details || null } : null,
        screenshots: { armed: armedScreenshot, terminal: terminalScreenshot },
      }));
    } finally {
      await client.detachSession(attached.output);
      await client.closeTarget(opened.output.targetRef, { expectedRisk: "externalEffect" });
    }
  }

  const failures = [];
  for (const expected of scenarios) {
    const measured = measurements.find((entry) => entry.scenario === expected.name);
    if (measured.success !== expected.expectSuccess) failures.push(`${expected.name}: success=${measured.success}`);
    if (measured.effects !== expected.effects) failures.push(`${expected.name}: effects=${measured.effects}`);
    const receipt = measured.convergence;
    if (receipt?.protocol !== "pyproc.actionConvergence" || receipt?.version !== 1) {
      failures.push(`${expected.name}: convergence protocol 없음`);
      continue;
    }
    if (receipt.reason !== expected.reason) failures.push(`${expected.name}: reason=${receipt.reason}`);
    if (receipt.maxAttempts !== 2 || receipt.attempts > 2
      || receipt.maxReobservations !== 1 || receipt.reobservations > 1
      || receipt.effectRetries !== 0 || receipt.maxPreEffectDurationMs !== 30000
      || receipt.preEffectDurationMs > receipt.maxPreEffectDurationMs) {
      failures.push(`${expected.name}: bounded receipt 위반`);
    }
    if (receipt.effectAttempts !== expected.effects) {
      failures.push(`${expected.name}: receipt effects=${receipt.effectAttempts}`);
    }
  }
  const summary = measurements.map((entry) => Object.freeze({
    scenario: entry.scenario,
    success: entry.success,
    effects: entry.effects,
    errorCode: entry.error?.code || null,
    reason: entry.convergence?.reason || null,
    attempts: entry.convergence?.attempts ?? null,
    reobservations: entry.convergence?.reobservations ?? null,
    effectAttempts: entry.convergence?.effectAttempts ?? null,
    preEffectDurationMs: entry.convergence?.preEffectDurationMs ?? null,
    ...(keepEvidence ? { screenshots: entry.screenshots } : {}),
  }));
  console.log(JSON.stringify({ state: failures.length ? "RED" : "GREEN",
    ...(keepEvidence ? { evidenceDir } : {}), scenarios: summary, failures }, null, 2));
  assert(failures.length === 0, `action convergence 졸업 게이트 RED: ${failures.join("; ")}`);
} finally {
  if (client) await client.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  if (!keepEvidence) await rm(installed.tmp, { recursive: true, force: true });
}
