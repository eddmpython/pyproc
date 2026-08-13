// preflightDiagnosticProbe.mjs - doctor가 effect 없이 blocking fact와 다음 안전한 명령을 반환하는지 측정한다.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectMachineProfile } from "../../../scripts/machineEntrance/machineDoctor.js";

const root = await mkdtemp(join(tmpdir(), "pyprocMachineEntranceDoctor-"));
try {
  const engineRoot = join(root, "pyodide");
  await mkdir(engineRoot);
  await writeFile(join(engineRoot, "pyodide.js"), "fixture");
  await writeFile(join(engineRoot, "pyodide-lock.json"), "{}");
  const configPath = join(root, "manifest.json");
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, engine: { root: engineRoot },
    browser: { enabled: false } }));
  let discoveries = 0;
  let inspections = 0;
  const report = await inspectMachineProfile(configPath, {
    browserFinder: () => { discoveries += 1; return "fixture-browser"; },
    engineInspector: async () => { inspections += 1; return { version: "fixture", coreAssets: 1,
      packages: 1, byteLength: 2, integrity: "verified" }; },
  });
  if (!report.ok || discoveries !== 1 || inspections !== 1
    || !report.checks.some((check) => check.code === "MACHINE_AUTOMATION_CLOSED")
    || !report.next.run.includes("--code")) {
    throw new Error("doctor did not return actionable Python-only facts");
  }
  if (report.automation.enabled !== false || report.automation.cdpEndpoint !== false) {
    throw new Error("Python-only doctor invented browser automation authority");
  }

  const invalidPath = join(root, "invalid.json");
  await writeFile(invalidPath, JSON.stringify({ schemaVersion: 1, engine: { root: "relative" },
    browser: { enabled: false } }));
  const invalid = await inspectMachineProfile(invalidPath, {
    browserFinder: () => { throw new Error("must not run"); },
    engineInspector: async () => { throw new Error("must not run"); },
  });
  if (invalid.ok || invalid.blocking[0].code !== "MACHINE_MANIFEST_BLOCKED"
    || !invalid.blocking[0].nextCommand) {
    throw new Error("doctor did not stop before browser discovery with an actionable blocker");
  }

  console.log("machine entrance doctor probe passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
