// 게이트 실행의 계수기. 섹션 단위로 체크 수를 세고, 하한(floor)과 대조해 "체크가 조용히
// 사라지는" 실패 모드를 막는다. 근거는 실측이다(2026-07-26): 이 층이 없을 때
// [election 프로토콜] 절 전체를 지워도 결과는 GREEN이었다. 게이트 수 추이가 사람의 기억과
// 원장에만 살면, 검증됐다는 착각을 파는 것은 게이트 자신이 된다.
export function createGateCounter({ log = console.log } = {}) {
  let passed = 0;
  let failed = 0;
  let current = "";
  const perSection = new Map();
  // 법(law) 단위 계수. 섹션 총계만 대조하면 섹션 안의 법 하나를 통째로 지워도 다른 법이 파일
  // 수만큼 늘어나며 그 자리를 메운다. 실측(2026-07-27): [digest 법] 섹션 하한 443에 실제
  // 555여서 여유가 112였고, 그 안의 네 법(로케일 비교자·공유 헬퍼 import·코덱·엔진 내부 접근)이
  // 각각 106~112개라 어느 하나를 완전히 삭제해도 총계가 하한을 넘어 GREEN이었다.
  // 법 이름 = 체크 이름의 `: ` 앞부분(파일별 순회가 같은 접두를 공유한다).
  const perLaw = new Map();
  const lawOf = (name) => {
    const at = name.indexOf(": ");
    return at < 0 ? name : name.slice(0, at);
  };

  const count = (name) => {
    const law = lawOf(name);
    perLaw.set(law, (perLaw.get(law) || 0) + 1);
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
    return Object.freeze({
      passed,
      failed,
      sections: Object.fromEntries(perSection),
      laws: Object.fromEntries(perLaw),
    });
  }

  // 하한은 예외 목록이 아니라 예산이다: 체크를 의도적으로 줄이면 이 숫자를 같은 커밋에서
  // 내려야 하고, 그 diff가 곧 심사 지점이 된다.
  // 파일별로 순회하는 법은 체크 수가 파일 수에 비례해 커진다. 그 크기가 섹션 총계의 여유가
  // 되어 다른 법을 숨기므로, 이 크기 이상인 법은 자기 하한을 따로 갖는다. 문턱을 넘는 새 법은
  // 자동으로 등재를 요구받는다(사람이 기억해서 등재하는 구조는 표류한다).
  const LAW_FLOOR_THRESHOLD = 10;
  function assertFloors(floors, lawFloors = {}) {
    const shortfalls = [];
    for (const [title, minimum] of Object.entries(floors)) {
      const actual = perSection.get(title);
      if (actual === undefined) shortfalls.push(`${title}: 섹션이 사라졌다(하한 ${minimum})`);
      else if (actual < minimum) shortfalls.push(`${title}: ${actual} < 하한 ${minimum}`);
    }
    for (const title of perSection.keys()) {
      if (!(title in floors)) shortfalls.push(`${title}: 하한 미등재(새 섹션은 하한과 함께 낸다)`);
    }
    for (const [law, minimum] of Object.entries(lawFloors)) {
      const actual = perLaw.get(law) || 0;
      if (!actual) shortfalls.push(`법 ${law}: 사라졌다(하한 ${minimum})`);
      else if (actual < minimum) shortfalls.push(`법 ${law}: ${actual} < 하한 ${minimum}`);
    }
    for (const [law, actual] of perLaw) {
      if (actual >= LAW_FLOOR_THRESHOLD && !(law in lawFloors)) {
        shortfalls.push(`법 ${law}: ${actual}개인데 하한 미등재(파일별 순회는 하한과 함께 낸다)`);
      }
    }
    if (shortfalls.length) {
      failed++;
      log(`  FAIL 게이트 층 하한: ${shortfalls.join(" / ")}`);
      return false;
    }
    passed++;
    log(`  PASS 게이트 층 하한 ${Object.keys(floors).length}개 섹션 + ${Object.keys(lawFloors).length}개 법`);
    return true;
  }

  function exit() {
    const result = summary();
    log(`\n결과: ${result.passed} passed, ${result.failed} failed`);
    process.exit(result.failed ? 1 : 0);
  }

  return Object.freeze({ check, checkAsync, section, summary, assertFloors, exit });
}
