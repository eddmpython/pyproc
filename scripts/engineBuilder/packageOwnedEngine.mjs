import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDeterministicZip } from "./deterministicZip.mjs";
import { nativeProfileBuildInput } from "./nativeProfileCompiler.mjs";
import { inspectWasmThreadCapability } from "./wasmThreadCapability.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LOCK_PATH = join(SCRIPT_DIR, "engineBuildLock.json");
const SKIPPED_DIRECTORIES = new Set(["__pycache__", "test", "tests", "ensurepip", "idlelib", "tkinter", "turtledemo", "venv"]);
export const CANONICAL_BUILD_ROOT = "/build/pyproc";

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return resolve(process.argv[index + 1]);
}

function textOption(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1]) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}

async function collectFiles(folder, base = folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path, base));
    else if (entry.isFile() && extname(entry.name) !== ".pyc") files.push({ path, archivePath: relative(base, path).replaceAll("\\", "/") });
    else if (entry.isSymbolicLink()) throw new Error(`stdlib symlink is not allowed: ${path}`);
  }
  return files.sort((left, right) => Buffer.from(left.archivePath).compare(Buffer.from(right.archivePath)));
}

async function generatedPlatformDirectory(buildDir) {
  const relativeFolder = (await readFile(join(buildDir, "pybuilddir.txt"), "utf8")).trim();
  if (!relativeFolder || isAbsolute(relativeFolder) || relativeFolder.split(/[\\/]/u).includes("..")) {
    throw new Error("owned engine pybuilddir.txt is unsafe");
  }
  const folder = resolve(buildDir, relativeFolder);
  const relativeToBuild = relative(resolve(buildDir), folder);
  if (!relativeToBuild || relativeToBuild.startsWith("..") || isAbsolute(relativeToBuild)) {
    throw new Error("owned engine generated platform folder escapes the build directory");
  }
  return Object.freeze({ folder, relativeFolder: relativeFolder.replaceAll("\\", "/") });
}

function workspaceSpellings(workspaceRoot) {
  const native = resolve(workspaceRoot);
  const slash = native.replaceAll("\\", "/");
  const spellings = new Set([native, slash]);
  if (/^[A-Za-z]:\//u.test(slash)) spellings.add(`/${slash[0].toLowerCase()}${slash.slice(2)}`);
  return [...spellings].sort((left, right) => right.length - left.length);
}

export async function canonicalizeGeneratedPlatformData({ buildDir, workspaceRoot }) {
  const { folder } = await generatedPlatformDirectory(buildDir);
  const entries = await readdir(folder, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()
    && (/^_sysconfigdata_[A-Za-z0-9_.-]+\.py$/u.test(entry.name)
      || /^_sysconfig_vars_[A-Za-z0-9_.-]+\.json$/u.test(entry.name)));
  if (files.length !== 2) throw new Error(`owned engine expected two generated sysconfig files, got ${files.length}`);
  const spellings = workspaceSpellings(workspaceRoot);
  for (const entry of files) {
    const path = join(folder, entry.name);
    const original = await readFile(path, "utf8");
    let canonical = original.replaceAll("\r\n", "\n");
    for (const spelling of spellings) canonical = canonical.replaceAll(spelling, CANONICAL_BUILD_ROOT);
    if (!canonical.includes(CANONICAL_BUILD_ROOT)) {
      throw new Error(`generated ${entry.name} does not expose a canonicalizable build root`);
    }
    if (spellings.some((spelling) => canonical.includes(spelling))) {
      throw new Error(`generated ${entry.name} still exposes its workspace root`);
    }
    if (entry.name.endsWith(".json")) JSON.parse(canonical);
    if (canonical !== original) await writeFile(path, canonical);
  }
}

export async function ownedBuildDetailsArguments({ sourceDir, buildDir, target }) {
  if (!/^[a-z0-9_-]+$/u.test(target)) throw new Error("owned engine target is unsafe");
  const generated = await generatedPlatformDirectory(buildDir);
  const guestFolder = `/cross-build/${target}/${generated.relativeFolder}`;
  return Object.freeze({
    args: Object.freeze([
      "run", "--wasm", "max-wasm-stack=16777216", "--dir", `${sourceDir}::/`,
      "--env", "PYTHONPATH=/Lib", "--env", `_PYTHON_SYSCONFIGDATA_PATH=${guestFolder}`,
      join(buildDir, "python.wasm"), "/Tools/build/generate-build-details.py",
      `${guestFolder}/build-details.json`,
    ]),
    output: join(generated.folder, "build-details.json"),
  });
}

export async function collectGeneratedPlatformData(buildDir) {
  const { folder } = await generatedPlatformDirectory(buildDir);
  const entries = await readdir(folder, { withFileTypes: true });
  const contracts = [
    { label: "sysconfig data", pattern: /^_sysconfigdata_[A-Za-z0-9_.-]+\.py$/u },
    { label: "sysconfig vars", pattern: /^_sysconfig_vars_[A-Za-z0-9_.-]+\.json$/u },
    { label: "build details", pattern: /^build-details\.json$/u },
  ];
  const result = [];
  for (const contract of contracts) {
    const matches = entries.filter((entry) => contract.pattern.test(entry.name));
    if (matches.length !== 1 || !matches[0].isFile()) {
      throw new Error(`owned engine build must contain exactly one generated ${contract.label}, got ${matches.length}`);
    }
    result.push(Object.freeze({ path: join(folder, matches[0].name), archivePath: matches[0].name }));
  }
  const details = JSON.parse(await readFile(join(folder, "build-details.json"), "utf8"));
  if (details.schema_version !== "1.0" || details.base_prefix !== "/usr/local"
    || details.base_interpreter !== "/usr/local/bin/python3.14"
    || !/^wasi-[0-9.]+-wasm32$/u.test(details.platform)
    || !details.suffixes?.extensions?.includes(".cpython-314-wasm32-wasi.so")) {
    throw new Error("owned engine build details do not describe the target WASI runtime");
  }
  return Object.freeze(result.sort((left, right) =>
    Buffer.from(left.archivePath).compare(Buffer.from(right.archivePath))));
}

async function treeDigest(folder) {
  const hash = createHash("sha256");
  async function visit(current, base) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const entry of entries) {
      const path = join(current, entry.name);
      const rel = relative(base, path).replaceAll("\\", "/");
      if (entry.isDirectory()) await visit(path, base);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        hash.update("file\0").update(rel).update("\0").update(String(bytes.byteLength)).update("\0").update(bytes);
      } else if (entry.isSymbolicLink()) {
        const target = await readlink(path);
        hash.update("link\0").update(rel).update("\0").update(target);
      }
    }
  }
  await visit(folder, folder);
  return hash.digest("hex");
}

async function artifact(path) {
  const bytes = await readFile(path);
  return Object.freeze({ file: path.split(/[\\/]/u).at(-1), byteLength: bytes.byteLength, sha256: sha256(bytes) });
}

function makeVariable(makefile, name) {
  const match = makefile.match(new RegExp(`^${name}=[ \\t]*(.*)$`, "mu"));
  return match ? match[1].trim() : null;
}

async function observedThreading({ sourceDir, buildDir, wasmBytes }) {
  const pyconfig = await readFile(join(buildDir, "pyconfig.h"), "utf8");
  const substrate = inspectWasmThreadCapability(wasmBytes);
  const usesStubs = /^#define HAVE_PTHREAD_STUBS 1$/mu.test(pyconfig);
  const hasPosixThreads = /^#define _POSIX_THREADS 1$/mu.test(pyconfig);
  if (usesStubs) {
    const [stubs, threadModule] = await Promise.all([
      readFile(join(sourceDir, "Python", "thread_pthread_stubs.h"), "utf8"),
      readFile(join(sourceDir, "Modules", "_threadmodule.c"), "utf8"),
    ]);
    if (!/pthread_create[\s\S]*return EAGAIN;/u.test(stubs)
      || !threadModule.includes("can't start new thread")) {
      throw new Error("CPython pthread stub failure contract drifted");
    }
  }
  const canStart = hasPosixThreads && !usesStubs && substrate.memory.shared
    && substrate.threadSpawnImports.length > 0;
  return Object.freeze({
    protocol:"pyproc.thread-capability",
    version:1,
    mode:canStart ? "shared-memory" : "worker-processes",
    pythonImplementation:usesStubs ? "pthread-stubs" : "pthread",
    pythonThreadCreation:canStart,
    sharedWasmMemory:substrate.memory.shared,
    wasiThreadSpawn:substrate.threadSpawnImports.length > 0,
    failure:canStart ? null : Object.freeze({ pythonType:"RuntimeError", message:"can't start new thread" }),
  });
}

export async function packageOwnedEngine({ sourceDir, buildDir, sdkDir, outDir,
  profileName = "core", profileBuild = null, scientificBuild = null }) {
  const lock = JSON.parse(await readFile(LOCK_PATH, "utf8"));
  const compiledProfile = profileBuild || await nativeProfileBuildInput(profileName);
  if (compiledProfile.input.profile !== profileName) throw new Error("native profile compiler input mismatch");
  const wasmSource = join(buildDir, "python.wasm");
  const configSource = await readFile(join(buildDir, "Modules", "config.c"), "utf8");
  const makefile = await readFile(join(buildDir, "Makefile"), "utf8");
  const wasmBytes = await readFile(wasmSource);
  const threading = await observedThreading({ sourceDir, buildDir, wasmBytes });
  if (JSON.stringify(threading) !== JSON.stringify(compiledProfile.input.threading)) {
    throw new Error("owned engine threading capability differs from the locked profile");
  }
  for (const module of compiledProfile.input.recipe.modules) {
    const initializer = module.name.replace(/^_/u, "PyInit__");
    if (!configSource.includes(`{"${module.name}", ${initializer}}`)) {
      throw new Error(`owned engine is missing static ${module.name} registration`);
    }
    if (!wasmBytes.includes(Buffer.from(module.name))) throw new Error(`owned engine bytes do not name ${module.name}`);
  }
  const scientificPackages = compiledProfile.input.scientificPackages || [];
  if (scientificPackages.length !== (scientificBuild ? 1 : 0)) {
    throw new Error("owned engine scientific package build is incomplete");
  }
  if (scientificBuild) {
    const expected = scientificPackages[0];
    const built = scientificBuild.manifest;
    if (built?.protocol !== "pyproc.scientific-package-build" || built.target !== compiledProfile.input.target
      || built.pythonVersion !== compiledProfile.input.source.version || built.package?.name !== expected.name
      || built.package?.version !== expected.version || built.package?.sourceSha256 !== expected.sourceSha256
      || built.package?.wheel?.file !== expected.wheelFile
      || built.package.wheel.byteLength > expected.maxWheelBytes
      || built.package.wheel.sha256 !== sha256(await readFile(scientificBuild.wheelPath))) {
      throw new Error("owned engine scientific package provenance differs from the compiled profile");
    }
    for (const module of expected.modules) {
      if (!configSource.includes(`{"${module}", PyInit_`) || !wasmBytes.includes(Buffer.from(module))) {
        throw new Error(`owned engine is missing scientific built-in registration: ${module}`);
      }
    }
  }

  await mkdir(outDir, { recursive: true });
  const wasmOut = join(outDir, "python.wasm");
  await copyFile(wasmSource, wasmOut);

  await canonicalizeGeneratedPlatformData({ buildDir, workspaceRoot: dirname(sourceDir) });
  const stdlibFiles = [...await collectFiles(join(sourceDir, "Lib")),
    ...await collectGeneratedPlatformData(buildDir)]
    .sort((left, right) => Buffer.from(left.archivePath).compare(Buffer.from(right.archivePath)));
  const zipEntries = [];
  const inventoryFiles = [];
  for (const file of stdlibFiles) {
    const bytes = await readFile(file.path);
    zipEntries.push({ path: file.archivePath, bytes });
    inventoryFiles.push({ path: file.archivePath, byteLength: bytes.byteLength, sha256: sha256(bytes) });
  }
  const stdlibZip = createDeterministicZip(zipEntries, lock.sourceDateEpoch);
  const stdlibOut = join(outDir, "python314-stdlib.zip");
  await writeFile(stdlibOut, stdlibZip);

  const inventory = {
    schemaVersion: 1,
    engineId: compiledProfile.input.engineId,
    nativeProfile: profileName,
    sourceCommit: lock.cpython.commit,
    fileCount: inventoryFiles.length,
    files: inventoryFiles,
  };
  const inventoryOut = join(outDir, "stdlib-inventory.json");
  await writeFile(inventoryOut, `${JSON.stringify(inventory, null, 2)}\n`);

  const profileInputOut = join(outDir, "native-profile-build-input.json");
  await writeFile(profileInputOut, compiledProfile.serialized);

  let scientificOutputs = {};
  if (scientificBuild) {
    const wheelOut = join(outDir, compiledProfile.input.scientificPackages[0].wheelFile);
    const buildOut = join(outDir, "scientific-package-build.json");
    await copyFile(scientificBuild.wheelPath, wheelOut);
    await copyFile(scientificBuild.manifestPath, buildOut);
    scientificOutputs = {
      scientificWheel: await artifact(wheelOut),
      scientificPackageBuild: await artifact(buildOut),
    };
  }

  const compiler = await artifact(join(sdkDir, "bin", process.platform === "win32" ? "clang.exe" : "clang"));
  const outputs = {
    engine: await artifact(wasmOut),
    stdlib: await artifact(stdlibOut),
    stdlibInventory: await artifact(inventoryOut),
    nativeProfileBuildInput: await artifact(profileInputOut),
    ...scientificOutputs,
  };
  if (outputs.engine.byteLength > compiledProfile.input.budgets.maxWasmBytes) {
    throw new Error(`native profile WASM exceeds budget: ${outputs.engine.byteLength}`);
  }
  if (outputs.stdlib.byteLength > compiledProfile.input.budgets.maxStdlibZipBytes) {
    throw new Error(`native profile stdlib exceeds budget: ${outputs.stdlib.byteLength}`);
  }
  const hostModule = compiledProfile.input.recipe.modules.find((module) => module.name === "_pyprocHost");
  const manifest = {
    schemaVersion: 2,
    protocol: "pyproc.engine-build-manifest",
    engineId: compiledProfile.input.engineId,
    nativeProfile: profileName,
    target: lock.target,
    threading,
    sourceDateEpoch: lock.sourceDateEpoch,
    source: lock.cpython,
    toolchain: {
      wasiSdkVersion: lock.wasiSdk.version,
      wasiSdkArchiveSha256: process.platform === "win32" ? lock.wasiSdk.windowsX8664.archiveSha256 : lock.wasiSdk.linuxX8664.archiveSha256,
      wasiSysrootTreeSha256: await treeDigest(join(sdkDir, "share", "wasi-sysroot")),
      compiler,
    },
    recipe: {
      configureArgs: lock.configureArgs,
      requestedCflags: lock.cflags,
      observedMakeVariables: {
        baseCflags: makeVariable(makefile, "BASECFLAGS"),
        optimizationFlags: makeVariable(makefile, "OPT"),
        configureCflags: makeVariable(makefile, "CONFIGURE_CFLAGS"),
        configureLdflags: makeVariable(makefile, "CONFIGURE_LDFLAGS"),
      },
      hostModule: lock.hostModule,
      hostModuleSourceSha256: hostModule?.sourceSha256 || null,
      setupLocalSha256: compiledProfile.input.recipe.setupSha256,
      setupFile: compiledProfile.input.recipe.setupFile,
      nativeModules: compiledProfile.input.recipe.modules,
      nativeProfileInputSha256: compiledProfile.sha256,
      scientificPackages,
      budgets: compiledProfile.input.budgets,
    },
    staticModules: [...configSource.matchAll(/\{"([^"}]+)",\s*PyInit_/gu)].map((match) => match[1]).sort(),
    outputs,
  };
  const manifestOut = join(outDir, "engine-build-manifest.json");
  await writeFile(manifestOut, `${JSON.stringify(manifest, null, 2)}\n`);

  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: { component: { type: "application", name: compiledProfile.input.engineId, version: lock.cpython.version } },
    components: [
      { type: "framework", name: "CPython", version: lock.cpython.version, bomRef: `cpython:${lock.cpython.commit}`, hashes: [{ alg: "SHA-256", content: lock.cpython.archiveSha256 }] },
      { type: "application", name: "WASI SDK", version: lock.wasiSdk.version, bomRef: `wasi-sdk:${lock.wasiSdk.version}`, hashes: [{ alg: "SHA-256", content: manifest.toolchain.wasiSdkArchiveSha256 }] },
      ...compiledProfile.input.recipe.modules.map((module) => ({ type: "library", name: module.name,
        version: module.abiVersion, bomRef: `native:${module.name}:${module.abiVersion}`,
        hashes: [{ alg: "SHA-256", content: module.sourceSha256 }] })),
      ...scientificPackages.map((entry) => ({ type: "library", name: entry.name,
        version: entry.version, bomRef: `scientific:${entry.name}:${entry.version}`,
        hashes: [{ alg: "SHA-256", content: entry.sourceSha256 }] })),
      { type: "file", name: outputs.engine.file, bomRef: `artifact:${outputs.engine.sha256}`, hashes: [{ alg: "SHA-256", content: outputs.engine.sha256 }] },
      { type: "file", name: outputs.stdlib.file, bomRef: `artifact:${outputs.stdlib.sha256}`, hashes: [{ alg: "SHA-256", content: outputs.stdlib.sha256 }] },
      { type: "file", name: outputs.nativeProfileBuildInput.file,
        bomRef: `artifact:${outputs.nativeProfileBuildInput.sha256}`,
        hashes: [{ alg: "SHA-256", content: outputs.nativeProfileBuildInput.sha256 }] },
      ...Object.values(scientificOutputs).map((output) => ({ type: "file", name: output.file,
        bomRef: `artifact:${output.sha256}`, hashes: [{ alg: "SHA-256", content: output.sha256 }] })),
    ],
  };
  const sbomOut = join(outDir, "engine.cyclonedx.json");
  await writeFile(sbomOut, `${JSON.stringify(sbom, null, 2)}\n`);
  return Object.freeze({ manifest, outputs: { ...outputs,
    manifest: await artifact(manifestOut), sbom: await artifact(sbomOut) } });
}

async function main() {
  const result = await packageOwnedEngine({
    sourceDir: option("--source"),
    buildDir: option("--build"),
    sdkDir: option("--sdk"),
    outDir: option("--out"),
    profileName: textOption("--profile", "core"),
  });
  console.log(JSON.stringify(result.outputs, null, 2));
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error?.stack || String(error)); process.exitCode = 1; });
}
