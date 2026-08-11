// Browser Agent Computer primitive probe. 정식 제품 코드는 이 파일을 import하지 않는다.
// 결과: 2026-08-11, Chrome과 Edge 각각 11/11 통과.
// 결론: 의미 locator, actionability, artifact, lifecycle primitive가 두 브라우저에서 성립한다.
// 다음: scripts/browserControl과 정식 contract/browser gate로 졸업한다.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticServer } from "../../../scripts/staticServer.mjs";
import { readDevToolsEndpoint } from "../../../scripts/browserControl/browserControlBroker.mjs";
import { CdpConnection } from "../../../scripts/browserControl/cdpConnection.mjs";
import { launchBrowser } from "../../browser/harness.mjs";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const downloadDir = mkdtempSync(join(tmpdir(), "pyprocBrowserProbeDownload-"));
const server = createStaticServer((req, res) => {
  const url = new URL(req.url, "http://fixture.invalid");
  if (url.pathname !== "/browserControlProbe") return false;
  res.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
  res.end("ok");
  return true;
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const origin = `http://127.0.0.1:${server.address().port}`;
const pageUrl = `${origin}/tests/attempts/browserAgentComputer/probeTarget.html`;
const browser = launchBrowser("about:blank", {
  prefix: "pyprocBrowserAgentProbe-",
  extraArgs: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"],
});

let connection;
let sessionId;
const events = [];
const checks = [];
const check = (name, pass, detail = "") => checks.push({ name, pass: !!pass, detail });
const waitFor = async (predicate, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  return null;
};
const evaluate = (expression, options = {}) => connection.send("Runtime.evaluate", {
  expression,
  awaitPromise: true,
  returnByValue: true,
  ...options,
}, sessionId);

try {
  const endpoint = await readDevToolsEndpoint(browser.profile);
  connection = await CdpConnection.connect(endpoint);
  connection.subscribe((event) => events.push(event));
  await connection.send("Target.setDiscoverTargets", { discover: true });
  const { targetId } = await connection.send("Target.createTarget", { url: "about:blank" });
  ({ sessionId } = await connection.send("Target.attachToTarget", { targetId, flatten: true }));
  await connection.send("Page.enable", {}, sessionId);
  await connection.send("Runtime.enable", {}, sessionId);
  await connection.send("Network.enable", {}, sessionId);
  await connection.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir, eventsEnabled: true }, sessionId);
  await connection.send("Page.navigate", { url: pageUrl }, sessionId);
  await waitFor(() => events.find((event) => event.sessionId === sessionId && event.method === "Page.loadEventFired"));
  await new Promise((resolveFixture) => setTimeout(resolveFixture, 220));

  const semantic = await evaluate(`(() => {
    const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim();
    const elements = [];
    const visit = (root) => {
      for (const element of root.querySelectorAll("*")) {
        elements.push(element);
        if (element.shadowRoot) visit(element.shadowRoot);
        if (element instanceof HTMLIFrameElement && element.contentDocument) visit(element.contentDocument);
      }
    };
    visit(document);
    const role = (element) => element.getAttribute("role") || ({ BUTTON: "button", INPUT: "textbox" }[element.tagName] || "");
    const name = (element) => normalize(element.getAttribute("aria-label")
      || (element.labels && Array.from(element.labels, (label) => label.textContent).join(" "))
      || element.textContent);
    return {
      role: elements.filter((element) => role(element) === "button" && name(element) === "Moving target").length,
      text: elements.filter((element) => name(element) === "Delayed action").length,
      label: elements.filter((element) => element.matches("input, textarea, select") && name(element) === "Work email").length,
      testId: elements.filter((element) => element.dataset?.testid === "email-field").length,
      shadow: elements.filter((element) => name(element) === "Shadow action").length,
      frame: elements.filter((element) => element.matches("button") && name(element) === "Frame action").length,
      duplicate: elements.filter((element) => name(element) === "Duplicate").length,
    };
  })()`);
  const found = semantic.result?.value || {};
  check("semantic locator primitives", found.role === 1 && found.text === 1 && found.label === 1 && found.testId === 1,
    JSON.stringify(found));
  check("open shadow and same-origin frame traversal", found.shadow === 1 && found.frame === 1, JSON.stringify(found));
  check("strict duplicate detection input", found.duplicate === 2, String(found.duplicate));

  const actionability = await evaluate(`(async () => {
    const wrap = document.getElementById("covered-wrap");
    const cover = document.createElement("div");
    cover.id = "cover-probe";
    cover.style.cssText = "position:absolute;inset:0;z-index:3;background:rgba(255,0,0,.2)";
    wrap.append(cover);
    const disabled = document.getElementById("disabled");
    disabled.disabled = true;
    const movingElement = document.getElementById("moving");
    movingElement.style.animation = "none";
    void movingElement.offsetWidth;
    movingElement.style.animation = "settle 220ms linear 1";
    setTimeout(() => cover.remove(), 260);
    setTimeout(() => { disabled.disabled = false; }, 260);
    const inspect = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        rect: [rect.x, rect.y, rect.width, rect.height],
        visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0,
        enabled: !("disabled" in element && element.disabled) && element.getAttribute("aria-disabled") !== "true",
        receivesEvents: hit === element || element.contains(hit),
      };
    };
    const started = performance.now();
    let previous = null;
    let stableFrames = 0;
    let moving;
    let covered;
    let enabled;
    while (performance.now() - started < 3000) {
      moving = inspect(document.getElementById("moving"));
      covered = inspect(document.getElementById("covered"));
      enabled = inspect(document.getElementById("disabled"));
      const key = moving.rect.join(":");
      stableFrames = key === previous ? stableFrames + 1 : 0;
      previous = key;
      if (moving.visible && stableFrames >= 2 && covered.receivesEvents && enabled.enabled) break;
      await new Promise(requestAnimationFrame);
    }
    return { elapsedMs: performance.now() - started, stableFrames, moving, covered, enabled };
  })()`);
  const ready = actionability.result?.value || {};
  check("actionability can wait for stable, hit-target, enabled", ready.elapsedMs >= 200 && ready.stableFrames >= 2
    && ready.moving?.visible && ready.covered?.receivesEvents && ready.enabled?.enabled,
  JSON.stringify(ready));

  const screenshot = await connection.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId);
  check("bounded screenshot primitive", typeof screenshot.data === "string" && screenshot.data.length > 100, `${screenshot.data?.length || 0} chars`);

  await evaluate("window.runProbeSignal()");
  check("console event primitive", !!await waitFor(() => events.find((event) => event.sessionId === sessionId
    && event.method === "Runtime.consoleAPICalled")), "Runtime.consoleAPICalled");
  check("network event primitive", !!await waitFor(() => events.find((event) => event.sessionId === sessionId
    && event.method === "Network.responseReceived" && event.params.response?.url.includes("browserControlProbe"))), "Network.responseReceived");

  const dialogTrigger = evaluate("document.getElementById('dialog').click()", { awaitPromise: false });
  const dialog = await waitFor(() => events.find((event) => event.sessionId === sessionId && event.method === "Page.javascriptDialogOpening"));
  check("dialog lifecycle primitive", !!dialog, dialog?.params?.type || "missing");
  if (dialog) await connection.send("Page.handleJavaScriptDialog", { accept: false }, sessionId);
  await dialogTrigger;

  await evaluate("document.getElementById('popup').click()", { awaitPromise: false, userGesture: true });
  const popup = await waitFor(() => events.find((event) => (event.method === "Target.targetCreated"
    || event.method === "Target.targetInfoChanged") && event.params.targetInfo?.url.includes("popup=1")));
  check("popup target primitive", !!popup, popup?.params?.targetInfo?.type || "missing");

  const documentResult = await connection.send("DOM.getDocument", { depth: 0, pierce: true }, sessionId);
  const uploadNode = await connection.send("DOM.querySelector", {
    nodeId: documentResult.root.nodeId,
    selector: "#upload",
  }, sessionId);
  await connection.send("DOM.setFileInputFiles", { nodeId: uploadNode.nodeId, files: [join(ROOT, "LICENSE")] }, sessionId);
  const uploaded = await evaluate("document.getElementById('upload').files[0]?.name || null");
  check("upload primitive", uploaded.result?.value === "LICENSE", String(uploaded.result?.value));

  await evaluate("document.getElementById('download').click()", { awaitPromise: false });
  const download = await waitFor(() => events.find((event) => event.sessionId === sessionId && event.method === "Page.downloadWillBegin"));
  check("download lifecycle primitive", !!download && download.params.suggestedFilename === "probe.txt",
    download?.params?.suggestedFilename || "missing");

  const failed = checks.filter((entry) => !entry.pass);
  for (const entry of checks) console.log(`${entry.pass ? "PASS" : "FAIL"} ${entry.name}: ${entry.detail}`);
  console.log(`RESULT ${checks.length - failed.length}/${checks.length}`);
  if (failed.length) process.exitCode = 1;
} finally {
  try { if (sessionId) await connection?.send("Target.detachFromTarget", { sessionId }); } catch (error) {}
  connection?.close();
  browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(downloadDir, { recursive: true, force: true });
}
