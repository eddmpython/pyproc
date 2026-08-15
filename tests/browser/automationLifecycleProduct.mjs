// automationLifecycleProduct.mjs - 설치 Control 제품의 반복 관찰, 행동, 정리 무잔류 게이트.

import { readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

const ROUNDS = Math.max(1, Math.min(100, Number(process.env.PYPROC_AUTOMATION_LIFECYCLE_ROUNDS || 20)));
const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 300000);
const PROFILE_PREFIX = "pyprocControl-";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function valueAt(root, path) {
  return path.split(".").reduce((value, key) => value?.[key], root);
}

const zeroPaths = Object.freeze([
  "targets", "ownedTargets", "sessions", "locators", "quarantinedSessions",
  "semanticInventories", "continuations", "observationListeners", "observationEvents",
  "lifecycleSessions", "lifecycleWatchers", "lifecycleQueuedEvents",
  "artifacts", "artifactBytes", "transport.sessions",
  "transport.pending", "transport.listeners", "perception.sensorSessions",
  "perception.identitySessions", "perception.entities", "perception.frames",
  "perception.timelineSessions", "perception.timelineObservations", "perception.temporalEntities",
  "perception.worldSessions", "perception.worlds", "perception.claims",
  "perception.situations", "perception.situationHistorySessions",
  "perception.situationHistoryEntries", "perception.capabilities", "perception.turns",
]);

async function profileNames() {
  return new Set((await readdir(tmpdir(), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(PROFILE_PREFIX))
    .map((entry) => entry.name));
}

const targetHtml = await readFile(new URL("./automationLifecycleTarget.html", import.meta.url));
const targetServer = createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(targetHtml);
});
await new Promise((resolve) => targetServer.listen(0, "127.0.0.1", resolve));
const targetOrigin = `http://127.0.0.1:${targetServer.address().port}`;
const profilesBefore = await profileNames();
const installed = await installPackedPyProc("pyprocAutomationLifecycleProduct-");
const configPath = join(installed.appDir, ".pyproc-lifecycle", "manifest.json");
const mcpCli = binPath(installed.appDir, "pyproc-mcp");
const browser = process.env.PYPROC_BROWSER || undefined;
let client = null;
let completed = 0;

try {
  run(mcpCli, ["init", "--recipe", "authorizedBrowser", "--project-root", installed.appDir,
    "--out", ".pyproc-lifecycle",
    "--engine-root", join(ROOT, "src", "runtime", "engines", "wasi", "owned", "core"),
    "--timeout-ms", String(TIMEOUT_MS), "--origin", targetOrigin, "--max-risk", "externalEffect",
    "--purpose", "automation lifecycle product gate", "--acknowledge-effects",
    "--action", "snapshot", "--action", "screenshot", "--action", "click",
    "--artifact-max-count", "8", "--artifact-ttl-ms", "120000",
    ...(browser ? ["--browser", browser] : [])], { cwd: installed.appDir });
  const installedRequire = createRequire(join(installed.appDir, "probeEntry.mjs"));
  const controlEntry = installedRequire.resolve("pyproc/control");
  const { PyProcControlClient } = await import(pathToFileURL(controlEntry).href);
  client = await PyProcControlClient.start(configPath, { cwd: installed.appDir,
    startupTimeoutMs: TIMEOUT_MS, shutdownTimeoutMs: 5000 });

  for (let round = 0; round < ROUNDS; round += 1) {
    const opened = await client.openTarget(`${targetOrigin}/?round=${round}`, {
      expectedRisk: "externalEffect", waitUntil: "load",
    });
    const attached = await client.attachSession(opened.output.targetRef);
    const eyes = client.perception(attached.output);
    const situation = await eyes.situate({ objective: "Advance exactly once and prove completion", requirements: [{
      requirementRef: "requirement:advance", select: { role: "button", name: "Advance", actionable: true },
      need: ["fact", "affordance"], cardinality: "one",
    }] }, { visual: { mode: "full", overview: "lowResolution", maxCrops: 1 },
      budget: { maxEntities: 80, maxRelations: 160, maxBytes: 262144 } });
    const affordance = situation.requirement("requirement:advance").oneAffordance("click");
    const visualArtifacts = (situation.situation.visualProbes || []).map((probe) => probe.artifact?.artifactRef)
      .filter(Boolean);
    assert(visualArtifacts.length === 1, `round ${round + 1} did not return one visual artifact`);
    for (const artifactRef of visualArtifacts) {
      const deleted = await client.deleteArtifact(artifactRef);
      assert(deleted.output.deleted === true, `round ${round + 1} did not delete the visual artifact`);
    }
    const acted = await eyes.actAffordance(affordance, { intent: "Advance the lifecycle fixture",
      verify: { entityAppeared: { role: "status", nameContains: "round complete" }, withinMs: 5000 } });
    assert(acted.output.actions[0].result.evidence?.verification?.state === "confirmed",
      `round ${round + 1} proof-carrying action was not confirmed`);
    const captured = await client.act(attached.output,
      [{ kind: "screenshot", format: "png", expectedRisk: "read" }]);
    const artifactRef = captured.output.actions[0].result.artifactRef;
    assert(captured.attachments.length === 1 && artifactRef,
      `round ${round + 1} screenshot attachment is incomplete`);
    const deleted = await client.deleteArtifact(artifactRef);
    assert(deleted.output.deleted === true, `round ${round + 1} did not delete the screenshot artifact`);
    await client.detachSession(attached.output);
    await client.closeTarget(opened.output.targetRef, { expectedRisk: "externalEffect" });
    const inspected = await client.inspectSpace();
    const resources = inspected.output.resources;
    assert(resources, `round ${round + 1} public inspect does not expose complete resource counts`);
    const nonzero = zeroPaths.filter((path) => valueAt(resources, path) !== 0)
      .map((path) => `${path}=${JSON.stringify(valueAt(resources, path))}`);
    assert(nonzero.length === 0, `round ${round + 1} retained resources: ${nonzero.join(", ")}`);
    completed += 1;
  }
  const processRef = client.process;
  await client.close();
  client = null;
  assert(processRef.exitCode !== null || processRef.signalCode !== null,
    "Control process remained alive after client close");
  const profilesAfter = await profileNames();
  const retainedProfiles = [...profilesAfter].filter((name) => !profilesBefore.has(name));
  assert(retainedProfiles.length === 0, `browser profiles remained after close: ${retainedProfiles.join(", ")}`);
  console.log(`automation lifecycle product green: ${completed}/${ROUNDS} rounds, resources and profiles returned to zero`);
} catch (error) {
  console.error(`automation lifecycle product red after ${completed}/${ROUNDS}: ${error?.stack || error}`);
  process.exitCode = 1;
} finally {
  await client?.close();
  await new Promise((resolve) => targetServer.close(resolve));
  await rm(installed.tmp, { recursive: true, force: true });
}
