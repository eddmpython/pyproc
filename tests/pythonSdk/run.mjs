// run.mjs - Python wheel/sdist clean install and packed npm product integration gate.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installPackedPyProc, ROOT, run } from "../packageHarness.mjs";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 300000);
const PYTHON = process.env.PYPROC_PYTHON || "python";
const HERE = fileURLToPath(new URL(".", import.meta.url));

function venvPython(directory) {
  return process.platform === "win32" ? join(directory, "Scripts", "python.exe") : join(directory, "bin", "python");
}

function runAsync(command, args, { cwd, timeoutMs = TIMEOUT_MS, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = (stdout + String(chunk)).slice(-16000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-16000); });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out\n${stderr}`));
    }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} failed with ${code}\n${stdout}\n${stderr}`));
    });
  });
}

const frameBridge = await readFile(join(ROOT, "scripts", "automationSpace", "frameSpaceTarget.js"));
const targetServer = createServer((req, res) => {
  if (req.url === "/frameSpaceTarget.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
    res.end(frameBridge);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><body><h1>python-sdk-ready</h1>
    ${req.url?.startsWith("/frame") ? '<script src="/frameSpaceTarget.js"></script>' : ""}</body></html>`);
});
await new Promise((resolve) => targetServer.listen(0, "127.0.0.1", resolve));
const targetOrigin = `http://127.0.0.1:${targetServer.address().port}`;

let passed = 0;
let failed = 0;
const check = (name, pass, info = "") => {
  if (pass) { passed += 1; console.log(`  PASS ${name}${info ? ` (${info})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${info ? ` (${info})` : ""}`); }
};

const installed = await installPackedPyProc("pyprocPythonSdk-");
const distDir = join(installed.tmp, "pythonDist");
const wheelVenv = join(installed.tmp, "wheelVenv");
const sourceVenv = join(installed.tmp, "sourceVenv");
const configPath = join(installed.appDir, "pyproc-python.json");
const frameConfigPath = join(installed.appDir, "pyproc-python-frame.json");
await mkdir(distDir, { recursive: true });
const browser = process.env.PYPROC_BROWSER || undefined;
await writeFile(configPath, JSON.stringify({
  schemaVersion: 1,
  engine: { root: join(ROOT, "vendor", "pyodide") },
  timeoutMs: TIMEOUT_MS,
  browser: {
    enabled: true,
    ...(browser ? { executable: browser } : {}),
    allowedOrigins: [targetOrigin],
    maxRisk: "externalEffect",
    actions: ["snapshot", "screenshot"],
    methods: [],
    externalEffects: "acknowledged",
    purpose: "Python SDK product gate",
    artifacts: { maxArtifactBytes: 8 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024,
      maxArtifacts: 8, inlineMaxBytes: 4 * 1024 * 1024, ttlMs: 120000 },
  },
}, null, 2));
await writeFile(frameConfigPath, JSON.stringify({
  schemaVersion: 1,
  engine: { root: join(ROOT, "vendor", "pyodide") },
  timeoutMs: TIMEOUT_MS,
  browser: {
    enabled: true,
    provider: "frame",
    ...(browser ? { executable: browser } : {}),
    allowedOrigins: [targetOrigin],
    maxRisk: "externalEffect",
    actions: ["snapshot", "screenshot"],
    methods: [],
    externalEffects: "acknowledged",
    purpose: "Python SDK FrameSpace product gate",
    artifacts: { maxArtifactBytes: 8 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024,
      maxArtifacts: 8, inlineMaxBytes: 4 * 1024 * 1024, ttlMs: 120000 },
  },
}, null, 2));

console.log("pyproc Python SDK product gate");
try {
  run(PYTHON, ["-m", "build", join(ROOT, "pythonSdk"), "--outdir", distDir], { cwd: ROOT });
  const distributions = await readdir(distDir);
  const wheel = distributions.find((file) => file.endsWith(".whl"));
  const source = distributions.find((file) => file.endsWith(".tar.gz"));
  check("wheel과 source distribution을 격리 backend로 빌드",
    !!wheel && !!source && distributions.length === 2, distributions.join(","));

  run(PYTHON, ["-m", "venv", wheelVenv], { cwd: installed.tmp });
  run(PYTHON, ["-m", "venv", sourceVenv], { cwd: installed.tmp });
  const wheelPython = venvPython(wheelVenv);
  const sourcePython = venvPython(sourceVenv);
  if (!existsSync(wheelPython) || !existsSync(sourcePython)) throw new Error("clean virtual environment Python is missing");
  run(wheelPython, ["-m", "pip", "install", "--disable-pip-version-check", "--no-deps", join(distDir, wheel)],
    { cwd: installed.tmp });
  run(sourcePython, ["-m", "pip", "install", "--disable-pip-version-check", "--no-deps", join(distDir, source)],
    { cwd: installed.tmp });
  const wheelMetadata = run(wheelPython, ["-m", "pip", "show", "pyproc-control"], { cwd: installed.tmp }).stdout;
  const sourceMetadata = run(sourcePython, ["-m", "pip", "show", "pyproc-control"], { cwd: installed.tmp }).stdout;
  check("서로 다른 clean venv에 wheel과 source distribution 설치",
    wheelMetadata.includes("Version: 0.0.15") && sourceMetadata.includes("Version: 0.0.15"));

  const protocol = run(sourcePython, [join(HERE, "protocolContract.py")], { cwd: installed.appDir });
  check("source 설치본 Python codec 음성 fixture", protocol.stdout.includes("11 fixtures"));

  const productPath = join(installed.appDir, "node_modules", ".bin");
  const journey = await runAsync(wheelPython, [join(HERE, "productJourney.py"), configPath,
    `${targetOrigin}/product`], { cwd: installed.appDir,
    env: { ...process.env, PATH: `${productPath}${delimiter}${process.env.PATH || ""}` } });
  const report = JSON.parse(journey.stdout.trim().split(/\r?\n/).at(-1));
  check("wheel 설치본이 Python, checkpoint, cancel, permission, screenshot 여정을 완주",
    report.ok === true && report.operations === 14 && report.checkpoint > 0
      && report.attachmentBytes > 0 && report.cancelOutcome === "outcomeUnknown",
  `${report.attachmentBytes} bytes`);
  const frameJourney = await runAsync(wheelPython, [join(HERE, "frameJourney.py"), frameConfigPath,
    `${targetOrigin}/frame`], { cwd: installed.appDir,
    env: { ...process.env, PATH: `${productPath}${delimiter}${process.env.PATH || ""}` } });
  const frameReport = JSON.parse(frameJourney.stdout.trim().split(/\r?\n/).at(-1));
  check("wheel 설치본이 FrameSpace Python, 격리, screenshot 여정을 완주",
    frameReport.ok === true && frameReport.operations === 13 && frameReport.attachmentBytes > 0,
    `${frameReport.attachmentBytes} bytes`);
} catch (error) {
  check("Python SDK 제품 흐름 예외 없음", false, String(error?.stack || error).slice(-1200));
} finally {
  targetServer.close();
  await rm(installed.tmp, { recursive: true, force: true });
}

console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
