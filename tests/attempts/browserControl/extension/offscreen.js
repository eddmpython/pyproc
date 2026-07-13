// offscreen.js - Pyodide 런타임 호스트(게이트 1+2 실측).
// 확장 문서에서: (1) crossOriginIsolated 여부, (2) SAB 생성, (3) module Worker 스폰 + SAB Atomics 왕복,
// (4) 번들 Pyodide 부팅(indexURL = 확장 루트) + runPython. 결과를 SW로 보내 러너로 릴레이한다.
const backchannelPort = new URL(location.href).searchParams.get("port");
const checks = [];
const add = (name, pass, info) => checks.push({ name, pass: !!pass, info: info || "" });

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
      py.globals.set("cdpNavigateEval", async (url, expr) => chrome.runtime.sendMessage({ type: "cdp", url, expr }));
      const targetUrl = `http://127.0.0.1:${backchannelPort}/cdpTarget`;
      const t1 = performance.now();
      const arr = (await py.runPythonAsync(`
target = "${targetUrl}"
titleResult = await cdpNavigateEval(target, "document.title")
markerResult = await cdpNavigateEval(target, "document.getElementById('marker').textContent")
computeResult = await cdpNavigateEval(target, "6 * 7")
[titleResult.ok, titleResult.value, markerResult.value, computeResult.ok, computeResult.value]
`)).toJs();
      timings.cdpMs = Math.round(performance.now() - t1);
      const [navOk, title, marker, evalOk, compute] = arr;
      add("게이트3: 파이썬 -> chrome.debugger Page.navigate + Runtime.evaluate",
        navOk === true && title === "pyprocCdpTarget" && marker === "cdpMarkerOk" && evalOk === true && compute === 42,
        `title=${title}, marker=${marker}, compute=${compute}, cdpMs=${timings.cdpMs}`);
    } catch (e) {
      add("게이트3: 파이썬 -> chrome.debugger Page.navigate + Runtime.evaluate", false, String(e));
    }
  } catch (e) {
    add("Pyodide 부팅 + runPython(1+1)==2", false, String(e));
  }

  const ok = checks.every((c) => c.pass);
  chrome.runtime.sendMessage({ type: "gateResult", backchannelPort, ok, checks, timings });
}

run().catch((e) => {
  chrome.runtime.sendMessage({ type: "gateResult", backchannelPort, ok: false, fatal: String(e), checks });
});
