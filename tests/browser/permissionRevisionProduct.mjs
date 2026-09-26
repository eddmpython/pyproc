// permissionRevisionProduct.mjs - live permission revision through the public Control client. A tab the site sends to
// another origin is held, not closed and not reported without a place: the caller learns the origin and path (never
// the query or fragment), widens the permission with a reference to the approval behind it, and goes on with the same
// tab. Narrowing holds it again; widening without a reference and observing a held tab are refused; ending a held
// session closes its tab; Execution Memory revisions after a revision carry the revised permission and reference.
// Revisions sent together take effect in the order they are recorded; one Execution Memory refuses changes nothing; an
// action a revision removes stops a request that is already running before it reaches that action.
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../packageHarness.mjs";
import { PyProcControlClient } from "../../scripts/controlProtocol/controlApi.js";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 120000);
const executable = process.env.PYPROC_BROWSER || undefined;
const HELD = "BROWSER_CONTROL_SURFACE_HELD";
const SECRET = `revision-gate-secret-${process.pid}`;
process.env.PYPROC_REVISION_GATE_SECRET = SECRET;
let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) { passed += 1; console.log(`  PASS ${name}${detail ? ` (${detail})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`); }
}
async function errorOf(operation) {
  try { await operation(); return null; } catch (error) { return error; }
}

// One server, two origins: 127.0.0.1 is allowed, localhost is where the site sends the task.
let otherOrigin = "";
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://fixture");
  if (url.pathname === "/redirect") {
    res.writeHead(302, { Location: `${otherOrigin}/landing?code=secret#fragment`, "Cache-Control": "no-store" });
    res.end();
    return;
  }
  const body = url.pathname === "/landing" ? "<h1>Landing page</h1>"
    : url.pathname === "/jsleave" ? `<h1>Leaving page</h1><script>addEventListener("load", () => setTimeout(() => {
      location.href = "${otherOrigin}/landing?code=secret"; }, 0));</script>`
    : url.pathname === "/late" ? `<h1>Late page</h1><div style="height:3000px"></div><script>setTimeout(() => {
      const button = document.createElement("button"); button.id = "late"; button.textContent = "Late";
      document.body.append(button); }, 1500);</script>`
      : "<h1>Start page</h1>";
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html><title>revision</title>${body}`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
otherOrigin = `http://localhost:${server.address().port}`;

const work = await mkdtemp(join(tmpdir(), "pyproc-permission-revision-"));
const memoryRoot = join(work, "memory");
await mkdir(memoryRoot);
const configPath = join(work, "manifest.json");
await writeFile(configPath, JSON.stringify({ schemaVersion: 1, engine: { enabled: false }, timeoutMs: TIMEOUT_MS,
  browser: { enabled: true, allowedOrigins: [origin], maxRisk: "externalEffect",
    actions: ["snapshot", "navigate", "waitFor", "scroll"],
    methods: [], externalEffects: "acknowledged", purpose: "Verify live permission revision", artifacts: {},
    permissionRevision: "controller",
    ...(executable ? { executable } : {}) },
  executionMemory: { enabled: true, root: memoryRoot, importRoots: [], secretEnv: ["PYPROC_REVISION_GATE_SECRET"] } },
null, 2));

let client = null;
const seesLanding = async (sessionRef) => JSON.stringify((await client.observe(sessionRef, { expectedRisk: "read" })).output).includes("Landing page");
const heldPlaceOf = (error) => JSON.stringify({ origin: error?.details?.origin, path: error?.details?.path });
const expectedPlace = JSON.stringify({ origin: otherOrigin, path: "/landing" });
try {
  client = await PyProcControlClient.start(configPath, { command: [process.execPath, join(ROOT, "scripts",
    "pyprocControl.mjs")], cwd: ROOT, startupTimeoutMs: TIMEOUT_MS, shutdownTimeoutMs: 10000 });
  const project = { workspaceId: "workspace:revision", commit: "commit:revision", treeSha256: `sha256:${"1".repeat(64)}`,
    diffSha256: `sha256:${"2".repeat(64)}`, untracked: false };
  const memoryFirst = await client.createExecutionSession("session:revision", project);

  // A new tab the site redirects elsewhere is held with its place, and nothing attaches to it yet.
  const openHeld = await errorOf(() => client.openTarget(`${origin}/redirect`, { expectedRisk: "externalEffect",
    waitUntil: "load" }));
  const heldRef = openHeld?.details?.targetRef;
  check("a new tab that lands on another origin is held, and the caller learns its origin and path",
    openHeld?.code === HELD && openHeld.outcome === "applied" && heldPlaceOf(openHeld) === expectedPlace
      && Boolean(heldRef), JSON.stringify({ code: openHeld?.code, details: openHeld?.details }));
  check("the held place never carries the query or fragment", !JSON.stringify(openHeld?.details || {}).includes("secret")
    && !String(openHeld?.message || "").includes("secret"));
  const attachEarly = await errorOf(() => client.attachSession(heldRef));
  const held = (await client.inspectSpace()).output.heldSurfaces || [];
  check("attaching to a held tab is refused, and the tab stays open and listed as held",
    attachEarly?.code === HELD && held.some((entry) => entry.targetRef === heldRef), JSON.stringify(held));

  // A page that moves on by itself right after it loaded is held where it went, never at the page it loaded: the open
  // itself reports it, or (when the open finished first) the next request on the tab does.
  const jsOpen = await client.openTarget(`${origin}/jsleave`, { expectedRisk: "externalEffect", waitUntil: "load" })
    .then((opened) => ({ opened }), (error) => ({ error }));
  let jsHeld = jsOpen.error || null;
  if (!jsHeld) {
    const jsSession = await client.attachSession(jsOpen.opened.output.targetRef).catch((error) => ({ error }));
    const deadline = Date.now() + TIMEOUT_MS;
    while (!jsHeld && Date.now() < deadline) {
      jsHeld = jsSession.error || await errorOf(() => client.observe(jsSession.output, { expectedRisk: "read" }));
      if (!jsHeld) await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  check("a page that leaves right after it loads is held where it went, not where it loaded",
    jsHeld?.code === HELD && heldPlaceOf(jsHeld) === expectedPlace,
    JSON.stringify({ code: jsHeld?.code, details: jsHeld?.details }));

  // Widening needs the reference to the approval behind it.
  const unreferenced = await errorOf(() => client.revisePermission({ allowedOrigins: [origin, otherOrigin] }));
  check("widening without a reference is refused before anything changes",
    unreferenced?.code === "BROWSER_CONTROL_PERMISSION_DENIED" && unreferenced.outcome === "notSent",
    unreferenced?.message);
  const beyond = await errorOf(() => client.revisePermission({ actions: ["snapshot", "navigate", "waitFor", "scroll", "click"],
    reference: "approval:beyond" }));
  check("actions beyond what the host started with are refused", beyond?.code === "BROWSER_CONTROL_PERMISSION_DENIED",
    beyond?.message);
  const widened = await client.revisePermission({ allowedOrigins: [origin, otherOrigin], reference: "approval:1" });
  check("widening with a reference applies at once and reports the held tab",
    widened.output.widened === true && widened.output.reference === "approval:1"
      && widened.output.permission.targetOrigins.includes(otherOrigin),
    JSON.stringify(widened.output.permission.targetOrigins));
  const attached = await client.attachSession(heldRef);
  check("after widening, the same held tab attaches and reads", await seesLanding(attached.output),
    attached.output.targetRef);

  // Narrowing holds the tab again; observing a held tab is refused, not answered.
  const narrowed = await client.revisePermission({ allowedOrigins: [origin] });
  const observeHeld = await errorOf(() => client.observe(attached.output, { expectedRisk: "read" }));
  check("narrowing needs no reference and holds the tab again at its next request",
    narrowed.output.widened === false && observeHeld?.code === HELD && heldPlaceOf(observeHeld) === expectedPlace
      && observeHeld.outcome === "notSent", JSON.stringify(observeHeld?.details));

  // In a session, a navigation that an allowed page redirects elsewhere is held, and goes on once widened.
  const opened = await client.openTarget(`${origin}/start`, { expectedRisk: "externalEffect", waitUntil: "load" });
  const session = (await client.attachSession(opened.output.targetRef)).output;
  const redirected = await errorOf(() => client.act(session, [{ kind: "navigate", url: `${origin}/redirect`,
    waitUntil: "load", expectedRisk: "externalEffect" }]));
  check("a navigation redirected to another origin is held with its place, the effect reported as applied",
    redirected?.code === HELD && redirected.outcome === "applied" && heldPlaceOf(redirected) === expectedPlace,
    JSON.stringify({ code: redirected?.code, outcome: redirected?.outcome, details: redirected?.details }));
  await client.revisePermission({ allowedOrigins: [origin, otherOrigin], reference: "approval:2" });
  check("after widening, the same session goes on where it landed", await seesLanding(session));

  // Execution Memory records the revised permission and the reference to its approval.
  const memorySecond = await client.checkpointExecutionSession("session:revision", memoryFirst.output.contentSha256,
    { state: "active", branch: "browser:revised", checkpoint: "checkpoint:revised", outcomeUnknown: false,
      pendingIntentSha256: null });
  const revisedDigest = memorySecond.output.permissions.manifestSha256;
  const manifest = JSON.parse(await readFile(join(memoryRoot, "artifacts", "permissions", `${revisedDigest}.json`),
    "utf8"));
  check("an Execution Memory checkpoint after a revision carries the revised permission and its reference",
    revisedDigest !== memoryFirst.output.permissions.manifestSha256 && manifest.reference === "approval:2"
      && manifest.browser.targetOrigins.includes(otherOrigin), JSON.stringify(manifest));

  // A revision Execution Memory refuses (its reference holds a configured secret) changes nothing.
  const recorded = await errorOf(() => client.revisePermission({ allowedOrigins: [origin], reference: SECRET }));
  const unchanged = (await client.inspectSpace()).output.policy?.targetOrigins || [];
  check("a revision Execution Memory refuses changes nothing and is reported as not sent",
    recorded?.code === "EXECUTION_MEMORY_SECRET" && recorded.outcome === "notSent" && unchanged.includes(otherOrigin),
    JSON.stringify({ code: recorded?.code, outcome: recorded?.outcome, unchanged }));

  // Revisions sent together take effect one at a time, in the order they are recorded.
  for (let round = 0; round < 4; round += 1) {
    await Promise.all([client.revisePermission({ allowedOrigins: [origin] }),
      client.revisePermission({ allowedOrigins: [origin, otherOrigin], reference: `approval:race${round}` })]);
  }
  const head = await client.openExecutionSession("session:revision");
  const racedManifest = JSON.parse(await readFile(join(memoryRoot, "artifacts", "permissions",
    `${(await client.checkpointExecutionSession("session:revision", head.output.contentSha256, head.output.work))
      .output.permissions.manifestSha256}.json`), "utf8"));
  const racedPolicy = (await client.inspectSpace()).output.policy?.targetOrigins || [];
  check("revisions sent together leave the permission in force and its record in agreement",
    JSON.stringify([...racedPolicy].sort()) === JSON.stringify([...racedManifest.browser.targetOrigins].sort())
      && racedManifest.reference === "approval:race3", JSON.stringify({ racedPolicy, manifest: racedManifest }));

  // An action a revision removes stops a request already running before it reaches that action.
  const late = await client.openTarget(`${origin}/late`, { expectedRisk: "externalEffect", waitUntil: "load" });
  const lateSession = (await client.attachSession(late.output.targetRef)).output;
  const running = errorOf(() => client.act(lateSession, [
    { kind: "waitFor", selector: "#late", state: "visible", expectedRisk: "read" },
    { kind: "scroll", selector: "#late", expectedRisk: "externalEffect" }]));
  await new Promise((resolve) => setTimeout(resolve, 300));
  await client.revisePermission({ actions: ["snapshot", "navigate", "waitFor"] });
  const stopped = await running;
  check("an action removed while a request runs is refused before it runs",
    stopped?.code === "BROWSER_AUTOMATION_ACTION_DENIED" && stopped.details?.failedActionIndex === 1
      && stopped.details?.failedAction?.kind === "scroll",
    JSON.stringify({ code: stopped?.code, failed: stopped?.details?.failedAction?.kind }));
  await client.revisePermission({ actions: ["snapshot", "navigate", "waitFor", "scroll"], reference: "approval:restore" });

  // Ending a session whose tab is held closes the tab.
  await client.revisePermission({ allowedOrigins: [origin] });
  await errorOf(() => client.observe(session, { expectedRisk: "read" }));
  const before = (await client.inspectSpace()).output;
  await client.detachSession(session);
  const after = (await client.inspectSpace()).output;
  check("detaching a held session closes its tab",
    after.ownedTargets === before.ownedTargets - 1
      && !(after.heldSurfaces || []).some((entry) => entry.targetRef === session.targetRef),
    JSON.stringify({ before: before.ownedTargets, after: after.ownedTargets }));
  await client.close();
  client = null;

  // A host whose manifest does not enable revision offers no revision and closes a new tab the site sends elsewhere.
  const plainConfig = JSON.parse(await readFile(configPath, "utf8"));
  delete plainConfig.browser.permissionRevision;
  delete plainConfig.executionMemory;
  const plainPath = join(work, "plain.json");
  await writeFile(plainPath, JSON.stringify(plainConfig, null, 2));
  client = await PyProcControlClient.start(plainPath, { command: [process.execPath, join(ROOT, "scripts",
    "pyprocControl.mjs")], cwd: ROOT, startupTimeoutMs: TIMEOUT_MS, shutdownTimeoutMs: 10000 });
  const plainOpen = await errorOf(() => client.openTarget(`${origin}/redirect`, { expectedRisk: "externalEffect",
    waitUntil: "load" }));
  const plainSpace = (await client.inspectSpace()).output;
  check("a host without revision offers none and closes a redirected new tab, naming where it went",
    !client.operations.includes("automation.permission.revise") && plainOpen?.code === "BROWSER_CONTROL_PERMISSION_DENIED"
      && plainOpen.outcome === "applied" && heldPlaceOf(plainOpen) === expectedPlace && plainSpace.ownedTargets === 0
      && (plainSpace.heldSurfaces || []).length === 0,
    JSON.stringify({ code: plainOpen?.code, details: plainOpen?.details, owned: plainSpace.ownedTargets }));
} catch (error) {
  check("permission revision gate has no exception", false, String(error?.stack || error).slice(-1600));
} finally {
  if (client) await client.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await rm(work, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
