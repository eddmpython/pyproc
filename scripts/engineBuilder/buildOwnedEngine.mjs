import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { ownedBuildDetailsArguments, packageOwnedEngine } from "./packageOwnedEngine.mjs";
import { nativeProfileBuildInput } from "./nativeProfileCompiler.mjs";
import { buildOwnedNumpy, numpyMakeSyslibs } from "../scientificPackageBuilder/numpyStaticBuilder.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LOCK_PATH = join(SCRIPT_DIR, "engineBuildLock.json");

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1]) throw new Error(`missing ${name} value`);
  return resolve(process.argv[index + 1]);
}

function textOption(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (!process.argv[index + 1]) throw new Error(`missing ${name} value`);
  return process.argv[index + 1];
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: options.capture ? "pipe" : "inherit", encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`${command} failed with exit ${result.status}${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  return options.capture ? result.stdout.trim() : undefined;
}

async function verify(path, expected) {
  const bytes = await readFile(path);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`archive digest mismatch for ${basename(path)}: ${actual}`);
}

async function download(url, path, sha256) {
  if (!existsSync(path)) {
    const response = await fetch(url, { redirect: "follow", headers: { "User-Agent": "pyproc-owned-engine-builder/1" } });
    if (!response.ok || !response.body) throw new Error(`download failed ${response.status}: ${url}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(path, { flags: "wx" }));
  }
  await verify(path, sha256);
}

async function prepareSetup(sourceDir, buildDir, profileInput) {
  for (const module of profileInput.recipe.modules) {
    await copyFile(join(SCRIPT_DIR, module.source), join(sourceDir, "Modules", module.source));
  }
  await mkdir(join(buildDir, "Modules"), { recursive: true });
  await copyFile(join(SCRIPT_DIR, profileInput.recipe.setupFile), join(buildDir, "Modules", "Setup.local"));
}

async function main() {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("owned production engine builds require a clean Linux x64 host");
  }
  const workspace = option("--workspace", process.env.PYPROC_ENGINE_WORKSPACE ? resolve(process.env.PYPROC_ENGINE_WORKSPACE) : null);
  const outDir = option("--out", workspace ? join(workspace, "dist") : null);
  const profileName = textOption("--profile", "core");
  if (!workspace || !outDir) throw new Error("provide --workspace and --out, or PYPROC_ENGINE_WORKSPACE");
  if (existsSync(workspace)) throw new Error(`refusing to reuse engine workspace: ${workspace}`);
  if (/\s/u.test(workspace)) throw new Error("engine workspace must not contain whitespace");

  const lock = JSON.parse(await readFile(LOCK_PATH, "utf8"));
  const profileBuild = await nativeProfileBuildInput(profileName);
  const downloads = join(workspace, "downloads");
  const sourceDir = join(workspace, "cpython");
  const sdkDir = join(workspace, "wasi-sdk");
  const wasmtimeDir = join(workspace, "wasmtime");
  await mkdir(downloads, { recursive: true });
  await mkdir(sourceDir, { recursive: true });
  await mkdir(sdkDir, { recursive: true });
  await mkdir(wasmtimeDir, { recursive: true });

  const sourceArchive = join(downloads, "cpython.tar.gz");
  const sdkArchive = join(downloads, "wasi-sdk.tar.gz");
  const wasmtimeArchive = join(downloads, "wasmtime.tar.xz");
  await download(lock.cpython.url, sourceArchive, lock.cpython.archiveSha256);
  await download(lock.wasiSdk.linuxX8664.url, sdkArchive, lock.wasiSdk.linuxX8664.archiveSha256);
  await download(lock.wasmtime.linuxX8664.url, wasmtimeArchive, lock.wasmtime.linuxX8664.archiveSha256);
  run("tar", ["-xf", sourceArchive, "-C", sourceDir, "--strip-components=1"]);
  run("tar", ["-xf", sdkArchive, "-C", sdkDir, "--strip-components=1"]);
  run("tar", ["-xf", wasmtimeArchive, "-C", wasmtimeDir, "--strip-components=1"]);

  const baseEnv = {
    ...process.env,
    LC_ALL: "C",
    TZ: "UTC",
    PYTHONHASHSEED: "0",
    SOURCE_DATE_EPOCH: String(lock.sourceDateEpoch),
  };
  const buildTriple = run(join(sourceDir, "config.guess"), [], { cwd: sourceDir, env: baseEnv, capture: true });
  const nativeBuildDir = join(sourceDir, "cross-build", buildTriple);
  await prepareSetup(sourceDir, nativeBuildDir, profileBuild.input);
  run("../../configure", lock.configureArgs, {
    cwd: nativeBuildDir,
    env: { ...baseEnv, CFLAGS: lock.cflags },
  });
  run("make", ["--jobs", String(availableParallelism()), "all"], { cwd: nativeBuildDir, env: baseEnv });

  const targetBuildDir = join(sourceDir, "cross-build", lock.target);
  await prepareSetup(sourceDir, targetBuildDir, profileBuild.input);
  const wasmtime = join(wasmtimeDir, "wasmtime");
  const targetSysconfig = `/cross-build/${lock.target}/build/lib.wasi-wasm32-3.14`;
  const hostRunner = `${wasmtime} run --wasm max-wasm-stack=16777216 --dir ${sourceDir}::/ --env PYTHONPATH=${targetSysconfig}:/Lib`;
  const sysroot = join(sdkDir, "share", "wasi-sysroot");
  const targetEnv = {
    ...baseEnv,
    PATH: `${join(sdkDir, "bin")}:${wasmtimeDir}:${process.env.PATH}`,
    CONFIG_SITE: join(sourceDir, "Tools", "wasm", "wasi", "config.site-wasm32-wasi"),
    CC: join(sdkDir, "bin", "clang"),
    CPP: join(sdkDir, "bin", "clang-cpp"),
    CXX: join(sdkDir, "bin", "clang++"),
    AR: join(sdkDir, "bin", "llvm-ar"),
    RANLIB: join(sdkDir, "bin", "ranlib"),
    CFLAGS: lock.cflags,
    HOSTRUNNER: hostRunner,
    WASI_SDK_PATH: sdkDir,
    WASI_SYSROOT: sysroot,
    PKG_CONFIG_PATH: "",
    PKG_CONFIG_LIBDIR: `${join(sysroot, "lib", "pkgconfig")}:${join(sysroot, "share", "pkgconfig")}`,
    PKG_CONFIG_SYSROOT_DIR: sysroot,
  };
  run("../../configure", [
    `--host=${lock.target}`,
    `--build=${buildTriple}`,
    `--with-build-python=${join(nativeBuildDir, "python")}`,
    ...lock.configureArgs,
  ], { cwd: targetBuildDir, env: targetEnv });
  run("make", ["--jobs", String(availableParallelism()), "all"], { cwd: targetBuildDir, env: targetEnv });

  let scientificBuild = null;
  if (profileBuild.input.scientificPackages.length) {
    if (profileBuild.input.scientificPackages.length !== 1
      || profileBuild.input.scientificPackages[0].name !== "numpy") {
      throw new Error(`owned ${profileName} scientific package recipe is unsupported`);
    }
    scientificBuild = await buildOwnedNumpy({ workspace: join(workspace, "scientific", "numpy"),
      cacheDir: downloads, cpythonSource: sourceDir, targetBuildDir, sdkDir,
      hostPython: join(nativeBuildDir, "python") });
    run("make", ["--jobs", String(availableParallelism()), "python.wasm",
      `SYSLIBS=${numpyMakeSyslibs(scientificBuild.archive)}`], { cwd: targetBuildDir, env: targetEnv });
  }

  const oracle = run(wasmtime, ["run", "--wasm", "max-wasm-stack=16777216", "--dir", `${sourceDir}::/`,
    "--env", "PYTHONPATH=/Lib", join(targetBuildDir, "python.wasm"), "-c", profileBuild.input.oracle.code],
  { capture: true });
  if (oracle.trim() !== profileBuild.input.oracle.stdout) throw new Error(`owned ${profileName} oracle failed: ${oracle}`);
  if (scientificBuild) {
    const scientific = profileBuild.input.scientificPackages[0];
    const scientificOracle = run(wasmtime, ["run", "--wasm", "max-wasm-stack=16777216",
      "--dir", `${sourceDir}::/`, "--dir", `${scientificBuild.layer}::/numpy-site`,
      "--env", "PYTHONPATH=/numpy-site:/Lib", join(targetBuildDir, "python.wasm"), "-c", scientific.oracle.code],
    { capture: true });
    if (scientificOracle.trim() !== scientific.oracle.stdout) {
      throw new Error(`owned ${profileName} ${scientific.name} oracle failed: ${scientificOracle}`);
    }
  }
  const buildDetails = await ownedBuildDetailsArguments({ sourceDir, buildDir: targetBuildDir, target: lock.target });
  run(wasmtime, buildDetails.args);
  const packaged = await packageOwnedEngine({ sourceDir, buildDir: targetBuildDir, sdkDir, outDir,
    profileName, profileBuild, scientificBuild });
  console.log(`\nowned ${profileName} engine complete: ${JSON.stringify(packaged.outputs, null, 2)}`);
}

main().catch((error) => { console.error(error?.stack || String(error)); process.exitCode = 1; });
