// Machine Entrance의 recipe, initializer, doctor, CLI argument 계약을 고정한다.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMachineProfileInitArguments, parseMachineRunArguments } from "../../scripts/machineEntrance/entranceCli.js";
import { inspectMachineProfile } from "../../scripts/machineEntrance/machineDoctor.js";
import { compileMachineProfile } from "../../scripts/machineEntrance/machineProfile.js";
import { initializeMachineProfile } from "../../scripts/machineEntrance/profileInitializer.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function errorOf(operation) {
  try { await operation(); return null; } catch (error) { return error; }
}

export async function assertMachineEntranceContract() {
  const root = await mkdtemp(join(tmpdir(), "pyprocMachineEntranceContract-"));
  try {
    const projectRoot = join(root, "project");
    const engineRoot = join(projectRoot, "vendor", "pyodide");
    await mkdir(engineRoot, { recursive: true });
    await writeFile(join(engineRoot, "pyodide.js"), "fixture");
    await writeFile(join(engineRoot, "pyodide-lock.json"), "{}");

    const parsed = parseMachineProfileInitArguments([
      "--recipe", "pythonOnly", "--project-root", projectRoot, "--engine-root", "vendor/pyodide", "--dry-run",
      "--execution-memory-root", ".pyproc/memory", "--execution-memory-import-root", "handoffs",
    ]);
    assert(parsed.profile.engineRoot === engineRoot && parsed.dryRun === true,
      "Machine Entrance CLI가 project-relative engine을 absolute profile로 컴파일하지 않았다");
    assert(parsed.profile.executionMemory.root === join(projectRoot, ".pyproc", "memory")
      && parsed.profile.executionMemory.importRoots[0] === join(projectRoot, "handoffs"),
    "Machine Entrance CLI가 Execution Memory 경로를 absolute profile로 컴파일하지 않았다");
    assert(parseMachineRunArguments(["--config", "profile.json", "--code", "40 + 2"]).code === "40 + 2",
      "Machine Entrance run CLI가 shell-safe Python source를 보존하지 않았다");

    const memoryRoot = join(projectRoot, ".pyproc", "memory");
    const profile = { recipe: "pythonOnly", engineRoot,
      executionMemory: { enabled: true, root: memoryRoot, importRoots: [], secretEnv: [] } };
    const compiled = compileMachineProfile(profile);
    assert(compiled.browser.enabled === false && Object.keys(compiled.browser).length === 1
      && compiled.executionMemory.root === memoryRoot,
    "pythonOnly recipe에 browser authority가 섞이거나 Execution Memory가 누락됐다");
    const wildcard = await errorOf(() => compileMachineProfile({ recipe: "observeLocal", engineRoot,
      allowedOrigins: ["http://*.test"], purpose: "fixture", externalEffects: "acknowledged" }));
    assert(/exact HTTP\(S\) origin/.test(wildcard?.message), "Machine Entrance가 wildcard origin을 거부하지 않았다");
    const leaked = await errorOf(() => compileMachineProfile({ ...profile, actions: ["snapshot"] }));
    assert(/pythonOnly does not accept actions/.test(leaked?.message), "pythonOnly가 action 입력을 무시하고 통과했다");

    const dry = await initializeMachineProfile({ projectRoot, profile, dryRun: true });
    assert(dry.dryRun && dry.next.run.includes("--code"), "initializer dry-run과 다음 명령 계약이 불일치한다");
    const initialized = await initializeMachineProfile({ projectRoot, profile });
    const manifest = JSON.parse(await readFile(initialized.manifestPath, "utf8"));
    const client = JSON.parse(await readFile(initialized.clientPath, "utf8"));
    assert(manifest.browser.enabled === false && manifest.executionMemory.root === memoryRoot
      && client.mcpServers.pyproc.command === "npx"
      && client.mcpServers.pyproc.args.includes("--no-install")
      && client.mcpServers.pyproc.args.at(-1) === initialized.manifestPath,
      "initializer 산출물이 exact manifest와 common MCP snippet을 연결하지 않았다");
    const overwrite = await errorOf(() => initializeMachineProfile({ projectRoot, profile }));
    assert(/without --overwrite/.test(overwrite?.message), "initializer가 기존 파일을 암묵적으로 덮어썼다");
    const escape = await errorOf(() => initializeMachineProfile({ projectRoot, outputDir: "../escape", profile }));
    assert(/inside projectRoot/.test(escape?.message), "initializer output이 project root를 벗어났다");

    let browserDiscovery = 0;
    const doctor = await inspectMachineProfile(initialized.manifestPath, {
      browserFinder: () => { browserDiscovery += 1; return "fixture-browser"; },
      engineInspector: async () => ({ version: "fixture", coreAssets: 1, packages: 1,
        byteLength: 2, integrity: "verified" }),
    });
    assert(doctor.ok && browserDiscovery === 1 && doctor.automation.enabled === false
      && doctor.automation.cdpEndpoint === false
      && doctor.checks.some((entry) => entry.code === "MACHINE_PREFLIGHT_EFFECT_FREE"),
    "doctor가 effect-free Python-only preflight를 증명하지 않았다");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
