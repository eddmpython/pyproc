import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDeterministicZip } from "./deterministicZip.mjs";
import { nativeProfileBuildInput } from "./nativeProfileCompiler.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LOCK_PATH = join(SCRIPT_DIR, "engineBuildLock.json");
const SKIPPED_DIRECTORIES = new Set(["__pycache__", "test", "tests", "ensurepip", "idlelib", "tkinter", "turtledemo", "venv"]);

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

export async function packageOwnedEngine({ sourceDir, buildDir, sdkDir, outDir,
  profileName = "core", profileBuild = null }) {
  const lock = JSON.parse(await readFile(LOCK_PATH, "utf8"));
  const compiledProfile = profileBuild || await nativeProfileBuildInput(profileName);
  if (compiledProfile.input.profile !== profileName) throw new Error("native profile compiler input mismatch");
  const wasmSource = join(buildDir, "python.wasm");
  const configSource = await readFile(join(buildDir, "Modules", "config.c"), "utf8");
  const makefile = await readFile(join(buildDir, "Makefile"), "utf8");
  const wasmBytes = await readFile(wasmSource);
  for (const module of compiledProfile.input.recipe.modules) {
    const initializer = module.name.replace(/^_/u, "PyInit__");
    if (!configSource.includes(`{"${module.name}", ${initializer}}`)) {
      throw new Error(`owned engine is missing static ${module.name} registration`);
    }
    if (!wasmBytes.includes(Buffer.from(module.name))) throw new Error(`owned engine bytes do not name ${module.name}`);
  }

  await mkdir(outDir, { recursive: true });
  const wasmOut = join(outDir, "python.wasm");
  await copyFile(wasmSource, wasmOut);

  const stdlibFiles = await collectFiles(join(sourceDir, "Lib"));
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

  const compiler = await artifact(join(sdkDir, "bin", process.platform === "win32" ? "clang.exe" : "clang"));
  const outputs = {
    engine: await artifact(wasmOut),
    stdlib: await artifact(stdlibOut),
    stdlibInventory: await artifact(inventoryOut),
    nativeProfileBuildInput: await artifact(profileInputOut),
  };
  if (outputs.engine.byteLength > compiledProfile.input.budgets.maxWasmBytes) {
    throw new Error(`native profile WASM exceeds budget: ${outputs.engine.byteLength}`);
  }
  if (outputs.stdlib.byteLength > compiledProfile.input.budgets.maxStdlibZipBytes) {
    throw new Error(`native profile stdlib exceeds budget: ${outputs.stdlib.byteLength}`);
  }
  const hostModule = compiledProfile.input.recipe.modules.find((module) => module.name === "_pyprocHost");
  const manifest = {
    schemaVersion: 1,
    protocol: "pyproc.engine-build-manifest",
    engineId: compiledProfile.input.engineId,
    nativeProfile: profileName,
    target: lock.target,
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
      { type: "file", name: outputs.engine.file, bomRef: `artifact:${outputs.engine.sha256}`, hashes: [{ alg: "SHA-256", content: outputs.engine.sha256 }] },
      { type: "file", name: outputs.stdlib.file, bomRef: `artifact:${outputs.stdlib.sha256}`, hashes: [{ alg: "SHA-256", content: outputs.stdlib.sha256 }] },
      { type: "file", name: outputs.nativeProfileBuildInput.file,
        bomRef: `artifact:${outputs.nativeProfileBuildInput.sha256}`,
        hashes: [{ alg: "SHA-256", content: outputs.nativeProfileBuildInput.sha256 }] },
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
