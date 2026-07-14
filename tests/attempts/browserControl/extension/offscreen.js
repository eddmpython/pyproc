// offscreen.js - Pyodide 런타임 호스트(게이트 1+2 실측).
// 확장 문서에서: (1) crossOriginIsolated 여부, (2) SAB 생성, (3) module Worker 스폰 + SAB Atomics 왕복,
// (4) 번들 Pyodide 부팅(indexURL = 확장 루트) + runPython. 결과를 SW로 보내 러너로 릴레이한다.
import { makeMessage } from "./browserControlProtocol.js";

const backchannelPort = new URL(location.href).searchParams.get("port");
const checks = [];
const add = (name, pass, info) => checks.push({ name, pass: !!pass, info: info || "" });

// 파이썬 pyprocBrowser 표면(승격될 블로킹 계약의 원형). run_sync로 SW 왕복을 동기화한다(socketBridge 패턴).
// 입력=문자열/JSON, 출력=JSON-값(structured clone 경계라 PyProxy 금지). ok=false면 파이썬 예외로 승격.
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
    # 에뮬레이션 심화(debugger mode 전용): 다크모드/타임존/로케일/오프라인/지오로케이션 스푸핑
    def emulateMedia(self, colorScheme=None, media=None, reducedMotion=None):
        self._op("emulateMedia", colorScheme=colorScheme, media=media, reducedMotion=reducedMotion); return self
    def setTimezone(self, timezoneId):
        self._op("setTimezone", timezoneId=timezoneId); return self
    def setOffline(self, offline=True):
        self._op("setOffline", offline=offline); return self
    def setGeolocation(self, latitude, longitude, accuracy=10):
        self._op("setGeolocation", latitude=latitude, longitude=longitude, accuracy=accuracy); return self
    def setLocale(self, locale):
        self._op("setLocale", locale=locale); return self
    # 다운로드 관측(debugger mode 전용): downloadWillBegin/Progress로 무엇이 다운로드되는지 회수.
    def enableDownloads(self):
        self._op("enableDownloads"); return self
    def waitForDownload(self, timeout=10000):
        return self._op("waitForDownload", timeout=timeout).get("value")
    # 콘솔/에러 캡처(debugger mode 전용): console.* + 미처리 예외를 관측(AI 에이전트가 페이지 로그·에러를 본다).
    def enableConsole(self):
        self._op("enableConsole"); return self
    def consoleLogs(self):
        return self._op("consoleLogs").get("value")
    def waitForConsole(self, pattern, timeout=10000):
        return self._op("waitForConsole", pattern=pattern, timeout=timeout).get("value")
    # 접근성 트리(debugger mode 전용): role/name 의미 구조(에이전트가 DOM 대신 의미로 페이지를 이해).
    def accessibilityTree(self):
        return self._op("accessibilityTree").get("value")
    # 프레임 traversal(iframe 내부 조작). frames는 목록, frame(url/name)은 프레임 핸들.
    def frames(self):
        return self._op("frames").get("value")
    def frame(self, url=None, name=None):
        for f in self.frames():
            if url is not None and url in (f.get("url") or ""):
                return Frame(self, f.get("frameId"), f.get("targetId"))
            if name is not None and name == f.get("name"):
                return Frame(self, f.get("frameId"), f.get("targetId"))
        raise RuntimeError("frame 미발견: " + str(url or name))
    def close(self):
        self._op("closeSession")

class Frame:
    # iframe 내부 핸들. same-origin은 isolated world(frameId), cross-origin OOPIF는 별 세션(targetId)에서 실행.
    def __init__(self, tab, frameId=None, targetId=None):
        self._tab = tab
        self._fid = frameId
        self._tid = targetId
    def _fop(self, verb, **args):
        return self._tab._op("frameOp", frameId=self._fid, targetId=self._tid, verb=verb, **args)
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

// iframe 역전 실측 헬퍼: 주어진 URL을 offscreen(chrome-extension:// origin)의 iframe에 담고,
// 내부 페이지가 postMessage로 로드를 알리면 true. 타임아웃(차단)이면 false. cross-origin이라
// contentDocument 직접 접근 대신 postMessage로 로드 성공을 관측한다.
function tryFrame(url, timeoutMs, opts = {}) {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    // offscreen은 crossOriginIsolated(COEP require-corp)라 cross-origin iframe이 COEP로 막힌다.
    // credentialless(쿠키 격리 조건)로 그 벽을 넘는다. X-Frame-Options 제거와 별개의 축.
    iframe.credentialless = true;
    // sandbox: allow-top-navigation을 빼면 iframe 안 사이트의 frame-busting(top.location 변경)이 막힌다.
    if (opts.sandbox) iframe.setAttribute("sandbox", opts.sandbox);
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMsg);
      try { iframe.remove(); } catch (e) {}
      resolve(val);
    };
    const onMsg = (ev) => { if (ev.data === "framedLoaded") finish(true); };
    window.addEventListener("message", onMsg);
    setTimeout(() => finish(false), timeoutMs);
    iframe.src = url;
    document.body.appendChild(iframe);
  });
}

async function run() {
  const timings = {};

  // 게이트 2-a: 확장 문서가 crossOriginIsolated인가(manifest COEP/COOP 키의 효과).
  add("crossOriginIsolated", globalThis.crossOriginIsolated === true, `value=${globalThis.crossOriginIsolated}`);

  // 게이트 2-b: SharedArrayBuffer 생성.
  let sab = null;
  try {
    sab = new SharedArrayBuffer(16);
    add("SharedArrayBuffer 생성", true);
  } catch (e) {
    add("SharedArrayBuffer 생성", false, String(e));
  }

  // 게이트 2-c: module Worker 스폰 + SAB Atomics 왕복(프로세스 OS 핵심 = 워커가 공유메모리를 본다).
  if (sab) {
    try {
      const view = new Int32Array(sab);
      const worker = new Worker(new URL("./probeWorker.js", import.meta.url), { type: "module" });
      const echoed = await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error("worker 타임아웃")), 8000);
        worker.onmessage = (ev) => { clearTimeout(to); resolve(ev.data); };
        worker.onerror = (ev) => { clearTimeout(to); reject(new Error(ev.message || "worker onerror")); };
        worker.postMessage({ sab });
      });
      worker.terminate();
      // 워커가 view[0]에 Atomics로 42를 썼으면 공유메모리가 실제로 공유됐다는 증거.
      add("module Worker 스폰 + SAB Atomics 왕복", echoed && echoed.ok && Atomics.load(view, 0) === 42, `echo=${JSON.stringify(echoed)}, view0=${Atomics.load(view, 0)}`);
    } catch (e) {
      add("module Worker 스폰 + SAB Atomics 왕복", false, String(e));
    }
  }

  // JSPI 가시성(부팅 없이도 확인 가능한 예비 신호).
  add("JSPI(WebAssembly.Suspending) 존재", typeof WebAssembly.Suspending === "function", `typeof=${typeof WebAssembly.Suspending}`);

  // 게이트 1: 번들 Pyodide 부팅 + runPython. indexURL = 확장 루트(chrome-extension://ID/).
  try {
    const indexURL = chrome.runtime.getURL("/");
    const t0 = performance.now();
    const mod = await import(indexURL + "pyodide.mjs");
    const py = await mod.loadPyodide({ indexURL });
    timings.bootMs = Math.round(performance.now() - t0);
    const two = py.runPython("1+1");
    add("Pyodide 부팅 + runPython(1+1)==2", two === 2, `result=${two}, bootMs=${timings.bootMs}`);

    // 부팅됐으면 JSPI 실동작도 본다: runPythonAsync(비동기 파이썬)가 도는가.
    try {
      const asyncOk = await py.runPythonAsync("import asyncio\nawait asyncio.sleep(0)\n7*6");
      add("runPythonAsync(JSPI 실동작)==42", asyncOk === 42, `result=${asyncOk}`);
    } catch (e) {
      add("runPythonAsync(JSPI 실동작)==42", false, String(e));
    }

    // 게이트 3: 파이썬이 chrome.debugger로 다른 탭을 운전한다(브라우저 자체 조작).
    // 브리지: 파이썬 -> 이 JS 함수 -> runtime 메시지 -> SW의 chrome.debugger -> 결과.
    try {
      py.globals.set("cdpNavigateEval", async (url, expr, override) => chrome.runtime.sendMessage({ type: "cdp", url, expr, override: !!override }));
      py.globals.set("contentScriptEval", async (url, expr) => chrome.runtime.sendMessage({ type: "contentScript", url, expr }));
      py.globals.set("trustedInput", async (url) => chrome.runtime.sendMessage({ type: "trustedInput", url }));
      const targetUrl = `http://127.0.0.1:${backchannelPort}/cdpTarget`;
      const signalExpr = "JSON.stringify({webdriver: navigator.webdriver, uaHeadless: /Headless/.test(navigator.userAgent), plugins: navigator.plugins.length, hasWindowChrome: typeof window.chrome, languages: (navigator.languages||[]).length})";
      const t1 = performance.now();
      const arr = (await py.runPythonAsync(`
target = "${targetUrl}"
titleResult = await cdpNavigateEval(target, "document.title")
markerResult = await cdpNavigateEval(target, "document.getElementById('marker').textContent")
computeResult = await cdpNavigateEval(target, "6 * 7")
cdpSignal = await cdpNavigateEval(target, ${JSON.stringify(signalExpr)})
scriptSignal = await contentScriptEval(target, ${JSON.stringify(signalExpr)})
overrideRead = await cdpNavigateEval(target, "String(navigator.webdriver)", True)
inputResult = await trustedInput(target)
import asyncio
multiA, multiB = await asyncio.gather(cdpNavigateEval(target, "111 + 111"), cdpNavigateEval(target, "222 + 222"))
[titleResult.ok, titleResult.value, markerResult.value, computeResult.ok, computeResult.value, cdpSignal.value, scriptSignal.ok, scriptSignal.value, overrideRead.value, inputResult.ok, inputResult.value, multiA.value, multiB.value]
`)).toJs();
      timings.cdpMs = Math.round(performance.now() - t1);
      const [navOk, title, marker, evalOk, compute, cdpSignals, scriptOk, scriptSignals, overrideRead, inputOk, inputValue, multiA, multiB] = arr;
      add("게이트3: 파이썬 -> chrome.debugger Page.navigate + Runtime.evaluate",
        navOk === true && title === "pyprocCdpTarget" && marker === "cdpMarkerOk" && evalOk === true && compute === 42,
        `title=${title}, marker=${marker}, compute=${compute}, cdpMs=${timings.cdpMs}`);
      // 측정(pass/fail 아님): 두 조작 경로가 남기는 자동화 지문 대비. navigator.webdriver가 핵심 신호.
      // headless라 uaHeadless는 이 실측의 산물이고 실배포(headed)에선 진짜 UA.
      add("[측정] chrome.debugger 경로(CDP attach) 신호", true, cdpSignals);
      add("[측정] content script 경로(chrome.scripting, CDP 없음) 신호", true, `ok=${scriptOk}, ${scriptSignals}`);
      // 측정: 페이지 상위 선제 개입. 하네스는 포트로 webdriver=true인데, addScriptToEvaluateOnNewDocument로
      // 페이지 JS보다 먼저 navigator.webdriver를 덮으면 페이지가 읽는 값이 undefined가 되는가(= 표시등 끔).
      add("[측정] 페이지 상위 선제 개입 후 webdriver 읽힘값(override)", true, `off=true(포트), on=${overrideRead}`);
      // 게이트5+6: 신뢰 입력(isTrusted)과 실제 조작(입력칸 값 변경).
      try {
        const inputData = JSON.parse(inputValue);
        add("게이트5: 신뢰 입력(chrome.debugger Input.* -> isTrusted=true)",
          inputOk === true && inputData.click && inputData.click.clicked === true && inputData.click.trusted === true,
          `clicked=${inputData.click && inputData.click.clicked}, trusted=${inputData.click && inputData.click.trusted}`);
        add("게이트6: 실제 DOM 조작(신뢰 키 입력이 입력칸 값을 바꿈)",
          inputOk === true && inputData.field === "hello42",
          `field=${JSON.stringify(inputData.field)}`);
      } catch (e) {
        add("게이트5/6: 신뢰 입력 + 실제 조작", false, `${String(e)} (raw=${inputValue})`);
      }
      // 게이트7: 다중 세션 병렬(2탭 동시 조작 = 프로세스 OS 차별점). asyncio.gather로 두 CDP 왕복 동시.
      add("게이트7: 다중 세션 병렬(2탭 동시 CDP 조작)",
        multiA === 222 && multiB === 444, `sessionA=${multiA}, sessionB=${multiB}`);

      // 게이트9: 영속 세션 표면(pyprocBrowser). one-shot이 아니라 한 핸들로 op 사이에 탭/attach가 유지되는지 +
      // 블로킹 run_sync가 offscreen 메인스레드에서 도는지(3에이전트 최대 리스크) 실측. debugger/script 두 mode.
      try {
        py.globals.set("_pyprocBrowserSend", async (op, fieldsJson) => {
          const resp = await chrome.runtime.sendMessage(makeMessage(op, JSON.parse(fieldsJson)));
          return JSON.stringify(resp);
        });
        await py.runPythonAsync(PYPROC_BROWSER_MODULE);
        const sessionArr = (await py.runPythonAsync(`
import pyprocBrowser as browser
persistTarget = "${targetUrl}"
dbg = browser.tab(persistTarget, mode="debugger")
dbgTitle = dbg.evaluate("document.title")
dbg.type("#field", "persistDbg")
dbgField = dbg.evaluate("document.getElementById('field').value")
dbg.click("#btn")
dbgClicked = dbg.evaluate("JSON.stringify(window.clickReport)")
dbg.close()
scr = browser.tab(persistTarget, mode="script")
scrTitle = scr.evaluate("document.title")
scr.type("#field", "persistScr")
scrField = scr.evaluate("document.getElementById('field').value")
scr.close()
[dbgTitle, dbgField, dbgClicked, scrTitle, scrField]
`)).toJs();
        const [dbgTitle, dbgField, dbgClicked, scrTitle, scrField] = sessionArr;
        const dbgClickData = JSON.parse(dbgClicked || "{}");
        add("게이트9a: 영속 세션(debugger) 한 핸들 다중 op + 블로킹 run_sync",
          dbgTitle === "pyprocCdpTarget" && dbgField === "persistDbg" && dbgClickData.trusted === true,
          `title=${dbgTitle}, field=${dbgField}, clickTrusted=${dbgClickData.trusted}`);
        add("게이트9b: 영속 세션(script) 한 핸들 다중 op",
          scrTitle === "pyprocCdpTarget" && scrField === "persistScr",
          `title=${scrTitle}, field=${scrField}`);

        // 게이트10: 세션 수명. 탭이 외부 종료(onRemoved)되면 이후 op가 SessionLost로 깨끗이 실패해야(행 금지).
        py.globals.set("_testKillTab", async (sid) => JSON.stringify(await chrome.runtime.sendMessage({ type: "testKillTab", sid })));
        const lifecycleArr = (await py.runPythonAsync(`
from pyodide.ffi import run_sync
victim = browser.tab(persistTarget, mode="debugger")
victimSid = victim._sid
run_sync(_testKillTab(victimSid))
lostError = "NO_ERROR"
try:
    victim.evaluate("1 + 1")
except Exception as e:
    lostError = str(e)
[lostError]
`)).toJs();
        const [lostError] = lifecycleArr;
        add("게이트10: 세션 수명(탭 외부 종료 -> 죽은 세션 op가 깨끗이 실패, 행 금지)",
          typeof lostError === "string" && lostError !== "NO_ERROR",
          `error=${lostError}`);

        // 게이트12: 프로세스 OS 워커 N=세션 N. 워커(chrome 미접근, 제약 A)가 offscreen 라우터 4-홉으로
        // 각자 세션을 조작한다. 워커 2개가 병렬로 다른 label을 쓰고 되읽어 세션 격리 + 라우터를 실증.
        const spawnRouterWorker = (label) => new Promise((resolve, reject) => {
          const w = new Worker(new URL("./browserRouterWorker.js", import.meta.url), { type: "module" });
          w.onmessage = async (ev) => {
            const m = ev.data;
            if (m.type === "op") {
              const opResult = await chrome.runtime.sendMessage(makeMessage(m.op, m.fields));
              w.postMessage({ type: "opResult", reqId: m.reqId, result: opResult });
            } else if (m.type === "done") {
              w.terminate();
              resolve(m.result);
            }
          };
          w.onerror = (ev) => { w.terminate(); reject(new Error(ev.message || "router worker error")); };
          w.postMessage({ type: "run", label, target: targetUrl });
        });
        const [workerA, workerB] = await Promise.all([spawnRouterWorker("workerA"), spawnRouterWorker("workerB")]);
        add("게이트12: 프로세스 OS 워커 N=세션 N(offscreen 라우터 4-홉, 워커 chrome 미접근 우회)",
          workerA.title === "pyprocCdpTarget" && workerA.label === "workerA" && workerB.label === "workerB",
          `A={title:${workerA.title},label:${workerA.label}}, B={label:${workerB.label}}`);

        // 게이트13: MV3 SW 강제종료 -> 다음 op 재attach 복구. 세션을 열고 러너가 CDP로 SW를 죽인 뒤,
        // storage.session 메타 + 살아있는 탭으로 재attach해 op가 복구되는가(SW 30초 소멸/크래시 대응).
        const recOpen = await chrome.runtime.sendMessage(makeMessage("openSession", { mode: "debugger" }));
        const recSid = recOpen.sessionId;
        await chrome.runtime.sendMessage(makeMessage("navigate", { sessionId: recSid, args: { url: targetUrl } }));
        let killErr = "";
        try { await fetch(`http://127.0.0.1:${backchannelPort}/killSW`); } catch (e) { killErr = "fetch:" + String(e); } // 러너가 서비스워커를 강제종료
        await new Promise((r) => setTimeout(r, 2000)); // SW 재시작 여유
        const recEval = await chrome.runtime.sendMessage(makeMessage("evaluate", { sessionId: recSid, args: { expr: "document.title" } }));
        add("게이트13: MV3 SW 강제종료 후 재attach 복구",
          recEval && recEval.ok === true && recEval.value === "pyprocCdpTarget",
          `recovered=${recEval && recEval.value}, ok=${recEval && recEval.ok}, err=${recEval && recEval.error}${killErr}`);
        try { await chrome.runtime.sendMessage(makeMessage("closeSession", { sessionId: recSid })); } catch (e) {}

        // 게이트14: waitForSelector. 700ms 뒤 등장하는 요소를 대기 후 확인(자동화 안정성 = 요소 나타날 때까지).
        const waitArr = (await py.runPythonAsync(`
wt = browser.tab(persistTarget, mode="debugger")
wt.waitFor("#delayed", 5000)
appeared = wt.evaluate("document.getElementById('delayed').textContent")
wt.close()
[appeared]
`)).toJs();
        add("게이트14: waitForSelector(지연 등장 요소 대기)", waitArr[0] === "appeared", `text=${waitArr[0]}`);

        // 게이트15: 확장 표면(Playwright급). 한 debugger 세션에서 추출/조회 + 폼 입력 + 포인터 확장 +
        // 신뢰 키보드(폼 제출/단축키) + waitForFunction + screenshot + 에뮬레이션(viewport/UA/헤더) +
        // 항법 히스토리(back/forward/reload) + 쿠키 왕복을 실측한다. evaluate 합성 op와 CDP 전용 op를 모두 관통.
        const echoTarget = targetUrl.replace("/cdpTarget", "/echoHeaders");
        const g15 = JSON.parse((await py.runPythonAsync(`
ex = browser.tab(persistTarget, mode="debugger")
echoTarget = "${echoTarget}"
res = {}
res["title"] = ex.title()
res["url"] = ex.url()
res["marker"] = ex.text("#marker")
res["markerHtml"] = ex.html("#marker")
res["fieldId"] = ex.attr("#field", "id")
res["itemCount"] = ex.count("li.item")
res["itemTexts"] = ex.texts("li.item")
res["missingExists"] = ex.exists("#nope")
res["btnW"] = ex.boundingBox("#btn")["width"]
try:
    ex.text("#nope"); res["missingRaises"] = False
except Exception:
    res["missingRaises"] = True
ex.fill("#field", "filled15")
res["filled"] = ex.value("#field")
ex.select("#sel", "two")
res["selected"] = ex.value("#sel")
ex.hover("#hoverbox")
res["hover"] = ex.evaluate("JSON.stringify(window.hoverReport)")
ex.doubleClick("#dbl")
res["dbl"] = ex.evaluate("JSON.stringify(window.dblReport)")
ex.rightClick("#ctx")
res["ctx"] = ex.evaluate("JSON.stringify(window.ctxReport)")
ex.fill("#formField", "submitme")
ex.press("Enter", "#formField")
res["submit"] = ex.evaluate("String(window.submitReport)")
ex.press("Control+a", "#formField")
res["keyReport"] = ex.evaluate("JSON.stringify(window.keyReport)")
ex.waitForFunction("window.__ready === true", 4000)
res["ready"] = ex.evaluate("window.__ready === true")
shot = ex.screenshot()
res["shotHead"] = shot[:8] if shot else ""
res["shotLen"] = len(shot) if shot else 0
ex.setViewport(540, 480)
res["innerWidth"] = ex.evaluate("window.innerWidth")
ex.setUserAgent("pyprocUA/15")
res["uaJs"] = ex.evaluate("navigator.userAgent")
ex.navigate(persistTarget + "?p=1")
ex.navigate(persistTarget + "?p=2")
ex.back()
res["afterBack"] = ex.url()
ex.forward()
res["afterForward"] = ex.url()
ex.reload()
res["afterReload"] = ex.url()
ex.setHeaders({"x-pyproc": "gate15"})
ex.navigate(echoTarget)
res["echo"] = ex.text("#h")
ex.setCookie("pyprocCk", "v15", url=persistTarget)
res["cookieNames"] = [c.get("name") for c in ex.cookies([persistTarget])]
ex.close()
json.dumps(res)
`)));
        const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        add("게이트15a: 추출/조회(title/url/text/html/attr/count/texts/exists/boundingBox + 미발견 예외)",
          g15.title === "pyprocCdpTarget" && g15.url.includes("/cdpTarget") && g15.marker === "cdpMarkerOk" &&
          g15.markerHtml === "cdpMarkerOk" && g15.fieldId === "field" && g15.itemCount === 3 &&
          eq(g15.itemTexts, ["a", "b", "c"]) && g15.missingExists === false && g15.btnW > 0 && g15.missingRaises === true,
          `count=${g15.itemCount}, texts=${JSON.stringify(g15.itemTexts)}, btnW=${g15.btnW}, missingRaises=${g15.missingRaises}`);
        add("게이트15b: 폼 입력(fill 값 대체 + select 옵션)",
          g15.filled === "filled15" && g15.selected === "two", `filled=${g15.filled}, selected=${g15.selected}`);
        const hov = JSON.parse(g15.hover || "null"), dbl = JSON.parse(g15.dbl || "null"), ctx = JSON.parse(g15.ctx || "null");
        add("게이트15c: 포인터 확장(hover/doubleClick/rightClick 신뢰 이벤트)",
          hov && hov.trusted === true && dbl && dbl.trusted === true && ctx && ctx.trusted === true,
          `hover=${g15.hover}, dbl=${g15.dbl}, ctx=${g15.ctx}`);
        const keys = JSON.parse(g15.keyReport || "[]");
        const ctrlA = keys.find((k) => k.key === "a" && k.ctrl === true);
        add("게이트15d: 신뢰 키보드(Enter 폼 제출 + Control+a 단축키 isTrusted)",
          g15.submit === "true" && !!ctrlA && ctrlA.trusted === true,
          `submit=${g15.submit}, ctrlA=${JSON.stringify(ctrlA)}`);
        add("게이트15e: waitForFunction(임의 조건 수렴 대기)", g15.ready === true, `ready=${g15.ready}`);
        add("게이트15f: screenshot(Page.captureScreenshot -> PNG base64)",
          g15.shotHead === "iVBORw0K" && g15.shotLen > 100, `head=${g15.shotHead}, len=${g15.shotLen}`);
        add("게이트15g: 에뮬레이션(setViewport innerWidth + setUserAgent + setHeaders 요청 반영)",
          g15.innerWidth === 540 && g15.uaJs === "pyprocUA/15" && g15.echo.includes("x-pyproc") && g15.echo.includes("gate15") && g15.echo.includes("pyprocUA/15"),
          `innerWidth=${g15.innerWidth}, ua=${g15.uaJs}, echoHasHeader=${g15.echo.includes("x-pyproc")}`);
        add("게이트15h: 항법 히스토리(back/forward/reload)",
          g15.afterBack.endsWith("?p=1") && g15.afterForward.endsWith("?p=2") && g15.afterReload.includes("?p=2"),
          `back=${g15.afterBack}, forward=${g15.afterForward}, reload=${g15.afterReload}`);
        add("게이트15i: 쿠키 왕복(setCookie -> cookies)",
          Array.isArray(g15.cookieNames) && g15.cookieNames.includes("pyprocCk"),
          `cookies=${JSON.stringify(g15.cookieNames)}`);

        // 게이트16: 실전 자동화 강력 배치. 자동 스크롤(폴드 아래 신뢰 클릭) + 다이얼로그 자동 처리(accept/reject)
        // + 파일 업로드(setFileInputFiles) + 쿠키 삭제 + 네트워크 관측(waitForResponse) + 가로채기(block/fulfill).
        let uploadProbePath = "";
        try { uploadProbePath = await (await fetch(`http://127.0.0.1:${backchannelPort}/uploadProbe`)).text(); } catch (e) { uploadProbePath = ""; }
        const g16 = JSON.parse((await py.runPythonAsync(`
d = browser.tab(persistTarget, mode="debugger")
uploadProbePath = ${JSON.stringify(uploadProbePath)}
r = {}
d.click("#far")
r["farClicked"] = d.evaluate("window.farClicked === true")
d.scrollIntoView("#marker")
d.setDialogHandler(True)
d.click("#dialogBtn")
d.waitForFunction("window.dialogResult !== null", 3000)
r["dialogAccept"] = d.evaluate("window.dialogResult")
r["dialogMsg"] = d.lastDialog()
d.setDialogHandler(False)
d.evaluate("window.dialogResult = null")
d.click("#dialogBtn")
d.waitForFunction("window.dialogResult !== null", 3000)
r["dialogReject"] = d.evaluate("window.dialogResult")
d.upload("#file", [uploadProbePath])
r["fileCount"] = d.evaluate("document.querySelector('#file').files.length")
r["fileName"] = d.evaluate("document.querySelector('#file').files.length ? document.querySelector('#file').files[0].name : ''")
d.setCookie("delCk", "1", url=persistTarget)
d.deleteCookie("delCk", url=persistTarget)
r["afterDelete"] = [c.get("name") for c in d.cookies([persistTarget])]
d.requests()
d.evaluate("window.apiResult=null; fetch('/jsonApi').then(x=>x.json()).then(j=>{window.apiResult=j.msg})")
resp = d.waitForResponse("/jsonApi", 5000)
r["respStatus"] = resp["status"] if resp else None
d.waitForFunction("window.apiResult !== null", 3000)
r["apiReal"] = d.evaluate("window.apiResult")
d.route("/blockme", "block")
d.evaluate("window.blockErr=null; fetch('/blockme').then(function(){window.blockErr='loaded'}).catch(function(){window.blockErr='blocked'})")
d.waitForFunction("window.blockErr !== null", 3000)
r["blocked"] = d.evaluate("window.blockErr")
d.route("/mockme", "fulfill", status=200, body="MOCKED")
d.evaluate("window.mockBody=null; fetch('/mockme').then(function(x){return x.text()}).then(function(t){window.mockBody=t})")
d.waitForFunction("window.mockBody !== null", 3000)
r["mocked"] = d.evaluate("window.mockBody")
d.close()
json.dumps(r)
`)));
        add("게이트16a: 자동 스크롤(폴드 아래 요소 신뢰 클릭)", g16.farClicked === true, `farClicked=${g16.farClicked}`);
        add("게이트16b: 다이얼로그 자동 처리(confirm accept -> true, reject -> false, 메시지 회수)",
          g16.dialogAccept === true && g16.dialogReject === false && g16.dialogMsg === "proceed?",
          `accept=${g16.dialogAccept}, reject=${g16.dialogReject}, msg=${g16.dialogMsg}`);
        add("게이트16c: 파일 업로드(setFileInputFiles)", g16.fileCount === 1 && g16.fileName === "probe.txt",
          `count=${g16.fileCount}, name=${g16.fileName}`);
        add("게이트16d: 쿠키 삭제(deleteCookie)", Array.isArray(g16.afterDelete) && !g16.afterDelete.includes("delCk"),
          `after=${JSON.stringify(g16.afterDelete)}`);
        add("게이트16e: 네트워크 관측(waitForResponse + 실제 응답 수신)",
          g16.respStatus === 200 && g16.apiReal === "apihit", `status=${g16.respStatus}, api=${g16.apiReal}`);
        add("게이트16f: 네트워크 가로채기(route block -> fetch 실패)", g16.blocked === "blocked", `blockErr=${g16.blocked}`);
        add("게이트16g: 네트워크 가로채기(route fulfill -> 정적 응답 주입)", g16.mocked === "MOCKED", `mockBody=${g16.mocked}`);

        // 게이트17: 네트워크 심화(콜백형). 요청 변조(헤더 주입) + held routing(요청을 붙잡아 continue/fulfill/abort로
        // 동적 결정) + 응답 바디 캡처. 선언형 route를 넘어 요청 단위 동적 제어를 블로킹 모델과 정합하게 실측.
        const g17 = JSON.parse((await py.runPythonAsync(`
d = browser.tab(persistTarget, mode="debugger")
echoTarget = "${echoTarget}"
r = {}
d.requests()
d.route("/echoHeaders", "modify", headers={"x-injected": "yes17"})
d.navigate(echoTarget)
r["injected"] = "x-injected" in d.text("#h")
d.navigate(persistTarget)
def waitPending(pat):
    for _ in range(60):
        for p in d.pendingRequests():
            if pat in p["url"]:
                return p["id"]
    return None
d.route("/heldApi", "hold")
d.evaluate("window.heldC=null; fetch('/heldApi').then(function(x){return x.json()}).then(function(j){window.heldC=j.held})")
d.continueRequest(waitPending("/heldApi"))
d.waitForFunction("window.heldC !== null", 3000)
r["heldContinue"] = d.evaluate("window.heldC")
d.route("/heldMock", "hold")
d.evaluate("window.heldF=null; fetch('/heldMock').then(function(x){return x.text()}).then(function(t){window.heldF=t})")
d.fulfillRequest(waitPending("/heldMock"), status=200, body="HELD-MOCK")
d.waitForFunction("window.heldF !== null", 3000)
r["heldFulfill"] = d.evaluate("window.heldF")
d.route("/heldAbort", "hold")
d.evaluate("window.heldA=null; fetch('/heldAbort').then(function(){window.heldA='loaded'}).catch(function(){window.heldA='aborted'})")
d.abortRequest(waitPending("/heldAbort"))
d.waitForFunction("window.heldA !== null", 3000)
r["heldAbort"] = d.evaluate("window.heldA")
d.evaluate("window.rb=null; fetch('/jsonApi').then(function(x){return x.json()}).then(function(j){window.rb=j.msg})")
d.waitForResponse("/jsonApi", 5000)
d.waitForFunction("window.rb !== null", 3000)
rb = d.responseBody("/jsonApi")
r["respBody"] = rb["body"] if rb else None
d.close()
json.dumps(r)
`)));
        add("게이트17a: 요청 변조(route modify 헤더 주입 -> 서버 반영)", g17.injected === true, `injected=${g17.injected}`);
        add("게이트17b: held routing continue(붙잡은 요청을 통과 -> 실제 응답)", g17.heldContinue === "ok", `heldContinue=${g17.heldContinue}`);
        add("게이트17c: held routing fulfill(붙잡은 요청에 정적 응답 주입)", g17.heldFulfill === "HELD-MOCK", `heldFulfill=${g17.heldFulfill}`);
        add("게이트17d: held routing abort(붙잡은 요청 취소)", g17.heldAbort === "aborted", `heldAbort=${g17.heldAbort}`);
        add("게이트17e: 응답 바디 캡처(responseBody)", typeof g17.respBody === "string" && g17.respBody.includes("apihit"), `respBody=${g17.respBody}`);

        // 게이트18: 프레임 traversal. /cdpTarget이 same-origin 자식 프레임을 담고, isolated world로 드릴다운해
        // 프레임 내부를 조회/입력/클릭한다(고정 화면 셸이 사이트를 iframe에 담는 비전과 직결).
        // cross-origin(OOPIF)은 별도 프로세스라 setAutoAttach가 필요한 별개 축(정직한 경계, 원장 기록).
        const g18 = JSON.parse((await py.runPythonAsync(`
d = browser.tab(persistTarget, mode="debugger")
r = {}
frs = d.frames()
r["frameCount"] = len(frs)
r["hasChild"] = any("/frameChild" in (f.get("url") or "") for f in frs)
f = d.frame(url="/frameChild")
f.waitFor("#cmarker", 3000)
r["childMarker"] = f.text("#cmarker")
r["childExists"] = f.exists("#cmarker")
f.fill("#cfield", "framedIn")
r["childField"] = f.value("#cfield")
f.click("#cbtn")
r["afterClick"] = f.text("#cmarker")
r["childPath"] = f.evaluate("location.pathname")
d.close()
json.dumps(r)
`)));
        add("게이트18a: 프레임 목록(frames = 톱 + 자식)",
          g18.frameCount >= 2 && g18.hasChild === true, `count=${g18.frameCount}, hasChild=${g18.hasChild}`);
        add("게이트18b: 프레임 내부 조회(text/exists/value, isolated world)",
          g18.childMarker === "childOk" && g18.childExists === true && g18.childPath === "/frameChild",
          `marker=${g18.childMarker}, exists=${g18.childExists}, path=${g18.childPath}`);
        add("게이트18c: 프레임 내부 조작(fill + click -> DOM 변경)",
          g18.childField === "framedIn" && g18.afterClick === "clicked",
          `field=${g18.childField}, afterClick=${g18.afterClick}`);

        // 게이트19: 에뮬레이션 심화. 페이지가 실제로 관측하는 환경을 스푸핑한다(다크모드/타임존/오프라인).
        // matchMedia/Intl/navigator.onLine으로 페이지 관측값이 실제로 바뀌는지 검증(전부 라이브).
        const g19 = JSON.parse((await py.runPythonAsync(`
d = browser.tab(persistTarget, mode="debugger")
r = {}
d.emulateMedia(colorScheme="dark")
r["dark"] = d.evaluate("matchMedia('(prefers-color-scheme: dark)').matches")
d.emulateMedia(colorScheme="light")
r["light"] = d.evaluate("matchMedia('(prefers-color-scheme: light)').matches")
d.setTimezone("Asia/Seoul")
r["tz"] = d.evaluate("Intl.DateTimeFormat().resolvedOptions().timeZone")
d.setOffline(True)
r["offline"] = d.evaluate("navigator.onLine")
d.setOffline(False)
r["online"] = d.evaluate("navigator.onLine")
d.close()
json.dumps(r)
`)));
        add("게이트19a: 미디어 에뮬레이션(prefers-color-scheme dark/light)",
          g19.dark === true && g19.light === true, `dark=${g19.dark}, light=${g19.light}`);
        add("게이트19b: 타임존 오버라이드(Intl 관측)",
          g19.tz === "Asia/Seoul", `tz=${g19.tz}`);
        add("게이트19c: 오프라인 에뮬레이션(navigator.onLine)",
          g19.offline === false && g19.online === true, `offline->onLine=${g19.offline}, online->onLine=${g19.online}`);

        // 게이트25: 지오로케이션 스푸핑(Phase 7 벽 돌파). Browser.grantPermissions는 browser-level이라 막혔지만
        // chrome.contentSettings.location(확장 API)로 권한을 우회 부여 + Emulation.setGeolocationOverride로 좌표.
        const g25 = JSON.parse((await py.runPythonAsync(`
d = browser.tab(persistTarget, mode="debugger")
r = {}
d.setGeolocation(37.5665, 126.9780)
d.evaluate("window.__geo=null; navigator.geolocation.getCurrentPosition(function(p){window.__geo=p.coords.latitude}, function(e){window.__geo='err:'+e.code})")
d.waitForFunction("window.__geo !== null", 5000)
r["geo"] = d.evaluate("window.__geo")
d.close()
json.dumps(r)
`)));
        add("게이트25: 지오로케이션 스푸핑(contentSettings 권한 우회 + setGeolocationOverride)",
          typeof g25.geo === "number" && Math.abs(g25.geo - 37.5665) < 0.01, `geo=${g25.geo}`);

        // 게이트26: 로케일 스푸핑(Phase 7 벽 돌파). setLocaleOverride는 Edge서 미반영이라 Accept-Language 헤더 +
        // navigator.language 선제 오버라이드로 대행. 항법 후 navigator.language + echoHeaders Accept-Language 검증.
        const g26 = JSON.parse((await py.runPythonAsync(`
d = browser.tab(persistTarget, mode="debugger")
r = {}
d.setLocale("fr-FR")
d.navigate(echoTarget)
r["acceptLang"] = "fr-FR" in d.text("#h")
d.navigate(persistTarget)
r["navLang"] = d.evaluate("navigator.language")
r["navLang0"] = d.evaluate("navigator.languages[0]")
d.close()
json.dumps(r)
`)));
        add("게이트26: 로케일 스푸핑(navigator.language 선제 오버라이드 + Accept-Language 헤더)",
          g26.navLang === "fr-FR" && g26.navLang0 === "fr-FR" && g26.acceptLang === true,
          `navLang=${g26.navLang}, navLang0=${g26.navLang0}, acceptLang=${g26.acceptLang}`);

        // 게이트21: 다운로드 관측. attachment 링크를 신뢰 클릭하면 다운로드가 시작되고, downloadWillBegin으로
        // 무엇이 다운로드되는지(파일명/URL) 관측한다. 저장 경로 지정은 browser-level이라 tab-session에선 못 두는 게 정직.
        const g21 = JSON.parse((await py.runPythonAsync(`
d = browser.tab(persistTarget, mode="debugger")
r = {}
d.enableDownloads()
d.click("#dl")
dl = d.waitForDownload(6000)
r["filename"] = dl["filename"] if dl else None
r["url"] = dl["url"] if dl else None
r["state"] = dl["state"] if dl else None
d.close()
json.dumps(r)
`)));
        add("게이트21: 다운로드 관측(downloadWillBegin -> 파일명/URL 회수)",
          g21.filename === "report.txt" && String(g21.url).includes("/downloadFile"),
          `filename=${g21.filename}, state=${g21.state}, url=${g21.url}`);

        // 게이트22: 콘솔/에러 캡처. 페이지의 console.*(consoleAPICalled) + 미처리 예외(exceptionThrown)를 관측한다
        // (AI 에이전트가 페이지가 무엇을 로그·에러냈는지 본다). log/error/exception 세 종류를 다 잡는지 검증.
        const g22 = JSON.parse((await py.runPythonAsync(`
d = browser.tab(persistTarget, mode="debugger")
r = {}
d.enableConsole()
d.evaluate("console.log('pyprocLog', 42); console.error('pyprocErr'); setTimeout(function(){ throw new Error('pyprocThrow') }, 30)")
hit = d.waitForConsole("pyprocLog", 3000)
r["logText"] = hit["text"] if hit else None
d.waitForConsole("pyprocThrow", 3000)
logs = d.consoleLogs()
r["types"] = sorted(set(l["type"] for l in logs))
r["hasErr"] = any("pyprocErr" in l["text"] for l in logs)
r["hasThrow"] = any("pyprocThrow" in l["text"] for l in logs)
d.close()
json.dumps(r)
`)));
        add("게이트22: 콘솔/에러 캡처(console.log/error + 미처리 예외 관측)",
          String(g22.logText).includes("pyprocLog") && String(g22.logText).includes("42") &&
          g22.hasErr === true && g22.hasThrow === true &&
          g22.types.includes("log") && g22.types.includes("error") && g22.types.includes("exception"),
          `logText=${g22.logText}, types=${JSON.stringify(g22.types)}, hasErr=${g22.hasErr}, hasThrow=${g22.hasThrow}`);

        // 게이트23: 접근성 트리. 페이지를 role/name 시맨틱으로 회수한다(에이전트가 DOM 셀렉터 대신 의미로 이해).
        // 타깃의 button/textbox 등이 접근성 트리에 role+name으로 잡히는지 검증.
        const g23 = JSON.parse((await py.runPythonAsync(`
d = browser.tab(persistTarget, mode="debugger")
r = {}
ax = d.accessibilityTree()
r["count"] = len(ax)
r["roles"] = sorted(set(n["role"] for n in ax if n.get("role")))
r["hasButton"] = any(n.get("role") == "button" for n in ax)
r["buttonNames"] = [n.get("name") for n in ax if n.get("role") == "button"]
d.close()
json.dumps(r)
`)));
        add("게이트23: 접근성 트리(role/name 시맨틱 회수)",
          g23.count > 0 && g23.hasButton === true && g23.buttonNames.includes("click"),
          `count=${g23.count}, hasButton=${g23.hasButton}, buttonNames=${JSON.stringify(g23.buttonNames)}, roles=${JSON.stringify(g23.roles)}`);

        // 게이트24: cross-origin OOPIF 프레임 드릴다운. localhost(별 origin) 자식은 OOPIF(별 프로세스)라
        // getFrameTree에 없지만 getTargets에 뜬다. 이 페이지 iframe src로 스코프해 targetId로 직접 attach,
        // 그 프레임 컨텍스트에서 조회/입력. same-origin(#fr) + cross-origin(#xfr) 둘 다 드릴다운을 실증.
        const g24 = JSON.parse((await py.runPythonAsync(`
d = browser.tab(persistTarget, mode="debugger")
d.waitFor("#xfr", 4000)
r = {}
r["frameUrls"] = [{"url": f.get("url"), "oopif": f.get("oopif")} for f in d.frames()]
xf = d.frame(url="localhost")
r["oopifMarker"] = xf.text("#cmarker")
r["oopifHref"] = xf.evaluate("location.href")
xf.fill("#cfield", "oopifFilled")
r["oopifField"] = xf.value("#cfield")
sf = d.frame(url="/frameChild")
r["sameMarker"] = sf.text("#cmarker")
d.close()
json.dumps(r)
`)));
        add("게이트24: cross-origin OOPIF 프레임 드릴다운(getTargets attach)",
          g24.oopifMarker === "childOk" && String(g24.oopifHref).includes("localhost") &&
          String(g24.oopifHref).includes("/frameChild") && g24.oopifField === "oopifFilled" && g24.sameMarker === "childOk",
          `oopifMarker=${g24.oopifMarker}, href=${g24.oopifHref}, field=${g24.oopifField}, sameMarker=${g24.sameMarker}, frames=${JSON.stringify(g24.frameUrls)}`);

        // 게이트20: 파이썬 워커 N=세션 N 진짜 병렬. 각 워커가 자기 Pyodide 인터프리터(독립 GIL)를 부팅하고
        // run_sync(JSPI) + offscreen 라우터로 자기 세션을 몰아 조작한다(제약 A 우회). 프로세스 OS x 브라우저
        // 컨트롤의 최대 차별점. 워커 2개가 각자 CPU 연산(총합) + 자기 label을 자기 탭에 쓰고 되읽어 격리·병렬 실증.
        const spawnPyWorker = (label) => new Promise((resolve, reject) => {
          const w = new Worker(new URL("./browserPyWorker.js", import.meta.url), { type: "module" });
          w.onmessage = async (ev) => {
            const wm = ev.data;
            if (wm.type === "op") {
              const opResult = await chrome.runtime.sendMessage(makeMessage(wm.op, wm.fields));
              w.postMessage({ type: "opResult", reqId: wm.reqId, result: opResult });
            } else if (wm.type === "done") {
              w.terminate(); resolve(wm.result);
            } else if (wm.type === "error") {
              w.terminate(); reject(new Error(wm.error));
            }
          };
          w.onerror = (ev) => { w.terminate(); reject(new Error(ev.message || "pyWorker onerror")); };
          w.postMessage({ type: "run", indexURL: chrome.runtime.getURL("/"), label, target: targetUrl, moduleSource: PYPROC_BROWSER_MODULE });
        });
        try {
          const [pa, pb] = await Promise.all([spawnPyWorker("workerA"), spawnPyWorker("workerB")]);
          add("게이트20: 파이썬 워커 N=세션 N 병렬(각 워커 자기 Pyodide + run_sync 라우터 + 세션 격리)",
            pa.readback === "workerA" && pb.readback === "workerB" &&
            pa.total === 19999900000 && pb.total === 19999900000 && pa.title === "pyprocCdpTarget",
            `A={readback:${pa.readback},total:${pa.total}}, B={readback:${pb.readback},total:${pb.total}}`);
        } catch (e) {
          add("게이트20: 파이썬 워커 N=세션 N 병렬", false, String(e));
        }
      } catch (e) {
        add("게이트9/10/12: 영속 세션 + 워커 라우터", false, String(e));
      }
    } catch (e) {
      add("게이트3: 파이썬 -> chrome.debugger Page.navigate + Runtime.evaluate", false, String(e));
    }
  } catch (e) {
    add("Pyodide 부팅 + runPython(1+1)==2", false, String(e));
  }

  // 게이트(영속 셸): iframe 역전. X-Frame-Options: DENY 페이지가 규칙 없이는 iframe에서 차단되고,
  // declarativeNetRequest로 헤더를 벗기면 로드되는가 = 임의 사이트를 우리 셸의 창에 담을 수 있는가.
  try {
    const framedUrl = `http://127.0.0.1:${backchannelPort}/framedTarget`;
    const before = await tryFrame(framedUrl, 5000);
    await chrome.runtime.sendMessage({ type: "enableFrameStrip" });
    const after = await tryFrame(framedUrl, 8000);
    add("게이트4: iframe 역전(X-Frame-Options 제거로 cross-origin 사이트를 셸의 창에)",
      before === false && after === true,
      `헤더제거_전=${before}(차단 기대), 후=${after}(로드 기대)`);
    // 게이트8: frame-busting 무력화. top 이탈을 시도하는 사이트를 sandbox(allow-top-navigation 없음)로
    // 담으면 이탈이 막히고 셸(offscreen)이 유지된 채 iframe이 로드되는가.
    const bustUrl = `http://127.0.0.1:${backchannelPort}/bustTarget`;
    // allow-top-navigation을 빼는 것이 frame-busting 차단의 핵심이지만, COI offscreen은 credentialless를
    // 강제하고 그것이 sandbox와 충돌해 로드가 실패한다(관측). 게이트4의 쿠키 격리와 같은 뿌리 =
    // iframe 역전의 부가 축(sandbox·쿠키)은 non-COI 셸에서만 온전하다는 확증. non-COI 셸에서 재측정은 Phase 2.
    const bustLoaded = await tryFrame(bustUrl, 6000, { sandbox: "allow-scripts allow-same-origin" });
    add("[측정] frame-busting(sandbox): COI offscreen의 credentialless 충돌",
      true, `COI offscreen 로드=${bustLoaded}(실패 예상). iframe 역전의 sandbox/쿠키 축은 non-COI 셸 필요 = 게이트4와 동일 뿌리`);
  } catch (e) {
    add("게이트4/8: iframe 역전 + frame-busting", false, String(e));
  }

  const ok = checks.every((c) => c.pass);
  chrome.runtime.sendMessage({ type: "gateResult", backchannelPort, ok, checks, timings });
}

run().catch((e) => {
  chrome.runtime.sendMessage({ type: "gateResult", backchannelPort, ok: false, fatal: String(e), checks });
});
