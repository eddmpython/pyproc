// swOriginSw.js - probe: Service Worker가 fetch를 가로채 페이지 커널의 ASGI로 위임한다.
// "가상 오리진": 파이썬 서버가 진짜 URL로 응답한다(소켓 0, 서버 0). WebContainers의
// localhost 매핑 개념을 ASGI dispatch(이미 승격됨) 위에 얹는 배선 실측.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const i = url.pathname.indexOf("/pyproc/");
  if (url.origin !== self.location.origin || i === -1) return; // 무관 요청은 네트워크로
  e.respondWith(dispatch(e, url.pathname.slice(i + "/pyproc".length), url.search.slice(1)));
});

async function dispatch(e, path, query) {
  // 요청을 낸 페이지(커널을 가진 클라이언트)로 위임한다.
  let client = e.clientId ? await self.clients.get(e.clientId) : null;
  if (!client) client = (await self.clients.matchAll({ type: "window" }))[0];
  if (!client) return new Response("kernel client 없음", { status: 503 });
  const body = e.request.method === "GET" || e.request.method === "HEAD" ? null : await e.request.text();
  const ch = new MessageChannel();
  const reply = new Promise((res) => { ch.port1.onmessage = (m) => res(m.data); });
  client.postMessage({ pyprocAsgi: { method: e.request.method, path, query, body } }, [ch.port2]);
  const r = await reply;
  if (r.error) return new Response(r.error, { status: 500 });
  return new Response(r.body, { status: r.status, headers: r.headers });
}
