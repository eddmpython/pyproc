// virtualOrigin.js - Layer 1 능력: 파이썬 서버를 진짜 URL로 만드는 페이지측 배선.
// pyprocSw.js(같은 폴더, 자산 경로 계약)가 가로챈 fetch를 pyprocAsgi 메시지로 넘기면,
// 이 배선이 커널의 AsgiServer.serve로 응답한다. 결과: fetch("/pyproc/api/x") -> FastAPI.
// 실측(runtimeParity/swOriginProbe): 평균 왕복 3.4ms(직접 dispatch와 동일, SW 오버헤드 0).
// SW 등록(스코프 결정)은 소비자 몫이다: navigator.serviceWorker.register("<자기 경로>/pyprocSw.js?asgi=/pyproc/").
//
// 커널 등록(hello): bind()가 SW에 자기 clientId를 알린다. 이후 SW는 요청을 낸 문서가
// 누구든(가상 오리진에서 서빙된 iframe/딴 탭 포함) 이 커널 클라이언트로 라우팅한다.
// hello 없이는 "요청을 낸 클라이언트"로 위임되어 커널 페이지 자신의 fetch만 성립했다
// (runtimeParity/originFidelityProbe가 iframe 동선을 실측). SW가 재시작되면 등록이 증발하므로
// controllerchange마다 재전송한다. 그래도 유실된 경우 SW 쪽 폴백/타임아웃(504)이 정직한 실패를 만든다.
export class VirtualOrigin {
  // asgi: 설치 완료된 AsgiServer 인스턴스(rt.enableAsgiServer(...) 후 install()까지 마친 것).
  constructor(asgi) { this._asgi = asgi; this._handler = null; this._hello = null; }

  // SW가 위임한 요청에 응답하기 시작한다(멱등).
  bind() {
    if (this._handler) return this;
    this._handler = async (e) => {
      const req = e.data && e.data.pyprocAsgi;
      if (!req) return;
      try {
        const r = await this._asgi.serve(req.method, req.path, req.body, req.query, req.headers);
        e.ports[0].postMessage({ status: r.status, headers: r.headers, body: r.bodyBytes });
      } catch (err) {
        e.ports[0].postMessage({ error: String(err).slice(-300) });
      }
    };
    navigator.serviceWorker.addEventListener("message", this._handler);
    this._hello = () => {
      if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ pyprocKernelHello: true });
    };
    this._hello();
    navigator.serviceWorker.addEventListener("controllerchange", this._hello);
    return this;
  }

  unbind() {
    if (!this._handler) return;
    navigator.serviceWorker.removeEventListener("message", this._handler);
    navigator.serviceWorker.removeEventListener("controllerchange", this._hello);
    this._handler = null;
    this._hello = null;
  }
}
