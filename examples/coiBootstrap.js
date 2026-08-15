// coiBootstrap.js - GitHub Pages 데모만 위한 첫 방문 COI 부트스트랩.

const RELOAD_MARKER = "pyprocCoiReload";

export async function ensureCrossOriginIsolation() {
  if (globalThis.crossOriginIsolated && typeof globalThis.SharedArrayBuffer === "function") {
    sessionStorage.removeItem(RELOAD_MARKER);
    return Object.freeze({ ready: true, source: "headers" });
  }
  if (!("serviceWorker" in navigator)) {
    throw new Error("This demo needs cross-origin isolation and Service Worker support.");
  }
  const script = new URL("../coiServiceWorker.js", import.meta.url);
  const scope = new URL("../", import.meta.url);
  await navigator.serviceWorker.register(script, { scope: scope.pathname });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    if (sessionStorage.getItem(RELOAD_MARKER) === "1") {
      throw new Error("The demo Service Worker did not take control after reload.");
    }
    sessionStorage.setItem(RELOAD_MARKER, "1");
    location.reload();
    await new Promise(() => {});
  }
  if (!globalThis.crossOriginIsolated || typeof globalThis.SharedArrayBuffer !== "function") {
    throw new Error("The controlled demo page is not cross-origin isolated.");
  }
  sessionStorage.removeItem(RELOAD_MARKER);
  return Object.freeze({ ready: true, source: "serviceWorker" });
}
