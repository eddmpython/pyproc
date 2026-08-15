// coiServiceWorker.js - 정적 데모 응답에 cross-origin isolation 헤더를 붙인다.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.type === "opaque" || response.type === "opaqueredirect" || response.status === 0) return response;
    const headers = new Headers(response.headers);
    if (["document", "worker", "sharedworker"].includes(event.request.destination)) {
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");
    }
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }));
});
