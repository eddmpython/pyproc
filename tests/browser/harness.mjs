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
export function headlessArgs(profileDir) {
  const args = [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-background-networking", `--user-data-dir=${profileDir}`,
  ];
  if (process.env.CI) args.push("--no-sandbox");
  return args;
}
