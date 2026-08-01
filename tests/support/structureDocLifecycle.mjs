// structureDocLifecycle.mjs - [구조] 절에서 나온 검사 묶음.
//
// 크기가 아니라 책임으로 나눴다: 이 묶음의 검사들은 자기 상수만 쓰고, 러너가 주는 것은 공용
// 헬퍼와 check뿐이다. 절 이름과 검사 이름은 그대로라 게이트 층 하한은 움직이지 않는다.
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
check("은퇴한 mainPlan archive가 재등장하지 않는다", () => {
  if (existsSync(join(ROOT, "mainPlan"))) throw new Error("mainPlan은 docs/tests/git 이력으로 수렴해 은퇴했다");
});
check("지속 제품·운영 계약 문서가 존재한다", () => {
  for (const path of [
    ["docs", "product", "vision.md"],
    ["docs", "operations", "operatingModel.md"],
    ["docs", "operations", "contractReality.md"],
  ]) {
    if (!existsSync(join(ROOT, ...path))) throw new Error(`${path.join("/")}: 지속 계약 없음`);
  }
});
}
