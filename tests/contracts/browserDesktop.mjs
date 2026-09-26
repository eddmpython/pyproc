// browserDesktop.mjs - contract of the private browser desktop: which launches may ask for it, how the manifest carries
// it, and that the helper, its build registry, and the launcher agree on its name and its failure code.
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BROWSER_DESKTOP_HELPER_FAILED,
  BROWSER_DESKTOP_HELPER_FILE,
  BROWSER_DESKTOP_SOURCE_ROOT,
  BROWSER_DESKTOPS,
  browserDesktopOf,
} from "../../scripts/browserControl/browserDesktop/browserDesktopHelper.mjs";
import { NATIVE_HOSTS } from "../../scripts/nativeHostBuilder/buildNativeHost.mjs";
import { validateMcpProductConfig } from "../../scripts/mcpProductConfig.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function errorOf(operation) {
  try { operation(); return null; } catch (error) { return error; }
}

export async function assertBrowserDesktop() {
  // The launch rule: `user` unless asked; `private` only for a headed browser, only on Windows.
  assert.deepEqual(BROWSER_DESKTOPS, ["user", "private"]);
  assert.equal(browserDesktopOf({}, {}), "user");
  assert.equal(browserDesktopOf({}, { PYPROC_BROWSER_DESKTOP: "user" }), "user");
  assert.match(String(errorOf(() => browserDesktopOf({ desktop: "elsewhere" }, {}))?.message), /one of user, private/);
  const headless = errorOf(() => browserDesktopOf({ desktop: "private" }, {}));
  if (process.platform === "win32") {
    assert.match(String(headless?.message), /headed browser/);
    assert.equal(browserDesktopOf({ desktop: "private", headed: true }, {}), "private");
    assert.equal(browserDesktopOf({}, { PYPROC_BROWSER_DESKTOP: "private", PYPROC_HEADED: "1" }), "private");
  } else {
    assert.match(String(headless?.message), /Windows-only/);
    assert.match(String(errorOf(() => browserDesktopOf({ desktop: "private", headed: true }, {}))?.message),
      /Windows-only/);
  }

  // The manifest carries it for the launched provider only; the environment it starts from never decides it.
  const base = { schemaVersion: 1, engine: { enabled: false }, browser: { enabled: true, headed: true,
    allowedOrigins: ["https://work.example"], maxRisk: "read", actions: ["snapshot"] } };
  const withDesktop = (browser) => ({ ...base, browser: { ...base.browser, ...browser } });
  const plain = validateMcpProductConfig(base);
  assert.equal(plain.env.PYPROC_BROWSER_DESKTOP, undefined);
  assert.equal(validateMcpProductConfig(withDesktop({ desktop: "user" })).env.PYPROC_BROWSER_DESKTOP, undefined);
  if (process.platform === "win32") {
    assert.equal(validateMcpProductConfig(withDesktop({ desktop: "private" })).env.PYPROC_BROWSER_DESKTOP, "private");
    assert.match(String(errorOf(() => validateMcpProductConfig(withDesktop({ desktop: "private", headed: false })))
      ?.message), /headed browser/);
  } else {
    assert.match(String(errorOf(() => validateMcpProductConfig(withDesktop({ desktop: "private" })))?.message),
      /Windows-only/);
  }
  assert.match(String(errorOf(() => validateMcpProductConfig(withDesktop({ desktop: "elsewhere" })))?.message),
    /one of user, private/);
  assert.match(String(errorOf(() => validateMcpProductConfig({ ...base, browser: { enabled: true,
    provider: "userBrowser", userBrowser: "edge", allowedOrigins: ["https://work.example"], maxRisk: "read",
    actions: ["snapshot"], desktop: "private" } }))?.message), /does not accept browser.desktop/);

  // One name and one failure code across the helper's source, its build registry, and the launcher.
  assert.equal(NATIVE_HOSTS.browserDesktop.file, BROWSER_DESKTOP_HELPER_FILE);
  assert.equal(resolve(ROOT, NATIVE_HOSTS.browserDesktop.source), BROWSER_DESKTOP_SOURCE_ROOT);
  const source = await readFile(resolve(BROWSER_DESKTOP_SOURCE_ROOT, "src", "main.rs"), "utf8");
  const failed = /const HELPER_FAILED: i32 = (0x[0-9A-Fa-f]+);/.exec(source);
  assert.equal(Number(failed?.[1]), BROWSER_DESKTOP_HELPER_FAILED);
  const manifest = await readFile(resolve(BROWSER_DESKTOP_SOURCE_ROOT, "Cargo.toml"), "utf8");
  assert.match(manifest, new RegExp(`name = "${BROWSER_DESKTOP_HELPER_FILE.replace(/\.exe$/, "")}"`));
  // The helper hands the browser exactly what it was given: the standard handles and the C runtime descriptor table
  // (a DevTools pipe on descriptors 3 and 4), on a desktop it created and holds until the browser exits.
  for (const needle of ["CreateDesktopW", "lpDesktop", "lpReserved2: given.lpReserved2", "cbReserved2: given.cbReserved2",
    "STARTF_USESTDHANDLES", "WaitForSingleObject", "CloseDesktop"]) {
    assert.ok(source.includes(needle), `browser desktop helper lost ${needle}`);
  }
  return true;
}
