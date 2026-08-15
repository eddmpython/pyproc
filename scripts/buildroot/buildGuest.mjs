// Buildroot i686 guest를 exact source/config에서 만들고 provenance 영수증을 남긴다.
// Linux/WSL build host에서 실행한다. 대형 build/output은 .cache 아래에만 둔다.
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..", "..");
const profileIndex = process.argv.indexOf("--profile");
const profileName = profileIndex >= 0 ? String(process.argv[profileIndex + 1] || "") : "linux";
const NODE_RUNTIME = Object.freeze({
  name: "node",
  version: "22.22.0",
  revision: "6add85e4c46b8be383c8b637102d6b6fd206adce",
  repository: "https://github.com/nodejs/node.git",
  sourceUrl: "https://nodejs.org/dist/v22.22.0/node-v22.22.0.tar.xz",
  sourceSha256: "4c138012bb5352f49822a8f3e6d1db71e00639d0c36d5b6756f91e4c6f30b683",
  oracle: Object.freeze({
    source: "pyproc-node-guest",
    sha256: "b3aed4be1f24f10fa77253e267fe69403144d97072cfe305c828a7ce0c8589c0",
  }),
});
const PROFILES = Object.freeze({
  linux: Object.freeze({
    recipe: "pyproc-buildroot-i686-v2",
    outputName: "buildroot-pyproc-i686.bin",
    configFragments: Object.freeze([]),
    runtime: null,
  }),
  node: Object.freeze({
    recipe: "pyproc-buildroot-node-i686-v1",
    outputName: "buildroot-pyproc-node-i686.bin",
    configFragments: Object.freeze(["node.fragment"]),
    runtime: NODE_RUNTIME,
  }),
});
const profile = PROFILES[profileName];
if (!profile) throw new Error(`지원하지 않는 Buildroot profile: ${profileName}`);
if (profileIndex >= 0 && (!process.argv[profileIndex + 1] || process.argv.length !== profileIndex + 2)) {
  throw new Error("--profile은 마지막 인자로 linux 또는 node 하나를 받는다");
}
const workspaceName = profileName === "linux" ? "buildrootGuest" : `buildrootGuest-${profileName}`;
const workspace = resolve(process.env.PYPROC_BUILDROOT_WORKSPACE || join(root, ".cache", workspaceName));
const sourceDir = join(workspace, "source");
const outputDir = join(workspace, "output");
const distDir = join(workspace, "dist");
const archivePath = join(workspace, "buildroot-2025.02.16.tar.xz");
const configPath = join(scriptDir, "buildroot.config");
const BUILDROOT = Object.freeze({
  version: "2025.02.16",
  revision: "2d05bb10d08410c59856ff4022ba8b762f77441a",
  commit: "135af563b945b8c3d18f8fd370370075b9edb140",
  repository: "https://gitlab.com/buildroot.org/buildroot.git",
  sourceUrl: "https://buildroot.org/downloads/buildroot-2025.02.16.tar.xz",
  sourceSha256: "15305e3d366eeaf4a5ecaf2ed42f685fd6af7fe5dbf1f62e1de5f46ee83225e2",
  sourceDateEpoch: 1784143163,
});

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    encoding: options.encoding || "utf8",
    input: options.input,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const diagnostic = options.capture ? `\n${String(result.stderr || result.stdout || "").trim()}` : "";
    throw new Error(`${command} ${args.join(" ")} 실패(${result.status})${diagnostic}`);
  }
  return result;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function prepareConfig() {
  const target = join(outputDir, ".config");
  if (!profile.configFragments.length) {
    await copyFile(configPath, target);
    return [];
  }
  let config = await readFile(configPath, "utf8");
  const fragments = [];
  for (const name of profile.configFragments) {
    const path = join(scriptDir, name);
    const source = await readFile(path, "utf8");
    config = `${config.replace(/\s*$/, "\n")}${source.replace(/^\s*/, "").replace(/\s*$/, "\n")}`;
    fragments.push({ path: `scripts/buildroot/${name}`, sha256: await sha256(path) });
  }
  await writeFile(target, config);
  return fragments;
}

function runRuntimeOracle() {
  if (!profile.runtime) return null;
  const qemu = join(outputDir, "host", "bin", "qemu-i386");
  const targetDir = join(outputDir, "target");
  const executable = join(targetDir, "usr", "bin", "node");
  if (!existsSync(qemu) || !existsSync(executable)) throw new Error("Node runtime oracle executable이 없다");
  const source = JSON.stringify(profile.runtime.oracle.source);
  const program = [
    "const crypto = require('node:crypto')",
    `const sha256 = crypto.createHash('sha256').update(${source}).digest('hex')`,
    "process.stdout.write(JSON.stringify({ version: process.version, sha256 }))",
  ].join(";");
  const stdout = run(qemu, ["-L", targetDir, executable, "-e", program], { capture: true }).stdout.trim();
  let result;
  try { result = JSON.parse(stdout); }
  catch (error) { throw new Error(`Node runtime oracle JSON 불일치: ${stdout}`, { cause: error }); }
  if (result.version !== `v${profile.runtime.version}` || result.sha256 !== profile.runtime.oracle.sha256) {
    throw new Error(`Node runtime oracle 불일치: ${stdout}`);
  }
  return Object.freeze({ version: result.version, sha256: result.sha256 });
}

async function prepareSource() {
  let validArchive = false;
  if (existsSync(archivePath)) validArchive = await sha256(archivePath) === BUILDROOT.sourceSha256;
  if (!validArchive) {
    const response = await fetch(BUILDROOT.sourceUrl, { redirect: "follow" });
    if (!response.ok) throw new Error(`Buildroot source download 실패(${response.status})`);
    const temporary = `${archivePath}.tmp`;
    await writeFile(temporary, Buffer.from(await response.arrayBuffer()));
    if (await sha256(temporary) !== BUILDROOT.sourceSha256) {
      await rm(temporary, { force: true });
      throw new Error("Buildroot source SHA-256 불일치");
    }
    await rename(temporary, archivePath);
  }
  await rm(sourceDir, { recursive: true, force: true });
  const extracted = join(workspace, `buildroot-${BUILDROOT.version}`);
  await rm(extracted, { recursive: true, force: true });
  run("tar", ["-xJf", archivePath, "-C", workspace]);
  await rename(extracted, sourceDir);
}

if (process.platform === "win32") {
  throw new Error("assets:buildroot는 Linux 또는 WSL에서 실행한다(Buildroot host toolchain 계약)");
}
await mkdir(workspace, { recursive: true });
await prepareSource();
const boardDir = join(sourceDir, "board", "pyproc");
await mkdir(boardDir, { recursive: true });
await copyFile(join(scriptDir, "linux.fragment"), join(boardDir, "linux.fragment"));
const rootfsOverlayDir = join(boardDir, "rootfs-overlay");
await mkdir(join(rootfsOverlayDir, "etc", "init.d"), { recursive: true });
await copyFile(join(scriptDir, "rootfsOverlay", "etc", "inittab"), join(rootfsOverlayDir, "etc", "inittab"));
const rootfsInitTarget = join(rootfsOverlayDir, "etc", "init.d", "S40pyproc");
await copyFile(join(scriptDir, "rootfsOverlay", "etc", "initScripts", "S40pyproc"), rootfsInitTarget);
await chmod(rootfsInitTarget, 0o755);
await rm(outputDir, { recursive: true, force: true });
await rm(distDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await mkdir(distDir, { recursive: true });
const profileFragments = await prepareConfig();
const sourceDateEpoch = String(BUILDROOT.sourceDateEpoch);
const env = {
  ...process.env,
  SOURCE_DATE_EPOCH: sourceDateEpoch,
  TZ: "UTC",
  LC_ALL: "C",
  // sourceDir가 저장소 안의 .cache에 있더라도 상위 pyproc Git SHA가
  // Buildroot BR2_VERSION_FULL과 guest 바이트에 유입되지 않게 한다.
  GIT_CEILING_DIRECTORIES: root,
};
run("make", [`O=${outputDir}`, "olddefconfig"], { cwd: sourceDir, env });
run("make", [`O=${outputDir}`], { cwd: sourceDir, env });
const runtimeOracle = runRuntimeOracle();
run("make", [`O=${outputDir}`, "legal-info"], { cwd: sourceDir, env });
const showInfo = run("make", [`O=${outputDir}`, "show-info"], { cwd: sourceDir, env, capture: true }).stdout;
const sbom = run(join(sourceDir, "utils", "generate-cyclonedx"), [], {
  cwd: sourceDir,
  env,
  input: showInfo,
  capture: true,
}).stdout;
const imageSource = join(outputDir, "images", "bzImage");
const imageTarget = join(distDir, profile.outputName);
await copyFile(imageSource, imageTarget);
await writeFile(join(distDir, "buildroot.cyclonedx.json"), sbom);
const legalReadme = join(outputDir, "legal-info", "README");
const legalText = await readFile(legalReadme, "utf8");
const acceptedLegalNotices = new Set([
  "WARNING: the Buildroot source code has not been saved",
]);
const reportedLegalWarnings = legalText
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.startsWith("WARNING:"));
const acceptedNotices = reportedLegalWarnings.filter((line) => acceptedLegalNotices.has(line));
const legalWarnings = reportedLegalWarnings.filter((line) => !acceptedLegalNotices.has(line));
const manifest = {
  schemaVersion: 1,
  recipe: profile.recipe,
  ...(profileName !== "linux" ? { profile: profileName } : {}),
  buildroot: BUILDROOT,
  ...(profile.runtime ? { runtime: profile.runtime, runtimeOracle } : {}),
  sourceDateEpoch: Number(sourceDateEpoch),
  config: {
    path: "scripts/buildroot/buildroot.config",
    sha256: await sha256(configPath),
    ...(profileFragments.length ? { profileFragments } : {}),
    linuxFragment: {
      path: "scripts/buildroot/linux.fragment",
      sha256: await sha256(join(scriptDir, "linux.fragment")),
    },
    rootfsInit: {
      path: "scripts/buildroot/rootfsOverlay/etc/initScripts/S40pyproc",
      sha256: await sha256(join(scriptDir, "rootfsOverlay", "etc", "initScripts", "S40pyproc")),
    },
    inittab: {
      path: "scripts/buildroot/rootfsOverlay/etc/inittab",
      sha256: await sha256(join(scriptDir, "rootfsOverlay", "etc", "inittab")),
    },
  },
  output: {
    name: profile.outputName,
    byteLength: (await stat(imageTarget)).size,
    sha256: await sha256(imageTarget),
  },
  evidence: {
    legalInfo: "output/legal-info",
    cyclonedx: "dist/buildroot.cyclonedx.json",
    acceptedNotices,
    legalWarnings,
  },
};
await writeFile(join(distDir, "build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
if (legalWarnings.length) {
  throw new Error(`legal-info 경고 ${legalWarnings.length}개. 공식 catalog 승격 전에 전부 해소해야 한다`);
}
console.log(`Buildroot guest ready: ${imageTarget}`);
