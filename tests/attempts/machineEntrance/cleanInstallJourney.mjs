// cleanInstallJourney.mjs - packed package의 공개 bin만으로 closed profile을 만드는지 측정한다.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { binPath, installPackedPyProc, run } from "../../packageHarness.mjs";

const installed = await installPackedPyProc("pyprocEntranceAttempt-");
try {
  const projectRoot = join(installed.appDir, "consumer");
  const engineRoot = join(projectRoot, "engine");
  await mkdir(engineRoot, { recursive: true });
  await writeFile(join(engineRoot, "pyodide.js"), "fixture");
  await writeFile(join(engineRoot, "pyodide-lock.json"), "{}");
  const cli = binPath(installed.appDir, "pyproc-mcp");
  const initialized = JSON.parse(run(cli, ["init", "--recipe", "pythonOnly", "--project-root",
    projectRoot, "--engine-root", engineRoot], { cwd: installed.appDir }).stdout);
  const manifest = JSON.parse(await readFile(initialized.manifestPath, "utf8"));
  const client = JSON.parse(await readFile(initialized.clientPath, "utf8"));
  if (!initialized.ok || manifest.browser.enabled !== false
    || client.mcpServers.pyproc.command !== "npx"
    || !client.mcpServers.pyproc.args.includes("--no-install")) {
    throw new Error("packed public bin did not complete the closed-profile journey");
  }
  console.log("machine entrance clean install probe passed");
} finally {
  await rm(installed.tmp, { recursive: true, force: true });
}
