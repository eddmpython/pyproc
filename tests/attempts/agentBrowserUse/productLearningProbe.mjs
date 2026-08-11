// productLearningProbe.mjs - 실제 제품을 설치 browser MCP 표면으로 관찰하는 측정 probe.
// 결과: 2026-08-12, Edge 151 Web과 Local 학습 검증 완료. raw command 0개.
// Local은 open commit 뒤 interactive 135/837 node, compact 18,069 bytes, PNG SHA-256 a9109d55...2645.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";

const root = new URL("../../..", import.meta.url);
const rootPath = decodeURIComponent(root.pathname.replace(/^\/(?:([A-Za-z]):)/, "$1:"));
const url = process.argv[2];
const label = process.argv[3] || "observation";
const clickNameArg = process.argv[4] || "";
const clickName = clickNameArg === "-" ? "" : clickNameArg;
const waitHeadingArg = process.argv[5] || clickName;
const waitHeading = waitHeadingArg === "-" ? "" : waitHeadingArg;
const operation = process.argv[6] || "";
const learningCode = process.argv[7] || 'print("verified")';
const clickRole = process.argv[8] || "link";
if (!url) throw new TypeError("usage: node productLearningProbe.mjs <url> [label]");

const parsedUrl = new URL(url);
if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new TypeError("target must use HTTP(S)");
const timeoutMs = 240000;
const scratch = await mkdtemp(join(tmpdir(), "pyproc-agent-browser-use-"));
const artifactDir = join(tmpdir(), "pyproc-agent-browser-evidence");
await mkdir(artifactDir, { recursive: true });
const configPath = join(scratch, "pyproc-mcp.json");
await writeFile(configPath, JSON.stringify({
  schemaVersion: 1,
  engine: { root: join(rootPath, "vendor", "pyodide") },
  timeoutMs,
  browser: {
    enabled: true,
    allowedOrigins: [parsedUrl.origin],
    maxRisk: "externalEffect",
    actions: [
      "snapshot", "screenshot", "waitFor", "hydrateLazy", "navigate", "click", "hover", "focus",
      "check", "uncheck", "drag", "fill", "press", "select", "scroll", "cookiesGet", "cookieSet",
      "cookieDelete", "storageGet", "storageSet", "storageRemove", "storageClear",
    ],
    methods: [],
    viewport: { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false, touch: false },
    externalEffects: "acknowledged",
    purpose: "authorized product learning journey measurement",
  },
}, null, 2));

const child = spawn(process.execPath, [join(rootPath, "scripts", "pyprocMcp.mjs"), "--config", configPath], {
  cwd: rootPath,
  stdio: ["pipe", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-12000); });

const waiters = new Map();
let sequence = 0;
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
lines.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const waiter = waiters.get(message.id);
  if (waiter) {
    waiters.delete(message.id);
    waiter.resolve(message);
  }
});

function request(method, params = {}) {
  const id = ++sequence;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(id);
      reject(new Error(`${method} timed out\n${stderr}`));
    }, timeoutMs);
    waiters.set(id, {
      resolve(message) {
        clearTimeout(timer);
        resolve(message);
      },
    });
  });
}

function toolText(message) {
  if (message.result?.isError) throw new Error(message.result.content?.[0]?.text || "tool failed");
  return JSON.parse(message.result.content[0].text);
}

const callTool = (name, args = {}) => request("tools/call", { name, arguments: args });

async function readArtifact(descriptor, evidenceName) {
  const chunks = [];
  let offset = 0;
  for (;;) {
    const part = toolText(await callTool("browserArtifactRead", {
      artifactRef: descriptor.artifactRef,
      offset,
      maxBytes: 262144,
    }));
    chunks.push(Buffer.from(part.dataBase64, "base64"));
    offset = part.nextOffset;
    if (part.eof) break;
  }
  const bytes = Buffer.concat(chunks);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== descriptor.sha256) throw new Error("screenshot digest mismatch");
  const path = join(artifactDir, `${label}-${evidenceName}-${basename(parsedUrl.pathname) || "root"}.png`);
  await writeFile(path, bytes);
  return { path, byteLength: bytes.length, sha256: digest };
}

let sessionRef = null;
try {
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "agent-browser-use-probe", version: "1" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const inspected = toolText(await callTool("browserInspect"));
  const machine = toolText(await callTool("pythonRun", { code: "sum([20, 22])" }));
  const opened = toolText(await callTool("browserOpen", { url, expectedRisk: "externalEffect" }));
  sessionRef = toolText(await callTool("browserAttach", { targetRef: opened.targetRef }));
  let preflightError = null;
  if (label.startsWith("local")) {
    toolText(await callTool("browserObserve", {
      sessionRef,
      expectedRisk: "read",
      maxNodes: 16,
      includeConsole: true,
      includeNetwork: true,
      maxEvents: 100,
    }));
    try {
      toolText(await callTool("browserAct", {
        sessionRef,
        actions: [
          { kind: "navigate", url, expectedRisk: "externalEffect" },
          {
            kind: "waitFor",
            selector: "#root > *",
            state: "attached",
            timeoutMs: 30000,
            expectedRisk: "read",
          },
        ],
      }));
    } catch (error) {
      preflightError = error instanceof Error ? error.message : String(error);
    }
    if (!preflightError && clickName) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          toolText(await callTool("browserAct", {
            sessionRef,
            actions: [{
              kind: "waitFor",
              locator: { by: "role", value: clickRole, name: clickName, exact: true },
              state: "visible",
              timeoutMs: 30000,
              expectedRisk: "read",
            }],
          }));
          preflightError = null;
          break;
        } catch (error) {
          preflightError = error instanceof Error ? error.message : String(error);
        }
      }
    }
    if (!preflightError && !clickName && operation === "run") {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          toolText(await callTool("browserAct", {
            sessionRef,
            actions: [{
              kind: "waitFor",
              locator: {
                by: "label",
                value: "Hello World 실습 직접 해보기 코드 편집기",
                exact: true,
              },
              state: "visible",
              timeoutMs: 30000,
              expectedRisk: "read",
            }],
          }));
          preflightError = null;
          break;
        } catch (error) {
          preflightError = error instanceof Error ? error.message : String(error);
        }
      }
    }
  }
  const initial = toolText(await callTool("browserObserve", {
    sessionRef,
    expectedRisk: "read",
    maxNodes: 512,
    includeScreenshot: true,
    includeConsole: true,
    includeNetwork: true,
    maxEvents: 100,
  }));
  const initialScreenshot = initial.result.screenshot
    ? await readArtifact(initial.result.screenshot, "initial")
    : null;
  let interaction = null;
  let observed = initial;
  let finalScreenshot = initialScreenshot;
  if (clickName) {
    const target = initial.result.nodes.find((node) => node.role === clickRole && node.name === clickName);
    if (!target?.locatorRef) throw new Error(`snapshot link is unavailable: ${clickName}`);
    interaction = toolText(await callTool("browserAct", {
      sessionRef,
      actions: [
        {
          kind: "click",
          locatorRef: target.locatorRef,
          expectedRisk: "externalEffect",
        },
        {
          kind: "waitFor",
          locator: { by: "role", value: "heading", name: waitHeading, exact: true },
          state: "visible",
          timeoutMs: 30000,
          expectedRisk: "read",
        },
        {
          kind: "waitFor",
          selector: '[data-product-surface-ready="curriculum"]',
          state: "visible",
          timeoutMs: 30000,
          expectedRisk: "read",
        },
        {
          kind: "waitFor",
          locator: {
            by: "label",
            value: "Hello World 실습 직접 해보기 코드 편집기",
            exact: true,
          },
          state: "visible",
          timeoutMs: 30000,
          expectedRisk: "read",
        },
      ],
    }));
    observed = toolText(await callTool("browserObserve", {
      sessionRef,
      expectedRisk: "read",
      maxNodes: operation ? 200 : 512,
      ...(operation ? { mode: "interactive" } : {}),
      includeScreenshot: true,
      includeConsole: true,
      includeNetwork: true,
      maxEvents: 100,
    }));
    finalScreenshot = observed.result.screenshot
      ? await readArtifact(observed.result.screenshot, "final")
      : null;
  }
  if (!clickName && operation === "run") {
    observed = toolText(await callTool("browserObserve", {
      sessionRef,
      expectedRisk: "read",
      maxNodes: 200,
      mode: "interactive",
      includeScreenshot: true,
      includeConsole: true,
      includeNetwork: true,
      maxEvents: 100,
    }));
    finalScreenshot = observed.result.screenshot
      ? await readArtifact(observed.result.screenshot, "final")
      : null;
  }
  let learning = null;
  let learningError = null;
  if (operation === "run") {
    const editor = observed.result.nodes.find((node) => node.role === "textbox"
      && node.name?.includes("Hello World 실습 직접 해보기 코드 편집기"));
    const editorBlockName = editor?.name?.replace(/ 직접 해보기 코드 편집기$/, "") || "";
    const runButton = observed.result.nodes.find((node) => node.role === "button"
      && (node.name === "셀 실행" || (editorBlockName && node.name === `${editorBlockName} 셀 실행`)));
    if (!editor?.locatorRef || !runButton?.locatorRef) {
      throw new Error(`learning controls are unavailable: editor=${!!editor}, run=${!!runButton}`);
    }
    try {
      learning = toolText(await callTool("browserAct", {
        sessionRef,
        actions: [
          {
            kind: "fill",
            locatorRef: editor.locatorRef,
            value: learningCode,
            expectedRisk: "externalEffect",
          },
          {
            kind: "click",
            locatorRef: runButton.locatorRef,
            expectedRisk: "externalEffect",
          },
          {
            kind: "waitFor",
            selector: '[data-learning-check-result]',
            state: "visible",
            timeoutMs: 30000,
            expectedRisk: "read",
          },
          {
            kind: "waitFor",
            selector: '[data-learning-check-result="verified"]',
            state: "visible",
            timeoutMs: 30000,
            expectedRisk: "read",
          },
        ],
      }));
    } catch (error) {
      learningError = error instanceof Error ? error.message : String(error);
    }
    observed = toolText(await callTool("browserObserve", {
      sessionRef,
      expectedRisk: "read",
      maxNodes: 200,
      mode: "interactive",
      includeScreenshot: true,
      includeConsole: true,
      includeNetwork: true,
      maxEvents: 100,
    }));
    finalScreenshot = observed.result.screenshot
      ? await readArtifact(observed.result.screenshot, "completed")
      : null;
  }
  const report = {
    url,
    compatibility: inspected.compatibility,
    machineValue: machine.value,
    startup: opened.startup,
    preflightError,
    interaction,
    learning,
    learningError,
    initial: initial.result,
    snapshot: {
      url: observed.result.url,
      mode: observed.result.mode,
      nodes: observed.result.nodes,
      eligibleNodes: observed.result.eligibleNodes,
      candidateNodes: observed.result.candidateNodes,
      truncated: observed.result.truncated,
      rawBytes: observed.result.rawBytes,
      compactBytes: observed.result.compactBytes,
      console: observed.result.console,
      network: observed.result.network,
    },
    screenshot: finalScreenshot,
  };
  const reportPath = join(artifactDir, `${label}-report.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  const namedNodes = observed.result.nodes.filter((node) => {
    if (!node.name || node.role === "StaticText") return false;
    if (!operation) return true;
    return /코드 편집기|셀 실행|검증|실행 결과|연습 완료/.test(node.name);
  });
  process.stdout.write(`${JSON.stringify({
    url,
    finalUrl: observed.result.url,
    compatibility: inspected.compatibility,
    machineValue: machine.value,
    preflightError,
    interaction,
    learning,
    learningError,
    snapshot: {
      nodeCount: observed.result.nodes.length,
      mode: observed.result.mode,
      eligibleNodes: observed.result.eligibleNodes,
      candidateNodes: observed.result.candidateNodes,
      rawBytes: observed.result.rawBytes,
      compactBytes: observed.result.compactBytes,
      truncated: observed.result.truncated,
      namedNodes,
      console: observed.result.console,
      network: observed.result.network,
    },
    screenshot: finalScreenshot,
    reportPath,
  }, null, 2)}\n`);
} finally {
  if (sessionRef) await callTool("browserDetach", { sessionRef }).catch(() => {});
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(scratch, { recursive: true, force: true });
}
