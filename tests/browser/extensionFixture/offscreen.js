// offscreen.js - 픽스처 런타임 셸. 실 src의 boot() + Runtime.enableBrowserControl()을 쓴다(SSOT 검증).
// 코어 boot()가 offscreen에서 실 src 경로로 부팅되는지 + 승격된 pyprocBrowser 표면이 실동하는지 게이트한다.
import { boot } from "./src/runtime/runtime.js";
import { routeBrowserWorker } from "./src/capabilities/browserControl.js";

const backchannelPort = new URL(location.href).searchParams.get("port");
const checks = [];
const add = (name, pass, info) => checks.push({ name, pass: !!pass, info: info || "" });

async function run() {
  // 코어 boot(): document 있는 offscreen에서 vendor 엔진을 자체 import한 loadPyodide로 채택(globalThis 미오염).
  const indexURL = chrome.runtime.getURL("/");
  const mod = await import(indexURL + "pyodide.mjs");
  const rt = await boot({ indexURL, loadPyodide: (cfg) => mod.loadPyodide(cfg) });
  add("boot() 실 src로 offscreen 부팅", rt && typeof rt.runAsync === "function");

  // 승격된 능력: Runtime.enableBrowserControl().install()이 파이썬 pyprocBrowser를 배선(핸드셰이크 포함).
  const bc = rt.enableBrowserControl();
  await bc.install();
  add("enableBrowserControl().install() 배선 + 핸드셰이크", true);

  // 실 src 표면 왕복: 영속 세션 한 핸들로 evaluate/type/evaluate/close(블로킹 run_sync = runAsync 경로).
  const target = `http://127.0.0.1:${backchannelPort}/cdpTarget`;
  const arr = (await rt.runAsync(`
import pyprocBrowser as browser
handle = browser.tab("${target}", mode="debugger")
pageTitle = handle.evaluate("document.title")
handle.type("#field", "srcPromoted")
fieldValue = handle.evaluate("document.getElementById('field').value")
handle.close()
[pageTitle, fieldValue]
`)).toJs();
  const [pageTitle, fieldValue] = arr;
  add("실 src pyprocBrowser 왕복(tab/evaluate/type/close)",
    pageTitle === "pyprocCdpTarget" && fieldValue === "srcPromoted",
    `title=${pageTitle}, field=${fieldValue}`);

  // 확장 표면(Playwright급)이 실 src로 실동하는지 회귀 게이트: 추출/폼/포인터/대기/캡처/에뮬/쿠키/항법을 관통.
  const echoTarget = target.replace("/cdpTarget", "/echoHeaders");
  const g = JSON.parse((await rt.runAsync(`
import json
ex = browser.tab("${target}", mode="debugger")
r = {}
r["title"] = ex.title()
r["marker"] = ex.text("#marker")
r["fieldId"] = ex.attr("#field", "id")
r["itemCount"] = ex.count("li.item")
ex.fill("#field", "srcFill")
r["filled"] = ex.value("#field")
ex.select("#sel", "two")
r["selected"] = ex.value("#sel")
ex.doubleClick("#dbl")
r["dbl"] = ex.evaluate("JSON.stringify(window.dblReport)")
ex.press("Enter", "#formField")
r["submit"] = ex.evaluate("String(window.submitReport)")
ex.waitForFunction("window.__ready === true", 4000)
r["ready"] = ex.evaluate("window.__ready === true")
shot = ex.screenshot()
r["shotHead"] = shot[:8] if shot else ""
ex.setViewport(480, 360)
r["innerWidth"] = ex.evaluate("window.innerWidth")
ex.setHeaders({"x-pyproc": "srcgate"})
ex.navigate("${echoTarget}")
r["echo"] = ("x-pyproc" in ex.text("#h"))
ex.setCookie("srcCk", "v", url="${target}")
r["cookieNames"] = [c.get("name") for c in ex.cookies(["${target}"])]
ex.close()
json.dumps(r)
`)));
  add("실 src 확장 표면(추출/폼/포인터/대기/캡처/에뮬/쿠키)",
    g.title === "pyprocCdpTarget" && g.marker === "cdpMarkerOk" && g.fieldId === "field" && g.itemCount === 3 &&
    g.filled === "srcFill" && g.selected === "two" && JSON.parse(g.dbl || "null") && JSON.parse(g.dbl).trusted === true &&
    g.submit === "true" && g.ready === true && g.shotHead === "iVBORw0K" && g.innerWidth === 480 &&
    g.echo === true && Array.isArray(g.cookieNames) && g.cookieNames.includes("srcCk"),
    `filled=${g.filled}, selected=${g.selected}, dbl=${g.dbl}, submit=${g.submit}, shot=${g.shotHead}, innerWidth=${g.innerWidth}, echo=${g.echo}, cookies=${JSON.stringify(g.cookieNames)}`);

  // 실 src로 이벤트 리스너 기반 신규 경로(다이얼로그 자동 처리 + Fetch 가로채기 + Network 관측) 회귀 게이트.
  const g2 = JSON.parse((await rt.runAsync(`
import json
d = browser.tab("${target}", mode="debugger")
r = {}
d.setDialogHandler(True)
d.click("#dialogBtn")
d.waitForFunction("window.dialogResult !== null", 3000)
r["dialog"] = d.evaluate("window.dialogResult")
r["dialogMsg"] = d.lastDialog()
d.requests()
d.evaluate("window.apiResult=null; fetch('/jsonApi').then(function(x){return x.json()}).then(function(j){window.apiResult=j.msg})")
resp = d.waitForResponse("/jsonApi", 5000)
r["respStatus"] = resp["status"] if resp else None
d.route("/blockme", "block")
d.evaluate("window.blockErr=null; fetch('/blockme').then(function(){window.blockErr='loaded'}).catch(function(){window.blockErr='blocked'})")
d.waitForFunction("window.blockErr !== null", 3000)
r["blocked"] = d.evaluate("window.blockErr")
d.route("/mockme", "fulfill", status=200, body="MOCKED")
d.evaluate("window.mockBody=null; fetch('/mockme').then(function(x){return x.text()}).then(function(t){window.mockBody=t})")
d.waitForFunction("window.mockBody !== null", 3000)
r["mocked"] = d.evaluate("window.mockBody")
def waitPending(pat):
    for _ in range(60):
        for p in d.pendingRequests():
            if pat in p["url"]:
                return p["id"]
    return None
d.route("/heldMock", "hold")
d.evaluate("window.heldF=null; fetch('/heldMock').then(function(x){return x.text()}).then(function(t){window.heldF=t})")
d.fulfillRequest(waitPending("/heldMock"), status=200, body="HELD")
d.waitForFunction("window.heldF !== null", 3000)
r["heldFulfill"] = d.evaluate("window.heldF")
rb = d.responseBody("/jsonApi")
r["respBody"] = rb["body"] if rb else None
fr = d.frame(url="/frameChild")
fr.waitFor("#cmarker", 3000)
r["frameText"] = fr.text("#cmarker")
fr.fill("#cfield", "framedSrc")
r["frameField"] = fr.value("#cfield")
d.emulateMedia(colorScheme="dark")
r["dark"] = d.evaluate("matchMedia('(prefers-color-scheme: dark)').matches")
d.setTimezone("Asia/Seoul")
r["tz"] = d.evaluate("Intl.DateTimeFormat().resolvedOptions().timeZone")
d.setOffline(True)
r["offline"] = d.evaluate("navigator.onLine")
d.setOffline(False)
d.enableDownloads()
d.click("#dl")
dl = d.waitForDownload(6000)
r["dlFile"] = dl["filename"] if dl else None
d.close()
json.dumps(r)
`)));
  add("실 src 다이얼로그/네트워크/프레임/에뮬/다운로드",
    g2.dialog === true && g2.dialogMsg === "proceed?" && g2.respStatus === 200 &&
    g2.blocked === "blocked" && g2.mocked === "MOCKED" && g2.heldFulfill === "HELD" &&
    typeof g2.respBody === "string" && g2.respBody.includes("apihit") &&
    g2.frameText === "childOk" && g2.frameField === "framedSrc" &&
    g2.dark === true && g2.tz === "Asia/Seoul" && g2.offline === false && g2.dlFile === "report.txt",
    `held=${g2.heldFulfill}, frameText=${g2.frameText}, dark=${g2.dark}, tz=${g2.tz}, dlFile=${g2.dlFile}`);

  // 프로세스 OS x 브라우저 컨트롤: 실 src routeBrowserWorker + installBrowserWorker로 Pyodide 워커가
  // 자기 인터프리터(독립 GIL)로 run_sync + 라우터를 거쳐 자기 세션을 몬다(SSOT 회귀).
  try {
    const pyw = await new Promise((resolve, reject) => {
      const w = new Worker(new URL("./pyWorker.js", import.meta.url), { type: "module" });
      routeBrowserWorker(w);
      w.addEventListener("message", (ev) => {
        if (ev.data && ev.data.type === "done") { w.terminate(); resolve(ev.data.result); }
        else if (ev.data && ev.data.type === "error") { w.terminate(); reject(new Error(ev.data.error)); }
      });
      w.onerror = (ev) => { w.terminate(); reject(new Error(ev.message || "pyWorker error")); };
      w.postMessage({ type: "run", indexURL: chrome.runtime.getURL("/"), target, label: "srcWorker" });
    });
    add("실 src 파이썬 워커 병렬(routeBrowserWorker + installBrowserWorker)",
      pyw.readback === "srcWorker" && pyw.title === "pyprocCdpTarget", `readback=${pyw.readback}, title=${pyw.title}`);
  } catch (e) {
    add("실 src 파이썬 워커 병렬(routeBrowserWorker + installBrowserWorker)", false, String(e));
  }

  const ok = checks.every((c) => c.pass);
  chrome.runtime.sendMessage({ type: "gateResult", ok, checks });
}

run().catch((e) => chrome.runtime.sendMessage({ type: "gateResult", ok: false, fatal: String(e), checks }));
