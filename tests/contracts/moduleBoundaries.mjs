import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function verifyGoldenWorkflowImports(goldenPage, packageJson) {
  const goldenImports = [...goldenPage.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  if (goldenImports.join(",") !== "pyproc,pyproc/history") {
    throw new Error(`golden workflow가 승인된 공개 specifier 밖을 import한다: ${goldenImports.join(",")}`);
  }
  if (/(?:\.\.\/index\.js|from\s+["'][^"']*\/src\/)/.test(goldenPage)) {
    throw new Error("golden workflow가 저장소 또는 package deep path를 소비한다");
  }
  // 브라우저는 package.json exports를 해석하지 않으므로 import map target은 실제 파일이다.
  // 소비 코드는 bare public specifier만 쓰고, 배선 target은 package exports 정본과 같아야 한다.
  const importMapText = goldenPage.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/)?.[1];
  const goldenImportMap = JSON.parse(importMapText ?? "{}").imports ?? {};
  const expectedGoldenMap = {
    pyproc: `/node_modules/pyproc/${packageJson.exports["."].default.replace(/^\.\//, "")}`,
    "pyproc/history": `/node_modules/pyproc/${packageJson.exports["./history"].default.replace(/^\.\//, "")}`,
  };
  if (JSON.stringify(goldenImportMap) !== JSON.stringify(expectedGoldenMap)) {
    throw new Error("golden workflow import map이 package exports 정본과 어긋난다");
  }
}

function verifyBuildrootWorkflow(recipe, workflow, nodeFragment) {
  if (!workflow.includes("npm run assets:buildroot -- --profile ${{ matrix.profile }}")) {
    throw new Error("Buildroot profile 재현 배선 누락");
  }
  if (!/profile:\s*\[linux, node\]/.test(workflow)) throw new Error("Buildroot Linux와 Node matrix 누락");
  if (!workflow.includes("PYPROC_BUILDROOT_WORKSPACE: ${{ github.workspace }}/../pyproc-buildroot-${{ matrix.profile }}")
    || workflow.includes("PYPROC_BUILDROOT_WORKSPACE: ${{ github.workspace }}/../pyproc-buildroot-${{ matrix.profile }}-${{ matrix.slot }}")) {
    throw new Error("Buildroot 독립 runner의 절대 workspace 경로가 서로 다르다");
  }
  const reproduceTimeout = Number(workflow.match(/reproduce:[\s\S]*?timeout-minutes:\s*(\d+)/)?.[1]);
  if (!Number.isSafeInteger(reproduceTimeout) || reproduceTimeout < 300) {
    throw new Error(`Buildroot Node 전체 재현 시간 예산 부족: ${reproduceTimeout || "missing"}`);
  }
  if (!/uses:\s*actions\/upload-artifact@[0-9a-f]{40}\b/.test(workflow)) {
    throw new Error("Buildroot artifact 보존 배선 누락");
  }
  if (!recipe.includes("sourceSha256") || recipe.includes('git", ["clone"')) {
    throw new Error("Buildroot source가 검증된 release archive 계약이 아니다");
  }
  const imageNames = [...recipe.matchAll(/outputName:\s*"(buildroot-[\w.-]+\.bin)"/g)].map((match) => match[1]);
  if (imageNames.join(",") !== "buildroot-pyproc-i686.bin,buildroot-pyproc-node-i686.bin") {
    throw new Error(`Buildroot profile output 불일치: ${imageNames.join(",")}`);
  }
  if (!workflow.includes("manifest.output.name") || !workflow.includes("left.equals(right)")) {
    throw new Error("Buildroot profile별 image 바이트 동일성 대조 누락");
  }
  if (!recipe.includes('version: "22.22.0"')
    || !recipe.includes('revision: "6add85e4c46b8be383c8b637102d6b6fd206adce"')
    || !recipe.includes('sourceSha256: "4c138012bb5352f49822a8f3e6d1db71e00639d0c36d5b6756f91e4c6f30b683"')
    || !recipe.includes('"qemu-i386"')) {
    throw new Error("Buildroot Node source 또는 runtime oracle 고정 누락");
  }
  for (const input of ["BR2_TOOLCHAIN_BUILDROOT_CXX=y", "BR2_PACKAGE_NODEJS=y", "BR2_PACKAGE_OPENSSL=y"]) {
    if (!nodeFragment.split(/\r?\n/).includes(input)) throw new Error(`Buildroot Node profile input 누락: ${input}`);
  }
}

function verifyNodeGuestProductGate(packageJson) {
  const command = packageJson.scripts?.["test:node-guest"] || "";
  if (!command.startsWith("node tests/webMachine/fixtures/v86/prepareAssets.mjs --consumer nodeGuest && ")
    || !command.endsWith("node tests/browser/nodeGuestProduct.mjs")) {
    throw new Error("Node guest가 정식 browser 제품 gate에 연결되지 않았다");
  }
  if (!existsSync(join(ROOT, "tests", "browser", "nodeGuestProduct.mjs"))) {
    throw new Error("Node guest browser 제품 gate가 없다");
  }
}

function verifyBuildrootReleaseAssembler(source, packageJson) {
  if (packageJson.scripts?.["assets:buildroot-release"] !== "node scripts/release/assembleBuildrootRelease.mjs") {
    throw new Error("Buildroot release 조립 공개 명령 누락");
  }
  for (const required of ["assertCacheOutput", "profileFragments", "linuxFragment", "rootfsInit", "inittab",
    "assertBuildrootIdentity", "assertCycloneDx", "MAX_SOURCE_BYTES", "assertLegalCompleteness", "headSha",
    "independentBuilds", "runtimeOracle", "sourceDateEpoch", "crc32File",
    "legal-info.sha256",
    "releaseAssets.json"]) {
    if (!source.includes(required)) throw new Error(`Buildroot release 조립 불변식 누락: ${required}`);
  }
}

function verifyReleaseVersionSurfaces(packageJson) {
  const version = packageJson.version;
  const pyproject = readFileSync(join(ROOT, "pythonSdk", "pyproject.toml"), "utf8");
  if (!pyproject.includes(`version = "${version}"`)) {
    throw new Error("Python SDK version이 npm package version과 어긋난다");
  }
  const extension = JSON.parse(readFileSync(
    join(ROOT, "scripts", "actuation", "delegatedTab", "extension", "manifest.json"), "utf8"));
  if (extension.version !== version) throw new Error("delegated tab extension version이 package version과 어긋난다");
  const exactNpmDocs = [
    "skills/automate-browser-with-pyproc/references/browser-automation.md",
    "skills/control-pyproc/references/javascript-control.md",
    "skills/use-pyproc-machine/references/machine-entrance.md",
  ];
  for (const path of exactNpmDocs) {
    if (!readFileSync(join(ROOT, ...path.split("/")), "utf8").includes(`pyproc@${version}`)) {
      throw new Error(`${path}: 현재 exact npm release 누락`);
    }
  }
  const wheelName = `pyproc_control-${version}-py3-none-any.whl`;
  for (const path of ["pythonSdk/README.md", "skills/control-pyproc/references/python-sdk.md"]) {
    const source = readFileSync(join(ROOT, ...path.split("/")), "utf8");
    if (!source.includes(`/v${version}/${wheelName}`)) throw new Error(`${path}: 현재 Python release URL 누락`);
  }
}

function verifyBrowserLauncherCleanup(source, browserRunner) {
  for (const required of [
    "PROFILE_ABSENCE_STABILITY_MS",
    'process.kill(-proc.pid, "SIGKILL")',
    'detached: process.platform !== "win32"',
  ]) {
    if (!source.includes(required)) throw new Error(`browser process tree cleanup 불변식 누락: ${required}`);
  }
  if (!/killBrowserProcess\(proc, profile\);\s*removeBrowserProfile\(profile\);/u.test(source)) {
    throw new Error("browser profile을 process tree 종료보다 먼저 지운다");
  }
  if (!browserRunner.includes('detached: process.platform !== "win32"')) {
    throw new Error("browser restart runner가 POSIX process group 경계를 만들지 않는다");
  }
}

export function assertModuleBoundaries() {
  const runtimeSubpath = readFileSync(join(ROOT, "src", "composition", "runtimeSubpath.js"), "utf8");
  if (!runtimeSubpath.includes("wasiSubpath.js") || runtimeSubpath.includes("runtimeBindings")) {
    throw new Error("runtime subpath가 owned kernel composition을 직접 게시하지 않는다");
  }

  const nodeGate = readFileSync(join(ROOT, "tests", "run.mjs"), "utf8");
  if (!nodeGate.includes('./contracts/run.mjs')) throw new Error("Node gate가 contract aggregator를 소비하지 않는다");
  if (/\.\/contracts\/(publicSurface|retentionPolicy)\.mjs/.test(nodeGate)) {
    throw new Error("Node gate가 개별 contract suite를 직접 import한다");
  }

  const browserHtml = readFileSync(join(ROOT, "tests", "browser", "gate.html"), "utf8");
  if (!browserHtml.includes('src="./gate.js"')) throw new Error("브라우저 gate module 배선 누락");
  if (/<script type="module">\s*\S/.test(browserHtml)) throw new Error("브라우저 HTML에 inline 실행 코드가 재등장했다");
  if (!existsSync(join(ROOT, "tests", "browser", "gate.js"))) throw new Error("브라우저 gate.js 누락");

  const goldenPage = readFileSync(join(ROOT, "tests", "browser", "goldenWorkflow.html"), "utf8");
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  verifyBrowserLauncherCleanup(
    readFileSync(join(ROOT, "scripts", "browserControl", "browserLauncher.mjs"), "utf8"),
    readFileSync(join(ROOT, "tests", "browser", "run.mjs"), "utf8"),
  );
  verifyReleaseVersionSurfaces(packageJson);
  verifyGoldenWorkflowImports(goldenPage, packageJson);
  // 음성 fixture: 공개 specifier는 그대로여도 import map이 package export target에서 표류하면
  // 설치 tarball이 아닌 우연한 파일을 검증하게 된다. 이 오염이 매 실행에서 RED인지 확인한다.
  let caughtGoldenMapDrift = false;
  try {
    verifyGoldenWorkflowImports(
      goldenPage.replace("/node_modules/pyproc/src/state/index.js", "/node_modules/pyproc/src/state/wrong.js"),
      packageJson,
    );
  } catch (error) {
    caughtGoldenMapDrift = String(error.message).includes("package exports 정본");
  }
  if (!caughtGoldenMapDrift) throw new Error("golden workflow import map 표류 음성 fixture를 놓쳤다");

  const buildrootWorkflow = readFileSync(join(ROOT, ".github", "workflows", "buildroot-guest.yml"), "utf8");
  const buildrootRecipe = readFileSync(join(ROOT, "scripts", "buildroot", "buildGuest.mjs"), "utf8");
  const buildrootNodeFragment = readFileSync(join(ROOT, "scripts", "buildroot", "node.fragment"), "utf8");
  const buildrootRelease = readFileSync(join(ROOT, "scripts", "release", "assembleBuildrootRelease.mjs"), "utf8");
  verifyBuildrootWorkflow(buildrootRecipe, buildrootWorkflow, buildrootNodeFragment);
  verifyNodeGuestProductGate(packageJson);
  verifyBuildrootReleaseAssembler(buildrootRelease, packageJson);
  let caughtNodeMatrixDrift = false;
  try {
    verifyBuildrootWorkflow(buildrootRecipe, buildrootWorkflow.replaceAll("profile: [linux, node]", "profile: [linux]"),
      buildrootNodeFragment);
  }
  catch (error) { caughtNodeMatrixDrift = String(error.message).includes("Node matrix"); }
  if (!caughtNodeMatrixDrift) throw new Error("Buildroot Node matrix 음성 fixture를 놓쳤다");
  let caughtWorkspaceDrift = false;
  try {
    verifyBuildrootWorkflow(buildrootRecipe, buildrootWorkflow.replace("${{ matrix.profile }}\n", "${{ matrix.profile }}-${{ matrix.slot }}\n"),
      buildrootNodeFragment);
  }
  catch (error) { caughtWorkspaceDrift = String(error.message).includes("절대 workspace"); }
  if (!caughtWorkspaceDrift) throw new Error("Buildroot workspace 경로 음성 fixture를 놓쳤다");
  let caughtNodeTimeoutDrift = false;
  try {
    verifyBuildrootWorkflow(buildrootRecipe, buildrootWorkflow.replace("timeout-minutes: 300", "timeout-minutes: 120"),
      buildrootNodeFragment);
  }
  catch (error) { caughtNodeTimeoutDrift = String(error.message).includes("시간 예산 부족"); }
  if (!caughtNodeTimeoutDrift) throw new Error("Buildroot Node 시간 예산 음성 fixture를 놓쳤다");
  let caughtNodeCryptoDrift = false;
  try { verifyBuildrootWorkflow(buildrootRecipe, buildrootWorkflow, buildrootNodeFragment.replace("BR2_PACKAGE_OPENSSL=y", "")); }
  catch (error) { caughtNodeCryptoDrift = String(error.message).includes("BR2_PACKAGE_OPENSSL"); }
  if (!caughtNodeCryptoDrift) throw new Error("Buildroot Node crypto 음성 fixture를 놓쳤다");
  let caughtReleaseDrift = false;
  try { verifyBuildrootReleaseAssembler(buildrootRelease.replace("profileFragments", "fragments"), packageJson); }
  catch (error) { caughtReleaseDrift = String(error.message).includes("profileFragments"); }
  if (!caughtReleaseDrift) throw new Error("Buildroot release profile fragment 음성 fixture를 놓쳤다");
  return true;
}
