// 게이트 실행의 계수기. 섹션 단위로 체크 수를 세고, 하한(floor)과 대조해 "체크가 조용히
// 사라지는" 실패 모드를 막는다. 근거는 실측이다(2026-07-26): 이 층이 없을 때
// [election 프로토콜] 절 전체를 지워도 결과는 GREEN이었다. 게이트 수 추이가 사람의 기억과
// 원장에만 살면, 검증됐다는 착각을 파는 것은 게이트 자신이 된다.
export function createGateCounter({ log = console.log } = {}) {
  let passed = 0;
  let failed = 0;
  let current = "";
  const perSection = new Map();

  const count = (name) => {
    if (!current) return;
    perSection.set(current, (perSection.get(current) || 0) + 1);
  };
  const ok = (name) => {
    passed++;
    count(name);
    log(`  PASS ${name}`);
  };
  const bad = (name, error) => {
    failed++;
    count(name);
    log(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  };

  // 섹션 제목의 형식을 한 곳에서 만든다. 제목이 계수기를 거치므로 "어느 섹션의 체크인가"가
  // 출력과 하한 대조에서 같은 값이 된다(제목을 print만 하면 그 둘이 갈라진다).
  function section(title) {
    current = title;
    if (!perSection.has(title)) perSection.set(title, 0);
    log(`\n[${title}]`);
  }

  function check(name, fn) {
    try {
      const result = fn();
      if (result && typeof result.then === "function") {
        result.catch(() => {});
        throw new Error("동기 check에 Promise가 반환됐다. checkAsync를 사용해야 한다");
      }
      ok(name);
    } catch (error) {
      bad(name, error);
    }
  }

  async function checkAsync(name, fn) {
    try {
      await fn();
      ok(name);
    } catch (error) {
      bad(name, error);
    }
  }

  function summary() {
    return Object.freeze({ passed, failed, sections: Object.fromEntries(perSection) });
  }

  // 하한은 예외 목록이 아니라 예산이다: 체크를 의도적으로 줄이면 이 숫자를 같은 커밋에서
  // 내려야 하고, 그 diff가 곧 심사 지점이 된다.
  function assertFloors(floors) {
    const shortfalls = [];
    for (const [title, minimum] of Object.entries(floors)) {
      const actual = perSection.get(title);
      if (actual === undefined) shortfalls.push(`${title}: 섹션이 사라졌다(하한 ${minimum})`);
      else if (actual < minimum) shortfalls.push(`${title}: ${actual} < 하한 ${minimum}`);
    }
    for (const title of perSection.keys()) {
      if (!(title in floors)) shortfalls.push(`${title}: 하한 미등재(새 섹션은 하한과 함께 낸다)`);
    }
    if (shortfalls.length) {
      failed++;
      log(`  FAIL 게이트 층 하한: ${shortfalls.join(" / ")}`);
      return false;
    }
    passed++;
    log(`  PASS 게이트 층 하한 ${Object.keys(floors).length}개 섹션`);
    return true;
  }

  function exit() {
    const result = summary();
    log(`\n결과: ${result.passed} passed, ${result.failed} failed`);
    process.exit(result.failed ? 1 : 0);
  }

  return Object.freeze({ check, checkAsync, section, summary, assertFloors, exit });
}
