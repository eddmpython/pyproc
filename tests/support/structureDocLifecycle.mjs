// structureDocLifecycle.mjs - [구조] 절에서 나온 검사 묶음.
//
// 크기가 아니라 책임으로 나눴다: 이 묶음의 검사들은 자기 상수만 쓰고, 러너가 주는 것은 공용
// 헬퍼와 check뿐이다. 절 이름과 검사 이름은 그대로라 게이트 층 하한은 움직이지 않는다.
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function missingCategoryReadmes({ directoryNames, hasReadme }) {
  return directoryNames.filter((name) => !hasReadme(name));
}

export function assertDocLifecycleStructure({ check, ROOT }) {
check("tests/attempts/README.md 존재(운영 규칙 SSOT)", () => {
  if (!existsSync(join(ROOT, "tests", "attempts", "README.md"))) throw new Error("없음");
});
check("attempts 카테고리마다 README + 졸업 게이트 절", () => {
  const dir = join(ROOT, "tests", "attempts");
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    const readme = join(full, "README.md");
    if (!existsSync(readme)) throw new Error(`${entry}: README.md 없음`);
    if (!readFileSync(readme, "utf8").includes("졸업 게이트")) throw new Error(`${entry}: 졸업 게이트 절 없음`);
  }
});
// mainPlan/은 착수 전 계획 작업 공간이다. 아직 없는 파일과 신설 예정 심볼을 참조하는 것이 그 문서의
// 일이라 링크 생존과 문서 법의 대상이 아니고, 그래서 러너의 collect가 건너뛴다. 그 배선이 사라지면
// 계획 문서가 제품 문서인 척 검사를 받아 엉뚱한 RED가 난다. 여기서 배선만 확인한다(내용은 안 본다).
check("mainPlan은 계획 작업 공간이라 린트 표면 밖이다", () => {
  const runner = readFileSync(join(ROOT, "tests", "run.mjs"), "utf8");
  const skips = runner.split("\n").some((line) => !line.trimStart().startsWith("//") && line.includes('entry === "mainPlan"'));
  if (!skips) throw new Error("collect가 mainPlan을 건너뛰지 않는다");
});
check("mainPlan은 큰 카테고리 자력 완결과 삭제를 요구한다", () => {
  const body = readFileSync(join(ROOT, "mainPlan", "README.md"), "utf8");
  for (const requiredRule of [
    "이니셔티브 하나를 큰 작업 카테고리로 고정한다",
    "자력으로 수행할 수 있는 모든",
    "같은 사이클에",
    "폴더째 삭제한다",
  ]) {
    if (!body.includes(requiredRule)) throw new Error(`mainPlan 운영 규칙 누락: ${requiredRule}`);
  }
});
// Git은 빈 디렉터리를 추적하지 않는다. 그래서 git tree에 경로가 0개라는 판정만으로는 완료한
// 카테고리의 물리 폴더가 사라졌다고 말할 수 없다. 실제 worktree의 모든 하위 디렉터리가 계획
// README를 갖는지 검사하면 완료 뒤 남거나 다시 생긴 빈 폴더가 commit과 push 전에 RED가 된다.
check("mainPlan 카테고리는 빈 물리 폴더로 남을 수 없다", () => {
  const dir = join(ROOT, "mainPlan");
  const directoryNames = readdirSync(dir).filter((entry) => statSync(join(dir, entry)).isDirectory());
  const missing = missingCategoryReadmes({
    directoryNames,
    hasReadme: (name) => existsSync(join(dir, name, "README.md")),
  });
  if (missing.length) throw new Error(`README 없는 mainPlan 카테고리: ${missing.join(", ")}`);
});
check("탐지기가 문다: 완료 뒤 남은 빈 mainPlan 폴더", () => {
  const missing = missingCategoryReadmes({
    directoryNames: ["finishedInitiative"],
    hasReadme: () => false,
  });
  if (missing.length !== 1 || missing[0] !== "finishedInitiative") {
    throw new Error("빈 mainPlan 카테고리 음성 fixture를 놓쳤다");
  }
});
check("지속 제품·운영 skill owner가 존재한다", () => {
  for (const path of [
    ["skills", "understand-pyproc", "references", "vision.md"],
    ["skills", "develop-pyproc", "references", "operating-model.md"],
    ["skills", "evolve-pyproc", "references", "contract-reality.md"],
  ]) {
    if (!existsSync(join(ROOT, ...path))) throw new Error(`${path.join("/")}: 지속 계약 없음`);
  }
});
}
