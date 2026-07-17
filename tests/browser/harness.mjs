// harness.mjs - 브라우저 게이트 공용 조각. 브라우저를 띄우는 모든 게이트(run/examples/
// productConsumer/speedBench/mcpSandboxServer)가 같은 탐색과 같은 수명주기를 쓴다.
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
export function killBrowser(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  else proc.kill("SIGKILL");
}

// url을 헤드리스로 연다. 프로필은 매번 새로 만든다(같은 프로필을 두 인스턴스가 물면
// 두 번째가 조용히 첫 번째에 탭만 넘기고 즉시 종료한다 = 게이트가 영영 리포트를 못 받는다).
// 반환: { proc, profile, browser, close() }. close()는 트리 종료 + 프로필 정리까지 한다.
export function launchBrowser(url, opts = {}) {
  const browser = opts.browser || findBrowser();
  const profile = mkdtempSync(join(opts.profileRoot || tmpdir(), opts.prefix || "pyprocGate-"));
  const proc = spawn(browser, [...headlessArgs(profile), url], { stdio: "ignore" });
  return {
    browser,
    profile,
    proc,
    close() {
      killBrowser(proc);
      try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 잠긴 프로필은 OS 임시 청소에 맡긴다 */ }
    },
  };
}
