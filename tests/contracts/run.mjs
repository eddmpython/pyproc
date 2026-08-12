import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPERS = new Set(["engineConformance.mjs", "run.mjs"]);
// suite 이름을 고정한다. 자동 발견은 새 suite를 공짜로 태우지만, 개수만 세면 suite를 지운
// 커밋이 조용히 통과한다(4개를 지워도 "1 suite" PASS였다). 목록을 고치는 diff가 심사 지점이다.
export const EXPECTED_SUITES = Object.freeze([
  "automationRecording.mjs",
  "automationSpace.mjs",
  "browserAutomation.mjs",
  "browserAutomationProduct.mjs",
  "browserControl.mjs",
  "controlProtocol.mjs",
  "frameSpace.mjs",
  "moduleBoundaries.mjs",
  "nestedPatchScope.mjs",
  "publicSurface.mjs",
  "pythonSdk.mjs",
  "retentionPolicy.mjs",
  "runtimeCapabilityClusters.mjs",
  "runtimeContract.mjs",
  "sourceParses.mjs",
]);

export async function runContractSuites() {
  const files = (await readdir(HERE))
    .filter((name) => name.endsWith(".mjs") && !HELPERS.has(name))
    .sort();
  let suites = 0;
  for (const file of files) {
    const module = await import(pathToFileURL(resolve(HERE, file)).href);
    const runners = Object.entries(module)
      .filter(([name, value]) => name.startsWith("assert") && typeof value === "function");
    if (runners.length !== 1) {
      throw new Error(`${file}: assert* suite export가 정확히 하나여야 한다`);
    }
    await runners[0][1]();
    suites++;
  }
  if (files.join(",") !== EXPECTED_SUITES.join(",")) {
    throw new Error(`contract suite 목록 불일치: 실물 ${files.join(",") || "없음"} vs 기대 ${EXPECTED_SUITES.join(",")}`);
  }
  return Object.freeze({ suites, files: Object.freeze(files) });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await runContractSuites();
  console.log(`PASS contracts: ${result.suites} suites`);
}
