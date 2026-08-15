import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { nativeProfileBuildInput } from "./nativeProfileCompiler.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LOCK = JSON.parse(await readFile(join(SCRIPT_DIR, "engineBuildLock.json"), "utf8"));
const DECLARED_FILES = Object.freeze([
  "python.wasm",
  "python314-stdlib.zip",
  "stdlib-inventory.json",
  "native-profile-build-input.json",
  "engine-build-manifest.json",
  "engine.cyclonedx.json",
]);

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function option(name, required = false) {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    if (required) throw new Error(`missing ${name}`);
    return null;
  }
  if (!process.argv[index + 1]) throw new Error(`missing ${name} value`);
  return resolve(process.argv[index + 1]);
}

function textOption(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1]) throw new Error(`missing ${name} value`);
  return process.argv[index + 1];
}

async function bytes(path) { return readFile(path); }

async function verifyFolder(folder, requireProductionFlags, profileName) {
  const compiledProfile = await nativeProfileBuildInput(profileName);
  const manifest = JSON.parse(await readFile(join(folder, "engine-build-manifest.json"), "utf8"));
  const inventory = JSON.parse(await readFile(join(folder, "stdlib-inventory.json"), "utf8"));
  const sbom = JSON.parse(await readFile(join(folder, "engine.cyclonedx.json"), "utf8"));
  const profileInput = await readFile(join(folder, "native-profile-build-input.json"), "utf8");
  if (profileInput !== compiledProfile.serialized) throw new Error("native profile build input differs from the locked compiler output");
  if (manifest.protocol !== "pyproc.engine-build-manifest"
    || manifest.engineId !== compiledProfile.input.engineId || manifest.nativeProfile !== profileName) {
    throw new Error("engine manifest identity mismatch");
  }
  if (manifest.source.commit !== LOCK.cpython.commit || manifest.toolchain.wasiSdkVersion !== LOCK.wasiSdk.version) throw new Error("engine manifest pin mismatch");
  if (manifest.recipe.nativeProfileInputSha256 !== compiledProfile.sha256
    || manifest.recipe.hostModule.abiVersion !== LOCK.hostModule.abiVersion
    || compiledProfile.input.recipe.modules.some((module) => !manifest.staticModules.includes(module.name))) {
    throw new Error("engine manifest native module profile mismatch");
  }
  if (inventory.engineId !== compiledProfile.input.engineId || inventory.nativeProfile !== profileName
    || inventory.fileCount !== inventory.files.length || inventory.fileCount < 500) throw new Error("stdlib inventory is incomplete");
  if (new Set(inventory.files.map((entry) => entry.path)).size !== inventory.files.length) throw new Error("stdlib inventory paths are not unique");
  if (sbom.bomFormat !== "CycloneDX" || compiledProfile.input.recipe.modules
    .some((module) => !sbom.components.some((entry) => entry.name === module.name
      && entry.hashes?.some((hash) => hash.content === module.sourceSha256)))) {
    throw new Error("engine SBOM is incomplete");
  }
  for (const output of Object.values(manifest.outputs)) {
    const actual = await bytes(join(folder, output.file));
    if (actual.byteLength !== output.byteLength || sha256(actual) !== output.sha256) throw new Error(`declared artifact mismatch: ${output.file}`);
  }
  if (requireProductionFlags) {
    const observed = manifest.recipe.observedMakeVariables.configureCflags || "";
    for (const flag of LOCK.cflags.split(/\s+/u)) if (!observed.split(/\s+/u).includes(flag)) throw new Error(`production CFLAG was not observed: ${flag}`);
  }
  if (manifest.outputs.engine.byteLength > compiledProfile.input.budgets.maxWasmBytes
    || manifest.outputs.stdlib.byteLength > compiledProfile.input.budgets.maxStdlibZipBytes) {
    throw new Error("native profile artifact exceeds its locked size budget");
  }
  return manifest;
}

async function main() {
  const folder = option("--artifact-dir", true);
  const compare = option("--compare");
  const receiptPath = option("--receipt");
  const profileName = textOption("--profile", "core");
  const requireProductionFlags = process.argv.includes("--require-production-flags");
  const manifest = await verifyFolder(folder, requireProductionFlags, profileName);
  if (compare) {
    await verifyFolder(compare, requireProductionFlags, profileName);
    for (const name of DECLARED_FILES) {
      const left = await bytes(join(folder, name));
      const right = await bytes(join(compare, name));
      if (!left.equals(right)) throw new Error(`independent build mismatch: ${name}`);
    }
  }
  const receipt = {
    schemaVersion: 1,
    protocol: "pyproc.engine-reproducibility-receipt",
    engineId: manifest.engineId,
    nativeProfile: profileName,
    independentBuilds: compare ? 2 : 1,
    byteIdentical: compare ? true : null,
    outputs: manifest.outputs,
  };
  if (receiptPath) await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
}

main().catch((error) => { console.error(error?.stack || String(error)); process.exitCode = 1; });
