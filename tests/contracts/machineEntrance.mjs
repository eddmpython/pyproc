// Machine Entrance의 recipe, initializer, doctor, CLI argument 계약을 고정한다.
import { generateKeyPairSync } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMachineProfileInitArguments, parseMachineRunArguments } from "../../scripts/machineEntrance/entranceCli.js";
import { inspectMachineProfile } from "../../scripts/machineEntrance/machineDoctor.js";
import { compileMachineProfile } from "../../scripts/machineEntrance/machineProfile.js";
import { initializeMachineProfile } from "../../scripts/machineEntrance/profileInitializer.js";
import { validateMcpProductConfig } from "../../scripts/mcpProductConfig.mjs";

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OWNED_ENGINE = join(REPOSITORY, "src", "runtime", "engines", "wasi", "owned", "core");
const MANIFEST_SECTIONS = ["engine", "browser", "executionMemory", "effectTransactions", "appSpace", "replayGraph", "actuation"];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function errorOf(operation) {
  try { await operation(); return null; } catch (error) { return error; }
}

function markdownFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) markdownFiles(full, acc);
    else if (entry.endsWith(".md")) acc.push(full);
  }
  return acc;
}

// 문서 예제의 자리표시 절대 경로를 실제 경로로 묶는다. engine.root는 이 저장소의 소유 engine이고, 나머지
// 디렉터리는 새로 만들며, 파일 이름 경로는 기록 모드가 새로 쓸 수 있게 만들지 않고 둔다.
async function bindExamplePaths(value, scratch, key = "", counter = { next: 0 }) {
  if (Array.isArray(value)) return Promise.all(value.map((entry) => bindExamplePaths(entry, scratch, key, counter)));
  if (value && typeof value === "object") {
    const bound = {};
    for (const [name, entry] of Object.entries(value)) {
      bound[name] = await bindExamplePaths(entry, scratch, key ? `${key}.${name}` : name, counter);
    }
    return bound;
  }
  if (typeof value !== "string" || !/^(\/|[A-Za-z]:\/)/.test(value)) return value;
  if (key === "engine.root") return OWNED_ENGINE;
  const target = join(scratch, `path${counter.next++}`);
  if (/\.[a-z]+$/i.test(value)) return `${target}${value.slice(value.lastIndexOf("."))}`;
  await mkdir(target, { recursive: true });
  return target;
}

// 배포 문서의 manifest 예제와 필드 표는 doctor와 같은 validator가 받아들이는 것만 말한다. 0.0.23 설치본
// 문서가 engine.indexURL을 허용한다고 적었지만 doctor는 필드 자체를 거절했다(소비 저장소 실측).
async function assertDocumentedManifests(scratch) {
  const docs = [join(REPOSITORY, "README.md"), join(REPOSITORY, "README.ko.md"), ...markdownFiles(join(REPOSITORY, "skills"))];
  let examples = 0;
  let fields = 0;
  let reference = null;
  for (const file of docs) {
    const markdown = await readFile(file, "utf8");
    for (const block of markdown.matchAll(/```json\n([\s\S]*?)```/g)) {
      if (!/"schemaVersion"\s*:\s*1/.test(block[1])) continue;
      const example = await bindExamplePaths(JSON.parse(block[1]), scratch);
      const secrets = Object.fromEntries((example.executionMemory?.secretEnv || []).map((name) => [name, "documented-example-secret-value-0123456789"]));
      const failure = await errorOf(() => validateMcpProductConfig(example, { baseEnv: secrets }));
      assert(!failure, `${file}: 문서 manifest 예제를 validator가 거절한다: ${failure?.message}`);
      if (!reference && example.browser?.enabled) reference = example;
      examples += 1;
    }
  }
  assert(examples > 0 && reference, "문서 manifest 예제를 하나도 찾지 못했다");
  for (const file of docs) {
    const markdown = await readFile(file, "utf8");
    for (const row of markdown.matchAll(/^\|([^|\n]+)\|/gm)) {
      for (const span of row[1].matchAll(/`([A-Za-z]+)\.([A-Za-z]+)`/g)) {
        const [, section, field] = span;
        if (!MANIFEST_SECTIONS.includes(section)) continue;
        const probe = structuredClone(reference);
        probe[section] = { ...(probe[section] || {}), [field]: Symbol.for("documentedField") };
        const failure = await errorOf(() => validateMcpProductConfig(probe, { baseEnv: {} }));
        assert(failure?.message !== `${section} does not accept ${field}`,
          `${file}: 문서 필드 표가 validator에 없는 ${section}.${field}를 설명한다`);
        fields += 1;
      }
    }
  }
  const unknown = structuredClone(reference);
  unknown.engine = { ...unknown.engine, indexURL: "https://example.test/engine/" };
  assert((await errorOf(() => validateMcpProductConfig(unknown, { baseEnv: {} })))?.message === "engine does not accept indexURL",
    "음성 시험: 알 수 없는 manifest 필드를 받아들였다");
  assert(fields > 0, "문서 manifest 필드 표를 하나도 찾지 못했다");
}

export async function assertMachineEntranceContract() {
  const root = await mkdtemp(join(tmpdir(), "pyprocMachineEntranceContract-"));
  try {
    const projectRoot = join(root, "project");
    const engineRoot = join(projectRoot, "vendor", "cpython-wasi");
    await mkdir(engineRoot, { recursive: true });
    await writeFile(join(engineRoot, "python.wasm"), "fixture");
    await writeFile(join(engineRoot, "python314-stdlib.zip"), "fixture");
    await writeFile(join(engineRoot, "engine-build-manifest.json"), "{}");
    const packageRoot = join(root, "installed-package");
    const packageEngineRoot = join(packageRoot, "src", "runtime", "engines", "wasi", "owned", "core");
    await mkdir(packageEngineRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ version: "1.2.3" }));
    await writeFile(join(packageEngineRoot, "python.wasm"), "fixture");
    await writeFile(join(packageEngineRoot, "python314-stdlib.zip"), "fixture");
    await writeFile(join(packageEngineRoot, "engine-build-manifest.json"), "{}");
    const approvalPublicKey = join(projectRoot, "approval-public.pem");
    await writeFile(approvalPublicKey, generateKeyPairSync("ed25519").publicKey
      .export({ type: "spki", format: "pem" }));

    const parsed = parseMachineProfileInitArguments([
      "--recipe", "pythonOnly", "--project-root", projectRoot, "--engine-root", "vendor/cpython-wasi", "--dry-run",
      "--execution-memory-root", ".pyproc/memory", "--execution-memory-import-root", "handoffs",
    ]);
    assert(parsed.profile.engineRoot === engineRoot && parsed.dryRun === true,
      "Machine Entrance CLI가 project-relative engine을 absolute profile로 컴파일하지 않았다");
    const defaultParsed = parseMachineProfileInitArguments([
      "--recipe", "pythonOnly", "--project-root", projectRoot, "--dry-run",
    ]);
    assert(defaultParsed.profile.engineRoot === undefined,
      "Machine Entrance CLI parser가 설치 패키지 경계를 알기 전에 engine 경로를 추측했다");
    assert(parsed.profile.executionMemory.root === join(projectRoot, ".pyproc", "memory")
      && parsed.profile.executionMemory.importRoots[0] === join(projectRoot, "handoffs"),
    "Machine Entrance CLI가 Execution Memory 경로를 absolute profile로 컴파일하지 않았다");
    const trustParsed = parseMachineProfileInitArguments([
      "--recipe", "authorizedBrowser", "--project-root", projectRoot, "--dry-run",
      "--trusted-certificate", "https://localhost:4443=certs/dev.pem",
    ]);
    assert(trustParsed.profile.trustedCertificates?.[0]?.origin === "https://localhost:4443"
      && trustParsed.profile.trustedCertificates[0].certificate === join(projectRoot, "certs", "dev.pem"),
    "Machine Entrance CLI가 신뢰 인증서를 origin과 absolute 경로로 컴파일하지 않았다");
    const trustMissingFile = await errorOf(() => parseMachineProfileInitArguments([
      "--recipe", "authorizedBrowser", "--project-root", projectRoot, "--trusted-certificate", "https://localhost:4443",
    ]));
    assert(/requires <https-origin>=<certificate-file>/.test(trustMissingFile?.message),
      "Machine Entrance CLI가 인증서 파일 없는 신뢰 선언을 받았다");
    const effectParsed = parseMachineProfileInitArguments([
      "--recipe", "authorizedBrowser", "--project-root", projectRoot, "--engine-root", "vendor/cpython-wasi",
      "--origin", "https://example.test", "--max-risk", "externalEffect", "--purpose", "Commit fixture",
      "--acknowledge-effects", "--action", "snapshot", "--action", "click",
      "--execution-memory-root", ".pyproc/effect-memory", "--enable-effect-transactions",
      "--effect-approval-authority", "operator:fixture=approval-public.pem",
    ]);
    assert(effectParsed.profile.effectTransactions.enabled
      && effectParsed.profile.effectTransactions.approvalAuthorities[0].authorityId === "operator:fixture"
      && effectParsed.profile.effectTransactions.approvalAuthorities[0].publicKeyFile === approvalPublicKey,
    "Machine Entrance CLI가 Rehearse-Commit authority를 absolute profile로 컴파일하지 않았다");
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
    const unknownRecipe = await errorOf(() => compileMachineProfile({ recipe: "unknownRecipe", engineRoot }));
    assert(/recipe must be one of/.test(unknownRecipe?.message), "Machine Entrance가 unknown recipe를 effect 전에 거부하지 않았다");
    const leaked = await errorOf(() => compileMachineProfile({ ...profile, actions: ["snapshot"] }));
    assert(/pythonOnly does not accept actions/.test(leaked?.message), "pythonOnly가 action 입력을 무시하고 통과했다");

    const dry = await initializeMachineProfile({ projectRoot, profile, dryRun: true });
    assert(dry.dryRun && dry.next.run.includes("--code")
      && dry.next.firstResult.operation === "machine.run"
      && dry.next.firstResult.mcp.tool === "pythonRun",
    "initializer dry-run과 다음 명령 계약이 불일치한다");
    const packageDefault = await initializeMachineProfile({ projectRoot, outputDir: ".pyproc-default",
      profile: defaultParsed.profile, packageRoot });
    const packageManifest = JSON.parse(await readFile(packageDefault.manifestPath, "utf8"));
    assert(packageDefault.engine.source === "packageDefault"
      && packageDefault.engine.root === packageEngineRoot
      && packageManifest.engine.root === packageEngineRoot,
    "initializer가 설치 패키지의 owned CPython을 기본 engine으로 고정하지 않았다");
    const initialized = await initializeMachineProfile({ projectRoot, profile });
    const manifest = JSON.parse(await readFile(initialized.manifestPath, "utf8"));
    const client = JSON.parse(await readFile(initialized.clientPath, "utf8"));
    assert(initialized.engine.source === "explicit" && initialized.engine.root === engineRoot
      && manifest.browser.enabled === false && manifest.executionMemory.root === memoryRoot
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
    const first = doctor.next.firstResult;
    assert(first.schemaVersion === 1 && first.operation === "machine.run"
      && first.input.code === "40 + 2"
      && first.shell.command === "pyproc-control" && first.shell.arguments[0] === "run"
      && first.javascript.module === "pyproc/control" && first.javascript.method === "runPython"
      && first.python.module === "pyprocControl" && first.python.method === "runPython"
      && first.mcp.command === "pyproc-mcp" && first.mcp.tool === "pythonRun"
      && first.mcp.arguments === first.input
      && [first.shell.arguments[2], first.javascript.startArguments[0], first.python.startArguments[0],
        first.mcp.serverArguments[1]].every((value) => value === initialized.manifestPath),
    "doctor 첫 결과가 네 adapter에서 같은 Machine operation과 입력을 가리키지 않았다");
    assert(Object.isFrozen(doctor.next) && Object.isFrozen(first) && Object.isFrozen(first.input)
      && Object.isFrozen(first.shell.arguments) && Object.isFrozen(first.javascript.startArguments),
    "doctor 다음 행동이 호출자 변경에 열려 있다");
    await assertDocumentedManifests(join(root, "documented"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
