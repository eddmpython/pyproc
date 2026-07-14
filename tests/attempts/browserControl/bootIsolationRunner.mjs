// bootIsolationRunner.mjs - browserControl 게이트 1+2 러너. Node 전용, 의존성 0.
// 확장 로딩은 CDP 경로 단일 확정(사전 게이트 0): --load-extension은 Chrome 137+에서 죽었고
// Extensions.loadUnpacked + --enable-unsafe-extension-debugging만 산다. 이 러너가 그 경로다.
// 흐름: temp에 [확장 소스 + vendor 코어] 조립 -> 브라우저 실행 -> loadUnpacked -> 서비스워커에
// 백채널 포트 주입(Runtime.evaluate) -> offscreen이 부팅/격리 검사 결과를 /gateReport로 릴레이.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findBrowser } from "../../browser/harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const VENDOR = join(ROOT, "vendor", "pyodide");
const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 180000);

// 번들할 엔진 코어 최소 세트(MV3 원격 코드 금지 = 확장에 물리 번들). loadPyodide가 실제로 타는 자산.
const CORE = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json", "package.json"];

// temp에 [확장 소스 + vendor 코어 + config.js(백채널 포트)] 조립. config는 조립 시점 주입이라
// 확장 소스에 커밋되지 않는다(러너가 항상 생성). 이래서 CDP evaluate 주입이 불필요해진다.
function assembleExtension(backPort) {
  if (!existsSync(join(VENDOR, "pyodide-lock.json"))) {
    console.error(`vendor 엔진 없음: ${VENDOR}\n먼저 준비: npm run fetch:engine`);
    process.exit(2);
  }
  const dir = mkdtempSync(join(tmpdir(), "browserControlExt-"));
  cpSync(join(HERE, "extension"), dir, { recursive: true }); // 확장 소스(manifest/sw/offscreen/worker)
  for (const f of CORE) {
    const src = join(VENDOR, f);
    if (!existsSync(src)) { console.error(`코어 자산 없음: ${src}`); process.exit(2); }
    cpSync(src, join(dir, f));
  }
  writeFileSync(join(dir, "config.js"), `export const BACKCHANNEL_PORT = ${backPort};\n`);
  return dir;
}

// --- 최소 CDP 클라이언트(browser ws). 의존성 0.
function cdpClient(ws) {
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { send };
}

// 게이트13: 확장 서비스워커를 강제종료한다(SW target을 닫는다). offscreen의 sendMessage가 다시 깨운다.
let cdpSend = null, loadedExtId = null;
async function killServiceWorker() {
  if (!cdpSend || !loadedExtId) return;
  await cdpSend("Target.setDiscoverTargets", { discover: true });
  const { result } = await cdpSend("Target.getTargets", {});
  const sw = result?.targetInfos?.find((t) => t.type === "service_worker" && t.url.includes(loadedExtId));
  if (sw) await cdpSend("Target.closeTarget", { targetId: sw.targetId });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const killTree = (p) => { if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }); else p.kill("SIGKILL"); };

async function main() {
  // 백채널 서버: offscreen 결과를 서비스워커가 fetch로 릴레이한다. 포트를 먼저 확보해 조립에 굽는다.
  let reportResolve;
  const reportPromise = new Promise((res) => { reportResolve = res; });
  // 게이트11 non-COI 셸: 별도 백채널(셸 http 탭이 직접 fetch. 확장 아니라 chrome.runtime 없음).
  let shellResolve;
  const shellPromise = new Promise((res) => { shellResolve = res; });
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url.startsWith("/gateReport")) {
      let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
        res.writeHead(204); res.end();
        try { reportResolve(JSON.parse(body)); } catch (e) { reportResolve({ ok: false, checks: [], parseError: String(e) }); }
      });
      return;
    }
    // 게이트 3 타깃 페이지: 파이썬이 chrome.debugger로 여기 navigate 후 title/marker/eval을 회수한다.
    // 게이트 5/6용 버튼 + 입력칸: 신뢰 입력(isTrusted)과 실제 조작(값 변경)을 관측한다.
    if (req.url.startsWith("/cdpTarget")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><head><title>pyprocCdpTarget</title></head><body>"
        + "<div id=\"marker\">cdpMarkerOk</div>"
        + "<button id=\"btn\" style=\"position:absolute;top:20px;left:20px;width:140px;height:44px\">click</button>"
        + "<input id=\"field\" value=\"\">"
        + "<script>window.clickReport={clicked:false};"
        + "document.getElementById('btn').addEventListener('click',function(e){window.clickReport={clicked:true,trusted:e.isTrusted};});"
        + "setTimeout(function(){var d=document.createElement('div');d.id='delayed';d.textContent='appeared';document.body.appendChild(d);},700);"
        + "</script></body></html>");
      return;
    }
    // 게이트 4 iframe 역전 타깃: X-Frame-Options: DENY로 프레이밍을 거부한다(강방어 사이트 재현).
    // declarativeNetRequest가 이 헤더를 벗기면 iframe에 담기고, 내부 스크립트가 부모에 로드를 알린다.
    if (req.url.startsWith("/framedTarget")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY" });
      res.end("<!doctype html><title>framed</title><script>parent.postMessage('framedLoaded','*')</script>OK");
      return;
    }
    // 게이트 8: frame-busting 사이트 재현. top!==self면 상위를 이탈시키려 한다. sandbox(allow-top-navigation
    // 없음)로 담으면 그 이탈이 막히고 셸이 유지되는가. 로드되면 내부가 부모에 알린다.
    if (req.url.startsWith("/bustTarget")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>bust</title><script>"
        + "try { if (top !== self) { top.location.href = 'about:blank'; } } catch (e) {}"
        + "parent.postMessage('bustLoaded','*');"
        + "</script>OK");
      return;
    }
    // 게이트 11 non-COI 셸(고정 화면): 확장이 여는 http 탭(localhost, COEP 없음 = non-COI)에서 cross-origin
    // iframe이 credentialless 없이 로드 + 쿠키 실림 + sandbox frame-busting. localhost/127.0.0.1 = cross-site 쌍.
    if (req.url.startsWith("/cookieSet")) { // 127.0.0.1에서 방문해 프레임 origin에 쿠키를 심는다
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": ["noneSess=abc; SameSite=None; Secure; Path=/", "laxSess=def; SameSite=Lax; Path=/"] });
      res.end("cookieSet");
      return;
    }
    if (req.url.startsWith("/framedCookieTarget")) { // 프레이밍 거부 + frame-busting 시도 + 요청 Cookie 반영
      const cookie = req.headers.cookie || "";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY" });
      res.end(`<!doctype html><title>framedCookie</title><script>try{if(top!==self){top.location.href='about:blank'}}catch(e){}parent.postMessage({framed:true,cookie:${JSON.stringify(cookie)}},"*")</script>OK`);
      return;
    }
    if (req.url.startsWith("/shellHost")) { // non-COI 셸(COEP 헤더 없음). credentialless 없이 cross-site iframe을 담는다
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><title>shell</title><body><script>
const frame=document.createElement("iframe");
frame.setAttribute("sandbox","allow-scripts allow-same-origin");
frame.src="http://127.0.0.1:${backPort}/framedCookieTarget";
let done=false;
const finish=(d)=>{if(done)return;done=true;fetch("http://localhost:${backPort}/shellReport",{method:"POST",body:JSON.stringify(d)});};
window.addEventListener("message",(ev)=>{if(ev.data&&ev.data.framed)finish({loaded:true,cookie:ev.data.cookie,shellPath:location.pathname});});
setTimeout(()=>finish({loaded:false}),9000);
document.body.appendChild(frame);
</script></body>`);
      return;
    }
    if (req.method === "POST" && req.url.startsWith("/shellReport")) {
      let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => { res.writeHead(204, { "Access-Control-Allow-Origin": "*" }); res.end(); try { shellResolve(JSON.parse(body)); } catch (e) { shellResolve({ loaded: false, parseError: String(e) }); } });
      return;
    }
    // 게이트13: offscreen이 세션을 연 뒤 이걸 호출하면 확장 SW를 강제종료한다(재attach 복구 검증).
    if (req.url.startsWith("/killSW")) {
      // offscreen은 COEP require-corp라 cross-origin 응답에 CORP가 필요하다(안 그러면 fetch 차단).
      const h = { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" };
      killServiceWorker().then(() => { res.writeHead(204, h); res.end(); }).catch(() => { res.writeHead(500, h); res.end(); });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const backPort = server.address().port;
  const extDir = assembleExtension(backPort);

  const browser = findBrowser();
  const profile = mkdtempSync(join(tmpdir(), "browserControlProf-"));
  const proc = spawn(browser, [
    "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--enable-unsafe-extension-debugging",
    "about:blank",
  ], { stdio: "ignore" });

  console.log(`browserControl 게이트 1+2\n  browser: ${browser}\n  ext:     ${extDir}\n  backchannel: 127.0.0.1:${backPort}\n`);

  const cleanup = () => {
    killTree(proc); server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    try { rmSync(extDir, { recursive: true, force: true }); } catch (e) {}
  };

  try {
    // browser ws 확보(DevToolsActivePort 파일 폴링).
    let wsUrl = null;
    for (let i = 0; i < 60 && !wsUrl; i++) {
      await wait(250);
      const portFile = join(profile, "DevToolsActivePort");
      if (!existsSync(portFile)) continue;
      const [p] = readFileSync(portFile, "utf8").split("\n");
      try { wsUrl = (await (await fetch(`http://127.0.0.1:${p.trim()}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {}
    }
    if (!wsUrl) throw new Error("browser ws를 얻지 못함(DevToolsActivePort 폴링 실패)");

    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error("browser ws 연결 실패")); });
    const { send } = cdpClient(ws);
    cdpSend = send;

    // 확장 로드. 백채널 포트는 config.js로 이미 구워져 있으므로 SW attach/주입이 불필요하다:
    // 확장이 설치 이벤트로 깨어나 offscreen을 만들고 결과를 백채널로 릴레이한다.
    const loaded = await send("Extensions.loadUnpacked", { path: extDir });
    const extId = loaded.result?.id;
    if (!extId) throw new Error(`loadUnpacked 실패: ${JSON.stringify(loaded)}`);
    loadedExtId = extId;
    // ws는 유지한다(게이트13 SW 강제종료에 CDP 필요). webdriver 전역 오염은 게이트11/12/13 결과와 무관(측정은 관측).
    console.log(`  확장 로드됨: ${extId} -> offscreen 부팅 대기\n`);

    const timeout = setTimeout(() => reportResolve({ ok: false, checks: [], timedOut: true }), TIMEOUT_MS);
    const result = await reportPromise;
    clearTimeout(timeout);

    if (result.timedOut) { console.log(`FAIL 타임아웃(${TIMEOUT_MS / 1000}s)`); cleanup(); process.exit(1); }
    if (result.fatal) console.log(`  FATAL: ${result.fatal}`);
    // 게이트11 non-COI 셸 결과(별도 백채널, SW가 offscreen과 병렬로 셸 탭을 연다).
    const shellResult = await Promise.race([shellPromise, new Promise((r) => setTimeout(() => r({ loaded: false, timedOut: true }), 30000))]);
    const shellCookie = shellResult.cookie || "";
    const shellChecks = [
      { name: "게이트11: non-COI 셸에서 credentialless-free cross-origin iframe 로드(XFO 제거)", pass: shellResult.loaded === true, info: `loaded=${shellResult.loaded}` },
      { name: "게이트11: 쿠키 실림(SameSite None cross-site) + Lax 차단", pass: shellCookie.includes("noneSess") && !shellCookie.includes("laxSess"), info: `cookie=[${shellCookie}]` },
      { name: "게이트11: sandbox frame-busting 무력화(셸 유지)", pass: shellResult.shellPath === "/shellHost", info: `shellPath=${shellResult.shellPath}` },
    ];
    const allChecks = [...(result.checks || []), ...(result.swChecks || []), ...shellChecks];
    for (const c of allChecks) console.log(`  ${c.pass ? "PASS" : "FAIL"} ${c.name}${c.info ? " (" + c.info + ")" : ""}`);
    if (result.timings) console.log(`\n실측: ${JSON.stringify(result.timings)}`);
    const green = allChecks.length > 0 && allChecks.every((c) => c.pass) && !result.fatal;
    console.log(`\n결과: ${green ? "GREEN" : "RED"} (${allChecks.filter((c) => c.pass).length}/${allChecks.length})`);
    cleanup();
    process.exit(green ? 0 : 1);
  } catch (e) {
    console.error(`RED: ${String(e)}`);
    cleanup();
    process.exit(1);
  }
}

main();
