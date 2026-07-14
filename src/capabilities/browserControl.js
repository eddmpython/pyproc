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
    # 네트워크 가로채기/관측(debugger mode 전용). action: block(차단) | fulfill(정적 응답) | modify(요청 변조) | hold(붙잡기)
    def route(self, pattern, action="block", status=None, body=None, headers=None, url=None, method=None):
        self._op("route", pattern=pattern, action=action, status=status, body=body, headers=headers, url=url, method=method); return self
    def unroute(self, pattern=None):
        self._op("unroute", pattern=pattern); return self
    def waitForResponse(self, pattern, timeout=10000):
        return self._op("waitForResponse", pattern=pattern, timeout=timeout).get("value")
    def requests(self):
        return self._op("requests").get("value")
    # 콜백형 held routing: action="hold"로 붙잡힌 요청을 관측하고 동적으로 결정한다(비-항법 요청에 쓴다).
    def pendingRequests(self):
        return self._op("pendingRequests").get("value")
    def continueRequest(self, id, url=None, method=None, headers=None):
        self._op("continueRequest", id=id, url=url, method=method, headers=headers); return self
    def fulfillRequest(self, id, status=200, body="", headers=None):
        self._op("fulfillRequest", id=id, status=status, body=body, headers=headers); return self
    def abortRequest(self, id):
        self._op("abortRequest", id=id); return self
    def responseBody(self, pattern):
        return self._op("responseBody", pattern=pattern).get("value")
    # 에뮬레이션 심화(debugger mode 전용): 다크모드/타임존/오프라인 스푸핑(페이지 관측값을 바꾼다)
    def emulateMedia(self, colorScheme=None, media=None, reducedMotion=None):
        self._op("emulateMedia", colorScheme=colorScheme, media=media, reducedMotion=reducedMotion); return self
    def setTimezone(self, timezoneId):
        self._op("setTimezone", timezoneId=timezoneId); return self
    def setOffline(self, offline=True):
        self._op("setOffline", offline=offline); return self
    # 다운로드 관측(debugger mode 전용): downloadWillBegin으로 무엇이 다운로드되는지(파일명/URL) 회수.
    def enableDownloads(self):
        self._op("enableDownloads"); return self
    def waitForDownload(self, timeout=10000):
        return self._op("waitForDownload", timeout=timeout).get("value")
    # 콘솔/에러 캡처(debugger mode 전용): console.* + 미처리 예외를 관측(페이지 로그·에러를 본다).
    def enableConsole(self):
        self._op("enableConsole"); return self
    def consoleLogs(self):
        return self._op("consoleLogs").get("value")
    def waitForConsole(self, pattern, timeout=10000):
        return self._op("waitForConsole", pattern=pattern, timeout=timeout).get("value")
    # 프레임 traversal(same-origin iframe 내부 조작). frames는 목록, frame(url/name)은 프레임 핸들.
    def frames(self):
        return self._op("frames").get("value")
    def frame(self, url=None, name=None):
        for f in self.frames():
            if url is not None and url in (f.get("url") or ""):
                return Frame(self, f["frameId"])
            if name is not None and name == f.get("name"):
                return Frame(self, f["frameId"])
        raise RuntimeError("frame 미발견: " + str(url or name))
    def close(self):
        self._op("closeSession")

class Frame:
    # iframe 내부 핸들. op는 프레임의 isolated world에서 실행(합성 입력). cross-origin OOPIF는 별도 축(미지원).
    def __init__(self, tab, frameId):
        self._tab = tab
        self._fid = frameId
    def _fop(self, verb, **args):
        return self._tab._op("frameOp", frameId=self._fid, verb=verb, **args)
    def evaluate(self, expr):
        return self._fop("evaluate", expr=expr).get("value")
    def text(self, selector):
        return self._fop("text", selector=selector).get("value")
    def html(self, selector):
        return self._fop("html", selector=selector).get("value")
    def attr(self, selector, name):
        return self._fop("attr", selector=selector, name=name).get("value")
    def value(self, selector):
        return self._fop("value", selector=selector).get("value")
    def exists(self, selector):
        return self._fop("exists", selector=selector).get("value")
    def count(self, selector):
        return self._fop("count", selector=selector).get("value")
    def click(self, selector):
        self._fop("click", selector=selector); return self
    def type(self, selector, text):
        self._fop("type", selector=selector, text=text); return self
    def fill(self, selector, text):
        self._fop("fill", selector=selector, text=text); return self
    def waitFor(self, selector, timeout=10000):
        self._fop("waitFor", selector=selector, timeout=timeout); return self

def tab(url=None, mode="script"):
    resp = _send("openSession", mode=mode)
    handle = BrowserTab(resp["sessionId"], mode)
    if url:
        handle.navigate(url)
    return handle

_mod = types.ModuleType("pyprocBrowser")
_mod.tab = tab
_mod.BrowserTab = BrowserTab
_mod.Frame = Frame
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

// 프로세스 OS x 브라우저 컨트롤 융합: 워커 N = 독립 인터프리터 N(독립 GIL) = 세션 N. dedicated Worker엔 chrome.*이
// 없어(제약 A) offscreen이 유일 chrome.runtime 채널이므로, 워커의 브라우저 op를 offscreen이 SW 호스트로 릴레이한다
// (4-홉: 워커 -> offscreen -> SW -> CDP). 파이썬 연산은 워커별 GIL로 물리 병렬, 브라우저-op은 SW 단일 큐(정직한 천장).
const WORKER_OP = "pyprocBrowserOp";
const WORKER_OP_RESULT = "pyprocBrowserOpResult";

// offscreen 측: 워커의 브라우저 op 메시지를 SW 호스트로 릴레이한다. 소비자는 워커를 스폰한 뒤 이걸 호출한다.
export function routeBrowserWorker(worker) {
  worker.addEventListener("message", async (ev) => {
    const m = ev.data;
    if (!m || m.type !== WORKER_OP) return;
    const result = await chrome.runtime.sendMessage(makeMessage(m.op, m.fields));
    worker.postMessage({ type: WORKER_OP_RESULT, reqId: m.reqId, result });
  });
  return worker;
}

// 워커 측: 그 워커의 파이썬이 브라우저를 몰 수 있게 배선한다. _pyprocBrowserSend가 chrome.runtime 대신 부모
// (offscreen)로 postMessage하고 opResult까지 run_sync(JSPI)로 블로킹한다. 워커도 offscreen(COI)에서 스폰되면
// crossOriginIsolated를 상속해 SAB/JSPI가 산다. 호출 후 워커 파이썬은 `import pyprocBrowser as browser`로 조작한다.
export async function installBrowserWorker(py) {
  const pending = new Map();
  let nextReqId = 1;
  self.addEventListener("message", (ev) => {
    const m = ev.data;
    if (!m || m.type !== WORKER_OP_RESULT) return;
    const resolve = pending.get(m.reqId);
    if (resolve) { pending.delete(m.reqId); resolve(m.result); }
  });
  py.globals.set("_pyprocBrowserSend", (op, fieldsJson) => new Promise((resolve) => {
    const reqId = nextReqId++;
    pending.set(reqId, (result) => resolve(JSON.stringify(result)));
    self.postMessage({ type: WORKER_OP, reqId, op, fields: JSON.parse(fieldsJson) });
  }));
  await py.runPythonAsync(PYPROC_BROWSER_MODULE);
  return py;
}

export { openBrowserControlHost } from "./browserControlHost.js";
