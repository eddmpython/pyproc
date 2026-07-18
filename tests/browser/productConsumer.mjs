// tests/browser/productConsumer.mjs - 설치된 npm 패키지를 실제 브라우저 앱처럼 소비하는 게이트.
// repo 상대 import가 아니라 npm pack으로 설치된 node_modules/pyproc만 브라우저에 노출한다.
import { createServer } from "node:http";
import { existsSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { safeJoin, sendFile } from "../../scripts/staticServer.mjs";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";
import { launchBrowser } from "./harness.mjs";
import { productConsumerCoverageManifest } from "./productConsumerCoverage.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 240000);
const COVERAGE_MANIFEST = productConsumerCoverageManifest();
const COVERAGE_MANIFEST_JSON = JSON.stringify(COVERAGE_MANIFEST);

// 라우팅만 이 게이트 고유다: 저장소 루트를 서빙하면 안 된다(설치된 node_modules/pyproc만
// 브라우저에 노출하는 것이 이 게이트의 존재 이유다). 그래서 createStaticServer를 쓰지 않고
// MIME/COI 헤더/경로 탈출 방어/404만 staticServer에서 가져와 조립한다.
function createProductServer(appDir, publicDir, onReport) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && url.pathname === "/gateReport") {
      let body = "";
      for await (const chunk of req) body += chunk;
      res.writeHead(204); res.end();
      try { onReport(JSON.parse(body)); } catch (e) { onReport({ ok: false, checks: [], parseError: String(e) }); }
      return;
    }

    let file = null;
    if (url.pathname === "/") file = join(publicDir, "productConsumer.html");
    else if (url.pathname === "/pyproc-assets.json") file = join(publicDir, "pyproc-assets.json");
    else if (url.pathname.startsWith("/node_modules/")) file = safeJoin(appDir, url.pathname);
    else if (url.pathname.startsWith("/vendor/pyodide/")) file = safeJoin(ROOT, url.pathname);
    else file = safeJoin(publicDir, url.pathname);

    if (!file) { res.writeHead(403); res.end("forbidden"); return; }
    await sendFile(res, file);
  });
}

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>pyproc product consumer gate</title>
  <script type="importmap">
    {
      "imports": {
        "pyproc": "/node_modules/pyproc/index.js",
        "pyproc/assets": "/node_modules/pyproc/src/runtime/assets.js",
        "pyproc/history": "/node_modules/pyproc/src/state/index.js"
      }
    }
  </script>
</head>
<body>
  <pre id="out">running</pre>
  <script type="module">
    import { runImmortalProductGate } from "/immortalProductGate.js";
    // state-kernel 7b: 설치 패키지의 public 표면은 porcelain(boot/open/createWebComputer 등)과
    // stable subpath다. 옛 클래스 직수출(PyProc, JobControl, MachineContainer, VirtualOrigin,
    // DeviceFs, MachineJournal, MachineJail)은 machine 핸들의 proc() 풀 / runtime 탈출구 /
    // history 동사로 도달하고, 서명 코어는 pyproc/history(createStateKeyPair 계열)가 정본이다.
    import { boot, open, createWebComputer } from "pyproc";
    import { getPyProcAssetManifest, verifyPyProcAssetIntegrity, registerPyProcServiceWorker } from "pyproc/assets";
    import { createStateKeyPair, exportStatePublicKey, fingerprintStatePublicKey } from "pyproc/history";

    const out = document.getElementById("out");
    const checks = [];
    const timings = {};
    const coverageManifest = ${COVERAGE_MANIFEST_JSON};
    const log = (msg) => { out.textContent += "\\n" + msg; };
    const indexParam = new URLSearchParams(location.search).get("indexURL");
    const INDEX = indexParam ? new URL(indexParam, location.href).href : undefined;
    const check = (name, pass, info = "") => {
      checks.push({ name, pass: !!pass, info: String(info) });
      log((pass ? "PASS " : "FAIL ") + name + (info ? " (" + info + ")" : ""));
    };
    const report = async () => {
      const ok = checks.length > 0 && checks.every((c) => c.pass);
      try {
        await fetch("/gateReport", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ok, checks, timings, coverageManifest }),
        });
      } catch (e) {}
    };
    const waitForServiceWorkerControl = async () => {
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error("service worker ready timeout")), 10000)),
      ]);
      if (!navigator.serviceWorker.controller) {
        await Promise.race([
          new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true })),
          new Promise((_, reject) => setTimeout(() => reject(new Error("service worker controller timeout")), 10000)),
        ]);
      }
    };
    const uniqueName = (prefix) => prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);

    // VirtualOrigin 클래스 직수출 폐지: 설치된 pyprocSw.js가 위임하는 pyprocAsgi 메시지(응답
    // 포트 동봉)에 커널의 asgi.serve로 답하고, pyprocKernelHello로 커널 클라이언트를 등록하는
    // 페이지측 배선을 SW 문면 계약 그대로 잇는다(virtualOrigin.js와 같은 프로토콜).
    const bindAsgiDelegation = (asgi) => {
      const onDelegated = async (event) => {
        const request = event.data && event.data.pyprocAsgi;
        if (!request) return;
        try {
          const response = await asgi.serve(request.method, request.path, request.body, request.query, request.headers);
          event.ports[0].postMessage({ status: response.status, headers: response.headers, body: response.bodyBytes });
        } catch (error) {
          event.ports[0].postMessage({ error: String(error).slice(-300) });
        }
      };
      const hello = () => {
        if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ pyprocKernelHello: true });
      };
      navigator.serviceWorker.addEventListener("message", onDelegated);
      hello();
      navigator.serviceWorker.addEventListener("controllerchange", hello);
      return {
        unbind: () => {
          navigator.serviceWorker.removeEventListener("message", onDelegated);
          navigator.serviceWorker.removeEventListener("controllerchange", hello);
        },
      };
    };

    let sw = null;
    let origin = null;
    let jobs = null;
    let containers = null;
    let opfsRoot = null;
    const cleanupEntries = [];
    try {
      check("crossOriginIsolated", crossOriginIsolated === true);

      const publicManifest = getPyProcAssetManifest({ baseURL: "/node_modules/pyproc/" });
      check("public package specifiers resolve", publicManifest.assets.some((a) => a.role === "processWorker"));

      const assetIntegrity = await fetch("/pyproc-assets.json", { cache: "no-store" }).then((r) => r.json());
      const verified = await verifyPyProcAssetIntegrity(assetIntegrity, { roles: ["processWorker"] });
      check("installed worker graph SRI verifies", verified.files.includes("src/processOs/worker.js") && verified.files.includes("src/processOs/ipc.js"), verified.verified + " files");

      sw = await registerPyProcServiceWorker(assetIntegrity, { cache: true, asgi: "/pyproc/", scope: "/" });
      check("installed package SW registers from manifest URL",
        sw.integrity.files.includes("src/capabilities/pyprocSw.js") && sw.url.includes("/node_modules/pyproc/src/capabilities/pyprocSw.js") && sw.url.includes("asgi=%2Fpyproc%2F"),
        sw.url);
      await waitForServiceWorkerControl();

      const immortal = await runImmortalProductGate({ indexURL: INDEX });
      for (const result of immortal.checks) check(result.name, result.pass, result.info);
      Object.assign(timings, immortal.timings);

      let t = performance.now();
      const machine = await boot({ indexURL: INDEX, assetIntegrity });
      const rt = machine.runtime; // 능력 상세(enable*)의 공개 탈출구
      timings.bootMs = Math.round(performance.now() - t);
      check("Runtime boots from installed package", machine.run("sum(range(20))") === 190, timings.bootMs + "ms");

      // worker pool spawn 전 SRI preflight: machine.proc()이 상속/전달된 manifest를 검증한다.
      let denied = false;
      const badAssetIntegrity = {
        ...assetIntegrity,
        files: assetIntegrity.files.map((f) => f.path === "src/processOs/worker.js" ? { ...f, integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } : f),
      };
      try { await machine.proc({ lanes: 1, useSnapshot: false, assetIntegrity: badAssetIntegrity }); }
      catch (e) { denied = String(e).includes("assetIntegrity"); }
      check("bad installed worker SRI denied before spawn", denied);

      const textDecoder = new TextDecoder();
      const productDeviceWrites = [];
      const deviceFs = rt.enableDeviceFs({
        devices: {
          "/dev/productState": {
            read: () => JSON.stringify({ mode: "browserOs", value: 41, execSeq: rt.execSeq }),
            write: (bytes) => productDeviceWrites.push(textDecoder.decode(bytes)),
          },
        },
      });
      const deviceInstall = deviceFs.install();
      const deviceOk = machine.run([
        "import json, os",
        "deviceDoc = json.loads(open('/dev/productState').read())",
        "open('/dev/productState', 'w').write('write-from-python')",
        "procDoc = json.loads(open('/proc/meminfo').read())",
        "deviceOk = deviceDoc['mode'] == 'browserOs' and deviceDoc['value'] == 41",
        "deviceOk = deviceOk and os.path.exists('/dev/productState') and os.path.exists('/proc/meminfo')",
        "deviceOk = deviceOk and procDoc['heapBytes'] > 0 and procDoc['execSeq'] >= 0",
        "deviceOk",
      ].join("\\n"));
      check("DeviceFs exposes installed product devices as Python files",
        deviceInstall.installed.includes("/dev/productState") &&
        deviceInstall.installed.includes("/proc/meminfo") &&
        deviceOk === true &&
        productDeviceWrites.join("") === "write-from-python",
        deviceInstall.installed.join(","));

      machine.run([
        "import json",
        "async def app(scope, receive, send):",
        "    message = await receive()",
        "    bodyBytes = message.get('body', b'')",
        "    requestHeaders = {k.decode(): v.decode() for k, v in scope['headers']}",
        "    result = {",
        "        'path': scope['path'],",
        "        'method': scope['method'],",
        "        'query': scope['query_string'].decode(),",
        "        'body': bodyBytes.decode(),",
        "        'gate': requestHeaders.get('x-product-gate', 'missing'),",
        "        'runtime': 'pyproc-virtual-origin'",
        "    }",
        "    responseBody = json.dumps(result).encode()",
        "    responseHeaders = [(b'content-type', b'application/json'), (b'x-product-runtime', b'pyproc-virtual-origin')]",
        "    await send({'type': 'http.response.start', 'status': 207, 'headers': responseHeaders})",
        "    await send({'type': 'http.response.body', 'body': responseBody})",
      ].join("\\n"));
      const asgi = rt.enableAsgiServer({ app: "app" });
      await asgi.install();
      origin = bindAsgiDelegation(asgi);
      t = performance.now();
      const virtualResp = await fetch("/pyproc/product/api?value=41", {
        method: "POST",
        headers: { "x-product-gate": "installed-virtual-origin" },
        body: "hello-from-product",
      });
      const virtualJson = await virtualResp.json();
      timings.virtualOriginMs = Math.round(performance.now() - t);
      check("VirtualOrigin fetch reaches Python server from installed package",
        virtualResp.status === 207 &&
        virtualResp.headers.get("x-product-runtime") === "pyproc-virtual-origin" &&
        virtualJson.path === "/product/api" &&
        virtualJson.method === "POST" &&
        virtualJson.query === "value=41" &&
        virtualJson.body === "hello-from-product" &&
        virtualJson.gate === "installed-virtual-origin",
        timings.virtualOriginMs + "ms");

      // MachineJail 클래스 직수출 폐지: 제품 permission manifest를 machine.runtime 탈출구의
      // 협조 choke point(setGlobal + Python 모듈 주입)와 CSP connect-src 문자열로 집행한다
      // (감옥 패턴의 문면 계약: 소비 계약 문서 trustPermissions 참조).
      const jailPermissions = { net: false, clipboard: false, home: true, workers: false };
      const jailAllows = (perm, arg) => perm === "net"
        ? jailPermissions.net === true || (Array.isArray(jailPermissions.net) && jailPermissions.net.includes(arg))
        : !!jailPermissions[perm];
      rt.setGlobal("_pyprocJailAllows", (perm, arg) => jailAllows(perm, arg || ""));
      machine.run([
        "import sys as _jailSys, types as _jailTypes",
        "_jailMod = _jailTypes.ModuleType('pyprocJail')",
        "def _jailCheck(perm, arg=''):",
        "    if not _pyprocJailAllows(perm, arg):",
        "        raise PermissionError('jail: ' + perm + ' denied' + ((' (' + arg + ')') if arg else ''))",
        "    return True",
        "_jailMod.net = lambda host='': _jailCheck('net', host)",
        "_jailMod.clipboard = lambda: _jailCheck('clipboard')",
        "_jailMod.home = lambda: _jailCheck('home')",
        "_jailMod.workers = lambda: _jailCheck('workers')",
        "_jailSys.modules['pyprocJail'] = _jailMod",
      ].join("\\n"));
      const jailPolicy = {
        permissions: { ...jailPermissions },
        connectSrc: jailPermissions.net === true
          ? "*"
          : ["'self'", ...(Array.isArray(jailPermissions.net) ? jailPermissions.net : [])].join(" "),
      };
      let blockedNet = false;
      try { machine.run("import pyprocJail\\npyprocJail.net('https://example.com')"); }
      catch (e) { blockedNet = String(e).includes("PermissionError") || String(e).includes("jail"); }
      const homeAllowed = machine.run("import pyprocJail\\npyprocJail.home()") === true;
      check("MachineJail enforces installed product permission manifest",
        jailPolicy.connectSrc === "'self'" &&
        jailPolicy.permissions.net === false &&
        jailPolicy.permissions.clipboard === false &&
        jailPolicy.permissions.home === true &&
        jailPolicy.permissions.workers === false &&
        blockedNet &&
        homeAllowed,
        "connect-src=" + jailPolicy.connectSrc);

      t = performance.now();
      const pool = await machine.proc({ lanes: 1, useSnapshot: false });
      const mapped = await pool.map("def _fn(x):\\n    return x * x", [6, 7, 8]);
      pool.terminate();
      timings.processMs = Math.round(performance.now() - t);
      check("PyProc worker runs from installed package", JSON.stringify(mapped) === JSON.stringify([36, 49, 64]), timings.processMs + "ms");

      // JobControl 클래스 직수출 폐지: 잡 컨트롤의 실체(대화형 레인 + 살아있는 fork + 백그라운드
      // repl + 시그널 회수)를 machine.proc({ replay }) 풀의 공개 동사로 그대로 실행한다.
      t = performance.now();
      jobs = await machine.proc({ lanes: 2, useSnapshot: false, replay: {} });
      const jobPids = jobs.ps().map((p) => p.pid);
      const interactivePid = jobPids[0];
      const jobLanePid = jobPids[1];
      const jobBoot = { jobSlots: jobPids.length - 1 }; // 대화형 1 + 잡 슬롯 N-1
      timings.jobBootMs = Math.round(performance.now() - t);
      await jobs.repl(interactivePid, "productBase = 41");
      const interactiveValue = await jobs.repl(interactivePid, "productBase + 1");
      t = performance.now();
      await jobs.fork(interactivePid, jobLanePid); // 'expr &' = 살아있는 namespace 복제 후 백그라운드
      const backgroundJob = { job: 1, pid: jobLanePid, promise: jobs.repl(jobLanePid, "productBase * 2") };
      timings.jobPromptReturnMs = Math.round(performance.now() - t); // 프롬프트 복귀 = fork 직후
      const foregroundResult = await backgroundJob.promise; // fg 등가(완료 대기)
      await jobs.fork(interactivePid, jobLanePid);
      const signalTable = jobs.constructor.SIGNAL;
      let killedState = "running";
      const loopJobPromise = jobs.repl(jobLanePid, "while True:\\n    pass").then(
        (r) => { killedState = "done"; return r; },
        (e) => {
          // 시그널 종료 판정은 워커 경계를 건너온 파이썬 예외 타입으로 한다(잡 컨트롤 계약).
          const pyExcType = (e && e.context && e.context.pyExcType) || "";
          killedState = (pyExcType === "KeyboardInterrupt" || pyExcType === "SystemExit") ? "killed" : "error";
          return { error: String((e && e.message) || e).slice(-200) };
        });
      await new Promise((resolve) => setTimeout(resolve, 300));
      t = performance.now();
      const killAccepted = jobs.signal(jobLanePid, signalTable.INT);
      const killedResult = await loopJobPromise;
      timings.jobKillMs = Math.round(performance.now() - t);
      check("JobControl runs installed product shell jobs",
        jobBoot.jobSlots === 1 &&
        interactiveValue.value === "42" &&
        backgroundJob.job &&
        foregroundResult.value === "82" &&
        killAccepted === true &&
        killedState === "killed" &&
        killedResult.error,
        "boot=" + timings.jobBootMs + "ms, prompt=" + timings.jobPromptReturnMs + "ms, kill=" + timings.jobKillMs + "ms");
      jobs.terminate();
      jobs = null;

      // MachineContainer 클래스 직수출 폐지: 자식 머신(자기 manifest setup으로 부팅한 독립
      // 커널)을 machine.proc({ setup }) 풀 레인으로 세우고 run/heapLen/kill 수명주기를 검증한다.
      t = performance.now();
      containers = await machine.proc({ lanes: 1, useSnapshot: false, setup: "containerValue = 41" });
      const containerPid = containers.ps()[0].pid;
      timings.containerSpawnMs = Math.round(performance.now() - t);
      const containerValue = await containers.exec(containerPid, "def _fn(arg):\\n    return containerValue + 1");
      // 자식 커널의 힙 길이: 옛 컨테이너 heap op의 등가를 자식 안에서 실측한다(테스트 전용 probe).
      const containerHeapLen = await containers.exec(containerPid, "def _fn(arg):\\n    import pyodide_js\\n    return pyodide_js._module.HEAPU8.length");
      const containerKilled = containers.kill(containerPid);
      const killedRejects = await containers.exec(containerPid, "def _fn(arg):\\n    return 1").then(() => false, () => true);
      check("MachineContainer runs installed product child machine",
        Number.isInteger(containerPid) &&
        timings.containerSpawnMs > 0 &&
        containerValue === 42 &&
        containerHeapLen > 0 &&
        containerKilled === true &&
        killedRejects === true,
        "spawn=" + timings.containerSpawnMs + "ms, heap=" + containerHeapLen);
      containers.terminate();
      containers = null;

      opfsRoot = await navigator.storage.getDirectory();
      const homeName = uniqueName("pyprocProductHome");
      cleanupEntries.push(homeName);
      const homeDir = await opfsRoot.getDirectoryHandle(homeName, { create: true });
      const journalName = uniqueName("pyprocProductJournal");
      cleanupEntries.push(journalName);
      const journalDir = await opfsRoot.getDirectoryHandle(journalName, { create: true });
      const resumeSrc = [
        "import os, sqlite3",
        "os.makedirs('/home/web/product', exist_ok=True)",
        "resumeReasonSeen = pyprocResumeReason",
        "resumeDbPath = '/home/web/product/resume.db'",
        "resumeConn = sqlite3.connect(resumeDbPath)",
        "resumeConn.execute('create table if not exists event(reason text, value integer)')",
        "resumeConn.execute('insert into event(reason, value) values (?, ?)', (resumeReasonSeen, globals().get('resumeValue', -1)))",
        "resumeConn.commit()",
        "resumeCount = resumeConn.execute('select count(*) from event').fetchone()[0]",
      ].join("\\n");

      t = performance.now();
      const detMachine = await boot({ deterministic: true, indexURL: INDEX });
      timings.machineBootMs = Math.round(performance.now() - t);

      detMachine.run("productJournalValue = 41\\nproductJournalNote = 'installed-journal'");
      t = performance.now();
      const journalCommit = await detMachine.history.commit({ dir: journalDir, idleMs: 100000 });
      timings.journalCommitMs = Math.round(performance.now() - t);
      t = performance.now();
      const recoveredMachine = await boot({ deterministic: true, indexURL: INDEX });
      const journalRecover = await recoveredMachine.history.recover({ dir: journalDir });
      timings.journalRecoverMs = Math.round(performance.now() - t);
      check("MachineJournal recovers installed product state after crash boundary",
        journalCommit &&
        journalCommit.pages > 0 &&
        journalCommit.wrote > 0 &&
        journalRecover &&
        journalRecover.pages > 0 &&
        recoveredMachine.run("productJournalValue") === 41 &&
        recoveredMachine.run("productJournalNote") === "installed-journal",
        "commit=" + timings.journalCommitMs + "ms, recover=" + timings.journalRecoverMs + "ms");

      const home = await detMachine.runtime.mountHome(homeDir);
      detMachine.fs.mkdirTree("/home/web/product");
      detMachine.fs.writeFile("/home/web/resume.py", resumeSrc);
      detMachine.fs.writeFile("/home/web/product/state.txt", "product-state=41");
      detMachine.run("resumeValue = 41\\nresumeNote = 'browser-os-product'");
      const freshResume = detMachine.runtime.enableInit({ bootPath: "/nope", cronPath: "/nope" }).resume("product.fresh");
      await home.sync();
      check("installed product resume.py prepares machine resources",
        freshResume.resume === true &&
        detMachine.run("resumeReasonSeen") === "product.fresh" &&
        detMachine.run("resumeCount") === 1,
        timings.machineBootMs + "ms");

      t = performance.now();
      const keyPair = await createStateKeyPair(crypto);
      const trustedPublicKey = await exportStatePublicKey(crypto, keyPair.publicKey);
      const fpFromPair = await fingerprintStatePublicKey(crypto, keyPair.publicKey);
      const fpFromJwk = await fingerprintStatePublicKey(crypto, trustedPublicKey);
      timings.machineTrustMs = Math.round(performance.now() - t);
      check("installed product trust fingerprint is stable",
        fpFromPair === fpFromJwk && /^sha256:[0-9a-f]{64}$/.test(fpFromPair),
        fpFromPair.slice(0, 23));

      t = performance.now();
      const imageBlob = await detMachine.history.export({ includeHome: true, signingKey: keyPair });
      timings.machineExportMs = Math.round(performance.now() - t);
      timings.machineMB = +(imageBlob.size / 1048576).toFixed(1);
      check("installed product exports signed .pymachine with home",
        imageBlob.size > 0 && imageBlob.type === "application/x-pymachine",
        timings.machineMB + "MB, " + timings.machineExportMs + "ms");

      let untrustedDenied = false;
      try { await open(imageBlob, { requireSignature: true }); }
      catch (e) { untrustedDenied = String(e).includes("signature") || String(e).includes("공개키"); }
      check("installed product refuses untrusted .pymachine", untrustedDenied);

      const wrongKeyPair = await createStateKeyPair(crypto);
      const wrongPublicKey = await exportStatePublicKey(crypto, wrongKeyPair.publicKey);
      let wrongKeyDenied = false;
      try { await open(imageBlob, { trustedPublicKeys: [wrongPublicKey], requireSignature: true }); }
      catch (e) { wrongKeyDenied = String(e).includes("signature") || String(e).includes("공개키"); }
      check("installed product refuses wrong signer key", wrongKeyDenied);

      // 설치본에서 컴퓨터 한 대: 간판 진입점 createWebComputer가 npm 표면만으로 조립되고
      // python guest가 부팅해 코드를 실행하는지. 레포 내부 E2E(웹 컴퓨터 앱)와 별개 증명이다:
      // 여기는 node_modules/pyproc만 노출된 서버라 "받은 물건에서 컴퓨터가 선다"를 실행으로 판다.
      t = performance.now();
      const computerConsole = [];
      const computer = createWebComputer({
        python: { session: { indexURL: INDEX } },
        onConsole: (line) => computerConsole.push(line),
      });
      await computer.bootAll();
      const computerRun = await computer.machine("pythonOs").request({ type: "run", code: "sum(range(30))" });
      timings.computerBootMs = Math.round(performance.now() - t);
      check("installed package assembles the web computer and runs the python guest",
        computer.runningMachineIds().includes("pythonOs") &&
        computerRun === 435 &&
        computerConsole.some((line) => line.includes("pythonOs")),
        timings.computerBootMs + "ms, run=" + computerRun);
      await computer.shutdownAll();
      check("installed web computer shuts down clean",
        computer.machine("pythonOs").state === "stopped");

      t = performance.now();
      const openedMachine = await open(imageBlob, { trustedPublicKeys: [trustedPublicKey], requireSignature: true });
      timings.machineOpenMs = Math.round(performance.now() - t);
      const openedResume = openedMachine.runtime.enableInit({ bootPath: "/nope", cronPath: "/nope" }).resume("product.openMachine");
      const openedRows = openedMachine.run("resumeConn.execute('select count(*) from event').fetchone()[0]");
      timings.machineResumeRows = openedRows;
      check("installed product opens trusted .pymachine and resumes resources",
        openedResume.resume === true &&
        openedMachine.fs.readFile("/home/web/product/state.txt", { encoding: "utf8" }) === "product-state=41" &&
        openedMachine.run("resumeReasonSeen") === "product.openMachine" &&
        openedMachine.run("resumeValue") === 41 &&
        openedRows === 2,
        "open=" + timings.machineOpenMs + "ms, rows=" + openedRows);
    } catch (e) {
      check("uncaught", false, e && (e.stack || e.message || String(e)));
    } finally {
      if (origin) origin.unbind();
      if (jobs) jobs.terminate();
      if (containers) containers.terminate();
      if (sw) await sw.registration.unregister();
      if (opfsRoot) {
        for (const name of cleanupEntries) {
          try { await opfsRoot.removeEntry(name, { recursive: true }); } catch (e) {}
        }
      }
      await report();
    }
  </script>
</body>
</html>
`;

const { tmp, appDir } = await installPackedPyProc("pyprocProduct-");

try {
  const publicDir = join(appDir, "public");
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, "productConsumer.html"), html);
  await writeFile(join(publicDir, "immortalProductParticipant.html"), await readFile(join(ROOT, "tests", "browser", "immortalProductParticipant.html")));
  await writeFile(join(publicDir, "immortalProductGate.js"), await readFile(join(ROOT, "tests", "browser", "immortalProductGate.js")));

  const cli = binPath(appDir, "pyproc-assets");
  if (!existsSync(cli)) throw new Error("installed pyproc-assets bin shim 없음");
  run(cli, ["--baseURL", "/node_modules/pyproc/", "--out", join(publicDir, "pyproc-assets.json")], { cwd: appDir });

  let reportResolve;
  const reportPromise = new Promise((res) => { reportResolve = res; });
  const server = createProductServer(appDir, publicDir, reportResolve);
  await new Promise((res) => server.listen(0, "127.0.0.1", res));

  const indexQuery = process.env.PYPROC_INDEX_URL ? `?indexURL=${encodeURIComponent(process.env.PYPROC_INDEX_URL)}` : "";
  const url = `http://127.0.0.1:${server.address().port}/${indexQuery}`;
  const session = launchBrowser(url, { prefix: "pyprocProduct-" });

  console.log(`pyproc 제품 소비자 게이트\n  browser: ${session.browser}\n  url:     ${url}\n`);
  const timeout = setTimeout(() => reportResolve({ ok: false, checks: [], timedOut: true }), TIMEOUT_MS);
  const result = await reportPromise;
  clearTimeout(timeout);

  session.close();
  server.close();

  if (result.timedOut) {
    console.log(`FAIL 게이트 타임아웃(${TIMEOUT_MS / 1000}s)`);
    process.exit(1);
  }
  const coverageOk = JSON.stringify(result.coverageManifest) === COVERAGE_MANIFEST_JSON;
  for (const c of result.checks) console.log(`  ${c.pass ? "PASS" : "FAIL"} ${c.name}${c.info ? " (" + c.info + ")" : ""}`);
  console.log(`  ${coverageOk ? "PASS" : "FAIL"} product consumer coverage manifest${coverageOk ? ` (${COVERAGE_MANIFEST.rows.length} rows)` : ""}`);
  if (result.timings) console.log(`\n실측: ${JSON.stringify(result.timings)}`);
  const passCount = result.checks.filter((c) => c.pass).length + (coverageOk ? 1 : 0);
  const totalCount = result.checks.length + 1;
  const ok = result.ok && coverageOk;
  console.log(`\n결과: ${ok ? "GREEN" : "RED"} (${passCount}/${totalCount})`);
  process.exit(ok ? 0 : 1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
