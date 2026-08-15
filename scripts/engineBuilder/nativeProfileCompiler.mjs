import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LOCK_PATH = join(SCRIPT_DIR, "engineBuildLock.json");

export const NATIVE_PROFILE_INPUT_PROTOCOL = "pyproc.native-profile-build-input";
export const NATIVE_PROFILE_COMPILER_VERSION = 1;

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function textOption(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1]) throw new Error(`missing ${name} value`);
  return process.argv[index + 1];
}

function pathOption(name) {
  const value = textOption(name);
  return value ? resolve(value) : null;
}

export async function nativeProfileBuildInput(profileName) {
  const lock = JSON.parse(await readFile(LOCK_PATH, "utf8"));
  const profile = lock.nativeProfiles?.[profileName];
  if (!profile || !/^[a-z][a-z0-9]*$/u.test(profileName)) {
    throw new Error(`unknown native profile: ${profileName}`);
  }
  if (profileName === "core" && profile.engineId !== lock.engineId) {
    throw new Error("core native profile engineId differs from the compatibility engineId");
  }
  if (!Array.isArray(profile.modules) || !profile.modules.length
    || new Set(profile.modules.map((module) => module.name)).size !== profile.modules.length) {
    throw new Error(`native profile modules are invalid: ${profileName}`);
  }
  const modules = [];
  for (const module of profile.modules) {
    if (!/^_[A-Za-z0-9]+$/u.test(module.name) || !/^[A-Za-z0-9_]+\.c$/u.test(module.source)
      || !/^[0-9a-f]{64}$/u.test(module.sourceSha256) || typeof module.abiVersion !== "string") {
      throw new Error(`native profile module declaration is invalid: ${module.name}`);
    }
    const bytes = await readFile(join(SCRIPT_DIR, module.source));
    const actual = sha256(bytes);
    if (actual !== module.sourceSha256) throw new Error(`native profile source digest mismatch: ${module.source}`);
    modules.push({ name: module.name, source: module.source, sourceSha256: actual,
      abiVersion: module.abiVersion, byteLength: bytes.byteLength });
  }
  if (!/^Setup(?:\.[a-z0-9]+)?\.local$/u.test(profile.setupFile)) {
    throw new Error(`native profile Setup filename is invalid: ${profile.setupFile}`);
  }
  const setupBytes = await readFile(join(SCRIPT_DIR, profile.setupFile));
  const setupSha256 = sha256(setupBytes);
  if (setupSha256 !== profile.setupSha256) throw new Error(`native profile Setup digest mismatch: ${profile.setupFile}`);
  for (const module of modules) {
    if (!new TextDecoder().decode(setupBytes).split(/\r?\n/u)
      .some((line) => line.trim().startsWith(`${module.name} ${module.source}`))) {
      throw new Error(`native profile Setup omits ${module.name}`);
    }
  }
  if (!Number.isSafeInteger(profile.budgets?.maxWasmBytes) || !Number.isSafeInteger(profile.budgets?.maxStdlibZipBytes)
    || profile.budgets.maxWasmBytes < 1 || profile.budgets.maxStdlibZipBytes < 1
    || typeof profile.oracle?.code !== "string" || typeof profile.oracle?.stdout !== "string") {
    throw new Error(`native profile oracle or budgets are invalid: ${profileName}`);
  }
  const input = Object.freeze({ protocol: NATIVE_PROFILE_INPUT_PROTOCOL, version: NATIVE_PROFILE_COMPILER_VERSION,
    profile: profileName, engineId: profile.engineId, target: lock.target,
    source: { version: lock.cpython.version, commit: lock.cpython.commit, archiveSha256: lock.cpython.archiveSha256 },
    toolchain: { wasiSdkVersion: lock.wasiSdk.version,
      linuxArchiveSha256: lock.wasiSdk.linuxX8664.archiveSha256,
      windowsArchiveSha256: lock.wasiSdk.windowsX8664.archiveSha256 },
    recipe: { sourceDateEpoch: lock.sourceDateEpoch, configureArgs: lock.configureArgs,
      cflags: lock.cflags, setupFile: profile.setupFile, setupSha256, modules },
    oracle: profile.oracle, budgets: profile.budgets,
    outputs: ["python.wasm", "python314-stdlib.zip", "stdlib-inventory.json",
      "native-profile-build-input.json", "engine-build-manifest.json", "engine.cyclonedx.json"] });
  const serialized = `${JSON.stringify(input, null, 2)}\n`;
  return Object.freeze({ input, serialized, sha256: sha256(serialized) });
}

async function main() {
  const profileName = textOption("--profile", "core");
  const out = pathOption("--out");
  const compiled = await nativeProfileBuildInput(profileName);
  if (out) await writeFile(out, compiled.serialized);
  console.log(JSON.stringify({ profile: profileName, engineId: compiled.input.engineId,
    sha256: compiled.sha256, modules: compiled.input.recipe.modules.map((module) => module.name),
    output: out }, null, 2));
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error?.stack || String(error)); process.exitCode = 1; });
}
