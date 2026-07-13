// browserControl.js - Layer 1 능력: MV3 확장 offscreen에서 파이썬이 브라우저를 조작한다.
// enableBrowserControl() -> BrowserControl. install()이 파이썬 pyprocBrowser 모듈을 배선한다(GpuBridge/
// SocketBridge 형제 패턴). 조작 자체는 서비스워커의 browserControlHost가 chrome.debugger/scripting으로
// 대행한다(offscreen은 chrome.* 제한 API). 능력<->호스트는 browserControlProtocol의 버전된 메시지로 통신.
// 지원: MV3 확장 offscreen document(crossOriginIsolated + JSPI). 소비자 배선은 examples 확장 스캐폴드 참조.
import { PROTOCOL_VERSION, OP, makeMessage } from "./browserControlProtocol.js";

// 파이썬 표면(블로킹, run_sync = socketBridge 패턴). 입력=문자열/JSON, 출력=JSON-값
// (chrome.runtime structured clone 경계라 PyProxy 금지). 호스트가 ok=false를 주면 파이썬 예외로 승격한다.
const PYPROC_BROWSER_MODULE = `
import json, sys, types
from pyodide.ffi import run_sync

def _send(op, **fields):
    respJson = run_sync(_pyprocBrowserSend(op, json.dumps(fields)))
    resp = json.loads(respJson)
    if not resp.get("ok"):
        raise RuntimeError("browserControl " + op + ": " + str(resp.get("error")))
    return resp

class BrowserTab:
    def __init__(self, sessionId, mode):
        self._sid = sessionId
        self.mode = mode
    def navigate(self, url):
        _send("navigate", sessionId=self._sid, args={"url": url})
        return self
    def evaluate(self, expr):
        return _send("evaluate", sessionId=self._sid, args={"expr": expr}).get("value")
    def click(self, selector):
        _send("click", sessionId=self._sid, args={"selector": selector})
        return self
    def type(self, selector, text):
        _send("type", sessionId=self._sid, args={"selector": selector, "text": text})
        return self
    def close(self):
        _send("closeSession", sessionId=self._sid)

def tab(url=None, mode="script"):
    resp = _send("openSession", mode=mode)
    handle = BrowserTab(resp["sessionId"], mode)
    if url:
        handle.navigate(url)
    return handle

_mod = types.ModuleType("pyprocBrowser")
_mod.tab = tab
_mod.BrowserTab = BrowserTab
sys.modules["pyprocBrowser"] = _mod
`;

export class BrowserControl {
  constructor(rt) { this._rt = rt; }

  // 파이썬 pyprocBrowser 모듈 배선. 전제: 확장 offscreen 컨텍스트(chrome.runtime) + browserControlHost가 열려 있음.
  // JSPI(run_sync)가 필요하므로 소비자는 rt.runAsync 경로에서 파이썬을 돌려야 한다(동기 rt.run에선 블로킹 op가 실패).
  async install() {
    if (typeof chrome === "undefined" || !chrome.runtime || typeof chrome.runtime.sendMessage !== "function") {
      throw new Error("BrowserControl.install: chrome.runtime.sendMessage가 없다. MV3 확장 offscreen 컨텍스트에서 browserControlHost를 연 뒤 호출해야 한다.");
    }
    // 핸드셰이크: 능력/호스트 두 절반이 다른 핀으로 vendored되면 조용히 깨지므로 프로토콜 버전을 확인한다.
    const hs = await chrome.runtime.sendMessage(makeMessage(OP.handshake));
    if (!hs || hs.version !== PROTOCOL_VERSION) {
      throw new Error(`BrowserControl: 프로토콜 버전 불일치(능력 ${PROTOCOL_VERSION} vs 호스트 ${hs && hs.version}). 확장 두 절반의 pyproc 핀을 맞춰라.`);
    }
    this._rt.setGlobal("_pyprocBrowserSend", async (op, fieldsJson) =>
      JSON.stringify(await chrome.runtime.sendMessage(makeMessage(op, JSON.parse(fieldsJson)))));
    this._rt.run(PYPROC_BROWSER_MODULE);
    return this;
  }
}

export { openBrowserControlHost } from "./browserControlHost.js";
