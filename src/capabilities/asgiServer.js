// asgiServer.js - Layer 1 능력: 커널 안 ASGI 서버 (browserAsServer 흡수, 2026-07-11).
// "로컬 서버 = TCP 소켓이 아니라 ASGI 인터페이스". FastAPI/Starlette 앱을 소켓 0으로
// 브라우저 커널 안에서 dispatch한다(실측 3.4ms/요청). Service Worker로 페이지 fetch를
// 여기에 잇는 배선은 virtualOrigin.js가 소유한다.
// 계약(2026-07-12 충실화, selfHost 판정 반영):
// - 요청: body는 str(텍스트) 또는 바이트 버퍼(Uint8Array 등), headers는 [k, v] 배열로 전달된다.
//   content-type 미지정 시에만 application/json을 기본값으로 채운다(기존 계약 보존).
// - 응답: body(utf-8 텍스트 뷰)와 bodyBytes(원시 바이트) 둘 다 준다(requests의 .text/.content 등가).
//   이미지 같은 바이너리 응답은 bodyBytes가 정본이다.
// 제약(dartlab 실측): 엔드포인트는 async def 강제(sync def는 스레드풀 -> WASM 불가).
// lifespan 이벤트는 발화하지 않는다(dispatch 단위 계약).
const HELPER = (appVar) => `
import json as _pyprocJson
import base64 as _pyprocB64

async def _pyprocAsgiCall(method, path, body, query="", reqHeaders=None):
    _app = ${appVar}
    bodyBytes = body.encode() if isinstance(body, str) else body.to_bytes()
    hdrs = []
    hasType = False
    for pair in reqHeaders:
        k = pair[0].lower()
        if k == "content-length":
            continue
        if k == "content-type":
            hasType = True
        hdrs.append((k.encode(), str(pair[1]).encode()))
    if not hasType:
        hdrs.append((b"content-type", b"application/json"))
    hdrs.append((b"content-length", str(len(bodyBytes)).encode()))
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
             "method": method, "scheme": "http", "path": path, "raw_path": path.encode(),
             "query_string": (query or "").encode(), "root_path": "",
             "headers": hdrs,
             "client": ("127.0.0.1", 0), "server": ("pyproc", 0)}
    sent = {"status": None, "headers": [], "body": b""}
    got = {"done": False}
    async def receive():
        if got["done"]:
            return {"type": "http.disconnect"}
        got["done"] = True
        return {"type": "http.request", "body": bodyBytes, "more_body": False}
    async def send(msg):
        if msg["type"] == "http.response.start":
            sent["status"] = msg["status"]
            sent["headers"] = [(k.decode(), v.decode()) for k, v in msg.get("headers", [])]
        elif msg["type"] == "http.response.body":
            sent["body"] += msg.get("body", b"")
    await _app(scope, receive, send)
    return _pyprocJson.dumps({"status": sent["status"], "headers": sent["headers"],
                              "bodyB64": _pyprocB64.b64encode(sent["body"]).decode()})
`;

export class AsgiServer {
  // cfg.app: 파이썬 전역에 있는 ASGI 앱 변수명(기본 "app"). 하드코딩 대신 계약으로 받는다.
  // 헬퍼는 매 요청 그 전역을 다시 읽으므로, 전역 재대입만으로 앱이 핫스왑된다(dev loop의 근거).
  constructor(rt, cfg = {}) { this._rt = rt; this._appVar = cfg.app || "app"; }

  async install() {
    this._rt.run(HELPER(this._appVar));
    return { app: this._appVar, transport: "asgi-dispatch (소켓 0)" };
  }

  // 요청 1건을 앱에 dispatch한다. 반환: { status, headers, body(utf-8 문자열 뷰), bodyBytes(Uint8Array) }.
  // null/undefined 정규화는 이 JS 경계에서 한다: setGlobal(null)은 Python None이 아니라
  // JsNull 프록시가 되므로(실측 AttributeError), 파이썬 쪽은 str 또는 버퍼/배열만 받는다.
  async serve(method, path, body = null, query = "", headers = null) {
    const rt = this._rt;
    rt.setGlobal("_pyprocM", method); rt.setGlobal("_pyprocP", path);
    rt.setGlobal("_pyprocB", body == null ? "" : body); rt.setGlobal("_pyprocQ", query);
    rt.setGlobal("_pyprocH", headers == null ? [] : headers);
    const raw = await rt.runAsync("await _pyprocAsgiCall(_pyprocM, _pyprocP, _pyprocB, _pyprocQ, _pyprocH)");
    const r = JSON.parse(raw);
    const bodyBytes = Uint8Array.from(atob(r.bodyB64), (c) => c.charCodeAt(0));
    return { status: r.status, headers: r.headers, body: new TextDecoder().decode(bodyBytes), bodyBytes };
  }
}
