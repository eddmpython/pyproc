#!/usr/bin/env node
// buildOwnedWasmTools.mjs - exact source, lock, toolchain, target, profile, and artifact gate.
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { OWNED_WASM_TOOLS } from "../../src/runtime/tools/ownedWasmTools.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXPECTED = Object.freeze({
  revision: "af60c2de9d85e7f3d81c78601669468cf02dabab",
  cargoLockSha256: "efc8f078eb02da18f454972e5d286b13660e1f2a58e3700f73abacad75e07004",
  rustcRelease: "1.97.1",
  rustcCommit: "8bab26f4f68e0e26f0bb7960be334d5b520ea452",
  cargoRelease: "1.97.1",
  target: "wasm32-wasip1",
});

function usage() {
  return `usage: node scripts/wasmToolBuilder/buildOwnedWasmTools.mjs [--check] [--source-dir path] [--out path]

--check verifies the committed binary only. A build requires an exact ripgrep checkout at --source-dir.
`;
}

function options(argv) {
  const value = { check: false, sourceDir: null,
    out: join(ROOT, "src", "runtime", "tools", "owned", "rg.wasm") };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") { process.stdout.write(usage()); process.exit(0); }
    if (arg === "--check") { value.check = true; continue; }
    if (arg === "--source-dir") { value.sourceDir = resolve(argv[++index]); continue; }
    if (arg === "--out") { value.out = resolve(argv[++index]); continue; }
    throw new TypeError(`Unknown argument: ${arg}`);
  }
  if (!value.check && !value.sourceDir) throw new TypeError("--source-dir is required for a build");
  return value;
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result.stdout.trim();
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

async function verify(path) {
  const tool = OWNED_WASM_TOOLS.find((entry) => entry.command === "rg");
  const bytes = await readFile(path);
  const actual = sha256(bytes);
  if (bytes.byteLength !== tool.byteLength || `sha256:${actual}` !== tool.binarySha256) {
    throw new Error(`rg.wasm mismatch: bytes=${bytes.byteLength} sha256=${actual}`);
  }
  return { path, byteLength: bytes.byteLength, sha256: actual };
}

async function main() {
  const opts = options(process.argv.slice(2));
  if (opts.check) {
    process.stdout.write(`${JSON.stringify(await verify(opts.out))}\n`);
    return;
  }
  const revision = run("git", ["rev-parse", "HEAD"], opts.sourceDir);
  if (revision !== EXPECTED.revision) throw new Error(`source revision mismatch: ${revision}`);
  const lock = await readFile(join(opts.sourceDir, "Cargo.lock"));
  if (sha256(lock) !== EXPECTED.cargoLockSha256) throw new Error("Cargo.lock digest mismatch");
  const rustc = run("rustc", ["-Vv"], opts.sourceDir);
  if (!rustc.includes(`release: ${EXPECTED.rustcRelease}`) || !rustc.includes(`commit-hash: ${EXPECTED.rustcCommit}`)) {
    throw new Error("rustc version mismatch");
  }
  if (!run("cargo", ["-V"], opts.sourceDir).startsWith(`cargo ${EXPECTED.cargoRelease} `)) {
    throw new Error("cargo version mismatch");
  }
  if (!run("rustup", ["target", "list", "--installed"], opts.sourceDir).split(/\r?\n/u).includes(EXPECTED.target)) {
    throw new Error(`${EXPECTED.target} is not installed`);
  }
  const targetDir = await mkdtemp(join(tmpdir(), "pyproc-owned-wasm-tools-"));
  try {
    const env = { ...process.env, CARGO_TARGET_DIR: targetDir,
      CARGO_PROFILE_RELEASE_OPT_LEVEL: "z", CARGO_PROFILE_RELEASE_LTO: "true",
      CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "1", CARGO_PROFILE_RELEASE_STRIP: "symbols",
      CARGO_PROFILE_RELEASE_PANIC: "abort" };
    run("cargo", ["build", "--release", "--locked", "--target", EXPECTED.target, "--bin", "rg"], opts.sourceDir, env);
    await copyFile(join(targetDir, EXPECTED.target, "release", "rg.wasm"), opts.out);
    process.stdout.write(`${JSON.stringify(await verify(opts.out))}\n`);
  } finally {
    await rm(targetDir, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error?.stack || String(error)); process.exit(1); });
