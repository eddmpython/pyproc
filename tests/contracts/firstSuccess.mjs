// 소비자 첫 성공 경로: Setup 앵커, playground 계약, core-only 자산, 내구 재개방 러너.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SETUP_FRAGMENT, SETUP_URL } from "../../src/runtime/preflight.js";
import { inspectDefaultKernelEngineDistribution } from "../../src/runtime/engines/wasi/ownedEngineDistribution.js";
import {
  DURABLE_REOPEN_NAME,
  DURABLE_REOPEN_PYTHON,
  DURABLE_REOPEN_VALUE,
  FIRST_SUCCESS_OUTPUT,
  FIRST_SUCCESS_PAGE,
  FIRST_SUCCESS_PYTHON,
  firstSuccessProbe,
} from "../../scripts/playground/firstSuccessContract.js";
import {
  defaultBootEngineAssetPaths,
  findDataEngineAssets,
} from "../../scripts/playground/firstSuccessAssets.js";
import {
  createPlaygroundServer,
  extractRelativeModuleSpecifiers,
  PLAYGROUND_PAGE_PATH,
  resolvePlaygroundPath,
} from "../../scripts/playground/playgroundServer.js";
import { runDurableReopen, runFirstSuccess } from "../../scripts/playground/runFirstSuccess.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FORBIDDEN_FIRST_SCREEN = Object.freeze([
  "V86", "WebGPU", "CDP", "action convergence", "actionConvergence",
  "libgit2", "ripgrep", "git.wasm", "rg.wasm",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function firstScreen(markdown, doorHeading) {
  const index = markdown.indexOf(doorHeading);
  assert(index > 0, `door heading missing: ${doorHeading}`);
  return markdown.slice(0, index);
}

function pagesAssembleAllowlist(workflow) {
  const directories = [];
  const files = [];
  for (const line of workflow.split("\n")) {
    const recursive = /^\s*cp -r (.+) _site\/?\s*$/u.exec(line);
    if (recursive) {
      directories.push(...recursive[1].trim().split(/\s+/u));
      continue;
    }
    const copied = /^\s*cp (.+) _site(?:\/\S*)?\s*$/u.exec(line);
    if (copied) files.push(...copied[1].trim().split(/\s+/u));
  }
  return Object.freeze({ directories: Object.freeze(directories), files: Object.freeze(files) });
}

function isPagesAssembled(relativePath, allowlist) {
  const posix = relativePath.replaceAll("\\", "/");
  if (allowlist.files.includes(posix)) return true;
  return allowlist.directories.some((directory) => posix === directory || posix.startsWith(`${directory}/`));
}

function repoRelative(fromFile, specifier) {
  const absolute = resolve(dirname(join(ROOT, fromFile)), specifier);
  return relative(ROOT, absolute).replaceAll(sep, "/");
}

function walkExampleAssembleGraph(allowlist) {
  const examplesDir = join(ROOT, "examples");
  const queue = readdirSync(examplesDir)
    .filter((name) => /\.(?:html|js|mjs)$/iu.test(name))
    .map((name) => `examples/${name}`);
  const seen = new Set();
  const missing = [];
  while (queue.length) {
    const path = queue.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    if (!isPagesAssembled(path, allowlist)) {
      missing.push(path);
      continue;
    }
    const full = join(ROOT, path);
    if (!existsSync(full) || !statSync(full).isFile()) {
      missing.push(path);
      continue;
    }
    if (!/\.(?:html|js|mjs)$/iu.test(path)) continue;
    const source = readFileSync(full, "utf8");
    const fromPath = path === "examples/index.html" ? "index.html" : path;
    for (const specifier of extractRelativeModuleSpecifiers(source)) {
      queue.push(repoRelative(fromPath, specifier.split(/[?#]/u)[0]));
    }
  }
  return { seen, missing };
}

function readmeSetup(markdown) {
  assert(/(^|\n)## Setup(\n|$)/u.test(markdown), "README Setup heading missing");
  assert(markdown.includes("Cross-Origin-Opener-Policy"), "README Setup missing COOP");
  assert(markdown.includes("Cross-Origin-Embedder-Policy"), "README Setup missing COEP");
  assert(markdown.includes("vite.config.js"), "README Setup missing Vite snippet");
  assert(markdown.includes("next.config.js"), "README Setup missing Next snippet");
  assert(markdown.includes("npx pyproc-playground"), "README Setup missing playground command");
}

async function walkPlaygroundModules(baseUrl, path, seen) {
  if (seen.has(path)) return;
  seen.add(path);
  const response = await fetch(new URL(path, baseUrl));
  assert(response.ok, `playground fetch failed: ${path} ${response.status}`);
  const source = await response.text();
  if (!/\.(?:html|js|mjs)$/iu.test(path) && path !== "/") return;
  for (const specifier of extractRelativeModuleSpecifiers(source)) {
    await walkPlaygroundModules(baseUrl, resolvePlaygroundPath(path, specifier), seen);
  }
}

export async function assertFirstSuccessContract() {
  assert(SETUP_FRAGMENT === "setup", "SETUP_FRAGMENT must be setup");
  assert(SETUP_URL.endsWith("#setup"), `diagnostic URL must use #setup: ${SETUP_URL}`);
  assert(!SETUP_URL.includes("#Setup"), "diagnostic URL must not use a dead #Setup fragment");

  const english = readFileSync(join(ROOT, "README.md"), "utf8");
  const korean = readFileSync(join(ROOT, "README.ko.md"), "utf8");
  readmeSetup(english);
  readmeSetup(korean);
  for (const [name, text, door] of [["README.md", english, "\n## Next\n"], ["README.ko.md", korean, "\n## 다음\n"]]) {
    const screen = firstScreen(text, door);
    assert(screen.includes(FIRST_SUCCESS_PYTHON), `${name} first screen missing first-success python`);
    assert(screen.includes("import { boot }"), `${name} first screen missing boot()`);
    for (const banned of FORBIDDEN_FIRST_SCREEN) {
      assert(!screen.includes(banned), `${name} first screen still contains ${banned}`);
    }
    assert(text.includes(DURABLE_REOPEN_PYTHON), `${name} missing durable reopen python`);
    assert(text.includes("await open(image)"), `${name} missing open(image)`);
    assert(text.includes(String(DURABLE_REOPEN_VALUE)), `${name} missing durable value`);
  }

  const probe = firstSuccessProbe();
  assert(probe.python === FIRST_SUCCESS_PYTHON && probe.expectedOutput === FIRST_SUCCESS_OUTPUT,
    "first-success probe drifted from the shipped contract");
  const cli = join(ROOT, "scripts", "pyprocPlayground.mjs");
  const first = spawnSync(process.execPath, [cli, "--probe"], { encoding: "utf8", cwd: ROOT });
  const second = spawnSync(process.execPath, [cli, "--probe"], { encoding: "utf8", cwd: ROOT });
  assert(first.status === 0 && second.status === 0, `playground --probe failed: ${first.stderr || second.stderr}`);
  assert(first.stdout === second.stdout, "playground --probe is not deterministic");
  assert(JSON.parse(first.stdout).python === FIRST_SUCCESS_PYTHON, "playground --probe python drifted");
  assert(JSON.parse(first.stdout).expectedOutput === FIRST_SUCCESS_OUTPUT, "playground --probe output drifted");

  const leakedDetector = findDataEngineAssets([
    "/src/runtime/engines/wasi/owned/data/python.wasm",
    "/src/runtime/packages/native/data/numpy-2.5.1-py3-none-any.whl",
    "/src/runtime/engines/wasi/owned/core/python.wasm",
  ]);
  assert(leakedDetector.length === 2, "data-engine asset detector does not bite on owned/data and NumPy");
  assert(findDataEngineAssets(defaultBootEngineAssetPaths()).length === 0,
    "default boot engine artifacts include a data-engine path");
  assert(inspectDefaultKernelEngineDistribution().nativeProfile === "core",
    "default boot() is not the core engine");

  const pythonCalls = [];
  const firstResult = await runFirstSuccess(async () => ({
    run: Object.assign(async (code) => {
      pythonCalls.push(code);
      return { output: `${FIRST_SUCCESS_OUTPUT}\n` };
    }, {
      python: async (code) => {
        pythonCalls.push(code);
        return { output: `${FIRST_SUCCESS_OUTPUT}\n` };
      },
    }),
    close: async () => {},
  }));
  assert(pythonCalls[0] === FIRST_SUCCESS_PYTHON, "first-success runner did not execute the advertised python");
  assert(pythonCalls.some((code) => code.includes("%pip install")),
    "first-success runner did not request a package through %pip install");
  assert(firstResult.output === FIRST_SUCCESS_OUTPUT, "first-success runner dropped the receipt output");

  let exported = false;
  let closed = 0;
  const durable = await runDurableReopen(async () => ({
    run: Object.assign(async (code) => {
      assert(code === DURABLE_REOPEN_PYTHON, `durable runner python drifted: ${code}`);
      return { output: "" };
    }, {
      python: async (code) => {
        assert(code === DURABLE_REOPEN_PYTHON, `durable runner python drifted: ${code}`);
        return { output: "" };
      },
      get: async (name) => {
        throw new Error(`get on the closed machine: ${name}`);
      },
    }),
    history: { export: async () => { exported = true; return { protocol: "pyproc.kernel-machine-image" }; } },
    close: async () => { closed += 1; },
  }), async (image) => {
    assert(exported && image?.protocol === "pyproc.kernel-machine-image", "durable runner did not export an image");
    return {
      run: { get: async (name) => {
        assert(name === DURABLE_REOPEN_NAME, `durable reopen read ${name}`);
        return DURABLE_REOPEN_VALUE;
      } },
      close: async () => { closed += 1; },
    };
  });
  assert(durable.recorded === durable.restored && durable.restored === DURABLE_REOPEN_VALUE,
    "durable reopen runner did not return the recorded value");
  assert(closed === 2, "durable reopen runner did not close both machines");

  const page = readFileSync(join(ROOT, FIRST_SUCCESS_PAGE), "utf8");
  assert(page.includes('from "../../index.js"'), "first-success page does not import the public package root");
  assert(page.includes("runFirstSuccess"), "first-success page does not call the shipped runner");
  const durablePage = readFileSync(join(ROOT, "examples", "durable.html"), "utf8");
  assert(durablePage.includes('data-scenario="durable"'), "examples/durable.html is not the public second example");
  const ownedDemo = readFileSync(join(ROOT, "examples", "ownedDemo.js"), "utf8");
  assert(ownedDemo.includes('from "./runFirstSuccess.js"'),
    "examples/ownedDemo.js must import the Pages-assembled runner");
  assert(!ownedDemo.includes("scripts/playground"),
    "examples/ownedDemo.js still imports outside the Pages assemble graph");

  const workflow = readFileSync(join(ROOT, ".github", "workflows", "pages.yml"), "utf8");
  const allowlist = pagesAssembleAllowlist(workflow);
  assert(allowlist.directories.includes("examples") && allowlist.directories.includes("src"),
    "pages.yml no longer copies examples and src into _site");
  assert(allowlist.files.includes("index.js"), "pages.yml no longer copies index.js into _site");
  const leakedDemo = repoRelative("examples/ownedDemo.js", "../scripts/playground/runFirstSuccess.js");
  assert(!isPagesAssembled(leakedDemo, allowlist),
    "Pages assemble detector does not reject scripts/playground from examples/");
  const assembled = walkExampleAssembleGraph(allowlist);
  assert(assembled.missing.length === 0,
    `Pages assemble graph cannot load: ${assembled.missing.join(", ")}`);
  assert(assembled.seen.has("examples/runFirstSuccess.js"),
    "assembled example graph never reached examples/runFirstSuccess.js");
  assert(assembled.seen.has("examples/ownedDemo.js"),
    "assembled example graph never reached examples/ownedDemo.js");
  const site = mkdtempSync(join(tmpdir(), "pyprocPagesAssemble-"));
  try {
    mkdirSync(join(site, "examples"));
    writeFileSync(join(site, "package.json"), JSON.stringify({ type: "module" }));
    cpSync(join(ROOT, "examples", "runFirstSuccess.js"), join(site, "examples", "runFirstSuccess.js"));
    cpSync(join(ROOT, "examples", "firstSuccessContract.js"), join(site, "examples", "firstSuccessContract.js"));
    cpSync(join(ROOT, "examples", "ownedDemo.js"), join(site, "examples", "ownedDemo.js"));
    const assembledRunner = await import(pathToFileURL(join(site, "examples", "runFirstSuccess.js")).href);
    assert(typeof assembledRunner.runFirstSuccess === "function"
      && typeof assembledRunner.runDurableReopen === "function",
    "assembled examples/runFirstSuccess.js did not load");
    assert(!existsSync(join(site, "scripts", "playground", "runFirstSuccess.js")),
      "assembled site unexpectedly contains scripts/playground");
  } finally {
    rmSync(site, { recursive: true, force: true });
  }

  const server = createPlaygroundServer({ root: ROOT });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/`;
    const seen = new Set();
    await walkPlaygroundModules(baseUrl, PLAYGROUND_PAGE_PATH, seen);
    const requested = [...seen, ...server.requestedPaths, ...defaultBootEngineAssetPaths()];
    const leaked = findDataEngineAssets(requested);
    assert(leaked.length === 0, `first-success path requested data-engine assets: ${leaked.join(", ")}`);
    assert(seen.has(PLAYGROUND_PAGE_PATH), "playground did not serve the first-success page");
  } finally {
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => { if (error) rejectClose(error); else resolveClose(); });
    });
  }
}
