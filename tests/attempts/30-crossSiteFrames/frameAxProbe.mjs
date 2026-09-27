// frameAxProbe.mjs - frame별 AX 관찰과 실제 교차 site 자식 process의 CDP 경계를 실측한다.
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { CdpConnection } from "../../../scripts/browserControl/cdpConnection.mjs";
import { launchBrowser } from "../../../scripts/browserControl/browserLauncher.mjs";
import { NodeCdpTransport } from "../../../scripts/browserControl/nodeCdpTransport.js";

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const devRoot = resolve(process.env.LOCALAPPDATA || tmpdir(), "dev-workspace");
await mkdir(devRoot, { recursive: true });
const taskDir = await mkdtemp(join(devRoot, "pyproc-frame-ax-"));
let browser = null;
let connection = null;
let server = null;
const requestedPaths = [];

try {
  server = createServer((request, response) => {
    requestedPaths.push(request.url);
    const port = server.address().port;
    const child = request.url === "/cross" ? "cross-frame-proof" : "";
    const body = child
      ? `<!doctype html><button>${child}</button>`
      : `<!doctype html><main><h1>frame-host</h1>
        <iframe srcdoc="<button>same-frame-proof</button>"></iframe>
        <iframe src="http://localhost:${port}/cross"></iframe></main>`;
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(body);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${server.address().port}/`;
  browser = launchBrowser(url, { cdpPipe: true, profileRoot: taskDir });
  connection = CdpConnection.overPipe(browser.cdpPipe, { timeoutMs: 30000 });
  let page = null;
  const deadline = Date.now() + 30000;
  while (!page && Date.now() < deadline) {
    page = (await connection.send("Target.getTargets")).targetInfos.find((item) => item.url === url);
    if (!page) await delay(50);
  }
  if (!page) throw new Error("probe page did not open");
  const { sessionId } = await connection.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
  let branches = [];
  let targets = [];
  while (Date.now() < deadline) {
    branches = (await connection.send("Page.getFrameTree", {}, sessionId)).frameTree.childFrames || [];
    targets = (await connection.send("Target.getTargets")).targetInfos
      .filter((item) => item.type === "iframe").map((item) => ({ type: item.type, url: item.url }));
    if (branches.some((branch) => branch.frame.url.endsWith("/cross"))
      || targets.some((item) => item.url.endsWith("/cross"))) break;
    await delay(50);
  }
  const sameBranch = branches.find((branch) => branch.frame.url === "about:srcdoc");
  if (!sameBranch) throw new Error(`same-site child frame is absent: ${JSON.stringify(branches)}`);
  const root = await connection.send("Accessibility.getFullAXTree", {}, sessionId);
  const names = (result) => result.nodes.map((node) => node.name?.value).filter(Boolean);
  const same = await connection.send("Accessibility.getFullAXTree", { frameId: sameBranch.frame.id }, sessionId);
  let cross = null;
  let crossError = null;
  const crossBranch = branches.find((branch) => branch.frame.url.endsWith("/cross"));
  if (crossBranch) {
    try { cross = await connection.send("Accessibility.getFullAXTree", { frameId: crossBranch.frame.id }, sessionId); }
    catch (error) { crossError = String(error?.message || error); }
  }
  const attached = [];
  const unsubscribe = connection.subscribe((event) => {
    if (event.method === "Target.attachedToTarget" && event.sessionId === sessionId) attached.push(event.params);
  });
  await connection.send("Target.setAutoAttach", {
    autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
    filter: [{ type: "iframe", exclude: false }],
  }, sessionId);
  const attachDeadline = Date.now() + 5000;
  while (!attached.length && Date.now() < attachDeadline) await delay(50);
  const childSession = attached.find((entry) => entry.targetInfo?.url.endsWith("/cross"))?.sessionId;
  const childAx = childSession ? await connection.send("Accessibility.getFullAXTree", {}, childSession) : null;
  const childTree = childSession ? await connection.send("Page.getFrameTree", {}, childSession) : null;
  let owner = null;
  let ownerError = null;
  if (childTree) {
    try { owner = await connection.send("DOM.getFrameOwner", { frameId: childTree.frameTree.frame.id }, sessionId); }
    catch (error) { ownerError = String(error?.message || error); }
  }
  unsubscribe();
  const result = {
    rootIncludesSame: names(root).includes("same-frame-proof"),
    sameFrameRead: names(same).includes("same-frame-proof"),
    crossFrameRead: cross ? names(cross).includes("cross-frame-proof") : false,
    crossError,
    childSessionRead: childAx ? names(childAx).includes("cross-frame-proof") : false,
    attachedTargets: attached.map((entry) => ({ type: entry.targetInfo?.type, url: entry.targetInfo?.url })),
    childFrameId: childTree?.frameTree.frame.id || null,
    childTargetId: attached[0]?.targetInfo.targetId || null,
    parentOwnerBackendNodeId: owner?.backendNodeId || null,
    parentOwnerError: ownerError,
    frameUrls: branches.map((branch) => branch.frame.url),
    iframeTargets: targets,
    requestedPaths,
  };
  const dom = await connection.send("DOMSnapshot.captureSnapshot", { computedStyles: [] }, sessionId);
  result.domDocuments = dom.documents.map((document, index) => ({
    index,
    url: dom.strings[document.documentURL],
    frameId: dom.strings[document.frameId],
    childIndexes: document.nodes.contentDocumentIndex?.value || [],
  }));
  const transport = new NodeCdpTransport(connection);
  const managed = await transport.attach(page.targetId);
  result.transportFrames = await transport.frames(managed);
  result.transportInspect = transport.inspect();
  await transport.detach(managed);
  console.log(JSON.stringify(result));
  if (result.rootIncludesSame || !result.sameFrameRead) process.exitCode = 1;
} finally {
  connection?.close();
  browser?.close();
  if (server) await new Promise((done) => server.close(done));
  if (!resolve(taskDir).startsWith(devRoot + sep)) throw new Error("probe task directory escaped dev-workspace");
  await rm(taskDir, { recursive: true });
}
