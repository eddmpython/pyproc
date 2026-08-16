#!/usr/bin/env node
// exact Git tree를 host 줄바꿈 설정과 분리해 registry와 같은 package tarball로 만든다.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..", "..");
const lock = JSON.parse(await readFile(join(scriptDir, "canonicalPackageLock.json"), "utf8"));

function parseArgs(argv) {
  if (argv.length !== 4 || argv[0] !== "--tree" || argv[2] !== "--out"
    || !argv[1] || !argv[3] || argv[1].startsWith("-")) {
    throw new TypeError("usage: buildCanonicalPackage.mjs --tree <commit-ish> --out <empty-directory>");
  }
  return Object.freeze({ treeish: argv[1], outputDir: resolve(argv[3]) });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const detail = options.capture ? String(result.stderr || result.stdout || "").trim() : "";
    throw new Error(`${command} ${args.join(" ")} failed(${result.status})${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

function runNpm(args, options = {}) {
  const npmCli = String(process.env.npm_execpath || "");
  if (!npmCli || !existsSync(npmCli)) throw new Error("npm_execpath is unavailable; use npm run package:reproduce");
  return run(process.execPath, [npmCli, ...args], options);
}

function output(command, args, options = {}) {
  const result = run(command, args, { ...options, capture: true });
  return `${String(result.stdout || "")}${String(result.stderr || "")}`.trim();
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function assertToolchain(nodeVersion, npmVersion) {
  if (nodeVersion !== `v${lock.toolchain.node}` || npmVersion !== lock.toolchain.npm) {
    throw new Error(`canonical package toolchain mismatch: ${nodeVersion}/${npmVersion}`);
  }
}

function assertKnownReproduction(manifest) {
  const known = lock.knownReproduction;
  if (manifest.source.commit !== known.commit) return;
  const actual = manifest.package;
  for (const key of ["filename", "byteLength", "sha256", "sha1", "integrity", "fileCount", "unpackedSize"]) {
    if (actual[key] !== known[key]) throw new Error(`known package reproduction mismatch: ${key}`);
  }
  if (manifest.source.tree !== known.tree || actual.version !== known.version) {
    throw new Error("known package source identity mismatch");
  }
}

export async function buildCanonicalPackage({ treeish, outputDir }) {
  const target = resolve(outputDir);
  if (target === root || target === resolve(root, ".cache")) throw new TypeError("unsafe package output directory");
  if (existsSync(target) && (await readdir(target)).length) throw new Error("package output directory must be empty");
  await mkdir(target, { recursive: true });

  const nodeVersion = process.version;
  const npmVersion = `${String(runNpm(["--version"], { capture: true }).stdout || "")}`.trim();
  assertToolchain(nodeVersion, npmVersion);
  const commit = output("git", ["rev-parse", "--verify", `${treeish}^{commit}`]);
  const tree = output("git", ["rev-parse", "--verify", `${commit}^{tree}`]);
  if (!/^[0-9a-f]{40}$/u.test(commit) || !/^[0-9a-f]{40}$/u.test(tree)) {
    throw new Error("canonical package source identity is invalid");
  }

  const workspace = await mkdtemp(join(tmpdir(), "pyproc-canonical-package-"));
  const archive = join(workspace, "source.tar");
  const source = join(workspace, "source");
  try {
    await mkdir(source);
    run("git", ["-c", "core.autocrlf=false", "archive", "--format=tar", `--output=${archive}`, commit]);
    run("tar", ["-xf", archive, "-C", source]);
    const packageJson = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    if (packageJson.name !== "pyproc" || !/^\d+\.\d+\.\d+$/u.test(packageJson.version || "")) {
      throw new Error("canonical package identity is invalid");
    }
    const packedResult = runNpm([
      "pack", source, "--ignore-scripts", "--pack-destination", target, "--json",
    ], { capture: true });
    const packed = JSON.parse(String(packedResult.stdout || "").trim());
    if (!Array.isArray(packed) || packed.length !== 1 || packed[0].name !== "pyproc"
      || packed[0].version !== packageJson.version || packed[0].entryCount !== packed[0].files?.length) {
      throw new Error("npm pack result is incomplete");
    }
    const result = packed[0];
    const tarball = join(target, result.filename);
    const manifest = {
      schemaVersion: 1,
      recipe: lock.recipe,
      source: { commit, tree },
      toolchain: {
        node: nodeVersion.slice(1),
        npm: npmVersion,
        gitCoreAutocrlf: false,
      },
      package: {
        name: result.name,
        version: result.version,
        filename: result.filename,
        byteLength: (await stat(tarball)).size,
        sha256: await sha256(tarball),
        sha1: result.shasum,
        integrity: result.integrity,
        fileCount: result.entryCount,
        unpackedSize: result.unpackedSize,
        files: result.files.map(({ path, size, mode }) => ({ path, size, mode })),
      },
    };
    assertKnownReproduction(manifest);
    await writeFile(join(target, "canonical-package-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return Object.freeze(manifest);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const manifest = await buildCanonicalPackage(options);
  const { files: _files, ...packageSummary } = manifest.package;
  console.log(JSON.stringify({ ...manifest, package: packageSummary }, null, 2));
}
