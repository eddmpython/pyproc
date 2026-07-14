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
    def _op(self, op, **args):
        return _send(op, sessionId=self._sid, args=args)
    # 항법
    def navigate(self, url):
        self._op("navigate", url=url); return self
    def reload(self):
        self._op("reload"); return self
    def back(self):
        self._op("back"); return self
    def forward(self):
        self._op("forward"); return self
    # 실행
    def evaluate(self, expr):
        return self._op("evaluate", expr=expr).get("value")
    # 입력
    def click(self, selector):
        self._op("click", selector=selector); return self
    def doubleClick(self, selector):
        self._op("doubleClick", selector=selector); return self
    def rightClick(self, selector):
        self._op("rightClick", selector=selector); return self
    def hover(self, selector):
        self._op("hover", selector=selector); return self
    def type(self, selector, text):
        self._op("type", selector=selector, text=text); return self
    def fill(self, selector, text):
        self._op("fill", selector=selector, text=text); return self
    def press(self, key, selector=None):
        self._op("press", key=key, selector=selector); return self
    def select(self, selector, value):
        self._op("select", selector=selector, value=value); return self
    # 조회/추출
    def text(self, selector):
        return self._op("text", selector=selector).get("value")
    def html(self, selector):
        return self._op("html", selector=selector).get("value")
    def attr(self, selector, name):
        return self._op("attr", selector=selector, name=name).get("value")
    def value(self, selector):
        return self._op("value", selector=selector).get("value")
    def exists(self, selector):
        return self._op("exists", selector=selector).get("value")
    def count(self, selector):
        return self._op("count", selector=selector).get("value")
    def texts(self, selector):
        return self._op("texts", selector=selector).get("value")
    def boundingBox(self, selector):
        return self._op("boundingBox", selector=selector).get("value")
    def title(self):
        return self._op("title").get("value")
    def url(self):
        return self._op("url").get("value")
    def content(self):
        return self._op("content").get("value")
    # 대기
    def waitFor(self, selector, timeout=10000):
        self._op("waitFor", selector=selector, timeout=timeout); return self
    def waitForFunction(self, expr, timeout=10000):
        self._op("waitForFunction", expr=expr, timeout=timeout); return self
    # 캡처/에뮬레이션(debugger mode 전용, script mode는 미지원 예외)
    def screenshot(self, fullPage=False, format="png", quality=None):
        return self._op("screenshot", fullPage=fullPage, format=format, quality=quality).get("value")
    def pdf(self, landscape=False, printBackground=True):
        return self._op("pdf", landscape=landscape, printBackground=printBackground).get("value")
    def setViewport(self, width, height, deviceScaleFactor=1, mobile=False):
        self._op("setViewport", width=width, height=height, deviceScaleFactor=deviceScaleFactor, mobile=mobile); return self
    def setUserAgent(self, userAgent):
        self._op("setUserAgent", userAgent=userAgent); return self
    def setHeaders(self, headers):
        self._op("setHeaders", headers=headers); return self
    def cookies(self, urls=None):
        return self._op("cookies", urls=urls).get("value")
    def setCookie(self, name, value, **kwargs):
        self._op("setCookie", name=name, value=value, **kwargs); return self
    def clearCookies(self, urls=None):
        self._op("clearCookies", urls=urls); return self
    def deleteCookie(self, name, url=None):
        self._op("deleteCookie", name=name, url=url); return self
    def scrollIntoView(self, selector):
        self._op("scrollIntoView", selector=selector); return self
    def upload(self, selector, files):
        self._op("upload", selector=selector, files=files); return self
    # 다이얼로그 자동 처리(alert/confirm/prompt는 렌더러를 멈추므로 세션 단위 정책으로 즉시 응답)
    def setDialogHandler(self, accept=True, promptText=""):
        self._op("setDialogHandler", accept=accept, promptText=promptText); return self
    def lastDialog(self):
        return self._op("lastDialog").get("value")
    # 네트워크 가로채기/관측(debugger mode 전용)
    def route(self, pattern, action="block", status=None, body=None, headers=None):
        self._op("route", pattern=pattern, action=action, status=status, body=body, headers=headers); return self
    def unroute(self, pattern=None):
        self._op("unroute", pattern=pattern); return self
    def waitForResponse(self, pattern, timeout=10000):
        return self._op("waitForResponse", pattern=pattern, timeout=timeout).get("value")
    def requests(self):
        return self._op("requests").get("value")
    def close(self):
        self._op("closeSession")

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
    // 송신 타임아웃: SW가 죽어 무응답이면 run_sync가 영구 행하지 않도록 typed 에러로 끊는다.
    this._rt.setGlobal("_pyprocBrowserSend", async (op, fieldsJson) => {
      const resp = await Promise.race([
        chrome.runtime.sendMessage(makeMessage(op, JSON.parse(fieldsJson))),
        new Promise((_, rej) => setTimeout(() => rej(new Error("browserControl: 서비스워커 무응답 타임아웃")), 30000)),
      ]);
      return JSON.stringify(resp);
    });
    this._rt.run(PYPROC_BROWSER_MODULE);
    return this;
  }
}

export { openBrowserControlHost } from "./browserControlHost.js";
