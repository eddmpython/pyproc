#!/usr/bin/env node
// buildPythonDistributions.mjs - exact commit 하나에서 Python 배포 자산 전부를 만든다: source distribution,
// 순수 wheel, 그리고 같은 commit의 canonical npm package와 고정 Node runtime을 싣는 platform wheel.
// platform wheel은 commit과 lock만의 함수라 어느 build host에서 만들어도 byte가 같다.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { unzipWheel } from "../../src/runtime/engines/wasi/wheelUnzip.js";
import { buildCanonicalPackage } from "../packageBuilder/buildCanonicalPackage.mjs";
import { assembleHostWheel } from "./assembleHostWheel.mjs";
import { extractNativeHost, extractNodeRuntime, fetchNativeHost, fetchNodeArchive, readPackageTree }
  from "./hostPayload.mjs";
import { nativeHostSourceTree } from "../nativeHostBuilder/buildNativeHost.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..", "..");
const lock = JSON.parse(await readFile(join(scriptDir, "pythonDistributionLock.json"), "utf8"));
const PYTHON = process.env.PYPROC_PYTHON || "python";

function parseArgs(argv) {
  if (argv.length !== 4 || argv[0] !== "--tree" || argv[2] !== "--out"
    || !argv[1] || !argv[3] || argv[1].startsWith("-")) {
    throw new TypeError("usage: buildPythonDistributions.mjs --tree <commit-ish> --out <empty-directory>");
  }
  return Object.freeze({ treeish: argv[1], outputDir: resolve(argv[3]) });
}

function run(command, args, { cwd = root, env = process.env } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed(${result.status})\n${String(result.stderr || result.stdout).trim()}`);
  }
  return String(result.stdout || "").trim();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function describe(path, kind, platform = null) {
  const bytes = await readFile(path);
  return { filename: path.split(/[\\/]/u).at(-1), kind, platform, byteLength: bytes.byteLength, sha256: sha256(bytes) };
}

export async function buildPythonDistributions({ treeish, outputDir }) {
  const target = resolve(outputDir);
  if (target === root || target === resolve(root, ".cache")) throw new TypeError("unsafe distribution output directory");
  if (existsSync(target) && (await readdir(target)).length) throw new Error("distribution output directory must be empty");
  await mkdir(target, { recursive: true });

  const commit = run("git", ["rev-parse", "--verify", `${treeish}^{commit}`]);
  const tree = run("git", ["rev-parse", "--verify", `${commit}^{tree}`]);
  const sourceDateEpoch = Number(run("git", ["show", "-s", "--format=%ct", commit]));
  if (!/^[0-9a-f]{40}$/u.test(commit) || !/^[0-9a-f]{40}$/u.test(tree) || !Number.isSafeInteger(sourceDateEpoch)) {
    throw new Error("Python distribution source identity is invalid");
  }

  // A host built from other source than this commit's must never ride in its wheel.
  const nativeHosts = [];
  for (const [component, pinned] of Object.entries(lock.nativeHosts.components)) {
    const hostTree = nativeHostSourceTree(component, commit);
    if (hostTree !== pinned.sourceTree) {
      throw new Error(`the ${component} source at ${commit} is tree ${hostTree}, but the lock pins ${pinned.sourceTree}; `
        + "build and pin that host first (skills/ship-pyproc/references/release.md)");
    }
    nativeHosts.push(await extractNativeHost(component,
      await fetchNativeHost(component, pinned, join(root, ".cache", "native-hosts")), pinned));
  }

  const workspace = await mkdtemp(join(tmpdir(), "pyproc-python-distributions-"));
  try {
    run("git", ["-c", "core.autocrlf=false", "archive", "--format=tar", `--output=${join(workspace, "source.tar")}`,
      commit, "pythonSdk"]);
    run("tar", ["-xf", "source.tar"], { cwd: workspace });
    await mkdir(join(workspace, "dist"));
    run(PYTHON, ["-m", "build", join(workspace, "pythonSdk"), "--outdir", join(workspace, "dist")],
      { cwd: workspace, env: { ...process.env, SOURCE_DATE_EPOCH: String(sourceDateEpoch) } });
    const built = (await readdir(join(workspace, "dist"))).sort();
    const pureName = built.find((name) => name.endsWith("-py3-none-any.whl"));
    const sdistName = built.find((name) => name.endsWith(".tar.gz"));
    if (built.length !== 2 || !pureName || !sdistName) throw new Error(`unexpected Python build output: ${built.join(",")}`);
    const pureWheel = { filename: pureName, files: await unzipWheel(await readFile(join(workspace, "dist", pureName))) };

    const npmManifest = await buildCanonicalPackage({ treeish: commit, outputDir: join(workspace, "npm") });
    const { name, version, filename, sha256: packageSha256, integrity } = npmManifest.package;
    const packageFiles = await readPackageTree(await readFile(join(workspace, "npm", filename)));
    if (packageFiles.length !== npmManifest.package.fileCount) {
      throw new Error(`npm package tree holds ${packageFiles.length} files, manifest says ${npmManifest.package.fileCount}`);
    }

    const distributions = [];
    for (const file of [sdistName, pureName]) {
      await copyFile(join(workspace, "dist", file), join(target, file));
      distributions.push(await describe(join(target, file), file === sdistName ? "sdist" : "wheel"));
    }
    for (const platform of Object.keys(lock.hostNode.platforms)) {
      const archive = await fetchNodeArchive(lock.hostNode, platform, join(root, ".cache", "node-dist"));
      const wheel = assembleHostWheel({
        platform,
        pureWheel,
        packageFiles,
        packageIdentity: { name, version, filename, sha256: packageSha256, integrity },
        nodeRuntime: await extractNodeRuntime(archive, lock.hostNode, platform),
        nativeHosts: platform === "win_amd64" ? nativeHosts : [],
        sourceDateEpoch,
      });
      await writeFile(join(target, wheel.filename), wheel.bytes);
      distributions.push(await describe(join(target, wheel.filename), "hostWheel", platform));
    }
    const manifest = {
      schemaVersion: 1,
      recipe: lock.recipe,
      source: { commit, tree, sourceDateEpoch },
      hostPackage: { name, version, filename, sha256: packageSha256, integrity },
      hostNode: { version: lock.hostNode.version },
      nativeHosts: Object.fromEntries(nativeHosts.map((host) =>
        [host.component, { sourceTree: host.sourceTree, archiveSha256: host.archiveSha256 }])),
      distributions,
    };
    await writeFile(join(target, "python-distributions-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return Object.freeze(manifest);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await buildPythonDistributions(parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(manifest, null, 2));
}
