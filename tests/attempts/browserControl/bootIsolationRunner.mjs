// bootIsolationRunner.mjs - browserControl 게이트 1+2 러너. Node 전용, 의존성 0.
// 확장 로딩은 CDP 경로 단일 확정(사전 게이트 0): --load-extension은 Chrome 137+에서 죽었고
// Extensions.loadUnpacked + --enable-unsafe-extension-debugging만 산다. 이 러너가 그 경로다.
// 흐름: temp에 [확장 소스 + vendor 코어] 조립 -> 브라우저 실행 -> loadUnpacked -> 서비스워커에
// 백채널 포트 주입(Runtime.evaluate) -> offscreen이 부팅/격리 검사 결과를 /gateReport로 릴레이.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
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

function assembleExtension() {
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
  return dir;
}

// --- 최소 CDP 클라이언트(browser ws + flatten 세션). 의존성 0.
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const killTree = (p) => { if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }); else p.kill("SIGKILL"); };

async function main() {
  const extDir = assembleExtension();

  // 백채널 서버: offscreen 결과를 서비스워커가 fetch로 릴레이한다.
  let reportResolve;
  const reportPromise = new Promise((res) => { reportResolve = res; });
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url.startsWith("/gateReport")) {
      let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
        res.writeHead(204); res.end();
        try { reportResolve(JSON.parse(body)); } catch (e) { reportResolve({ ok: false, checks: [], parseError: String(e) }); }
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const backPort = server.address().port;

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

    // 확장 로드.
    const loaded = await send("Extensions.loadUnpacked", { path: extDir });
    const extId = loaded.result?.id;
    if (!extId) throw new Error(`loadUnpacked 실패: ${JSON.stringify(loaded)}`);
    console.log(`  확장 로드됨: ${extId}`);

    // 서비스워커 타깃 발견 -> attach -> 백채널 포트 주입(storage.session).
    await send("Target.setDiscoverTargets", { discover: true });
    let swSession = null;
    for (let i = 0; i < 40 && !swSession; i++) {
      const { result } = await send("Target.getTargets", {});
      const sw = result?.targetInfos?.find((t) => t.type === "service_worker" && t.url.includes(extId));
      if (sw) {
        const a = await send("Target.attachToTarget", { targetId: sw.targetId, flatten: true });
        swSession = a.result?.sessionId || a.sessionId;
      } else { await wait(250); }
    }
    if (!swSession) throw new Error("서비스워커 타깃을 찾지 못함(SW가 안 깨어남)");
    console.log(`  서비스워커 attach: ${swSession}`);

    const diag = await send("Runtime.evaluate", {
      expression: `JSON.stringify({ chrome: typeof chrome, keys: (typeof chrome==='object'&&chrome?Object.keys(chrome):[]).slice(0,60), storage: typeof (chrome&&chrome.storage), dbg: typeof (chrome&&chrome.debugger), ctx: typeof self })`,
      returnByValue: true,
    }, swSession);
    console.log(`  [진단] SW 컨텍스트: ${diag.result?.result?.value || JSON.stringify(diag.result?.exceptionDetails)}`);

    const inj = await send("Runtime.evaluate", {
      expression: `chrome.storage.session.set({ backchannelPort: ${backPort} })`,
      awaitPromise: true,
    }, swSession);
    if (inj.result?.exceptionDetails) throw new Error(`포트 주입 실패: ${JSON.stringify(inj.result.exceptionDetails)}`);
    console.log(`  백채널 포트 주입 완료 -> offscreen 부팅 대기\n`);

    const timeout = setTimeout(() => reportResolve({ ok: false, checks: [], timedOut: true }), TIMEOUT_MS);
    const result = await reportPromise;
    clearTimeout(timeout);

    if (result.timedOut) { console.log(`FAIL 타임아웃(${TIMEOUT_MS / 1000}s)`); cleanup(); process.exit(1); }
    if (result.fatal) console.log(`  FATAL: ${result.fatal}`);
    const allChecks = [...(result.checks || []), ...(result.swChecks || [])];
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
