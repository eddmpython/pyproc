// offscreen.js - 픽스처 런타임 셸. 실 src의 boot() + Runtime.enableBrowserControl()을 쓴다(SSOT 검증).
// 코어 boot()가 offscreen에서 실 src 경로로 부팅되는지 + 승격된 pyprocBrowser 표면이 실동하는지 게이트한다.
import { boot } from "./src/runtime/runtime.js";

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

  const ok = checks.every((c) => c.pass);
  chrome.runtime.sendMessage({ type: "gateResult", ok, checks });
}

run().catch((e) => chrome.runtime.sendMessage({ type: "gateResult", ok: false, fatal: String(e), checks }));
