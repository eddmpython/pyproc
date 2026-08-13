// profileInitializerProbe.mjs - initializer의 경로, overwrite, dry-run, secret-free 산출물을 측정한다.
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { initializeMachineProfile } from "../../../scripts/machineEntrance/profileInitializer.js";

async function exists(path) {
  try { await access(path, constants.F_OK); return true; } catch (error) { return false; }
}

async function rejected(operation, pattern) {
  let failure = null;
  try { await operation(); } catch (error) { failure = error; }
  if (!failure || !pattern.test(failure.message)) {
    throw new Error(`expected rejection ${pattern}, received ${failure?.message || "success"}`);
  }
}

const root = await mkdtemp(join(tmpdir(), "pyprocMachineEntranceInit-"));
try {
  const projectRoot = join(root, "project");
  const engineRoot = join(projectRoot, "vendor", "pyodide");
  await mkdir(engineRoot, { recursive: true });
  await writeFile(join(engineRoot, "pyodide.js"), "fixture");
  await writeFile(join(engineRoot, "pyodide-lock.json"), "{}");
  const profile = { recipe: "pythonOnly", engineRoot };

  const dry = await initializeMachineProfile({ projectRoot, profile, dryRun: true });
  if (await exists(dry.output)) throw new Error("dry-run created the profile directory");
  const created = await initializeMachineProfile({ projectRoot, profile });
  const paths = [created.manifestPath, created.clientPath, created.readmePath];
  const presence = await Promise.all(paths.map((path) => exists(path)));
  if (paths.some((path) => !isAbsolute(path)) || presence.some((value) => !value)) {
    throw new Error("initializer did not create absolute profile files");
  }
  const joined = (await Promise.all(paths.map((path) => readFile(path, "utf8")))).join("\n");
  if (/password\s*[:=]|api[_-]?key\s*[:=]|cookie\s*[:=]|profile directory/i.test(joined)) {
    throw new Error("initializer output contains secret or browser-profile material");
  }
  const client = JSON.parse(await readFile(created.clientPath, "utf8"));
  if (client.mcpServers.pyproc.command !== "npx"
    || client.mcpServers.pyproc.args.at(-1) !== created.manifestPath
    || !client.mcpServers.pyproc.args.includes("--no-install")) {
    throw new Error("initializer client snippet does not point to the exact manifest");
  }
  await rejected(() => initializeMachineProfile({ projectRoot, profile }), /refuses existing file/);
  await rejected(() => initializeMachineProfile({ projectRoot, outputDir: "../escape", profile }), /inside projectRoot/);
  const replaced = await initializeMachineProfile({ projectRoot, profile, overwrite: true });
  if (!replaced.overwritten) throw new Error("explicit overwrite was not reported");

  console.log("machine entrance initializer probe passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
