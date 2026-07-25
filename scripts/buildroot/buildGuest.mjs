// Buildroot i686 guest를 exact source/config에서 만들고 provenance 영수증을 남긴다.
// Linux/WSL build host에서 실행한다. 대형 build/output은 .cache 아래에만 둔다.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..", "..");
const workspace = resolve(process.env.PYPROC_BUILDROOT_WORKSPACE || join(root, ".cache", "buildrootGuest"));
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
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} 실패(${result.status})`);
  return result;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
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
await rm(outputDir, { recursive: true, force: true });
await rm(distDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await mkdir(distDir, { recursive: true });
await copyFile(configPath, join(outputDir, ".config"));
const sourceDateEpoch = String(BUILDROOT.sourceDateEpoch);
const env = { ...process.env, SOURCE_DATE_EPOCH: sourceDateEpoch, TZ: "UTC", LC_ALL: "C" };
run("make", [`O=${outputDir}`, "olddefconfig"], { cwd: sourceDir, env });
run("make", [`O=${outputDir}`], { cwd: sourceDir, env });
run("make", [`O=${outputDir}`, "legal-info"], { cwd: sourceDir, env });
const showInfo = run("make", [`O=${outputDir}`, "show-info"], { cwd: sourceDir, env, capture: true }).stdout;
const sbom = run(join(sourceDir, "utils", "generate-cyclonedx"), [], {
  cwd: sourceDir,
  env,
  input: showInfo,
  capture: true,
}).stdout;
const imageSource = join(outputDir, "images", "bzImage");
const imageTarget = join(distDir, "buildroot-pyproc-i686.bin");
await copyFile(imageSource, imageTarget);
await writeFile(join(distDir, "buildroot.cyclonedx.json"), sbom);
const legalReadme = join(outputDir, "legal-info", "README");
const legalText = await readFile(legalReadme, "utf8");
const legalWarnings = legalText.split(/\r?\n/).filter((line) => /warning|not saved|unknown/i.test(line));
const manifest = {
  schemaVersion: 1,
  recipe: "pyproc-buildroot-i686-v1",
  buildroot: BUILDROOT,
  sourceDateEpoch: Number(sourceDateEpoch),
  config: {
    path: "scripts/buildroot/buildroot.config",
    sha256: await sha256(configPath),
  },
  output: {
    name: "buildroot-pyproc-i686.bin",
    byteLength: (await stat(imageTarget)).size,
    sha256: await sha256(imageTarget),
  },
  evidence: {
    legalInfo: "output/legal-info",
    cyclonedx: "dist/buildroot.cyclonedx.json",
    legalWarnings,
  },
};
await writeFile(join(distDir, "build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
if (legalWarnings.length) {
  throw new Error(`legal-info 경고 ${legalWarnings.length}개. 공식 catalog 승격 전에 전부 해소해야 한다`);
}
console.log(`Buildroot guest ready: ${imageTarget}`);
