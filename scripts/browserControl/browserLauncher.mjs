// browserLauncher.mjs - 설치 제품과 browser gate가 공유하는 격리 Chromium process 수명주기.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function findBrowser({ executable = process.env.PYPROC_BROWSER || "" } = {}) {
  if (executable) {
    if (!existsSync(executable)) throw new Error(`Chromium executable is unavailable: ${executable}`);
    return executable;
  }
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
  const found = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!found) throw new Error("No supported Chromium executable was found. Set browser.executable or PYPROC_BROWSER.");
  return found;
}

export function browserLaunchArgs(profileDir, opts = {}) {
  const gpu = opts.gpu === true || process.env.PYPROC_GPU === "1";
  const headed = opts.headed === true || process.env.PYPROC_HEADED === "1";
  const args = [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    `--user-data-dir=${profileDir}`,
  ];
  if (!opts.enableExtensions) args.push("--disable-extensions");
  if (!headed) args.push("--headless=new");
  if (!headed && gpu) args.push("--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--enable-features=Vulkan");
  else if (!headed) args.push("--disable-gpu");
  if (process.env.CI) args.push("--no-sandbox");
  return args;
}

// 호환 이름은 기존 browser gate가 소비한다. 제품 정본은 browserLaunchArgs다.
export const headlessArgs = browserLaunchArgs;

export function killBrowserProcess(proc, profileDir = null) {
  if (proc && proc.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    else proc.kill("SIGKILL");
  }
  if (process.platform === "win32" && profileDir) {
    const needle = profileDir.replace(/'/g, "''").replace(/\\/g, "*");
    spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `$deadline = (Get-Date).AddSeconds(10); while ((Get-Date) -lt $deadline) { `
      + `$p = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle}*' }; `
      + "if (-not $p) { break }; $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; "
      + "Start-Sleep -Milliseconds 200 }",
    ], { stdio: "ignore", timeout: 20000 });
  }
}

export const killBrowser = killBrowserProcess;

export function launchBrowser(url, opts = {}) {
  const browser = opts.browser || findBrowser({ executable: opts.executable });
  const profile = mkdtempSync(join(opts.profileRoot || tmpdir(), opts.prefix || "pyprocBrowser-"));
  const extraArgs = opts.extraArgs === undefined ? [] : opts.extraArgs;
  if (!Array.isArray(extraArgs) || extraArgs.some((arg) => typeof arg !== "string")) {
    throw new TypeError("launchBrowser: extraArgs must be an array of strings");
  }
  const proc = spawn(browser, [...browserLaunchArgs(profile, opts), ...extraArgs, url], { stdio: "ignore" });
  const spawnedAt = Date.now();
  let exitInfo = null;
  const whenExited = new Promise((resolve) => {
    proc.on("exit", (code, signal) => {
      exitInfo = { code, signal, afterMs: Date.now() - spawnedAt };
      resolve(exitInfo);
    });
    proc.on("error", (error) => {
      exitInfo = { code: null, signal: null, afterMs: Date.now() - spawnedAt,
        error: String(error?.message || error) };
      resolve(exitInfo);
    });
  });
  let closed = false;
  return Object.freeze({
    browser,
    profile,
    proc,
    exited: () => exitInfo,
    whenExited,
    close() {
      if (closed) return;
      closed = true;
      killBrowserProcess(proc, profile);
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
      catch (error) { if (existsSync(profile)) process.stderr.write(`pyproc browser profile cleanup deferred: ${error?.code || error}\n`); }
    },
  });
}
