// preflight.js - Layer 0: browser capability diagnosis for the owned worker kernel.
import { PyProcError } from "./errors.js";

const HEADER_SNIPPET =
  "Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp";
export const SETUP_FRAGMENT = "setup";
export const SETUP_URL = `https://github.com/eddmpython/pyproc#${SETUP_FRAGMENT}`;

function hasCrossOriginIsolation() {
  return typeof globalThis.crossOriginIsolated === "boolean" && globalThis.crossOriginIsolated;
}

function hasSharedArrayBuffer() {
  return typeof globalThis.SharedArrayBuffer === "function";
}

export function hasJspi() {
  return typeof WebAssembly !== "undefined" && "Suspending" in WebAssembly;
}

export function checkEnvironment() {
  const crossOriginIsolated = hasCrossOriginIsolation();
  const sharedArrayBuffer = hasSharedArrayBuffer();
  const jspi = hasJspi();
  const issues = [];
  if (!crossOriginIsolated || !sharedArrayBuffer) {
    issues.push({
      code: "no-cross-origin-isolation",
      need: "SharedArrayBuffer (crossOriginIsolated)",
      why: "The worker-owned kernel uses shared command and hostcall channels.",
      fix: `Serve the page with these headers:\n  ${HEADER_SNIPPET}\nDetails: ${SETUP_URL}`,
    });
  }
  if (!jspi) {
    issues.push({
      code: "no-jspi",
      need: "JSPI (WebAssembly.Suspending)",
      why: "Synchronous Python hostcalls suspend the worker while the browser performs an asynchronous effect.",
      fix: `Use a current Chromium or Edge release. Details: ${SETUP_URL}`,
    });
  }
  return { ok: issues.length === 0, crossOriginIsolated, sharedArrayBuffer, jspi, issues };
}

export function requireCoi(feature) {
  if (hasCrossOriginIsolation() && hasSharedArrayBuffer()) return;
  throw new PyProcError("PYPROC_ENV_UNSUPPORTED",
    `${feature} needs SharedArrayBuffer (crossOriginIsolated).\nServe the page with these headers:\n  ${HEADER_SNIPPET}\nDetails: ${SETUP_URL}`);
}

export function requireJspi(feature) {
  if (hasJspi()) return;
  throw new PyProcError("PYPROC_ENV_UNSUPPORTED",
    `${feature} needs JSPI (WebAssembly.Suspending). Use a current Chromium or Edge release. Details: ${SETUP_URL}`);
}
