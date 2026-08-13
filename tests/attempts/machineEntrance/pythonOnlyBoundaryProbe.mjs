// pythonOnlyBoundaryProbe.mjs - closed recipe와 doctor가 automation/CDP authority를 만들지 않는지 측정한다.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectMachineProfile } from "../../../scripts/machineEntrance/machineDoctor.js";
import { compileMachineProfile } from "../../../scripts/machineEntrance/machineProfile.js";

const root = await mkdtemp(join(tmpdir(), "pyprocPythonOnlyBoundary-"));
try {
  const engineRoot = join(root, "engine");
  await mkdir(engineRoot);
  await writeFile(join(engineRoot, "pyodide.js"), "fixture");
  await writeFile(join(engineRoot, "pyodide-lock.json"), "{}");
  const profile = compileMachineProfile({ recipe: "pythonOnly", engineRoot });
  const configPath = join(root, "manifest.json");
  await writeFile(configPath, JSON.stringify(profile));
  let discoveries = 0;
  const report = await inspectMachineProfile(configPath, {
    browserFinder: () => { discoveries += 1; return "fixture-machine-host"; },
    engineInspector: async () => ({ integrity: "verified", version: "fixture", coreAssets: 1, packages: 1 }),
  });
  if (!report.ok || discoveries !== 1 || profile.browser.enabled !== false
    || report.automation.enabled !== false || report.automation.cdpEndpoint !== false
    || report.automation.operations.length !== 0) {
    throw new Error("pythonOnly recipe opened automation or CDP authority");
  }
  console.log("machine entrance Python-only boundary probe passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
