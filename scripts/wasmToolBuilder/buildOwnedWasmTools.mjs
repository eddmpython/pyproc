#!/usr/bin/env node
// buildOwnedWasmTools.mjs - exact source, patch, toolchain, profile, and artifact gate.
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { OWNED_WASM_TOOLS } from "../../src/runtime/tools/ownedWasmTools.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PATCH = join(ROOT, "scripts", "wasmToolBuilder", "patches", "libgit2-1.9.7-wasi.patch");
const EXPECTED = Object.freeze({
  rg: Object.freeze({
    revision: "af60c2de9d85e7f3d81c78601669468cf02dabab",
    cargoLockSha256: "efc8f078eb02da18f454972e5d286b13660e1f2a58e3700f73abacad75e07004",
    rustcRelease: "1.97.1",
    rustcCommit: "8bab26f4f68e0e26f0bb7960be334d5b520ea452",
    cargoRelease: "1.97.1",
    target: "wasm32-wasip1",
  }),
  git: Object.freeze({
    revision: "49e408b3208bc3093757a1c2db938d3590f3f412",
    patchSha256: "530b48e6ce295643ed67ac257e23f79e3c2faac5452c4928122fc53048a5ba82",
    licenseSha256: "5ae5d094e490008c24e8af7aa59e9035ccae1724b3e76ba8158d7152569bf008",
    wasiSdkArchiveSha256: "df14ca2a2127c2d6b6be07e6f5549b3af9c1b3c0112430c200a4749970c59f06",
    wasiSdkClangRelease: "22.1.0",
    ninjaArchiveSha256: "07fc8261b42b20e71d1720b39068c2e14ffcee6396b76fb7a795fb460b78dc65",
    ninjaRelease: "1.13.2",
    cmakeRelease: "4.3.1",
  }),
});

function usage() {
  return `usage: node scripts/wasmToolBuilder/buildOwnedWasmTools.mjs [--check] [--command rg|git] [options]

--check verifies both committed binaries, or only --command when supplied.
An rg build requires --source-dir.
A git build requires --source-dir, --wasi-sdk-dir, --wasi-sdk-archive, --ninja, and --ninja-archive.
Both builds accept --out to replace the command-specific default artifact path.
`;
}

function options(argv) {
  const value = { check: false, command: null, sourceDir: null, out: null, wasiSdkDir: null,
    wasiSdkArchive: null, ninja: null, ninjaArchive: null };
  const paths = new Set(["--source-dir", "--out", "--wasi-sdk-dir", "--wasi-sdk-archive",
    "--ninja", "--ninja-archive"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") { process.stdout.write(usage()); process.exit(0); }
    if (arg === "--check") { value.check = true; continue; }
    if (arg === "--command") { value.command = argv[++index]; continue; }
    if (paths.has(arg)) {
      const field = { "--source-dir": "sourceDir", "--out": "out", "--wasi-sdk-dir": "wasiSdkDir",
        "--wasi-sdk-archive": "wasiSdkArchive", "--ninja": "ninja", "--ninja-archive": "ninjaArchive" }[arg];
      if (!argv[index + 1]) throw new TypeError(`${arg} requires a path`);
      value[field] = resolve(argv[++index]); continue;
    }
    throw new TypeError(`Unknown argument: ${arg}`);
  }
  if (value.command !== null && !["rg", "git"].includes(value.command)) {
    throw new TypeError(`Unsupported command: ${value.command}`);
  }
  if (!value.check) {
    value.command ||= "rg";
    if (!value.sourceDir) throw new TypeError("--source-dir is required for a build");
    if (value.command === "git" && (!value.wasiSdkDir || !value.wasiSdkArchive
      || !value.ninja || !value.ninjaArchive)) throw new TypeError("git build inputs are incomplete");
  }
  return value;
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result.stdout.trim();
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function toolFor(command) {
  const tool = OWNED_WASM_TOOLS.find((entry) => entry.command === command);
  if (!tool) throw new TypeError(`Unknown owned WASM tool: ${command}`);
  return tool;
}

function artifactPath(command) {
  return join(ROOT, "src", "runtime", "tools", "owned", `${command}.wasm`);
}

async function digest(path) { return sha256(await readFile(path)); }

async function verify(path, command) {
  const tool = toolFor(command);
  const bytes = await readFile(path);
  const actual = sha256(bytes);
  if (bytes.byteLength !== tool.byteLength || `sha256:${actual}` !== tool.binarySha256) {
    throw new Error(`${command}.wasm mismatch: bytes=${bytes.byteLength} sha256=${actual}`);
  }
  return { command, path, byteLength: bytes.byteLength, sha256: actual };
}

async function verifyProvenance(command) {
  const tool = toolFor(command);
  const provenancePath = join(ROOT, "src", "runtime", "tools", "owned",
    command === "git" ? "libgit2-1.9.7.provenance.json" : "ripgrep-15.1.0.provenance.json");
  const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
  if (provenance.command !== command || provenance.upstream?.commit !== tool.revision
    || provenance.artifact?.byteLength !== tool.byteLength
    || "sha256:" + provenance.artifact?.sha256 !== tool.binarySha256) {
    throw new Error(command + " provenance does not match the runtime catalog");
  }
  if (command === "git") {
    const build = provenance.build;
    const profile = build?.profile;
    if (provenance.implementation !== "libgit2-lg2"
      || provenance.upstream?.repository !== "https://github.com/libgit2/libgit2"
      || provenance.upstream?.tag !== "v1.9.7"
      || provenance.upstream?.license !== "GPL-2.0-only WITH LicenseRef-libgit2-linking-exception"
      || provenance.upstream?.licensePath !== "LICENSE.libgit2"
      || provenance.upstream?.licenseSha256 !== EXPECTED.git.licenseSha256
      || provenance.patch?.path !== "../../../../scripts/wasmToolBuilder/patches/libgit2-1.9.7-wasi.patch"
      || provenance.patch?.sha256 !== EXPECTED.git.patchSha256
      || build?.wasiSdk !== "33.0"
      || build?.wasiSdkArchive !== "wasi-sdk-33.0-x86_64-windows.tar.gz"
      || build?.wasiSdkArchiveSha256 !== EXPECTED.git.wasiSdkArchiveSha256
      || build?.clang !== "22.1.0 (4434dabb69916856b824f68a64b029c67175e532)"
      || build?.cmake !== EXPECTED.git.cmakeRelease
      || build?.ninja !== EXPECTED.git.ninjaRelease
      || build?.ninjaArchiveSha256 !== EXPECTED.git.ninjaArchiveSha256
      || build?.target !== "wasm32-wasip1"
      || profile?.cmakeBuildType !== "MinSizeRel" || profile?.sharedLibraries !== false
      || profile?.tests !== false || profile?.examples !== true || profile?.cli !== false
      || profile?.threads !== false || profile?.ssh !== false || profile?.https !== false
      || profile?.gssapi !== false || profile?.ntlm !== false || profile?.iconv !== false
      || profile?.bundledZlib !== true || profile?.regexBackend !== "builtin" || profile?.mmap !== false
      || profile?.reproducibleBuilds !== true
      || profile?.stackBytes !== 1048576 || profile?.filePrefixMap !== "/src/libgit2-1.9.7"
      || provenance.runtimeBoundary?.network !== false || provenance.runtimeBoundary?.childProcesses !== false
      || await digest(PATCH) !== EXPECTED.git.patchSha256
      || await digest(join(ROOT, "src", "runtime", "tools", "owned", "LICENSE.libgit2"))
        !== EXPECTED.git.licenseSha256) throw new Error("libgit2 provenance drifted");
  }
}

async function verifyArchive(path, expected, label) {
  const actual = await digest(path);
  if (actual !== expected) throw new Error(`${label} archive digest mismatch: ${actual}`);
}

function verifySource(sourceDir, revision) {
  const actual = run("git", ["rev-parse", "HEAD"], sourceDir);
  if (actual !== revision) throw new Error(`source revision mismatch: ${actual}`);
}

async function buildRipgrep(opts) {
  const expected = EXPECTED.rg;
  verifySource(opts.sourceDir, expected.revision);
  const lock = await readFile(join(opts.sourceDir, "Cargo.lock"));
  if (sha256(lock) !== expected.cargoLockSha256) throw new Error("Cargo.lock digest mismatch");
  const rustc = run("rustc", ["-Vv"], opts.sourceDir);
  if (!rustc.includes(`release: ${expected.rustcRelease}`) || !rustc.includes(`commit-hash: ${expected.rustcCommit}`)) {
    throw new Error("rustc version mismatch");
  }
  if (!run("cargo", ["-V"], opts.sourceDir).startsWith(`cargo ${expected.cargoRelease} `)) {
    throw new Error("cargo version mismatch");
  }
  if (!run("rustup", ["target", "list", "--installed"], opts.sourceDir).split(/\r?\n/u).includes(expected.target)) {
    throw new Error(`${expected.target} is not installed`);
  }
  const targetDir = await mkdtemp(join(tmpdir(), "pyproc-owned-rg-"));
  try {
    const env = { ...process.env, CARGO_TARGET_DIR: targetDir,
      CARGO_PROFILE_RELEASE_OPT_LEVEL: "z", CARGO_PROFILE_RELEASE_LTO: "true",
      CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "1", CARGO_PROFILE_RELEASE_STRIP: "symbols",
      CARGO_PROFILE_RELEASE_PANIC: "abort" };
    run("cargo", ["build", "--release", "--locked", "--target", expected.target, "--bin", "rg"],
      opts.sourceDir, env);
    const artifact = join(targetDir, expected.target, "release", "rg.wasm");
    await verify(artifact, "rg");
    const retained = join(tmpdir(), `pyproc-owned-rg-${Date.now()}.wasm`);
    await copyFile(artifact, retained);
    return retained;
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

async function buildGit(opts) {
  const expected = EXPECTED.git;
  verifySource(opts.sourceDir, expected.revision);
  if (await digest(PATCH) !== expected.patchSha256) throw new Error("libgit2 WASI patch digest mismatch");
  await verifyArchive(opts.wasiSdkArchive, expected.wasiSdkArchiveSha256, "WASI SDK");
  await verifyArchive(opts.ninjaArchive, expected.ninjaArchiveSha256, "Ninja");
  const clang = join(opts.wasiSdkDir, "bin", process.platform === "win32" ? "clang.exe" : "clang");
  if (!run(clang, ["--version"], opts.sourceDir).startsWith(`clang version ${expected.wasiSdkClangRelease} `)) {
    throw new Error("WASI SDK clang version mismatch");
  }
  if (run(opts.ninja, ["--version"], opts.sourceDir) !== expected.ninjaRelease) {
    throw new Error("Ninja version mismatch");
  }
  if (!run("cmake", ["--version"], opts.sourceDir).startsWith(`cmake version ${expected.cmakeRelease}`)) {
    throw new Error("CMake version mismatch");
  }
  const workspace = await mkdtemp(join(tmpdir(), "pyproc-owned-git-"));
  const source = join(workspace, "source");
  const build = join(workspace, "build");
  let worktreeAttached = false;
  try {
    run("git", ["worktree", "add", "--detach", source, expected.revision], opts.sourceDir);
    worktreeAttached = true;
    run("git", ["apply", "--check", PATCH], source);
    run("git", ["apply", PATCH], source);
    const sourceMap = source.replaceAll("\\", "/");
    run("cmake", ["-S", source, "-B", build, "-G", "Ninja",
      `-DCMAKE_MAKE_PROGRAM=${opts.ninja}`,
      `-DCMAKE_TOOLCHAIN_FILE=${join(opts.wasiSdkDir, "share", "cmake", "wasi-sdk.cmake")}`,
      "-DCMAKE_BUILD_TYPE=MinSizeRel",
      `-DCMAKE_C_FLAGS=-DNO_MMAP -ffile-prefix-map=${sourceMap}=/src/libgit2-1.9.7`,
      "-DCMAKE_EXE_LINKER_FLAGS=-Wl,-z,stack-size=1048576",
      "-DBUILD_SHARED_LIBS=OFF", "-DBUILD_TESTS=OFF", "-DBUILD_EXAMPLES=ON", "-DBUILD_CLI=OFF",
      "-DBUILD_FUZZERS=OFF", "-DUSE_THREADS=OFF", "-DUSE_SSH=OFF", "-DUSE_HTTPS=OFF",
      "-DUSE_GSSAPI=OFF", "-DUSE_NTLMCLIENT=OFF", "-DUSE_ICONV=OFF", "-DUSE_BUNDLED_ZLIB=ON",
      "-DREGEX_BACKEND=builtin", "-DENABLE_REPRODUCIBLE_BUILDS=ON"], opts.sourceDir);
    run("cmake", ["--build", build, "--target", "lg2"], opts.sourceDir);
    const artifact = join(build, "examples", "lg2");
    await verify(artifact, "git");
    const retained = join(tmpdir(), `pyproc-owned-git-${Date.now()}.wasm`);
    await copyFile(artifact, retained);
    return retained;
  } finally {
    if (worktreeAttached) run("git", ["worktree", "remove", "--force", source], opts.sourceDir);
    await rm(workspace, { recursive: true, force: true });
  }
}

async function main() {
  const opts = options(process.argv.slice(2));
  if (opts.check) {
    const commands = opts.command ? [opts.command] : OWNED_WASM_TOOLS.map((tool) => tool.command);
    const receipts = [];
    for (const command of commands) {
      await verifyProvenance(command);
      receipts.push(await verify(opts.out || artifactPath(command), command));
    }
    process.stdout.write(`${JSON.stringify(receipts)}\n`); return;
  }
  const built = opts.command === "git" ? await buildGit(opts) : await buildRipgrep(opts);
  const out = opts.out || artifactPath(opts.command);
  try {
    await verify(built, opts.command);
    await copyFile(built, out);
    process.stdout.write(`${JSON.stringify(await verify(out, opts.command))}\n`);
  } finally {
    await rm(built, { force: true });
  }
}

main().catch((error) => { console.error(error?.stack || String(error)); process.exit(1); });
