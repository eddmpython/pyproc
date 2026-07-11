// pyprocSw.js - pyproc의 Service Worker 계층(소비자가 자기 오리진에서 등록하는 자산).
// virtualOrigin.js와 같은 폴더 고정(자산 경로 계약). 이 파일은 SW 컨텍스트에서 돌므로
// 모듈 import 없이 자기충족이다. 기능은 등록 URL 쿼리로 켠다:
//   pyprocSw.js?cache=1                 - Pyodide CDN 자산 캐시-우선(2차 부팅 네트워크 0).
//   pyprocSw.js?asgi=/pyproc/           - 그 접두 경로 fetch를 페이지 커널 ASGI로 위임(가상 오리진).
//   pyprocSw.js?coi=1                   - COOP/COEP 헤더 주입: 헤더를 못 다는 호스팅(GitHub Pages)에서
//                                         crossOriginIsolated를 성립시켜 SAB(프로세스 OS)를 연다.
//   조합 가능(예: ?cache=1&coi=1). cdn=<접두URL>로 캐시 대상 교체.
// 실측: runtimeParity/swOriginProbe(왕복 3.4ms = dispatch와 동일, SW 오버헤드 0),
//       pythonMachine/swOfflineProbe(2차 부팅 CDN miss 0), pythonMachine/swCoiProbe(COI 주입).
const params = new URL(self.location.href).searchParams;
const CACHE_ON = params.get("cache") === "1";
const ASGI_PREFIX = params.get("asgi"); // 예: "/pyproc/". 없으면 위임 꺼짐.
const COI_ON = params.get("coi") === "1";
const CDN = params.get("cdn") || "https://cdn.jsdelivr.net/pyodide/"; // 기본 엔진 배포 지점(runtime.js DEFAULT_INDEX의 버전 상위 접두)
const CACHE_NAME = "pyprocCore";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (CACHE_ON && e.request.url.startsWith(CDN)) return e.respondWith(coreCache(e));
  if (ASGI_PREFIX && url.origin === self.location.origin) {
    const i = url.pathname.indexOf(ASGI_PREFIX);
    if (i !== -1) return e.respondWith(dispatch(e, url.pathname.slice(i + ASGI_PREFIX.length - 1), url.search.slice(1)));
  }
  if (COI_ON) return e.respondWith(coiInject(e));
});

// COI 주입: 문서/워커 응답에 COOP/COEP를, 그 외 응답에 CORP를 실어 재서빙한다.
// 첫 방문은 SW가 장악 전이라 페이지가 등록 후 1회 새로고침해야 한다(부트스트랩은 등록자 몫).
// opaque(cross-origin no-cors) 응답은 헤더 수정이 불가능해 원본 그대로 통과한다:
// CDN이 자체 CORP를 보내야 하며 jsdelivr는 보낸다(swOfflineProbe에서 COEP 하에 동작 실측).
async function coiInject(e) {
  const resp = await fetch(e.request);
  if (resp.type === "opaque" || resp.type === "opaqueredirect" || resp.status === 0) return resp;
  const headers = new Headers(resp.headers);
  const dest = e.request.destination;
  if (dest === "document" || dest === "worker" || dest === "sharedworker") {
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  }
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
}

// 코어 캐시-우선: 한 번 받은 엔진 자산(js/mjs/wasm/zip/lock)은 다시 네트워크에 묻지 않는다.
// opaque(no-cors script)도 캐시 가능하며 원 응답 헤더가 보존되어 재생 시 CORP/MIME이 산다.
async function coreCache(e) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(e.request.url);
  if (cached) return cached;
  const resp = await fetch(e.request);
  if (resp.ok || resp.type === "opaque") await cache.put(e.request.url, resp.clone());
  return resp;
}

// 가상 오리진: 요청을 낸 페이지(커널을 가진 클라이언트)의 VirtualOrigin 배선으로 위임한다.
async function dispatch(e, path, query) {
  let client = e.clientId ? await self.clients.get(e.clientId) : null;
  if (!client) client = (await self.clients.matchAll({ type: "window" }))[0];
  if (!client) return new Response("pyproc kernel client 없음", { status: 503 });
  const body = e.request.method === "GET" || e.request.method === "HEAD" ? null : await e.request.text();
  const ch = new MessageChannel();
  const reply = new Promise((res) => { ch.port1.onmessage = (m) => res(m.data); });
  client.postMessage({ pyprocAsgi: { method: e.request.method, path, query, body } }, [ch.port2]);
  const r = await reply;
  if (r.error) return new Response(r.error, { status: 500 });
  return new Response(r.body, { status: r.status, headers: r.headers });
}
