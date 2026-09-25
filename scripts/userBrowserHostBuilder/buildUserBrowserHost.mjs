#!/usr/bin/env node
// buildUserBrowserHost.mjs - the user-browser native host of one exact Git tree, built with the Rust toolchain the
// Python distribution lock pins. Source paths are remapped, the PE timestamp is fixed (/Brepro), and the PDB is named
// without its folder, so two builds on the same runner image give the same bytes. The output is one deterministic zip
// (the host, its third-party notices, its identity) that a project release publishes and the win_amd64 platform wheel
// carries, pinned by SHA-256 in the lock. `verify` checks that two independent builds are byte-identical.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeterministicZip } from "../engineBuilder/deterministicZip.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const USER_BROWSER_HOST_SOURCE = "scripts/browserControl/userBrowser/nativeHost";
export const USER_BROWSER_HOST_FILE = "pyproc-user-browser-host.exe";
export const USER_BROWSER_HOST_NOTICES = "THIRD-PARTY-NOTICES.txt";
export const USER_BROWSER_HOST_IDENTITY = "userBrowserHost.json";
const LICENSE_FILE = /^(licen[cs]e|copying|copyright|notice)/iu;
// The Rust standard library's own notices, shipped by the toolchain's rustc component.
const STD_NOTICES = ["share/doc/rust/COPYRIGHT-library.html", "share/doc/rust/licenses/MIT.txt",
  "share/doc/rust/licenses/Apache-2.0.txt"];

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

function lineFeeds(text) {
  return text.replaceAll("\r\n", "\n");
}

/** The Git tree id of the host source at `commit`: the one identity of what a prebuilt host was built from. */
export function userBrowserHostSourceTree(commit, cwd = root) {
  return run("git", ["rev-parse", "--verify", `${commit}:${USER_BROWSER_HOST_SOURCE}`], { cwd });
}

export function userBrowserHostArchiveName(sourceTree) {
  if (!/^[0-9a-f]{40}$/u.test(sourceTree)) throw new TypeError(`not a Git tree id: ${sourceTree}`);
  return `pyproc-user-browser-host-${sourceTree.slice(0, 12)}.zip`;
}

async function readLock() {
  const lock = JSON.parse(await readFile(join(root, "scripts/pythonSdkBuilder/pythonDistributionLock.json"), "utf8"));
  const host = lock.userBrowserHost;
  if (!host || !/^\d+\.\d+\.\d+$/u.test(host.toolchain) || host.target !== "x86_64-pc-windows-msvc") {
    throw new Error("the Python distribution lock pins no user-browser host toolchain");
  }
  return host;
}

// The crates the host links: every normal dependency reachable from the host for the target, with their license
// files as each crate ships them.
async function crateNotices(toolchain, target, manifestPath) {
  const metadata = JSON.parse(run("cargo", [`+${toolchain}`, "metadata", "--format-version", "1", "--locked",
    "--filter-platform", target, "--manifest-path", manifestPath]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const packages = new Map(metadata.packages.map((entry) => [entry.id, entry]));
  const linked = new Set();
  const pending = [metadata.resolve.root];
  while (pending.length) {
    for (const dep of nodes.get(pending.pop())?.deps || []) {
      if (!dep.dep_kinds.some((kind) => kind.kind === null) || linked.has(dep.pkg)) continue;
      linked.add(dep.pkg);
      pending.push(dep.pkg);
    }
  }
  const sections = [];
  for (const entry of [...linked].map((id) => packages.get(id))
    .sort((left, right) => `${left.name} ${left.version}`.localeCompare(`${right.name} ${right.version}`))) {
    const directory = dirname(entry.manifest_path);
    const files = (await readdir(directory)).filter((name) => LICENSE_FILE.test(name)).sort();
    if (!files.length) throw new Error(`${entry.name} ${entry.version} ships no license file`);
    const texts = await Promise.all(files.map(async (name) =>
      `--- ${name}\n${lineFeeds(await readFile(join(directory, name), "utf8")).trimEnd()}\n`));
    sections.push(`== ${entry.name} ${entry.version} (${entry.license || "see files"}) ${entry.repository || ""}\n\n${
      texts.join("\n")}`);
  }
  return sections;
}

async function stdNotices(toolchain) {
  const sysroot = run("rustc", [`+${toolchain}`, "--print", "sysroot"]);
  const texts = await Promise.all(STD_NOTICES.map(async (path) =>
    `--- ${path.split("/").at(-1)}\n${lineFeeds(await readFile(join(sysroot, path), "utf8")).trimEnd()}\n`));
  return `== Rust standard library ${toolchain} (MIT OR Apache-2.0) https://github.com/rust-lang/rust\n\n${texts.join("\n")}`;
}

/** Build the host of `treeish` into `outputDir`: the release zip and its identity beside it. */
export async function buildUserBrowserHost({ treeish, outputDir }) {
  if (process.platform !== "win32") throw new Error("the user-browser native host builds only on Windows");
  const target = resolve(outputDir);
  if (existsSync(target) && (await readdir(target)).length) throw new Error("host output directory must be empty");
  await mkdir(target, { recursive: true });
  const { toolchain, target: rustTarget } = await readLock();
  const rustc = run("rustc", [`+${toolchain}`, "--version"]);
  if (!rustc.startsWith(`rustc ${toolchain} `)) throw new Error(`toolchain ${toolchain} is not installed (${rustc})`);
  const commit = run("git", ["rev-parse", "--verify", `${treeish}^{commit}`]);
  const sourceDateEpoch = Number(run("git", ["show", "-s", "--format=%ct", commit]));
  const sourceTree = userBrowserHostSourceTree(commit);

  const workspace = await mkdtemp(join(tmpdir(), "pyproc-user-browser-host-"));
  try {
    run("git", ["-c", "core.autocrlf=false", "archive", "--format=tar", `--output=${join(workspace, "source.tar")}`,
      commit, USER_BROWSER_HOST_SOURCE]);
    run("tar", ["-xf", "source.tar"], { cwd: workspace });
    const source = join(workspace, ...USER_BROWSER_HOST_SOURCE.split("/"));
    const cargoHome = process.env.CARGO_HOME || join(homedir(), ".cargo");
    const flags = [`--remap-path-prefix=${source}=pyproc-user-browser-host`, `--remap-path-prefix=${cargoHome}=cargo`,
      "-Clink-arg=/Brepro", "-Clink-arg=/PDBALTPATH:%_PDB%"];
    const manifestPath = join(source, "Cargo.toml");
    run("cargo", [`+${toolchain}`, "build", "--release", "--locked", "--target", rustTarget, "--manifest-path",
      manifestPath, "--target-dir", join(workspace, "target")],
    { cwd: source, env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: flags.join("\x1f") } });
    const host = await readFile(join(workspace, "target", rustTarget, "release", USER_BROWSER_HOST_FILE));
    const notices = Buffer.from(`pyproc-user-browser-host bundles the Rust standard library and the crates below, each
under the license it states.\n\n${[await stdNotices(toolchain), ...await crateNotices(toolchain, rustTarget,
  manifestPath)].join("\n\n")}`);
    const identity = { schemaVersion: 1, commit, sourceTree, toolchain: { rustc, target: rustTarget },
      host: { file: USER_BROWSER_HOST_FILE, byteLength: host.byteLength, sha256: sha256(host) },
      notices: { file: USER_BROWSER_HOST_NOTICES, sha256: sha256(notices) } };
    const archive = createDeterministicZip([
      { path: USER_BROWSER_HOST_FILE, bytes: host, mode: 0o755 },
      { path: USER_BROWSER_HOST_NOTICES, bytes: notices },
      { path: USER_BROWSER_HOST_IDENTITY, bytes: Buffer.from(`${JSON.stringify(identity, null, 2)}\n`) },
    ], sourceDateEpoch);
    const archiveName = userBrowserHostArchiveName(sourceTree);
    await writeFile(join(target, archiveName), archive);
    const receipt = { ...identity, archive: { file: archiveName, byteLength: archive.byteLength, sha256: sha256(archive) } };
    await writeFile(join(target, USER_BROWSER_HOST_IDENTITY), `${JSON.stringify(receipt, null, 2)}\n`);
    return Object.freeze(receipt);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

/** Two independent builds agree byte for byte, archive and identity. */
export async function verifyUserBrowserHostBuilds({ left, right }) {
  const [leftReceipt, rightReceipt] = await Promise.all([left, right].map(async (directory) =>
    JSON.parse(await readFile(join(directory, USER_BROWSER_HOST_IDENTITY), "utf8"))));
  const [leftArchive, rightArchive] = await Promise.all([[left, leftReceipt], [right, rightReceipt]].map(
    async ([directory, receipt]) => readFile(join(directory, receipt.archive.file))));
  if (JSON.stringify(leftReceipt) !== JSON.stringify(rightReceipt) || !leftArchive.equals(rightArchive)
    || sha256(leftArchive) !== leftReceipt.archive.sha256) {
    throw new Error(`user-browser host builds differ: ${leftReceipt.archive.sha256} vs ${rightReceipt.archive.sha256}`);
  }
  return Object.freeze(leftReceipt);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    if (!rest[index]?.startsWith("--") || !rest[index + 1]) throw new TypeError(`bad argument ${rest[index]}`);
    options[rest[index].slice(2)] = rest[index + 1];
  }
  if (command === "build" && options.tree && options.out && Object.keys(options).length === 2) {
    return { command, treeish: options.tree, outputDir: options.out };
  }
  if (command === "verify" && options.left && options.right && Object.keys(options).length === 2) {
    return { command, left: resolve(options.left), right: resolve(options.right) };
  }
  throw new TypeError("usage: buildUserBrowserHost.mjs build --tree <commit-ish> --out <empty-directory>\n"
    + "       buildUserBrowserHost.mjs verify --left <build> --right <build>");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const receipt = options.command === "build" ? await buildUserBrowserHost(options) : await verifyUserBrowserHostBuilds(options);
  console.log(JSON.stringify(receipt, null, 2));
}
