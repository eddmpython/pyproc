// swOfflineSw.js - probe: Pyodide CDN 요청 전부를 Cache Storage에 캐시-우선으로.
// coreCacheDir(기둥5 v1)가 못 덮던 마지막 구멍이 script 경로(pyodide.js/asm.js)인데,
// Service Worker의 fetch 이벤트는 script/wasm/zip 전부를 가로챈다. 2차 부팅의 CDN
// 미스가 0이면 "비행기 모드에서도 켜지는 컴퓨터"가 fetch 계층 너머까지 성립한다.
const CACHE = "pyprocCoreProbe";
// 배포 지점 2종을 모두 가로챈다: CDN(기본)과 자가 호스팅 /vendor/(engine-independence P0 재실측).
const PREFIXES = ["https://cdn.jsdelivr.net/pyodide/", self.location.origin + "/vendor/"];
let hits = 0, misses = 0, missList = [];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("message", (e) => {
  if (e.data === "resetStats") { hits = 0; misses = 0; missList = []; e.ports[0].postMessage("ok"); }
  else if (e.data === "stats") e.ports[0].postMessage({ hits, misses, missList });
});

self.addEventListener("fetch", (e) => {
  if (!PREFIXES.some((p) => e.request.url.startsWith(p))) return; // 코어 밖(로컬 페이지/게이트 백채널)은 그대로
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request.url);
    if (cached) { hits++; return cached; }
    misses++; missList.push(e.request.url.split("/").pop());
    const resp = await fetch(e.request);
    // opaque(no-cors script)도 캐시 가능하다. 원 응답 헤더가 보존되어 재생 시 CORP/MIME이 산다.
    if (resp.ok || resp.type === "opaque") await cache.put(e.request.url, resp.clone());
    return resp;
  })());
});
