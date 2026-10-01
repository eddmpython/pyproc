// 2026-10-01: installed 0.0.34 echoes a password in act results. Candidate probe exercises actual Chromium through
// the packed public SDK, including a page deliberately echoing its input into text, console and the URL.
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, writeFile, readdir } from "node:fs/promises";

export async function checkSecretInput(app) {
  const secret = "Synthetic-private-value-42";
  let entered = false;
  const server = createServer((req, res) => {
    if (req.method === "POST") {
      let body = "";
      req.on("data", (part) => { body += part; });
      req.on("end", () => { entered = body === secret; res.end("ok"); });
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    const focusMutation = req.url === "/focus-mutation";
    res.end(`<label>Password<input type="password" id="pw"></label><output id="echo"></output><button id="send">Sign in</button>
      <script>const pw=document.getElementById('pw');pw.oninput=()=>{document.getElementById('echo').textContent=pw.value;
        console.log(pw.value);history.replaceState({},'', '?echo='+encodeURIComponent(pw.value));};
      ${focusMutation ? "pw.onfocus=()=>{pw.type='text';};" : ""}
      document.getElementById('send').onclick=()=>fetch('/login',{method:'POST',body:pw.value});</script>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let client;
  try {
    const req = createRequire(join(app.appDir, "package.json"));
    const { PyProcControlClient } = await import(pathToFileURL(req.resolve("pyproc/control")).href);
    const config = join(app.appDir, "secret-input.json");
    const recording = join(app.appDir, "recording.json");
    const memoryRoot = join(app.appDir, "secret-memory");
    await writeFile(config, JSON.stringify({ schemaVersion: 1, engine: { enabled: false },
      executionMemory: { enabled: true, root: memoryRoot }, browser: {
      enabled: true, allowedOrigins: [origin], actions: ["snapshot", "fill", "click", "screenshot"], methods: [],
      maxRisk: "externalEffect", externalEffects: "acknowledged", purpose: "synthetic secret input probe",
      recording: { mode: "record", file: recording, overwrite: true } } }));
    client = await PyProcControlClient.start(config, { command: [process.execPath,
      join(app.appDir, "node_modules/pyproc/scripts/pyprocControl.mjs")] });
    const opened = await client.openTarget(origin, { expectedRisk: "externalEffect", waitUntil: "load" });
    const session = (await client.attachSession(opened.output.targetRef)).output;
    const observation = await client.observe(session, { expectedRisk: "read" });
    const find = (value) => {
      if (value && typeof value === "object") {
        if (value.name === "Password" && value.locatorRef && value.role === "textbox") return value.locatorRef;
        for (const child of Object.values(value)) { const result = find(child); if (result) return result; }
      }
      return null;
    };
    const locatorRef = find(observation.output);
    assert.ok(locatorRef, "password field is observed");
    const binding = { value: secret, locatorRef, origin, field: "password" };
    await assert.rejects(client.bindSecret(session, { ...binding, origin: "https://wrong.example" }));
    const other = await client.openTarget(origin, { expectedRisk: "externalEffect", waitUntil: "load" });
    const otherSession = (await client.attachSession(other.output.targetRef)).output;
    const wrongSessionBinding = await client.bindSecret(session, binding);
    const wrongSessionAction = { kind: "fill", expectedRisk: "externalEffect", locatorRef, secretRef: wrongSessionBinding.output.secretRef };
    await assert.rejects(client.act(otherSession, [wrongSessionAction]));
    await assert.rejects(client.act(session, [wrongSessionAction]), "a refused attempt consumes its binding");
    const bound = await client.bindSecret(session, binding);
    const action = { kind: "fill", expectedRisk: "externalEffect", locatorRef, secretRef: bound.output.secretRef };
    const filled = await client.act(session, [action]);
    const observed = await client.observe(session, { expectedRisk: "read", includeConsole: true, includeNetwork: true });
    assert.equal(JSON.stringify([bound, filled, observed]).includes(secret), false, "responses do not echo secret");
    await assert.rejects(client.act(session, [action]));
    await assert.rejects(client.act(session, [{ kind: "screenshot", expectedRisk: "read" }]));
    await assert.rejects(client.act(session, [{ kind: "click", selector: "#send", download: true, expectedRisk: "externalEffect" }]));
    assert.equal(entered, false, "binary download refusal precedes the click");
    await client.act(session, [{ kind: "click", selector: "#send", expectedRisk: "externalEffect" }]);
    assert.equal(entered, true, "real input reaches the login form");
    const project = { workspaceId: "workspace:secret", commit: "commit:secret", treeSha256: `sha256:${"1".repeat(64)}`,
      diffSha256: `sha256:${"2".repeat(64)}`, untracked: false };
    const memory = await client.createExecutionSession("session:secret", project);
    const situation = await client.perception(session).situate({ requirements: [{ requirementRef: "requirement:login",
      select: { role: "button", name: "Sign in" }, need: ["fact"], cardinality: "one" }] });
    const cursor = (await client.inspectSpace()).output.recording;
    await client.checkpointExecutionSession("session:secret", memory.output.contentSha256, {
      state: "active", branch: "browser:secret", checkpoint: "checkpoint:secret", outcomeUnknown: false, pendingIntentSha256: null,
    }, { browser: { situation: situation.situation, cursor: cursor.entries, prefixSha256: cursor.prefixSha256 } });
    const changed = await client.openTarget(`${origin}/focus-mutation`, { expectedRisk: "externalEffect", waitUntil: "load" });
    const changedSession = (await client.attachSession(changed.output.targetRef)).output;
    const changedLocator = find((await client.observe(changedSession, { expectedRisk: "read" })).output);
    const changedBinding = await client.bindSecret(changedSession, { ...binding, locatorRef: changedLocator });
    await assert.rejects(client.act(changedSession, [{ ...action, locatorRef: changedLocator, secretRef: changedBinding.output.secretRef }]));
    await client.act(changedSession, [{ kind: "click", selector: "#send", expectedRisk: "externalEffect" }]);
    assert.equal(entered, false, "focus-time field replacement never receives the value");
    await client.close();
    assert.equal((await readFile(recording, "utf8")).includes(secret), false, "recording contains no secret");
    async function inspectFiles(folder) {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) await inspectFiles(path);
        else assert.equal((await readFile(path)).includes(Buffer.from(secret)), false, "Execution Memory contains no secret");
      }
    }
    await inspectFiles(memoryRoot);
    console.log("PASS secret input, origin/session/field refusal, echo redaction, one use, recording and Execution Memory");
  } finally {
    await client?.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}
