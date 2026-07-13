// harness.mjs - 브라우저 게이트 공용 조각. run.mjs(공개 표면 게이트)와
// examples.mjs(예제 실행 게이트)가 같은 브라우저 탐색을 쓴다(드리프트 방지).
import { existsSync } from "node:fs";
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
