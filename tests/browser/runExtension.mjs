// runExtension.mjs - browserControl 능력의 실 src 런타임 게이트. Node 전용, 의존성 0.
// tests/browser/run.mjs는 --disable-extensions라 확장을 못 띄운다(정반대 프로파일). 이 러너는 확장 경로다:
// temp에 [픽스처 셸 + 실 src 트리(구조 보존 vendoring) + vendor 엔진 코어 + config] 조립 -> CDP loadUnpacked ->
// 픽스처 offscreen이 boot()+enableBrowserControl()으로 실 src를 돌려 결과를 백채널로 보고한다.
// 픽스처가 사본이 아니라 실 src를 import하므로 승격 코드의 회귀를 잡는다(SSOT). vendor는 npm run fetch:engine.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findBrowser } from "./harness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const VENDOR = join(ROOT, "vendor", "pyodide");
const FIXTURE = join(HERE, "extensionFixture");
const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 180000);

// boot()가 채택하는 엔진 코어(MV3 원격 코드 금지 = 확장에 물리 번들).
const CORE = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json", "package.json"];

function assembleExtension(backPort) {
  if (!existsSync(join(VENDOR, "pyodide-lock.json"))) {
    console.error(`vendor 엔진 없음: ${VENDOR}\n먼저 준비: npm run fetch:engine`);
    process.exit(2);
  }
  const dir = mkdtempSync(join(tmpdir(), "browserControlFixture-"));
  cpSync(FIXTURE, dir, { recursive: true });            // 픽스처 셸(manifest/SW/offscreen)
  cpSync(join(ROOT, "src"), join(dir, "src"), { recursive: true }); // 실 src 트리(구조 보존 = 상대 import 성립)
  for (const f of CORE) cpSync(join(VENDOR, f), join(dir, f));      // vendor 엔진 코어(확장 루트 = indexURL)
  writeFileSync(join(dir, "config.js"), `export const BACKCHANNEL_PORT = ${backPort};\n`);
  return dir;
}

function cdpClient(ws) {
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  return { send: (method, params = {}) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); }) };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const killTree = (p) => { if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }); else p.kill("SIGKILL"); };

async function main() {
  let reportResolve;
  const reportPromise = new Promise((res) => { reportResolve = res; });
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url.startsWith("/gateReport")) {
      let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => { res.writeHead(204); res.end(); try { reportResolve(JSON.parse(body)); } catch (e) { reportResolve({ ok: false, checks: [], parseError: String(e) }); } });
      return;
    }
    // 조작 타깃 페이지: 픽스처 offscreen이 실 src pyprocBrowser로 확장 표면(추출/폼/포인터/에뮬/쿠키)을 왕복한다.
    if (req.url.startsWith("/cdpTarget")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><title>pyprocCdpTarget</title></head><body>
<div id="marker">cdpMarkerOk</div>
<input id="field" value="">
<select id="sel"><option value="one">1</option><option value="two">2</option></select>
<ul><li class="item">a</li><li class="item">b</li><li class="item">c</li></ul>
<div id="dbl" style="position:absolute;top:80px;left:220px;width:160px;height:40px">dbl</div>
<form id="form" style="position:absolute;top:160px;left:220px"><input id="formField" value=""></form>
<button id="dialogBtn" style="position:absolute;top:220px;left:220px;width:160px;height:40px">dialog</button>
<iframe id="fr" src="/frameChild" style="position:absolute;top:280px;left:220px;width:300px;height:100px"></iframe>
<script>
window.clickReport={clicked:false};
window.dialogResult=null;
document.getElementById('dbl').addEventListener('dblclick',function(e){window.dblReport={trusted:e.isTrusted};});
document.getElementById('form').addEventListener('submit',function(e){e.preventDefault();window.submitReport=true;});
document.getElementById('dialogBtn').addEventListener('click',function(){window.dialogResult=window.confirm('proceed?');});
setTimeout(function(){window.__ready=true;},400);
</script></body></html>`);
      return;
    }
    if (req.url.startsWith("/frameChild")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><title>child</title></head><body><div id="cmarker">childOk</div><input id="cfield" value=""></body></html>`);
      return;
    }
    if (req.url.startsWith("/echoHeaders")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><title>echo</title></head><body><pre id="h">${JSON.stringify(req.headers)}</pre></body></html>`);
      return;
    }
    if (req.url.startsWith("/jsonApi")) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ msg: "apihit" }));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const backPort = server.address().port;
  const extDir = assembleExtension(backPort);

  const browser = findBrowser();
  const profile = mkdtempSync(join(tmpdir(), "browserControlFixtureProf-"));
  const proc = spawn(browser, [
    "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--enable-unsafe-extension-debugging",
    "about:blank",
  ], { stdio: "ignore" });

  console.log(`browserControl 실 src 런타임 게이트\n  browser: ${browser}\n  ext:     ${extDir}\n  backchannel: 127.0.0.1:${backPort}\n`);

  const cleanup = () => { killTree(proc); server.close(); try { rmSync(profile, { recursive: true, force: true }); } catch (e) {} try { rmSync(extDir, { recursive: true, force: true }); } catch (e) {} };

  try {
    let wsUrl = null;
    for (let i = 0; i < 60 && !wsUrl; i++) {
      await wait(250);
      const portFile = join(profile, "DevToolsActivePort");
      if (!existsSync(portFile)) continue;
      const [p] = readFileSync(portFile, "utf8").split("\n");
      try { wsUrl = (await (await fetch(`http://127.0.0.1:${p.trim()}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {}
    }
    if (!wsUrl) throw new Error("browser ws를 얻지 못함");

    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error("browser ws 연결 실패")); });
    const { send } = cdpClient(ws);
    const loaded = await send("Extensions.loadUnpacked", { path: extDir });
    const extId = loaded.result?.id;
    if (!extId) throw new Error(`loadUnpacked 실패: ${JSON.stringify(loaded)}`);
    ws.close();
    console.log(`  확장 로드됨: ${extId} -> offscreen 부팅 대기\n`);

    const timeout = setTimeout(() => reportResolve({ ok: false, checks: [], timedOut: true }), TIMEOUT_MS);
    const result = await reportPromise;
    clearTimeout(timeout);

    if (result.timedOut) { console.log(`FAIL 타임아웃(${TIMEOUT_MS / 1000}s)`); cleanup(); process.exit(1); }
    if (result.fatal) console.log(`  FATAL: ${result.fatal}`);
    for (const c of result.checks || []) console.log(`  ${c.pass ? "PASS" : "FAIL"} ${c.name}${c.info ? " (" + c.info + ")" : ""}`);
    const green = (result.checks || []).length > 0 && (result.checks || []).every((c) => c.pass) && !result.fatal;
    console.log(`\n결과: ${green ? "GREEN" : "RED"} (${(result.checks || []).filter((c) => c.pass).length}/${(result.checks || []).length})`);
    cleanup();
    process.exit(green ? 0 : 1);
  } catch (e) {
    console.error(`RED: ${String(e)}`);
    cleanup();
    process.exit(1);
  }
}

main();
