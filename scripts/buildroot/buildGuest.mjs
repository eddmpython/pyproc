// Buildroot i686 guest를 exact source/config에서 만들고 provenance 영수증을 남긴다.
// Linux/WSL build host에서 실행한다. 대형 build/output은 .cache 아래에만 둔다.
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  BUILDROOT,
  PROFILES,
  expectedRuntimeOracleVersion,
  nodeOracleProgram,
  pythonOracleProgram,
} from "./buildrootProfiles.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..", "..");
const profileIndex = process.argv.indexOf("--profile");
const profileName = profileIndex >= 0 ? String(process.argv[profileIndex + 1] || "") : "linux";
const profile = PROFILES[profileName];
if (!profile) throw new Error(`지원하지 않는 Buildroot profile: ${profileName}`);
if (profileIndex >= 0 && (!process.argv[profileIndex + 1] || process.argv.length !== profileIndex + 2)) {
  throw new Error(`--profile은 마지막 인자로 ${Object.keys(PROFILES).join(", ")} 하나를 받는다`);
}
const workspaceName = profileName === "linux" ? "buildrootGuest" : `buildrootGuest-${profileName}`;
const workspace = resolve(process.env.PYPROC_BUILDROOT_WORKSPACE || join(root, ".cache", workspaceName));
const sourceDir = join(workspace, "source");
const outputDir = join(workspace, "output");
const distDir = join(workspace, "dist");
const archivePath = join(workspace, `buildroot-${BUILDROOT.version}.tar.xz`);
const configPath = join(scriptDir, "buildroot.config");

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

async function assertResolvedProfileConfig() {
  if (!profile.requiredConfig.length) return;
  const config = await readFile(join(outputDir, ".config"), "utf8");
  const missing = profile.requiredConfig.filter((line) => !config.split(/\r?\n/).includes(line));
  if (missing.length) throw new Error(`${profileName} profile resolved config 누락: ${missing.join(", ")}`);
}

function runtimeOracleArgv(executable) {
  const source = profile.runtime.oracle.source;
  if (profile.runtime.name === "node") return [executable, "-e", nodeOracleProgram(source)];
  if (profile.runtime.name === "python") return [executable, "-c", pythonOracleProgram(source)];
  throw new Error(`지원하지 않는 runtime oracle: ${profile.runtime.name}`);
}

function runRuntimeOracle() {
  if (!profile.runtime) return null;
  const qemu = join(outputDir, "host", "bin", "qemu-i386");
  const targetDir = join(outputDir, "target");
  const executable = join(targetDir, ...profile.oracleExecutable);
  if (!existsSync(qemu)) throw new Error(`${profileName} runtime oracle의 qemu-i386 executable이 없다`);
  if (!existsSync(executable)) {
    throw new Error(`${profileName} runtime oracle의 target ${profile.oracleExecutable.join("/")} 가 없다`);
  }
  const stdout = run(qemu, ["-L", targetDir, ...runtimeOracleArgv(executable)], {
    capture: true,
  }).stdout.trim();
  let result;
  try { result = JSON.parse(stdout); }
  catch (error) { throw new Error(`${profileName} runtime oracle JSON 불일치: ${stdout}`, { cause: error }); }
  const expectedVersion = expectedRuntimeOracleVersion(profile.runtime);
  if (result.version !== expectedVersion || result.sha256 !== profile.runtime.oracle.sha256) {
    throw new Error(`${profileName} runtime oracle 불일치: ${stdout}`);
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
await assertResolvedProfileConfig();
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
