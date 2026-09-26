// browserDesktopHelper.mjs - which desktop a launched browser's windows live on, and the Windows helper that starts a
// browser on a desktop of its own. Windows gives each desktop its own foreground window, so no window of a browser on a
// private desktop can take the foreground or the keyboard of the desktop the user works on (a headed browser started
// normally activates its window even while the user types elsewhere). The browser is still headed there: it renders,
// lays out, and answers input and screenshots as it would on screen, with the identity of a headed browser. The helper
// comes with the win_amd64 platform wheel, pinned by SHA-256 in the wheel's host descriptor; without the wheel (a source
// checkout, the npm package) PYPROC_BROWSER_DESKTOP_HELPER names one built with cargo from nativeHelper.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..", "..", "..");
export const BROWSER_DESKTOP_SOURCE_ROOT = join(HERE, "nativeHelper");
export const BROWSER_DESKTOP_HELPER_FILE = "pyproc-browser-desktop.exe";
// `user`: the desktop the user works on (the default). `private`: a desktop created for this one browser.
export const BROWSER_DESKTOPS = Object.freeze(["user", "private"]);
// The helper's own failure (it never ran the browser), distinct from any browser exit code.
export const BROWSER_DESKTOP_HELPER_FAILED = 0x70d;

let helperPath = null;

function unavailable(message) {
  return Object.assign(new Error(message), { code: "BROWSER_DESKTOP_UNAVAILABLE" });
}

/** The desktop a launch asks for (`opts.desktop`, else PYPROC_BROWSER_DESKTOP, else `user`), checked for this host. */
export function browserDesktopOf({ desktop, headed } = {}, env = process.env) {
  const value = desktop ?? (env.PYPROC_BROWSER_DESKTOP || "user");
  if (!BROWSER_DESKTOPS.includes(value)) {
    throw new TypeError(`browser desktop must be one of ${BROWSER_DESKTOPS.join(", ")}`);
  }
  if (value === "private") {
    if (process.platform !== "win32") throw new TypeError("a private browser desktop is Windows-only");
    if (!(headed === true || env.PYPROC_HEADED === "1")) {
      throw new TypeError("a private browser desktop is for a headed browser; a headless one has no windows");
    }
  }
  return value;
}

function wheelHelper() {
  const descriptorPath = join(PACKAGE_ROOT, "..", "host.json");
  if (!existsSync(descriptorPath)) return null;
  const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
  const { version } = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
  const entry = descriptor?.browserDesktop;
  if (descriptor?.package?.name !== "pyproc" || descriptor.package.version !== version || !entry) return null;
  const path = join(dirname(descriptorPath), entry.path);
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (digest !== entry.sha256) throw unavailable(`the platform wheel's browser desktop helper ${path} does not match its SHA-256`);
  return path;
}

/** The helper to start a browser on a private desktop: the platform wheel's, else the one PYPROC_BROWSER_DESKTOP_HELPER
 * names. */
export function browserDesktopHelper(env = process.env) {
  if (helperPath) return helperPath;
  const named = env.PYPROC_BROWSER_DESKTOP_HELPER || "";
  if (named && (!isAbsolute(named) || !existsSync(named))) {
    throw unavailable(`PYPROC_BROWSER_DESKTOP_HELPER must name an existing absolute file: ${named}`);
  }
  const found = wheelHelper() || named;
  if (!found) {
    throw unavailable("a private browser desktop needs pyproc's browser desktop helper: install the pyproc-control "
      + "win_amd64 platform wheel, or build it (cargo build --release --manifest-path "
      + `${join(BROWSER_DESKTOP_SOURCE_ROOT, "Cargo.toml")} --target-dir <outside the checkout>) and set `
      + "PYPROC_BROWSER_DESKTOP_HELPER to the built pyproc-browser-desktop.exe");
  }
  helperPath = found;
  return found;
}
