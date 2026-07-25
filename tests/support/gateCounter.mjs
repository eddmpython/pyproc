export function createGateCounter({ log = console.log } = {}) {
  let passed = 0;
  let failed = 0;

  const ok = (name) => {
    passed++;
    log(`  PASS ${name}`);
  };
  const bad = (name, error) => {
    failed++;
    log(`  FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  };

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
    return Object.freeze({ passed, failed });
  }

  function exit() {
    const result = summary();
    log(`\n결과: ${result.passed} passed, ${result.failed} failed`);
    process.exit(result.failed ? 1 : 0);
  }

  return Object.freeze({ check, checkAsync, summary, exit });
}
