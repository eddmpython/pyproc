// offscreen.js - Pyodide 런타임 호스트(게이트 1+2 실측).
// 확장 문서에서: (1) crossOriginIsolated 여부, (2) SAB 생성, (3) module Worker 스폰 + SAB Atomics 왕복,
// (4) 번들 Pyodide 부팅(indexURL = 확장 루트) + runPython. 결과를 SW로 보내 러너로 릴레이한다.
const backchannelPort = new URL(location.href).searchParams.get("port");
const checks = [];
const add = (name, pass, info) => checks.push({ name, pass: !!pass, info: info || "" });

// iframe 역전 실측 헬퍼: 주어진 URL을 offscreen(chrome-extension:// origin)의 iframe에 담고,
// 내부 페이지가 postMessage로 로드를 알리면 true. 타임아웃(차단)이면 false. cross-origin이라
// contentDocument 직접 접근 대신 postMessage로 로드 성공을 관측한다.
function tryFrame(url, timeoutMs) {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    // offscreen은 crossOriginIsolated(COEP require-corp)라 cross-origin iframe이 COEP로 막힌다.
    // credentialless(쿠키 격리 조건)로 그 벽을 넘는다. X-Frame-Options 제거와 별개의 축.
    iframe.credentialless = true;
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
  } catch (e) {
    add("게이트4: iframe 역전(X-Frame-Options 제거로 cross-origin 사이트를 셸의 창에)", false, String(e));
  }

  const ok = checks.every((c) => c.pass);
  chrome.runtime.sendMessage({ type: "gateResult", backchannelPort, ok, checks, timings });
}

run().catch((e) => {
  chrome.runtime.sendMessage({ type: "gateResult", backchannelPort, ok: false, fatal: String(e), checks });
});
