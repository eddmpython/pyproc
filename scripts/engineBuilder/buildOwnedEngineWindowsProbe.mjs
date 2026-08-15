import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { packageOwnedEngine } from "./packageOwnedEngine.mjs";
import { nativeProfileBuildInput } from "./nativeProfileCompiler.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const LOCK = JSON.parse(await readFile(join(SCRIPT_DIR, "engineBuildLock.json"), "utf8"));

function option(name, required = true) {
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

function bashPath(path) {
  const normalized = resolve(path).replaceAll("\\", "/");
  return `/${normalized[0].toLowerCase()}${normalized.slice(2)}`;
}

function run(command, args, options = {}) {
  console.log(`\n> ${basename(command)} ${args.join(" ")}`);
  const result = spawnSync(command, args, { encoding: "utf8", stdio: options.capture ? "pipe" : "inherit", ...options });
  if (result.status !== 0 && !options.allowedExitCodes?.includes(result.status)) {
    throw new Error(`${command} failed with exit ${result.status}${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  }
  return options.capture ? result.stdout.trim() : result.status;
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function ensureInput(cacheDir, name, descriptor) {
  const path = join(cacheDir, name);
  if (!existsSync(path)) {
    const partial = `${path}.partial`;
    const response = await fetch(descriptor.url, { redirect: "follow", headers: { "User-Agent": "pyproc-owned-engine-windows-probe/1" } });
    if (!response.ok || !response.body) throw new Error(`download failed ${response.status}: ${descriptor.url}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: "wx" }));
    await rename(partial, path);
  }
  const actual = await sha256File(path);
  if (actual !== descriptor.archiveSha256) throw new Error(`input digest mismatch for ${name}: ${actual}`);
  return path;
}

export function patchWindowsMakefile(makefile) {
  const replacements = [
    ['MULTIARCH_CPPFLAGS = -DMULTIARCH=\\"wasm32-wasi\\"', 'MULTIARCH_CPPFLAGS = -DMULTIARCH=\\\\\\"wasm32-wasi\\\\\\"'],
    ['-DPYTHONPATH=\'"$(PYTHONPATH)"\'', '-DPYTHONPATH=\\\\\\"$(PYTHONPATH)\\\\\\"'],
    ['-DPREFIX=\'"$(host_prefix)"\'', '-DPREFIX=\\\\\\"$(host_prefix)\\\\\\"'],
    ['-DEXEC_PREFIX=\'"$(host_exec_prefix)"\'', '-DEXEC_PREFIX=\\\\\\"$(host_exec_prefix)\\\\\\"'],
    ['-DVERSION=\'"$(VERSION)"\'', '-DVERSION=\\\\\\"$(VERSION)\\\\\\"'],
    ['-DVPATH=\'"$(VPATH)"\'', '-DVPATH=\\\\\\"$(VPATH)\\\\\\"'],
    ['-DPLATLIBDIR=\'"$(PLATLIBDIR)"\'', '-DPLATLIBDIR=\\\\\\"$(PLATLIBDIR)\\\\\\"'],
    ['-DPYTHONFRAMEWORK=\'"$(PYTHONFRAMEWORK)"\'', '-DPYTHONFRAMEWORK=\\\\\\"$(PYTHONFRAMEWORK)\\\\\\"'],
    ['-DSOABI=\'"$(SOABI)"\'', '-DSOABI=\\\\\\"$(SOABI)\\\\\\"'],
    ['-DSHLIB_EXT=\'"$(EXT_SUFFIX)"\'', '-DSHLIB_EXT=\\\\\\"$(EXT_SUFFIX)\\\\\\"'],
    ['-DABIFLAGS=\'"$(ABIFLAGS)"\'', '-DABIFLAGS=\\\\\\"$(ABIFLAGS)\\\\\\"'],
    ['-DPLATFORM=\'"$(MACHDEP)"\'', '-DPLATFORM=\\\\\\"$(MACHDEP)\\\\\\"'],
  ];
  let patched = makefile;
  for (const [before, after] of replacements) {
    const first = patched.indexOf(before);
    if (first < 0 || patched.indexOf(before, first + before.length) >= 0) throw new Error(`Windows make patch anchor mismatch: ${before}`);
    patched = patched.replace(before, after);
  }
  return patched;
}

async function main() {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Windows probe builder requires Windows x64");
  const workspace = option("--workspace");
  const outDir = option("--out");
  const cacheDir = option("--input-cache");
  const profileName = textOption("--profile", "core");
  const profileBuild = await nativeProfileBuildInput(profileName);
  if (existsSync(workspace)) throw new Error(`refusing to reuse Windows probe workspace: ${workspace}`);
  if (/\s/u.test(workspace)) throw new Error("Windows probe workspace must not contain whitespace");
  await mkdir(workspace, { recursive: true });
  await mkdir(cacheDir, { recursive: true });

  const inputs = {
    source: await ensureInput(cacheDir, "cpython.tar.gz", LOCK.cpython),
    sdk: await ensureInput(cacheDir, "wasi-sdk-windows.tar.gz", LOCK.wasiSdk.windowsX8664),
    wasmtime: await ensureInput(cacheDir, "wasmtime-windows.zip", LOCK.wasmtime.windowsX8664),
    hostPython: await ensureInput(cacheDir, "python-embed.zip", LOCK.windowsProbeTools.hostPython),
    make: await ensureInput(cacheDir, "make.pkg.tar.zst", LOCK.windowsProbeTools.make),
    gettext: await ensureInput(cacheDir, "gettext.pkg.tar.zst", LOCK.windowsProbeTools.gettextRuntime),
    libiconv: await ensureInput(cacheDir, "libiconv.pkg.tar.zst", LOCK.windowsProbeTools.libiconv),
  };
  const sourceDir = join(workspace, "cpython");
  const sdkDir = join(workspace, "wasi-sdk");
  const hostPythonDir = join(workspace, "host-python");
  const toolsDir = join(workspace, "tools");
  const toolBin = join(toolsDir, "bin");
  await Promise.all([sourceDir, sdkDir, hostPythonDir, toolsDir, toolBin].map((path) => mkdir(path, { recursive: true })));
  run("tar", ["-xf", inputs.source, "-C", sourceDir, "--strip-components=1", "--exclude=*/Misc/mypy/*"]);
  run("tar", ["-xf", inputs.sdk, "-C", sdkDir, "--strip-components=1"]);
  run("tar", ["-xf", inputs.hostPython, "-C", hostPythonDir]);
  run("tar", ["-xf", inputs.wasmtime, "-C", toolsDir, "--strip-components=1"]);
  const packageRoot = join(workspace, "tool-packages");
  await mkdir(packageRoot, { recursive: true });
  for (const path of [inputs.make, inputs.gettext, inputs.libiconv]) run("tar", ["-xf", path, "-C", packageRoot]);
  await copyFile(join(packageRoot, "mingw64", "bin", "mingw32-make.exe"), join(toolBin, "make.exe"));
  await copyFile(join(packageRoot, "mingw64", "bin", "libintl-8.dll"), join(toolBin, "libintl-8.dll"));
  await copyFile(join(packageRoot, "mingw64", "bin", "libiconv-2.dll"), join(toolBin, "libiconv-2.dll"));
  await copyFile(join(toolsDir, "wasmtime.exe"), join(toolBin, "wasmtime.exe"));
  for (const module of profileBuild.input.recipe.modules) {
    await copyFile(join(SCRIPT_DIR, module.source), join(sourceDir, "Modules", module.source));
  }
  await writeFile(join(hostPythonDir, "python314._pth"), `${sourceDir}\\Lib\npython314.zip\n.\n`);

  const buildDir = join(sourceDir, "cross-build", LOCK.target);
  await mkdir(join(buildDir, "Modules"), { recursive: true });
  await copyFile(join(SCRIPT_DIR, profileBuild.input.recipe.setupFile), join(buildDir, "Modules", "Setup.local"));
  const gitBash = process.env.PYPROC_GIT_BASH || "C:\\Program Files\\Git\\bin\\bash.exe";
  if (!existsSync(gitBash)) throw new Error(`Git Bash was not found: ${gitBash}`);
  const sourceBash = bashPath(sourceDir);
  const buildBash = bashPath(buildDir);
  const sdkBash = bashPath(sdkDir);
  const hostPythonPosix = `${hostPythonDir.replaceAll("\\", "/")}/python.exe`;
  const baseEnv = {
    ...process.env,
    PATH: `${toolBin};${join(sdkDir, "bin")};${process.env.PATH}`,
    SOURCE_DATE_EPOCH: String(LOCK.sourceDateEpoch),
  };
  const configure = [
    "set -euo pipefail",
    `cd ${buildBash}`,
    `export SOURCE_DATE_EPOCH=${LOCK.sourceDateEpoch}`,
    `export CONFIG_SITE=${sourceBash}/Tools/wasm/wasi/config.site-wasm32-wasi`,
    `export CC=${sdkBash}/bin/clang.exe CPP=${sdkBash}/bin/clang-cpp.exe CXX=${sdkBash}/bin/clang++.exe`,
    `export AR=${sdkBash}/bin/llvm-ar.exe RANLIB=${sdkBash}/bin/ranlib.exe`,
    `export WASI_SDK_PATH=${sdkDir.replaceAll("\\", "/")} WASI_SYSROOT=${sdkDir.replaceAll("\\", "/")}/share/wasi-sysroot`,
    `export PKG_CONFIG_PATH= PKG_CONFIG_LIBDIR=${sdkDir.replaceAll("\\", "/")}/share/wasi-sysroot/lib/pkgconfig`,
    `export PKG_CONFIG_SYSROOT_DIR=${sdkDir.replaceAll("\\", "/")}/share/wasi-sysroot HOSTRUNNER=true`,
    `export CFLAGS='${LOCK.cflags}'`,
    `../../configure --host=${LOCK.target} --build=x86_64-pc-mingw64 --with-build-python=${hostPythonPosix} ${LOCK.configureArgs.join(" ")}`,
  ].join("; ");
  run(gitBash, ["-lc", configure], { env: baseEnv });
  const makefilePath = join(buildDir, "Makefile");
  await writeFile(makefilePath, patchWindowsMakefile(await readFile(makefilePath, "utf8")));
  const makeCommand = `set -euo pipefail; cd ${buildBash}; export SOURCE_DATE_EPOCH=${LOCK.sourceDateEpoch}; make --jobs ${availableParallelism()} python.wasm`;
  run(gitBash, ["-lc", makeCommand], { env: baseEnv });

  const wasmtimeOutput = run(join(toolBin, "wasmtime.exe"), [
    "run", "--wasm", "max-wasm-stack=16777216", "--dir", `${sourceDir}::/`,
    "--env", "PYTHONPATH=/Lib",
    join(buildDir, "python.wasm"), "-c",
    profileBuild.input.oracle.code,
  ], { capture: true });
  if (wasmtimeOutput.trim() !== profileBuild.input.oracle.stdout) {
    throw new Error(`owned Windows ${profileName} probe oracle failed: ${wasmtimeOutput}`);
  }
  const result = await packageOwnedEngine({ sourceDir, buildDir, sdkDir, outDir, profileName, profileBuild });
  console.log(JSON.stringify({ profile: profileName, oracle: wasmtimeOutput, outputs: result.outputs }, null, 2));
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error?.stack || String(error)); process.exitCode = 1; });
}
