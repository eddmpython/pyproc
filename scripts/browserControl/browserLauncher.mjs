// browserLauncher.mjs - 설치 제품과 browser gate가 공유하는 격리 Chromium process 수명주기.
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync }
  from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { BROWSER_DESKTOP_HELPER_FAILED, browserDesktopHelper, browserDesktopOf }
  from "./browserDesktop/browserDesktopHelper.mjs";

const profileCleanupWaiter = new Int32Array(new SharedArrayBuffer(4));
const PROFILE_ABSENCE_STABILITY_MS = 750;

function removeBrowserProfile(profile) {
  const deadline = Date.now() + 10000;
  let lastError = null;
  let absentSince = null;
  do {
    if (existsSync(profile)) absentSince = null;
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }); }
    catch (error) { lastError = error; }
    if (!existsSync(profile)) {
      absentSince ??= Date.now();
      if (Date.now() - absentSince >= PROFILE_ABSENCE_STABILITY_MS) return;
    } else {
      absentSince = null;
    }
    Atomics.wait(profileCleanupWaiter, 0, 0, 100);
  } while (Date.now() < deadline);
  const error = new Error(`browser profile cleanup did not converge: ${profile}`,
    lastError ? { cause: lastError } : undefined);
  error.code = "BROWSER_PROFILE_CLEANUP_FAILED";
  throw error;
}

// The lock a session leaves in a persistent user data directory while it owns it, and the failure a second session gets.
export const BROWSER_USER_DATA_LOCK = "pyprocUserData.lock";
export const BROWSER_USER_DATA_IN_USE = "BROWSER_USER_DATA_IN_USE";

function processRuns(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

/** Prepare a persistent user data directory for the browser (`--user-data-dir`). The browser keeps its own state there
 *  across sessions: cookies, signed-in accounts, site settings. Chrome lets one running instance own such a directory and a
 *  second launch hands itself to the first and exits, so a lock file naming the owning process is written there and a
 *  second session fails with `BROWSER_USER_DATA_IN_USE` while that process runs; a lock a dead process left is replaced.
 *  First preferences are written only for a directory that has none yet, so an existing profile's settings are never
 *  overwritten. `release()` removes the lock and keeps the directory. */
export function prepareBrowserUserData({ userDataDir, preferences = null } = {}) {
  if (typeof userDataDir !== "string" || !isAbsolute(userDataDir)) {
    throw new TypeError("userDataDir must be an absolute folder path");
  }
  mkdirSync(userDataDir, { recursive: true });
  const lock = join(userDataDir, BROWSER_USER_DATA_LOCK);
  let fd;
  try { fd = openSync(lock, "wx"); }
  catch (error) {
    if (error?.code !== "EEXIST") throw error;
    let holder = NaN;
    try { holder = Number(readFileSync(lock, "utf8").trim()); } catch { holder = NaN; }
    if (holder !== process.pid && processRuns(holder)) {
      const busy = new Error(`the browser user data directory is in use by process ${holder}: ${userDataDir}`);
      busy.code = BROWSER_USER_DATA_IN_USE;
      throw busy;
    }
    unlinkSync(lock);
    fd = openSync(lock, "wx");
  }
  writeFileSync(fd, String(process.pid));
  closeSync(fd);
  const preferencesFile = join(userDataDir, "Default", "Preferences");
  if (preferences && !existsSync(preferencesFile)) {
    mkdirSync(join(userDataDir, "Default"), { recursive: true });
    writeFileSync(preferencesFile, JSON.stringify(preferences));
  }
  return Object.freeze({
    dir: userDataDir,
    release() { try { unlinkSync(lock); } catch (error) { if (error?.code !== "ENOENT") throw error; } },
  });
}

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
  if (process.platform === "win32") {
    if (proc && proc.exitCode === null) {
      spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    }
  } else if (proc?.pid) {
    try { process.kill(-proc.pid, "SIGKILL"); }
    catch (error) {
      if (error?.code !== "ESRCH") throw error;
      if (proc.exitCode === null) proc.kill("SIGKILL");
    }
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
  const extraArgs = opts.extraArgs === undefined ? [] : opts.extraArgs;
  if (!Array.isArray(extraArgs) || extraArgs.some((arg) => typeof arg !== "string")) {
    throw new TypeError("launchBrowser: extraArgs must be an array of strings");
  }
  const preferences = opts.preferences === undefined ? null : opts.preferences;
  if (preferences !== null && (typeof preferences !== "object" || Array.isArray(preferences))) {
    throw new TypeError("launchBrowser: preferences must be an object");
  }
  // On a private desktop the helper starts the browser with these same handles and waits for it, so its windows never
  // take the user's foreground or keyboard; a tree kill of the helper ends the browser.
  const desktop = browserDesktopOf(opts);
  const helper = desktop === "private" ? browserDesktopHelper() : null;
  // The scratch folder (the broker's downloads and artifacts) is always temporary and removed at close. The browser's own
  // state lives there too, unless `userDataDir` names a persistent directory of its own (prepareBrowserUserData).
  const profile = mkdtempSync(join(opts.profileRoot || tmpdir(), opts.prefix || "pyprocBrowser-"));
  let userData = null;
  if (opts.userDataDir !== undefined && opts.userDataDir !== null) {
    try { userData = prepareBrowserUserData({ userDataDir: opts.userDataDir, preferences }); }
    catch (error) { removeBrowserProfile(profile); throw error; }
  } else if (preferences) {
    // 새 profile의 첫 설정은 브라우저가 뜨기 전에 써야 첫 페이지부터 적용된다.
    mkdirSync(join(profile, "Default"), { recursive: true });
    writeFileSync(join(profile, "Default", "Preferences"), JSON.stringify(preferences));
  }
  const dataDir = userData ? userData.dir : profile;
  // cdpPipe: CDP를 loopback port가 아니라 브라우저 fd 3(읽기)과 fd 4(쓰기) pipe로 연다. 부모 쪽에서는
  // stdio[3]에 쓰고 stdio[4]에서 읽는다. listener가 없으므로 이 브라우저에 붙을 수 있는 것은 이 프로세스뿐이다.
  const pipeArgs = opts.cdpPipe === true ? ["--remote-debugging-pipe"] : [];
  const launchArgs = [...browserLaunchArgs(dataDir, opts), ...pipeArgs, ...extraArgs, url];
  // The helper says on standard error why it could not start the browser; nothing else is kept from it.
  const errorOut = helper ? "pipe" : "ignore";
  const proc = spawn(helper || browser, helper ? [browser, ...launchArgs] : launchArgs, {
    stdio: opts.cdpPipe === true ? ["ignore", "ignore", errorOut, "pipe", "pipe"] : ["ignore", "ignore", errorOut],
    detached: process.platform !== "win32",
  });
  let helperSaid = "";
  proc.stderr?.on("data", (chunk) => { helperSaid = `${helperSaid}${chunk}`.slice(-2000); });
  const spawnedAt = Date.now();
  let exitInfo = null;
  const whenExited = new Promise((resolve) => {
    proc.on("exit", (code, signal) => {
      const helperFailed = helper !== null && code === BROWSER_DESKTOP_HELPER_FAILED;
      exitInfo = { code, signal, afterMs: Date.now() - spawnedAt,
        ...(helperFailed ? { error: helperSaid.trim() || "the browser desktop helper failed" } : {}) };
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
    desktop,
    profile,
    userDataDir: userData ? userData.dir : null,
    proc,
    cdpPipe: opts.cdpPipe === true ? Object.freeze({ write: proc.stdio[3], read: proc.stdio[4] }) : null,
    exited: () => exitInfo,
    whenExited,
    close() {
      if (closed) return;
      killBrowserProcess(proc, profile);
      removeBrowserProfile(profile);
      // A persistent directory is kept; strays that still name it are ended and its lock is released.
      if (userData) { killBrowserProcess(null, userData.dir); userData.release(); }
      closed = true;
    },
  });
}
