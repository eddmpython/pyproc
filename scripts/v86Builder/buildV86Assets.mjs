// V86 engine과 firmware를 exact source와 toolchain에서 만들고 완결된 provenance를 남긴다.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile, mkdir, readFile, rename, rm, stat, symlink, writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..", "..");
const lockPath = join(scriptDir, "v86BuildLock.json");
const lock = JSON.parse(await readFile(lockPath, "utf8"));
const ubuntuSnapshot = String(process.env.PYPROC_UBUNTU_SNAPSHOT || "");
const workspaceIndex = process.argv.indexOf("--workspace");
const workspace = resolve(workspaceIndex >= 0
  ? String(process.argv[workspaceIndex + 1] || "")
  : process.env.PYPROC_V86_WORKSPACE || join(root, ".cache", "v86Assets"));
if (workspaceIndex >= 0 && (!process.argv[workspaceIndex + 1] || process.argv.length !== workspaceIndex + 2)) {
  throw new Error("--workspace는 마지막 인자로 정확한 directory 하나를 받는다");
}
if (process.platform === "win32") throw new Error("assets:v86는 Linux build host에서 실행한다");
if (ubuntuSnapshot !== lock.toolchain.ubuntuSnapshot) {
  throw new Error(`Ubuntu snapshot mismatch: ${ubuntuSnapshot || "unset"}`);
}
if (workspace === root || workspace.length <= root.length / 2) throw new Error(`unsafe V86 workspace: ${workspace}`);

const sourceRoot = join(workspace, "source");
const v86Source = join(sourceRoot, "v86");
const seabiosSource = join(sourceRoot, "seabios");
const downloads = join(workspace, "downloads");
const dist = join(workspace, "dist");
const legal = join(dist, "legal");
const inputDir = join(dist, "inputs");
const toolBin = join(workspace, "tool-bin");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    encoding: options.encoding === null ? null : "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const stderr = options.capture ? String(result.stderr || result.stdout || "").trim() : "";
    throw new Error(`${command} ${args.join(" ")} failed(${result.status})${stderr ? `\n${stderr}` : ""}`);
  }
  return result;
}

function output(command, args, options = {}) {
  const result = run(command, args, { ...options, capture: true });
  return `${String(result.stdout || "")}${String(result.stderr || "")}`.trim();
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function descriptor(path, name = relative(dist, path).split(sep).join("/")) {
  return Object.freeze({ name, byteLength: (await stat(path)).size, sha256: await sha256(path) });
}

async function downloadVerified({ url, path, expectedSha256, expectedBytes }) {
  await mkdir(dirname(path), { recursive: true });
  if (existsSync(path) && await sha256(path) === expectedSha256 && (await stat(path)).size === expectedBytes) return;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`download failed(${response.status}): ${url}`);
  const temporary = `${path}.tmp`;
  await writeFile(temporary, Buffer.from(await response.arrayBuffer()));
  const actual = await descriptor(temporary, "download");
  if (actual.sha256 !== expectedSha256 || actual.byteLength !== expectedBytes) {
    await rm(temporary, { force: true });
    throw new Error(`download integrity mismatch: ${url}`);
  }
  await rename(temporary, path);
}

function assertVersion(actual, expected, label) {
  if (!actual.includes(expected)) throw new Error(`${label} version mismatch: ${actual}`);
}

function exactClone(source, target) {
  run("git", ["init", target]);
  run("git", ["-C", target, "config", "core.autocrlf", "false"]);
  run("git", ["-C", target, "remote", "add", "origin", source.repository]);
  run("git", ["-C", target, "fetch", "--depth", "1", "origin", source.revision]);
  run("git", ["-C", target, "checkout", "--detach", "FETCH_HEAD"]);
  const revision = output("git", ["-C", target, "rev-parse", "HEAD"]);
  const tree = output("git", ["-C", target, "rev-parse", "HEAD^{tree}"]);
  if (revision !== source.revision || tree !== source.tree) {
    throw new Error(`source identity mismatch: ${revision}/${tree}`);
  }
}

async function assertSourceInputs() {
  for (const [name, expected] of Object.entries(lock.v86.inputs)) {
    const actual = await sha256(join(v86Source, ...name.split("/")));
    if (actual !== expected) throw new Error(`V86 source input mismatch: ${name}`);
  }
}

function createSbom(runtimeOutputs, sourceInputs) {
  const outputOf = new Map(runtimeOutputs.map((entry) => [entry.name, entry]));
  const component = (name, version, license, revision, properties = []) => ({
    type: "library",
    name,
    version,
    licenses: [{ license: { id: license } }],
    properties: [
      ...(revision ? [{ name: "pyproc:sourceRevision", value: revision }] : []),
      ...properties,
    ],
  });
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: { type: "application", name: lock.recipe, version: "1" },
      properties: runtimeOutputs.map((entry) => ({
        name: `pyproc:output:${entry.name}`,
        value: `sha256:${entry.sha256};bytes:${entry.byteLength}`,
      })),
    },
    components: [
      component("v86", lock.v86.version, "BSD-2-Clause", lock.v86.revision, [
        { name: "pyproc:output:module", value: `sha256:${outputOf.get("libv86.mjs").sha256}` },
        { name: "pyproc:output:wasm", value: `sha256:${outputOf.get("v86.wasm").sha256}` },
      ]),
      component("v86 QEMU floppy portions", "vendored", "MIT", lock.v86.revision),
      component("Berkeley SoftFloat", "3e", "BSD-3-Clause", lock.v86.revision, [
        { name: "pyproc:vendoredSourceSha256", value: sourceInputs.softfloat },
      ]),
      component("Zstandard single-file decompressor", "1.4.5", "BSD-3-Clause", lock.v86.revision, [
        { name: "pyproc:vendoredSourceSha256", value: sourceInputs.zstd },
      ]),
      component("SeaBIOS", lock.seabios.version, lock.seabios.license, lock.seabios.revision, [
        { name: "pyproc:output:bios", value: `sha256:${outputOf.get("seabios.bin").sha256}` },
        { name: "pyproc:output:vgabios", value: `sha256:${outputOf.get("vgabios.bin").sha256}` },
      ]),
    ],
  };
}

await rm(sourceRoot, { recursive: true, force: true });
await rm(dist, { recursive: true, force: true });
await rm(toolBin, { recursive: true, force: true });
await mkdir(sourceRoot, { recursive: true });
await mkdir(dist, { recursive: true });
await mkdir(legal, { recursive: true });
await mkdir(inputDir, { recursive: true });
await mkdir(toolBin, { recursive: true });

exactClone(lock.v86, v86Source);
exactClone(lock.seabios, seabiosSource);
await assertSourceInputs();

const nodeVersion = output("node", ["--version"]);
const rustcVersion = output("rustc", ["--version", "--verbose"]);
const cargoVersion = output("cargo", ["--version", "--verbose"]);
const clangPath = output("which", ["clang-18"]);
const clangVersion = output(clangPath, ["--version"]);
const javaVersion = output("java", ["-version"]);
const pythonVersion = output("python3", ["--version"]);
const gccVersion = output("gcc", ["--version"]);
const ldVersion = output("ld", ["--version"]);
const makeVersion = output("make", ["--version"]);
const iaslVersion = output("iasl", ["-v"]);
const packageVersions = output("dpkg-query", [
  "-W", "-f=${binary:Package}\t${Version}\n", ...Object.keys(lock.toolchain.ubuntuPackages),
]).split("\n").sort();
const expectedPackageVersions = Object.entries(lock.toolchain.ubuntuPackages)
  .map(([name, version]) => `${name}\t${version}`).sort();
assertVersion(nodeVersion, `v${lock.toolchain.node}`, "Node");
assertVersion(rustcVersion, `rustc ${lock.toolchain.rust.version}`, "Rust");
assertVersion(rustcVersion, `commit-hash: ${lock.toolchain.rust.commit}`, "Rust commit");
assertVersion(clangVersion, lock.toolchain.clang, "Clang");
assertVersion(javaVersion, lock.toolchain.java, "Java");
assertVersion(pythonVersion, lock.toolchain.python, "Python");
assertVersion(gccVersion, lock.toolchain.gcc, "GCC");
assertVersion(ldVersion, lock.toolchain.ld, "ld");
assertVersion(makeVersion, lock.toolchain.make, "make");
assertVersion(iaslVersion, lock.toolchain.iasl, "IASL");
if (packageVersions.join("\n") !== expectedPackageVersions.join("\n")) {
  throw new Error(`Ubuntu package version mismatch: ${packageVersions.join(", ")}`);
}
await symlink(clangPath, join(toolBin, "clang"));

const closurePath = join(downloads, "closure-compiler-v20210601.jar");
await downloadVerified({
  url: lock.toolchain.closureCompiler.url,
  path: closurePath,
  expectedSha256: lock.toolchain.closureCompiler.sha256,
  expectedBytes: lock.toolchain.closureCompiler.byteLength,
});
await mkdir(join(v86Source, "closure-compiler"), { recursive: true });
await copyFile(closurePath, join(v86Source, "closure-compiler", "compiler.jar"));

const v86Env = {
  ...process.env,
  PATH: `${toolBin}:${process.env.PATH}`,
  SOURCE_DATE_EPOCH: String(lock.v86.sourceDateEpoch),
  TZ: "UTC",
  LC_ALL: "C",
};
run("make", ["all-debug"], { cwd: v86Source, env: v86Env });
run("make", ["all"], { cwd: v86Source, env: v86Env });
await copyFile(join(v86Source, "build", "libv86.mjs"), join(dist, "libv86.mjs"));
await copyFile(join(v86Source, "build", "v86.wasm"), join(dist, "v86.wasm"));

await copyFile(join(v86Source, "bios", "seabios.config"), join(seabiosSource, ".config"));
const seabiosEnv = {
  ...process.env,
  SOURCE_DATE_EPOCH: String(lock.seabios.sourceDateEpoch),
  KBUILD_BUILD_TIMESTAMP: String(lock.seabios.sourceDateEpoch),
  TZ: "UTC",
  LC_ALL: "C",
};
run("make", [], { cwd: seabiosSource, env: seabiosEnv });
await copyFile(join(seabiosSource, "out", "bios.bin"), join(dist, "seabios.bin"));
await copyFile(join(seabiosSource, "out", "vgabios.bin"), join(dist, "vgabios.bin"));

run("git", ["-C", v86Source, "archive", "--format=tar", `--prefix=v86-${lock.v86.version}/`,
  `--output=${join(dist, `v86-${lock.v86.version}-source.tar`)}`, "HEAD"]);
run("git", ["-C", seabiosSource, "archive", "--format=tar", `--prefix=seabios-${lock.seabios.version}/`,
  `--output=${join(dist, `seabios-${lock.seabios.version}-source.tar`)}`, "HEAD"]);

const legalCopies = [
  [join(v86Source, "LICENSE"), "LICENSE.v86"],
  [join(v86Source, "LICENSE.MIT"), "LICENSE.v86-mit"],
  [join(v86Source, "lib", "softfloat", "softfloat.c"), "LICENSE.softfloat-source.c"],
  [join(v86Source, "lib", "zstd", "zstddeclib.c"), "LICENSE.zstd-source.c"],
  [join(seabiosSource, "COPYING"), "COPYING.seabios"],
  [join(seabiosSource, "COPYING.LESSER"), "COPYING.LESSER.seabios"],
];
for (const [source, name] of legalCopies) await copyFile(source, join(legal, name));
await copyFile(join(v86Source, "bios", "seabios.config"), join(inputDir, "seabios.config"));
await copyFile(join(v86Source, "bios", "fetch-and-build-seabios.sh"), join(inputDir, "fetch-and-build-seabios.sh"));
await copyFile(lockPath, join(inputDir, "v86BuildLock.json"));

const runtimeNames = ["libv86.mjs", "v86.wasm", "seabios.bin", "vgabios.bin"];
const runtimeOutputs = await Promise.all(runtimeNames.map((name) => descriptor(join(dist, name), name)));
const sourceInputs = {
  softfloat: await sha256(join(v86Source, "lib", "softfloat", "softfloat.c")),
  zstd: await sha256(join(v86Source, "lib", "zstd", "zstddeclib.c")),
};
await writeFile(join(dist, "v86-assets.cyclonedx.json"), `${JSON.stringify(createSbom(runtimeOutputs, sourceInputs), null, 2)}\n`);

const artifactPaths = [
  ...runtimeNames,
  `v86-${lock.v86.version}-source.tar`,
  `seabios-${lock.seabios.version}-source.tar`,
  "v86-assets.cyclonedx.json",
  ...legalCopies.map(([, name]) => `legal/${name}`),
  "inputs/seabios.config",
  "inputs/fetch-and-build-seabios.sh",
  "inputs/v86BuildLock.json",
].sort();
const artifacts = await Promise.all(artifactPaths.map((name) => descriptor(join(dist, ...name.split("/")), name)));
const referenceMatches = Object.fromEntries(runtimeOutputs.map((entry) => {
  const reference = lock.referenceOutputs[entry.name];
  return [entry.name, Boolean(reference && reference.sha256 === entry.sha256
    && reference.byteLength === entry.byteLength)];
}));
const manifest = {
  schemaVersion: 1,
  recipe: lock.recipe,
  sources: {
    v86: {
      version: lock.v86.version,
      repository: lock.v86.repository,
      revision: lock.v86.revision,
      tree: lock.v86.tree,
      sourceDateEpoch: lock.v86.sourceDateEpoch,
      npm: lock.v86.npm,
      attestations: lock.v86.attestations,
    },
    seabios: {
      version: lock.seabios.version,
      repository: lock.seabios.repository,
      revision: lock.seabios.revision,
      tree: lock.seabios.tree,
      sourceDateEpoch: lock.seabios.sourceDateEpoch,
    },
  },
  toolchain: {
    runnerImage: lock.toolchain.runnerImage,
    ubuntuSnapshot,
    ubuntuPackages: packageVersions,
    node: nodeVersion,
    rustc: rustcVersion.split("\n"),
    cargo: cargoVersion.split("\n"),
    clang: clangVersion.split("\n"),
    java: javaVersion.split("\n"),
    python: pythonVersion.split("\n"),
    gcc: gccVersion.split("\n"),
    ld: ldVersion.split("\n"),
    make: makeVersion.split("\n"),
    iasl: iaslVersion.split("\n"),
    closureCompiler: lock.toolchain.closureCompiler,
  },
  sourceInputs,
  artifacts,
  referenceMatches,
};
await writeFile(join(dist, "build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ dist, runtimeOutputs, referenceMatches }, null, 2));
