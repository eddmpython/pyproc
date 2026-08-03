// harness.mjs - 브라우저 게이트 공용 조각. 브라우저를 띄우는 모든 게이트(run/examples/
// installedPackageGate/speedBench/mcpSandboxServer)가 같은 탐색과 같은 수명주기를 쓴다.
//
// 왜 수명주기까지 여기인가: spawn -> 대기 -> 종료 -> 프로필 삭제가 다섯 벌로 복제돼 있었고
// 이미 갈라져 있었다(프로필을 mkdtemp로 만드는 곳과 pid 고정 경로로 만드는 곳, 종료를
// taskkill /T로 하는 곳과 SIGKILL만 하는 곳). 특히 브라우저 종료의 플랫폼 분기는 한 곳에
// 있어야 하는 지식이다: win32에서 proc.kill()은 런처만 죽이고 렌더러 자식이 살아남는다.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function findBrowser() {
  if (process.env.PYPROC_BROWSER) return process.env.PYPROC_BROWSER;
  const candidates = process.platform === "win32" ? [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
  ] : process.platform === "darwin" ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ] : [
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser", "/usr/bin/chromium", "/usr/bin/microsoft-edge",
  ];
  const found = candidates.find((c) => c && existsSync(c));
  if (!found) throw new Error("Chromium 계열 브라우저를 찾지 못함. PYPROC_BROWSER=<경로>로 지정하라.");
  return found;
}

// headless 실행 인자(프로필 경로는 호출자가 준다). CI에선 --no-sandbox(컨테이너 러너 호환).
// PYPROC_GPU=1 실측 결과(2026-08-01): 이 스위치로는 어댑터가 안 잡힌다. Edge headless에
// --enable-unsafe-swiftshader --use-angle=swiftshader를 줘도 requestAdapter()가 null을 준다.
// 그러므로 GPU 축의 수동 probe 상한은 이 경로로 못 푼다(CI 하드웨어가 바뀌어야 한다).
// 스위치는 남긴다: 러너가 바뀌면 먼저 시험할 자리가 여기다.
// PYPROC_GPU=1이면 소프트웨어 WebGPU 어댑터(SwiftShader)를 켠다: GPU 능력 probe가 하드웨어
// GPU 없는 CI에서도 정합성(업로드/컴퓨트/리드백)을 실측하기 위함. 속도(G2)는 소프트웨어라
// 무의미하니 실 GPU 머신 몫(numerical-acceleration 02-phasing). 기본은 --disable-gpu(모든 게이트 불변).
export function headlessArgs(profileDir) {
  const gpu = process.env.PYPROC_GPU === "1";
  // PYPROC_HEADED=1: 창 있는 브라우저(하드웨어 GPU 어댑터 확보용). WebGPU는 헤드리스에서
  // 어댑터가 안 뜨므로(실측), GPU probe만 실 머신에서 창 모드로 검증한다(소켓 릴레이와 같은 계급).
  const headed = process.env.PYPROC_HEADED === "1";
  const args = [
    "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-background-networking", `--user-data-dir=${profileDir}`,
  ];
  if (!headed) args.push("--headless=new");
  if (headed) { /* 창 모드 = 하드웨어 GPU 사용(--disable-gpu 미부착) */ }
  else if (gpu) args.push("--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--enable-features=Vulkan");
  else args.push("--disable-gpu");
  if (process.env.CI) args.push("--no-sandbox");
  return args;
}

// 브라우저 프로세스 트리를 확실히 죽인다. win32의 proc.kill()은 런처만 죽이고 렌더러
// 자식이 살아남아 프로필 디렉터리를 물고 있으므로 taskkill /T로 트리째 끊는다.
//
// pid 트리 종료만으로는 부족하다(실측 2026-07-19): Edge가 스폰된 런처를 실제 브라우저에
// 위임시키고 먼저 종료시켜서(런처 exitCode 0, 트리 17프로세스 생존) pid 기준 종료가 아무것도
// 못 죽인다. 그러면 다음 launch가 같은 프로필의 생존 인스턴스에 탭만 넘기고 죽어 재시작
// phase가 영영 리포트를 못 받는다. 프로필 경로는 런당 mkdtemp로 유일하므로, 그 경로를
// 명령행에 문 프로세스를 소유 기준으로 쓸어낸다(다른 프로필 = 사용자 브라우저는 불가침).
export function killBrowser(proc, profileDir = null) {
  if (proc && proc.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    else proc.kill("SIGKILL");
  }
  if (process.platform === "win32" && profileDir) {
    const needle = profileDir.replace(/'/g, "''").replace(/\\/g, "*"); // -like 패턴: 구분자 차이(\ vs /)를 와일드카드로 흡수
    // 죽음 확인까지 기다린다: 죽어가는 프로세스가 프로필 singleton을 쥔 채로 다음 launch가
    // 오면 새 인스턴스가 그 시체에 탭을 위임하다 유실된다(재시작 phase 행의 두 번째 원인,
    // 실측 2026-07-19: sweep 직후 즉시 재실행은 행, 2초 대기 후 재실행은 완주).
    spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `$deadline = (Get-Date).AddSeconds(10); while ((Get-Date) -lt $deadline) { ` +
      `$p = Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${needle}*' }; ` +
      `if (-not $p) { break }; $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 200 }`,
    ], { stdio: "ignore", timeout: 20000 });
  }
}

// url을 헤드리스로 연다. 프로필은 매번 새로 만든다(같은 프로필을 두 인스턴스가 물면
// 두 번째가 조용히 첫 번째에 탭만 넘기고 즉시 종료한다 = 게이트가 영영 리포트를 못 받는다).
// 반환: { proc, profile, browser, exited(), whenExited, close() }.
// exited()는 런처 프로세스의 종료 기록이다(null = 아직 산다). Edge는 런처를 실제 브라우저에
// 위임하고 먼저 끝내기도 하므로(killBrowser 주석의 실측) 런처 종료 = 게이트 사망이 아니다.
// 그래서 이 기록은 판정이 아니라 진단 재료이고, 발사 직후의 이른 죽음(위임이 아니라 크래시)을
// 구분하는 쪽은 awaitGateReport다. close()는 트리 종료 + 프로필 정리까지 한다.
export function launchBrowser(url, opts = {}) {
  const browser = opts.browser || findBrowser();
  const profile = mkdtempSync(join(opts.profileRoot || tmpdir(), opts.prefix || "pyprocGate-"));
  const proc = spawn(browser, [...headlessArgs(profile), url], { stdio: "ignore" });
  const spawnedAt = Date.now();
  let exitInfo = null;
  const whenExited = new Promise((resolve) => {
    proc.on("exit", (code, signal) => {
      exitInfo = { code, signal, afterMs: Date.now() - spawnedAt };
      resolve(exitInfo);
    });
    proc.on("error", (error) => {
      exitInfo = { code: null, signal: null, afterMs: Date.now() - spawnedAt, error: String(error && error.message || error) };
      resolve(exitInfo);
    });
  });
  return {
    browser,
    profile,
    proc,
    exited: () => exitInfo,
    whenExited,
    close() {
      killBrowser(proc, profile);
      try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 잠긴 프로필은 OS 임시 청소에 맡긴다 */ }
    },
  };
}

// 서버가 본 요청 수. http.Server의 request 이벤트는 리스너를 더 달아도 기존 처리에 영향이
// 없으므로 러너의 서버 조립(createStaticServer든 직접 createServer든)을 건드리지 않는다.
export function countRequests(server) {
  let seen = 0;
  server.on("request", () => { seen++; });
  return () => seen;
}

// 리포트 대기 + 타임아웃 진단 + 발사 실패 1회 재발사. 세 결정이 한 곳에 사는 이유:
//
// 지금까지 타임아웃은 증거 없이 "FAIL 타임아웃" 한 줄이었다. 실측(2026-08-03, edge-release
// installed 레인): 같은 커밋·같은 분에 성공 실행은 52초에 끝났는데 실패 실행은 헤더 출력 뒤
// 240초 내내 완전 침묵이었고, 브라우저가 죽었는지 페이지가 로드됐는지 아무것도 남지 않아
// 원인 미식별로 끝났다. 그 전에도 같은 급의 미식별이 하나 있다(콜드 119/120, 재현 12회 실패).
// 진단 없는 타임아웃은 같은 사건을 계속 미식별로 만든다.
//
// 재발사는 정확히 한 경우다: **리포트도 서버 요청도 없는 채로 런처가 죽었다**(발사 자체의
// 실패. 시험 대상은 페이지의 체크이지 브라우저 부팅이 아니다). 요청이 이미 있었으면 페이지가
// 살았던 것이므로 재발사가 실 실패를 가릴 수 있어 하지 않고, 살아 있는데 침묵하면 행이므로
// 역시 하지 않는다(재시도는 행의 진단을 죽인다). 재발사는 1회이고 크게 기록한다.
//
// 인자: reportPromise(페이지의 최종 보고), timeoutMs, session(launchBrowser 반환),
// relaunch(새 session을 만드는 함수, 생략 시 재발사 없음), requestCount(서버가 본 요청 수를
// 주는 함수, 생략 시 진단에서 "미측정"), progress(페이지가 흘린 마지막 진행 단계를 주는 함수,
// 선택), log. 반환: { result, session }. 호출자는 반환된 session을 close()한다(재발사됐으면
// 처음 것이 아니다).
export async function awaitGateReport({ reportPromise, timeoutMs, session, relaunch = null, requestCount = null, progress = null, log = console.log }) {
  const startedAt = Date.now();
  let current = session;
  let relaunched = false;
  // 런처 종료는 세션당 한 번만 심리한다. 종료한 whenExited는 영원히 resolved라 매 라운드
  // race를 즉시 이기고, 위임 종료(요청은 계속 온다)에서 루프가 뜨거운 회전이 된다.
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
    // 런처 종료. Edge 위임 종료(코드 0, 브라우저 트리는 생존해 요청을 낸다)와 발사 크래시를
    // 요청 수로 가른다. 요청 0이면 늦은 로드일 수 있으니 짧게만 기다려 본다.
    exitHeard = true;
    if ((requests() ?? 0) === 0) {
      const grace = Math.min(3000, Math.max(0, timeoutMs - (Date.now() - startedAt)));
      const followup = await Promise.race([
        report,
        new Promise((resolve) => setTimeout(() => resolve({ kind: "grace-over" }), grace)),
      ]);
      if (followup.kind === "report") return { result: followup.result, session: current };
    }
    if ((requests() ?? 0) > 0) continue; // 위임 종료: 페이지는 산다. 리포트만 기다린다.
    if (!relaunch || relaunched) break; // 발사 실패인데 재발사 카드가 없다: 진단을 실어 끝낸다.
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
    // 페이지가 흘린 마지막 진행 단계. 행은 이 단계와 그다음 단계 사이에 있다.
    lastProgress: progress ? progress() : undefined,
    relaunched,
    elapsedMs: Date.now() - startedAt,
  };
  return { result: { ok: false, checks: [], timedOut: true, diagnosis }, session: current };
}

// 판정은 러너가 한다. `result.ok`는 시험 대상인 페이지가 계산해 보내온 값이라 그것만 믿으면
// 검증 대상이 자기 합격을 선언한다. 페이지들이 각자 `checks.every(pass)` 사본을 갖고 있었고
// 어느 게이트도 그 공식을 강제하지 않았다: 한 페이지가 `some(...)`으로 표류하거나 `ok: true`를
// 박으면 FAIL 줄을 인쇄하면서 exit 0이었다. 그 판정이 러너 5개에 흩어져 있었으므로 여기 모은다.
// 페이지가 보낸 ok는 참고값으로 강등하고 읽지 않는다.
//
// opts.floor: 통과 체크 수 하한(등재된 페이지만). opts.extra: 러너가 페이지 밖에서 만든 단정
// 목록([{ name, pass }]). opts.timeoutLabel: 타임아웃 표기.
export function judgeReport(result, opts = {}) {
  const checks = Array.isArray(result?.checks) ? result.checks : [];
  const passed = checks.filter((entry) => entry.pass).length;
  const extra = Array.isArray(opts.extra) ? opts.extra : [];
  const problems = [];
  if (result?.timedOut) problems.push(opts.timeoutLabel || "타임아웃");
  // 체크 0개는 합격이 아니다. 빈 보고를 통과로 세면 페이지 사망이 GREEN (0/0)이 된다.
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
