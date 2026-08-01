// structureDocLifecycle.mjs - [구조] 절에서 나온 검사 묶음.
//
// 크기가 아니라 책임으로 나눴다: 이 묶음의 검사들은 자기 상수만 쓰고, 러너가 주는 것은 공용
// 헬퍼와 check뿐이다. 절 이름과 검사 이름은 그대로라 게이트 층 하한은 움직이지 않는다.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

export function assertDocLifecycleStructure({ check, ROOT, collect, rel }) {
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
check("mainPlan 이니셔티브마다 README", () => {
  const dir = join(ROOT, "mainPlan");
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (!statSync(full).isDirectory()) continue;
      if (!existsSync(join(full, "README.md"))) throw new Error(`${rel(full)}: README.md 없음`);
    }
  };
  walk(dir); if (existsSync(join(dir, "_done"))) walk(join(dir, "_done"));
});
// mainPlan 수명주기 강제: "완료는 폴더째 _done 이관"이 사람 기억이 아니라 기계 가드다.
// 실제 사고(2026-07-18): 이니셔티브를 완료로 선언·보고하고도 활성 폴더에 방치했다.
// 규칙 문면이 있어도 게이트가 없으면 안 지켜진다는 실증이라 즉시 기계화한다.
check("mainPlan 수명주기: 완료 선언 = _done 이관 동시", () => {
  const dir = join(ROOT, "mainPlan");
  const doneDir = join(dir, "_done");
  const problems = [];
  // (a) 활성 이니셔티브는 완료를 선언할 수 없다(단계 완료 기록은 허용, 이니셔티브 완결 선언만 차단).
  const DONE_MARKERS = ["실질 완료", "완료 이관", "✅ 완료", "이니셔티브 완결"];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory() || entry === "_done") continue;
    for (const f of collect(full, [".md"], [])) {
      const text = readFileSync(f, "utf8");
      for (const marker of DONE_MARKERS) {
        if (text.includes(marker)) problems.push(`${rel(f)}: 활성 이니셔티브가 "${marker}" 선언(완료면 폴더째 _done 이관이 규칙)`);
      }
    }
  }
  // (b) _done 이니셔티브는 배너(상태 이모지 + 날짜)와 보관 목록 행을 가져야 한다.
  const doneIndex = readFileSync(join(doneDir, "README.md"), "utf8");
  for (const entry of readdirSync(doneDir)) {
    const full = join(doneDir, entry);
    if (!statSync(full).isDirectory()) continue;
    const readme = readFileSync(join(full, "README.md"), "utf8");
    if (!/[✅🚫🔀][^\n]*\(\d{4}-\d{2}-\d{2}[^)]*\)/u.test(readme)) problems.push(`_done/${entry}: 완료·폐기 배너(이모지 + 날짜) 없음`);
    if (!doneIndex.includes(`[${entry}/](${entry}/)`)) problems.push(`_done/README.md 보관 목록에 ${entry} 행 없음`);
  }
  // (c) 활성 목록 동기: mainPlan/README.md의 활성 절이 실제 활성 폴더와 1:1이어야 한다.
  const mainIndex = readFileSync(join(dir, "README.md"), "utf8");
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory() || entry === "_done") continue;
    if (!mainIndex.includes(`[${entry}](${entry}/README.md)`)) problems.push(`mainPlan/README.md 활성 목록에 ${entry} 없음`);
  }
  if (problems.length) throw new Error(problems.slice(0, 6).join("; "));
});
}
