// harness.mjs - browser product launcher 위에 gate report 진단과 판정만 더한다.
export {
  browserLaunchArgs,
  findBrowser,
  headlessArgs,
  killBrowser,
  killBrowserProcess,
  launchBrowser,
} from "../../scripts/browserControl/browserLauncher.mjs";

export function countRequests(server) {
  let seen = 0;
  server.on("request", () => { seen++; });
  return () => seen;
}

export async function awaitGateReport({ reportPromise, timeoutMs, session, relaunch = null, requestCount = null, progress = null, log = console.log }) {
  const startedAt = Date.now();
  let current = session;
  let relaunched = false;
  let exitHeard = false;
  const requests = () => (requestCount ? requestCount() : null);
  const report = reportPromise.then((result) => ({ kind: "report", result }));
  while (true) {
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) break;
    const arms = [report, new Promise((resolve) => setTimeout(() => resolve({ kind: "timeout" }), remaining))];
    if (!exitHeard) arms.push(current.whenExited.then(() => ({ kind: "exit" })));
    const raced = await Promise.race(arms);
    if (raced.kind === "report") return { result: raced.result, session: current };
    if (raced.kind === "timeout") break;
    exitHeard = true;
    if ((requests() ?? 0) === 0) {
      const grace = Math.min(3000, Math.max(0, timeoutMs - (Date.now() - startedAt)));
      const followup = await Promise.race([
        report,
        new Promise((resolve) => setTimeout(() => resolve({ kind: "grace-over" }), grace)),
      ]);
      if (followup.kind === "report") return { result: followup.result, session: current };
    }
    if ((requests() ?? 0) > 0) continue;
    if (!relaunch || relaunched) break;
    relaunched = true;
    const exit = current.exited();
    log(`  재발사: 런처가 요청 0건인 채 종료(code=${exit?.code} signal=${exit?.signal ?? "없음"} +${exit?.afterMs}ms). 발사 배관 실패로 판정, 1회 재발사한다.`);
    current.close();
    current = relaunch();
    exitHeard = false;
  }
  const exit = current.exited();
  const diagnosis = {
    browser: exit ? `exited(code=${exit.code} signal=${exit.signal ?? "없음"} +${exit.afterMs}ms${exit.error ? ` error=${exit.error}` : ""})` : "alive-but-silent",
    requests: requests() ?? "미측정",
    lastProgress: progress ? progress() : undefined,
    relaunched,
    elapsedMs: Date.now() - startedAt,
  };
  return { result: { ok: false, checks: [], timedOut: true, diagnosis }, session: current };
}

export function judgeReport(result, opts = {}) {
  const checks = Array.isArray(result?.checks) ? result.checks : [];
  const passed = checks.filter((entry) => entry.pass).length;
  const extra = Array.isArray(opts.extra) ? opts.extra : [];
  const problems = [];
  if (result?.timedOut) problems.push(opts.timeoutLabel || "타임아웃");
  if (!checks.length) problems.push("체크 0개: 페이지가 아무것도 단정하지 않았다");
  const failed = checks.filter((entry) => !entry.pass);
  if (failed.length) problems.push(`실패 체크 ${failed.length}개: ${failed.map((entry) => entry.name).join(", ").slice(0, 160)}`);
  for (const entry of extra) if (!entry.pass) problems.push(entry.name);
  const floor = opts.floor;
  if (Number.isFinite(floor) && passed + extra.filter((entry) => entry.pass).length < floor) {
    problems.push(`게이트 층 하한: 통과 ${passed + extra.filter((entry) => entry.pass).length} < 하한 ${floor}`);
  }
  return Object.freeze({
    ok: problems.length === 0,
    passed: passed + extra.filter((entry) => entry.pass).length,
    total: checks.length + extra.length,
    problems: Object.freeze(problems),
  });
}
