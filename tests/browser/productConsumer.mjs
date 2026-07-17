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
        "pyproc/assets": "/node_modules/pyproc/src/runtime/assets.js"
      }
    }
  </script>
</head>
<body>
  <pre id="out">running</pre>
  <script type="module">
    import { runImmortalProductGate } from "/immortalProductGate.js";
    import {
      boot,
      bootSession,
      PyProc,
      JobControl,
      MachineContainer,
      VirtualOrigin,
      DeviceFs,
      verifyPyProcAssetIntegrity,
      registerPyProcServiceWorker,
      openMachine,
      createMachineKeyPair,
      exportMachinePublicKey,
      fingerprintMachinePublicKey,
      MachineJournal,
      MachineJail
    } from "pyproc";
    import { getPyProcAssetManifest } from "pyproc/assets";

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

      let denied = false;
      const badAssetIntegrity = {
        ...assetIntegrity,
        files: assetIntegrity.files.map((f) => f.path === "src/processOs/worker.js" ? { ...f, integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } : f),
      };
      try { await new PyProc({ indexURL: INDEX, assetIntegrity: badAssetIntegrity }).boot(1, false); }
      catch (e) { denied = String(e).includes("assetIntegrity"); }
      check("bad installed worker SRI denied before spawn", denied);

      const immortal = await runImmortalProductGate({ indexURL: INDEX });
      for (const result of immortal.checks) check(result.name, result.pass, result.info);
      Object.assign(timings, immortal.timings);

      let t = performance.now();
      const rt = await boot({ indexURL: INDEX, assetIntegrity });
      timings.bootMs = Math.round(performance.now() - t);
      check("Runtime boots from installed package", rt.run("sum(range(20))") === 190, timings.bootMs + "ms");

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
      const deviceOk = rt.run([
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
        deviceFs instanceof DeviceFs &&
        deviceInstall.installed.includes("/dev/productState") &&
        deviceInstall.installed.includes("/proc/meminfo") &&
        deviceOk === true &&
        productDeviceWrites.join("") === "write-from-python",
        deviceInstall.installed.join(","));

      rt.run([
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
      origin = new VirtualOrigin(asgi).bind();
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

      const jail = new MachineJail({ net: false, clipboard: false, home: true, workers: false });
      const jailPolicy = jail.install(rt);
      let blockedNet = false;
      try { rt.run("import pyprocJail\\npyprocJail.net('https://example.com')"); }
      catch (e) { blockedNet = String(e).includes("PermissionError") || String(e).includes("jail"); }
      const homeAllowed = rt.run("import pyprocJail\\npyprocJail.home()") === true;
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
      const os = new PyProc({ indexURL: INDEX, assetIntegrity });
      const workerBoot = await os.boot(1, false);
      const mapped = await os.map("def _fn(x):\\n    return x * x", [6, 7, 8]);
      await os.terminate();
      timings.processMs = Math.round(performance.now() - t);
      check("PyProc worker runs from installed package", JSON.stringify(mapped) === JSON.stringify([36, 49, 64]), workerBoot.avgBootMs + "ms");

      t = performance.now();
      jobs = new JobControl({ indexURL: INDEX, workers: 2, assetIntegrity });
      const jobBoot = await jobs.boot();
      timings.jobBootMs = Math.round(performance.now() - t);
      await jobs.push("productBase = 41");
      const interactiveValue = await jobs.push("productBase + 1");
      t = performance.now();
      const backgroundJob = await jobs.push("productBase * 2 &");
      timings.jobPromptReturnMs = Math.round(performance.now() - t);
      const foregroundResult = await jobs.fg(backgroundJob.job);
      const loopJob = await jobs.push("while True:\\n    pass &");
      await new Promise((resolve) => setTimeout(resolve, 300));
      t = performance.now();
      const killAccepted = jobs.kill(loopJob.job);
      const killedResult = await jobs.fg(loopJob.job);
      timings.jobKillMs = Math.round(performance.now() - t);
      const killedState = jobs.jobs().find((j) => j.jobId === loopJob.job)?.state;
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

      t = performance.now();
      containers = new MachineContainer(rt, { indexURL: INDEX, assetIntegrity });
      const childMachine = await containers.spawn({ setup: "containerValue = 41" });
      timings.containerSpawnMs = Math.round(performance.now() - t);
      const containerValue = await childMachine.run("containerValue + 1");
      const containerHeapLen = await childMachine.heapLen();
      const containerKilled = childMachine.kill();
      const killedRejects = await childMachine.run("1").then(() => false, () => true);
      check("MachineContainer runs installed product child machine",
        containers instanceof MachineContainer &&
        childMachine.cid &&
        childMachine.bootMs > 0 &&
        containerValue === 42 &&
        containerHeapLen > 0 &&
        containerKilled === true &&
        killedRejects === true,
        "spawn=" + timings.containerSpawnMs + "ms, boot=" + childMachine.bootMs + "ms");
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
      const machine = await bootSession({ indexURL: INDEX });
      timings.machineBootMs = Math.round(performance.now() - t);

      machine.rt.run("productJournalValue = 41\\nproductJournalNote = 'installed-journal'");
      t = performance.now();
      const journal = machine.rt.enableJournal({ dir: journalDir, reactive: machine.reactive, idleMs: 100000 });
      const journalCommit = await journal.commit();
      timings.journalCommitMs = Math.round(performance.now() - t);
      t = performance.now();
      const recoveredMachine = await bootSession({ indexURL: INDEX });
      const recoveredJournal = recoveredMachine.rt.enableJournal({ dir: journalDir, reactive: recoveredMachine.reactive });
      const journalRecover = await recoveredJournal.recover();
      timings.journalRecoverMs = Math.round(performance.now() - t);
      check("MachineJournal recovers installed product state after crash boundary",
        journal instanceof MachineJournal &&
        recoveredJournal instanceof MachineJournal &&
        journalCommit &&
        journalCommit.pages > 0 &&
        journalCommit.wrote > 0 &&
        journalRecover &&
        journalRecover.pages > 0 &&
        recoveredMachine.rt.run("productJournalValue") === 41 &&
        recoveredMachine.rt.run("productJournalNote") === "installed-journal",
        "commit=" + timings.journalCommitMs + "ms, recover=" + timings.journalRecoverMs + "ms");

      const home = await machine.rt.mountHome(homeDir);
      machine.rt.fs.mkdirTree("/home/web/product");
      machine.rt.fs.writeFile("/home/web/resume.py", resumeSrc);
      machine.rt.fs.writeFile("/home/web/product/state.txt", "product-state=41");
      machine.rt.run("resumeValue = 41\\nresumeNote = 'browser-os-product'");
      const freshResume = machine.rt.enableInit({ bootPath: "/nope", cronPath: "/nope" }).resume("product.fresh");
      await home.sync();
      check("installed product resume.py prepares machine resources",
        freshResume.resume === true &&
        machine.rt.run("resumeReasonSeen") === "product.fresh" &&
        machine.rt.run("resumeCount") === 1,
        timings.machineBootMs + "ms");

      t = performance.now();
      const keyPair = await createMachineKeyPair();
      const trustedPublicKey = await exportMachinePublicKey(keyPair);
      const fpFromPair = await fingerprintMachinePublicKey(keyPair);
      const fpFromJwk = await fingerprintMachinePublicKey(trustedPublicKey);
      timings.machineTrustMs = Math.round(performance.now() - t);
      check("installed product trust fingerprint is stable",
        fpFromPair === fpFromJwk && /^sha256:[0-9a-f]{64}$/.test(fpFromPair),
        fpFromPair.slice(0, 23));

      t = performance.now();
      const imageBlob = await machine.exportImage({ includeHome: true, signingKey: keyPair });
      timings.machineExportMs = Math.round(performance.now() - t);
      timings.machineMB = +(imageBlob.size / 1048576).toFixed(1);
      check("installed product exports signed .pymachine with home",
        imageBlob.size > 0 && imageBlob.type === "application/x-pymachine",
        timings.machineMB + "MB, " + timings.machineExportMs + "ms");

      let untrustedDenied = false;
      try { await openMachine(imageBlob, { requireSignature: true }); }
      catch (e) { untrustedDenied = String(e).includes("signature") || String(e).includes("공개키"); }
      check("installed product refuses untrusted .pymachine", untrustedDenied);

      const wrongKeyPair = await createMachineKeyPair();
      const wrongPublicKey = await exportMachinePublicKey(wrongKeyPair);
      let wrongKeyDenied = false;
      try { await openMachine(imageBlob, { trustedPublicKeys: [wrongPublicKey], requireSignature: true }); }
      catch (e) { wrongKeyDenied = String(e).includes("signature") || String(e).includes("공개키"); }
      check("installed product refuses wrong signer key", wrongKeyDenied);

      t = performance.now();
      const openedMachine = await openMachine(imageBlob, { trustedPublicKeys: [trustedPublicKey], requireSignature: true });
      timings.machineOpenMs = Math.round(performance.now() - t);
      const openedResume = openedMachine.rt.enableInit({ bootPath: "/nope", cronPath: "/nope" }).resume("product.openMachine");
      const openedRows = openedMachine.rt.run("resumeConn.execute('select count(*) from event').fetchone()[0]");
      timings.machineResumeRows = openedRows;
      check("installed product opens trusted .pymachine and resumes resources",
        openedResume.resume === true &&
        openedMachine.rt.fs.readFile("/home/web/product/state.txt", { encoding: "utf8" }) === "product-state=41" &&
        openedMachine.rt.run("resumeReasonSeen") === "product.openMachine" &&
        openedMachine.rt.run("resumeValue") === 41 &&
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
