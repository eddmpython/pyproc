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
  if (!buildrootWorkflow.includes("npm run assets:buildroot")) {
    throw new Error("Buildroot Linux 재현 배선 누락");
  }
  // 공급망 입력은 exact commit이어야 하고, 별도 CI 배관 gate가 승인 SHA와 전수 대조한다.
  if (!/uses:\s*actions\/upload-artifact@[0-9a-f]{40}\b/.test(buildrootWorkflow)) {
    throw new Error("Buildroot artifact 보존 배선 누락");
  }
  const buildrootRecipe = readFileSync(join(ROOT, "scripts", "buildroot", "buildGuest.mjs"), "utf8");
  if (!buildrootRecipe.includes("sourceSha256") || buildrootRecipe.includes('git", ["clone"')) {
    throw new Error("Buildroot source가 검증된 release archive 계약이 아니다");
  }
  // 이미지 파일명은 recipe가 정본이다. workflow가 다른 이름을 대조하면 재현 증거가 빈다.
  const imageName = buildrootRecipe.match(/name:\s*"(buildroot-[\w.-]+\.bin)"/)?.[1];
  if (!imageName) throw new Error("Buildroot recipe가 출력 이미지 이름을 manifest에 담지 않는다");
  if (!new RegExp(`cmp[^\\n]*${imageName.replace(/\./g, "\\.")}`).test(buildrootWorkflow)) {
    throw new Error("Buildroot 독립 빌드의 바이트 동일성 대조가 recipe 출력 이름과 어긋난다");
  }
  return true;
}
