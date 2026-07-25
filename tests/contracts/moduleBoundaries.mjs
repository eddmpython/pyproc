import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function assertModuleBoundaries() {
  const runtimeBindings = readFileSync(join(ROOT, "src", "composition", "runtimeBindings.js"), "utf8");
  if (runtimeBindings.includes("../capabilities/")) {
    throw new Error("중앙 runtimeBindings가 capability 구현을 직접 import한다");
  }
  for (const cluster of ["stateBindings.js", "serviceBindings.js", "environmentBindings.js"]) {
    if (!existsSync(join(ROOT, "src", "composition", "runtimeBindings", cluster))) {
      throw new Error(`Runtime capability cluster 누락: ${cluster}`);
    }
  }

  const nodeGate = readFileSync(join(ROOT, "tests", "run.mjs"), "utf8");
  if (!nodeGate.includes('./contracts/run.mjs')) throw new Error("Node gate가 contract aggregator를 소비하지 않는다");
  if (/\.\/contracts\/(publicSurface|runtimeContract|runtimeCapabilityClusters|retentionPolicy)\.mjs/.test(nodeGate)) {
    throw new Error("Node gate가 개별 contract suite를 직접 import한다");
  }

  const browserHtml = readFileSync(join(ROOT, "tests", "browser", "gate.html"), "utf8");
  if (!browserHtml.includes('src="./gate.js"')) throw new Error("브라우저 gate module 배선 누락");
  if (/<script type="module">\s*\S/.test(browserHtml)) throw new Error("브라우저 HTML에 inline 실행 코드가 재등장했다");
  if (!existsSync(join(ROOT, "tests", "browser", "gate.js"))) throw new Error("브라우저 gate.js 누락");

  const reactive = readFileSync(join(ROOT, "src", "capabilities", "reactive.js"), "utf8");
  if (!reactive.includes('./reactive/retentionPolicy.js')) {
    throw new Error("ReactiveController가 retention 정책 모듈을 소비하지 않는다");
  }

  const buildrootWorkflow = readFileSync(join(ROOT, ".github", "workflows", "buildroot-guest.yml"), "utf8");
  if (!buildrootWorkflow.includes("npm run assets:buildroot") || !buildrootWorkflow.includes("upload-artifact@v4")) {
    throw new Error("Buildroot Linux 재현 또는 artifact 보존 배선 누락");
  }
  return true;
}
