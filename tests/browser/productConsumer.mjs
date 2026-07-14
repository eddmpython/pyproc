// tests/browser/productConsumer.mjs - 설치된 npm 패키지를 실제 브라우저 앱처럼 소비하는 게이트.
// repo 상대 import가 아니라 npm pack으로 설치된 node_modules/pyproc만 브라우저에 노출한다.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, rmSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import { binPath, installPackedPyProc, ROOT, run } from "../packageHarness.mjs";
import { findBrowser, headlessArgs } from "./harness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 240000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".data": "application/octet-stream",
  ".whl": "application/octet-stream",
};

function safeJoin(root, urlPath) {
  const rootNorm = normalize(root);
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
  const file = normalize(join(rootNorm, rel));
  if (file !== rootNorm && !file.startsWith(rootNorm + sep)) return null;
  return file;
}

async function sendFile(res, file) {
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Service-Worker-Allowed": "/",
    });
    res.end(body);
  } catch (e) {
    res.writeHead(e.code === "ENOENT" ? 404 : 500);
    res.end(e.code === "ENOENT" ? `not found: ${file}` : `error: ${e.code}`);
  }
}

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
    import { boot, PyProc, verifyPyProcAssetIntegrity, registerPyProcServiceWorker } from "pyproc";
    import { getPyProcAssetManifest } from "pyproc/assets";

    const out = document.getElementById("out");
    const checks = [];
    const timings = {};
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
          body: JSON.stringify({ ok, checks, timings }),
        });
      } catch (e) {}
    };

    try {
      check("crossOriginIsolated", crossOriginIsolated === true);

      const publicManifest = getPyProcAssetManifest({ baseURL: "/node_modules/pyproc/" });
      check("public package specifiers resolve", publicManifest.assets.some((a) => a.role === "processWorker"));

      const assetIntegrity = await fetch("/pyproc-assets.json", { cache: "no-store" }).then((r) => r.json());
      const verified = await verifyPyProcAssetIntegrity(assetIntegrity, { roles: ["processWorker"] });
      check("installed worker graph SRI verifies", verified.files.includes("src/processOs/worker.js") && verified.files.includes("src/processOs/ipc.js"), verified.verified + " files");

      const sw = await registerPyProcServiceWorker(assetIntegrity, { cache: true, scope: "/" });
      check("installed package SW registers from manifest URL",
        sw.integrity.files.includes("src/capabilities/pyprocSw.js") && sw.url.includes("/node_modules/pyproc/src/capabilities/pyprocSw.js"),
        sw.url);
      await sw.registration.unregister();

      let denied = false;
      const badAssetIntegrity = {
        ...assetIntegrity,
        files: assetIntegrity.files.map((f) => f.path === "src/processOs/worker.js" ? { ...f, integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } : f),
      };
      try { await new PyProc({ indexURL: INDEX, assetIntegrity: badAssetIntegrity }).boot(1, false); }
      catch (e) { denied = String(e).includes("assetIntegrity"); }
      check("bad installed worker SRI denied before spawn", denied);

      let t = performance.now();
      const rt = await boot({ indexURL: INDEX, assetIntegrity });
      timings.bootMs = Math.round(performance.now() - t);
      check("Runtime boots from installed package", rt.run("sum(range(20))") === 190, timings.bootMs + "ms");

      t = performance.now();
      const os = new PyProc({ indexURL: INDEX, assetIntegrity });
      const workerBoot = await os.boot(1, false);
      const mapped = await os.map("def _fn(x):\\n    return x * x", [6, 7, 8]);
      await os.terminate();
      timings.processMs = Math.round(performance.now() - t);
      check("PyProc worker runs from installed package", JSON.stringify(mapped) === JSON.stringify([36, 49, 64]), workerBoot.avgBootMs + "ms");
    } catch (e) {
      check("uncaught", false, e && (e.stack || e.message || String(e)));
    } finally {
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

  const cli = binPath(appDir, "pyproc-assets");
  if (!existsSync(cli)) throw new Error("installed pyproc-assets bin shim 없음");
  run(cli, ["--baseURL", "/node_modules/pyproc/", "--out", join(publicDir, "pyproc-assets.json")], { cwd: appDir });

  let reportResolve;
  const reportPromise = new Promise((res) => { reportResolve = res; });
  const server = createProductServer(appDir, publicDir, reportResolve);
  await new Promise((res) => server.listen(0, "127.0.0.1", res));

  const indexQuery = process.env.PYPROC_INDEX_URL ? `?indexURL=${encodeURIComponent(process.env.PYPROC_INDEX_URL)}` : "";
  const url = `http://127.0.0.1:${server.address().port}/${indexQuery}`;
  const browser = findBrowser();
  const profile = join(tmpdir(), `pyprocProductProfile-${process.pid}`);
  const proc = spawn(browser, [...headlessArgs(profile), url], { stdio: "ignore" });

  console.log(`pyproc 제품 소비자 게이트\n  browser: ${browser}\n  url:     ${url}\n`);
  const timeout = setTimeout(() => reportResolve({ ok: false, checks: [], timedOut: true }), TIMEOUT_MS);
  const result = await reportPromise;
  clearTimeout(timeout);

  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  else proc.kill("SIGKILL");
  server.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}

  if (result.timedOut) {
    console.log(`FAIL 게이트 타임아웃(${TIMEOUT_MS / 1000}s)`);
    process.exit(1);
  }
  for (const c of result.checks) console.log(`  ${c.pass ? "PASS" : "FAIL"} ${c.name}${c.info ? " (" + c.info + ")" : ""}`);
  if (result.timings) console.log(`\n실측: ${JSON.stringify(result.timings)}`);
  console.log(`\n결과: ${result.ok ? "GREEN" : "RED"} (${result.checks.filter((c) => c.pass).length}/${result.checks.length})`);
  process.exit(result.ok ? 0 : 1);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
