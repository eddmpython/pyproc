// browserUserDataDir.mjs - contract of the persistent user data directory: which manifests may name it, how it reaches the
// launcher, and that one running session owns the directory at a time (Chrome hands a second launch of the same directory
// to the first and exits, so the lock refuses it before any browser starts).
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BROWSER_USER_DATA_IN_USE,
  BROWSER_USER_DATA_LOCK,
  prepareBrowserUserData,
} from "../../scripts/browserControl/browserLauncher.mjs";
import { validateMcpProductConfig } from "../../scripts/mcpProductConfig.mjs";

function errorOf(operation) {
  try { operation(); return null; } catch (error) { return error; }
}

export async function assertBrowserUserDataDir() {
  const scratch = mkdtempSync(join(tmpdir(), "pyprocUserDataContract-"));
  try {
    const persistent = join(scratch, "profile");
    // The manifest carries it for the launched provider only, as an absolute folder, and the environment the broker reads it
    // from names the same folder.
    const base = { schemaVersion: 1, engine: { enabled: false }, browser: { enabled: true, headed: true,
      allowedOrigins: ["https://work.example"], maxRisk: "read", actions: ["snapshot"] } };
    const withBrowser = (browser) => ({ ...base, browser: { ...base.browser, ...browser } });
    const named = validateMcpProductConfig(withBrowser({ userDataDir: persistent }));
    assert.equal(named.config.browser.userDataDir, persistent);
    assert.equal(named.env.PYPROC_BROWSER_USER_DATA_DIR, persistent);
    assert.equal(validateMcpProductConfig(base).env.PYPROC_BROWSER_USER_DATA_DIR, undefined);
    assert.match(String(errorOf(() => validateMcpProductConfig(withBrowser({ userDataDir: "profiles/dongap" })))?.message),
      /absolute folder/);
    assert.match(String(errorOf(() => validateMcpProductConfig(withBrowser({ userDataDir: persistent, requests: "safe" })))
      ?.message), /requests safe/);
    assert.match(String(errorOf(() => validateMcpProductConfig({ ...base, browser: { enabled: true,
      provider: "userBrowser", userBrowser: "chrome", allowedOrigins: ["https://work.example"], maxRisk: "read",
      actions: ["snapshot"], userDataDir: persistent } }))?.message), /does not accept browser.userDataDir/);

    // The directory is created, locked by this process, and kept; a second session fails while the lock is held and a
    // dead process's lock is replaced. First preferences go only into a directory that has none yet.
    const first = prepareBrowserUserData({ userDataDir: persistent, preferences: { first: true } });
    assert.equal(first.dir, persistent);
    assert.equal(readFileSync(join(persistent, BROWSER_USER_DATA_LOCK), "utf8"), String(process.pid));
    assert.deepEqual(JSON.parse(readFileSync(join(persistent, "Default", "Preferences"), "utf8")), { first: true });
    // The same process holds it (a second prepare by this process is the owner again, not a conflict).
    const again = prepareBrowserUserData({ userDataDir: persistent, preferences: { second: true } });
    assert.deepEqual(JSON.parse(readFileSync(join(persistent, "Default", "Preferences"), "utf8")), { first: true });
    again.release();
    assert.equal(existsSync(join(persistent, BROWSER_USER_DATA_LOCK)), false);
    assert.equal(existsSync(join(persistent, "Default", "Preferences")), true, "release keeps the directory");
    // A lock another running process holds refuses the directory. The parent of this test process is such a process.
    const runningOther = process.ppid && process.ppid !== process.pid ? process.ppid : null;
    if (runningOther) {
      writeFileSync(join(persistent, BROWSER_USER_DATA_LOCK), String(runningOther));
      const busy = errorOf(() => prepareBrowserUserData({ userDataDir: persistent }));
      assert.equal(busy?.code, BROWSER_USER_DATA_IN_USE);
      assert.match(String(busy?.message), /in use by process/);
    }
    // A lock a dead process left is replaced (a pid no process has).
    writeFileSync(join(persistent, BROWSER_USER_DATA_LOCK), "999999");
    const taken = prepareBrowserUserData({ userDataDir: persistent });
    assert.equal(readFileSync(join(persistent, BROWSER_USER_DATA_LOCK), "utf8"), String(process.pid));
    taken.release();
    assert.match(String(errorOf(() => prepareBrowserUserData({ userDataDir: "relative/profile" }))?.message),
      /absolute folder/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
