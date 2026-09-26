#!/usr/bin/env node
// buildNativeHost.mjs - one of pyproc's Windows native hosts from one exact Git tree, built with the Rust toolchain the
// Python distribution lock pins. Source paths are remapped, the PE timestamp is fixed (/Brepro), and the PDB is named
// without its folder, so two builds on the same runner image give the same bytes. The output is one deterministic zip
// per host (the executable, its third-party notices, its identity) that a project release publishes and the win_amd64
// platform wheel carries, pinned by SHA-256 in the lock. `verify` checks that two independent builds are byte-identical.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeterministicZip } from "../engineBuilder/deterministicZip.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Each native host: its crate, the executable it builds, and the name its archives and releases carry.
export const NATIVE_HOSTS = Object.freeze({
  // The native messaging host the user's own browser starts for the User Browser extension.
  userBrowserHost: Object.freeze({ source: "scripts/browserControl/userBrowser/nativeHost",
    file: "pyproc-user-browser-host.exe", name: "pyproc-user-browser-host" }),
  // The helper that starts a launched browser on a desktop of its own, away from the user's foreground.
  browserDesktop: Object.freeze({ source: "scripts/browserControl/browserDesktop/nativeHelper",
    file: "pyproc-browser-desktop.exe", name: "pyproc-browser-desktop" }),
});
export const NATIVE_HOST_NOTICES = "THIRD-PARTY-NOTICES.txt";
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

function nativeHost(component) {
  const host = Object.hasOwn(NATIVE_HOSTS, component) ? NATIVE_HOSTS[component] : null;
  if (!host) throw new TypeError(`not a native host: ${component} (one of ${Object.keys(NATIVE_HOSTS).join(", ")})`);
  return host;
}

/** The identity file a host's archive and build directory carry (`<component>.json`). */
export function nativeHostIdentityFile(component) {
  nativeHost(component);
  return `${component}.json`;
}

/** The Git tree id of a host's source at `commit`: the one identity of what a prebuilt host was built from. */
export function nativeHostSourceTree(component, commit, cwd = root) {
  return run("git", ["rev-parse", "--verify", `${commit}:${nativeHost(component).source}`], { cwd });
}

export function nativeHostArchiveName(component, sourceTree) {
  if (!/^[0-9a-f]{40}$/u.test(sourceTree)) throw new TypeError(`not a Git tree id: ${sourceTree}`);
  return `${nativeHost(component).name}-${sourceTree.slice(0, 12)}.zip`;
}

async function readToolchain() {
  const lock = JSON.parse(await readFile(join(root, "scripts/pythonSdkBuilder/pythonDistributionLock.json"), "utf8"));
  const pinned = lock.nativeHosts;
  if (!pinned || !/^\d+\.\d+\.\d+$/u.test(pinned.toolchain) || pinned.target !== "x86_64-pc-windows-msvc") {
    throw new Error("the Python distribution lock pins no native host toolchain");
  }
  return pinned;
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

/** Build one host of `treeish` into `outputDir`: the release zip and its identity beside it. */
export async function buildNativeHost({ component, treeish, outputDir }) {
  const host = nativeHost(component);
  if (process.platform !== "win32") throw new Error("pyproc's native hosts build only on Windows");
  const target = resolve(outputDir);
  if (existsSync(target) && (await readdir(target)).length) throw new Error("host output directory must be empty");
  await mkdir(target, { recursive: true });
  const { toolchain, target: rustTarget } = await readToolchain();
  const rustc = run("rustc", [`+${toolchain}`, "--version"]);
  if (!rustc.startsWith(`rustc ${toolchain} `)) throw new Error(`toolchain ${toolchain} is not installed (${rustc})`);
  const commit = run("git", ["rev-parse", "--verify", `${treeish}^{commit}`]);
  const sourceDateEpoch = Number(run("git", ["show", "-s", "--format=%ct", commit]));
  const sourceTree = nativeHostSourceTree(component, commit);
  const identityFile = nativeHostIdentityFile(component);

  const workspace = await mkdtemp(join(tmpdir(), `${host.name}-`));
  try {
    run("git", ["-c", "core.autocrlf=false", "archive", "--format=tar", `--output=${join(workspace, "source.tar")}`,
      commit, host.source]);
    run("tar", ["-xf", "source.tar"], { cwd: workspace });
    const source = join(workspace, ...host.source.split("/"));
    const cargoHome = process.env.CARGO_HOME || join(homedir(), ".cargo");
    const flags = [`--remap-path-prefix=${source}=${host.name}`, `--remap-path-prefix=${cargoHome}=cargo`,
      "-Clink-arg=/Brepro", "-Clink-arg=/PDBALTPATH:%_PDB%"];
    const manifestPath = join(source, "Cargo.toml");
    run("cargo", [`+${toolchain}`, "build", "--release", "--locked", "--target", rustTarget, "--manifest-path",
      manifestPath, "--target-dir", join(workspace, "target")],
    { cwd: source, env: { ...process.env, CARGO_ENCODED_RUSTFLAGS: flags.join("\x1f") } });
    const binary = await readFile(join(workspace, "target", rustTarget, "release", host.file));
    const notices = Buffer.from(`${host.name} bundles the Rust standard library and the crates below, each
under the license it states.\n\n${[await stdNotices(toolchain), ...await crateNotices(toolchain, rustTarget,
  manifestPath)].join("\n\n")}`);
    const identity = { schemaVersion: 1, commit, sourceTree, toolchain: { rustc, target: rustTarget },
      host: { file: host.file, byteLength: binary.byteLength, sha256: sha256(binary) },
      notices: { file: NATIVE_HOST_NOTICES, sha256: sha256(notices) } };
    const archive = createDeterministicZip([
      { path: host.file, bytes: binary, mode: 0o755 },
      { path: NATIVE_HOST_NOTICES, bytes: notices },
      { path: identityFile, bytes: Buffer.from(`${JSON.stringify(identity, null, 2)}\n`) },
    ], sourceDateEpoch);
    const archiveName = nativeHostArchiveName(component, sourceTree);
    await writeFile(join(target, archiveName), archive);
    const receipt = { component, ...identity,
      archive: { file: archiveName, byteLength: archive.byteLength, sha256: sha256(archive) } };
    await writeFile(join(target, identityFile), `${JSON.stringify(receipt, null, 2)}\n`);
    return Object.freeze(receipt);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

/** Two independent builds of one host agree byte for byte, archive and identity. */
export async function verifyNativeHostBuilds({ component, left, right }) {
  const identityFile = nativeHostIdentityFile(component);
  const [leftReceipt, rightReceipt] = await Promise.all([left, right].map(async (directory) =>
    JSON.parse(await readFile(join(directory, identityFile), "utf8"))));
  const [leftArchive, rightArchive] = await Promise.all([[left, leftReceipt], [right, rightReceipt]].map(
    async ([directory, receipt]) => readFile(join(directory, receipt.archive.file))));
  if (leftReceipt.component !== component || JSON.stringify(leftReceipt) !== JSON.stringify(rightReceipt)
    || !leftArchive.equals(rightArchive) || sha256(leftArchive) !== leftReceipt.archive.sha256) {
    throw new Error(`${component} builds differ: ${leftReceipt.archive.sha256} vs ${rightReceipt.archive.sha256}`);
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
  const keys = Object.keys(options).sort().join(",");
  if (command === "build" && keys === "component,out,tree") {
    return { command, component: options.component, treeish: options.tree, outputDir: options.out };
  }
  if (command === "verify" && keys === "component,left,right") {
    return { command, component: options.component, left: resolve(options.left), right: resolve(options.right) };
  }
  throw new TypeError("usage: buildNativeHost.mjs build --component <name> --tree <commit-ish> --out <empty-directory>\n"
    + "       buildNativeHost.mjs verify --component <name> --left <build> --right <build>");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const receipt = options.command === "build" ? await buildNativeHost(options) : await verifyNativeHostBuilds(options);
  console.log(JSON.stringify(receipt, null, 2));
}
