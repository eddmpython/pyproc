import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BUILDER = join(SCRIPT_DIR, "buildOwnedEngineWindowsProbe.mjs");
const VERIFIER = join(SCRIPT_DIR, "verifyOwnedEngine.mjs");

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

function child(args) {
  return new Promise((resolveChild, reject) => {
    const processChild = spawn(process.execPath, args, { stdio: "inherit" });
    processChild.once("error", reject);
    processChild.once("exit", (code) => code === 0 ? resolveChild() : reject(new Error(`child build exited ${code}`)));
  });
}

async function main() {
  if (process.platform !== "win32") throw new Error("Windows reproduction probe requires Windows");
  const root = option("--root");
  const inputCache = option("--input-cache");
  const profile = textOption("--profile", "core");
  if (existsSync(root)) throw new Error(`refusing to reuse reproduction root: ${root}`);
  await mkdir(root, { recursive: true });
  const slots = ["a", "b"];
  await Promise.all(slots.map((slot) => child([
    BUILDER,
    "--workspace", join(root, slot),
    "--out", join(root, slot, "dist"),
    "--input-cache", inputCache,
    "--profile", profile,
  ])));
  await child([
    VERIFIER,
    "--artifact-dir", join(root, "a", "dist"),
    "--compare", join(root, "b", "dist"),
    "--require-production-flags",
    "--profile", profile,
    "--receipt", join(root, "reproducibility-manifest.json"),
  ]);
}

main().catch((error) => { console.error(error?.stack || String(error)); process.exitCode = 1; });
