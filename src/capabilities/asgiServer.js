// asgiServer.js - Layer 1 능력: 커널 안 ASGI 서버 (browserAsServer 흡수, 2026-07-11).
// "로컬 서버 = TCP 소켓이 아니라 ASGI 인터페이스". FastAPI/Starlette 앱을 소켓 0으로
// 브라우저 커널 안에서 dispatch한다(실측 3.4ms/요청). Service Worker로 페이지 fetch를
// 여기에 잇는 배선은 소비 제품 몫이고, pyproc은 dispatch 프리미티브만 소유한다.
// 제약(dartlab 실측): 엔드포인트는 async def 강제(sync def는 스레드풀 -> WASM 불가).
const HELPER = (appVar) => `
import json as _pyproc_json

async def _pyproc_asgi_call(method, path, body, query=""):
    _app = ${appVar}
    body_bytes = (body or "").encode()
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
             "method": method, "scheme": "http", "path": path, "raw_path": path.encode(),
             "query_string": (query or "").encode(), "root_path": "",
             "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body_bytes)).encode())],
             "client": ("127.0.0.1", 0), "server": ("pyproc", 0)}
    sent = {"status": None, "headers": [], "body": b""}
    got = {"done": False}
    async def receive():
        if got["done"]:
            return {"type": "http.disconnect"}
        got["done"] = True
        return {"type": "http.request", "body": body_bytes, "more_body": False}
    async def send(msg):
        if msg["type"] == "http.response.start":
            sent["status"] = msg["status"]
            sent["headers"] = [(k.decode(), v.decode()) for k, v in msg.get("headers", [])]
        elif msg["type"] == "http.response.body":
            sent["body"] += msg.get("body", b"")
    await _app(scope, receive, send)
    return _pyproc_json.dumps({"status": sent["status"], "headers": sent["headers"], "body": sent["body"].decode()})
`;

export class AsgiServer {
  // cfg.app: 파이썬 전역에 있는 ASGI 앱 변수명(기본 "app"). 하드코딩 대신 계약으로 받는다.
  constructor(rt, cfg = {}) { this._rt = rt; this._appVar = cfg.app || "app"; }

  async install() {
    this._rt.run(HELPER(this._appVar));
    return { app: this._appVar, transport: "asgi-dispatch (소켓 0)" };
  }

  // 요청 1건을 앱에 dispatch한다. 반환: { status, headers, body(문자열) }.
  async serve(method, path, body = null, query = "") {
    const rt = this._rt;
    rt.setGlobal("_pyproc_m", method); rt.setGlobal("_pyproc_p", path);
    rt.setGlobal("_pyproc_b", body); rt.setGlobal("_pyproc_q", query);
    const raw = await rt.runAsync("await _pyproc_asgi_call(_pyproc_m, _pyproc_p, _pyproc_b, _pyproc_q)");
    return JSON.parse(raw);
  }
}
