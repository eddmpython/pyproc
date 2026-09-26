// perceptionReuseProduct.mjs - warm situate through the public Control client. On an unchanged page of 3,000 buttons a
// situate after the first answers from the last full capture (its evidence is unchanged): warm P95 at most 150 ms. It
// never answers stale. After each change the next situate reads the page again and shows it:
// - DOM text, and text inside an open shadow root;
// - a value, checked, or indeterminate state set by script, and a custom validity;
// - a style rule, CSS alt text and inertness from a constructed style sheet, generated content changed by CSSOM;
// - an ARIA element reference set as a property, and a custom element's ElementInternals name;
// - focus (also in a tab in the background, where no focus event fires);
// - a select's picker opened and closed with trusted input;
// - scroll, and a document rewritten with document.open.
// A page with a closed shadow root, and a page that changes all the time, are never answered from a capture.
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../packageHarness.mjs";
import { PyProcControlClient } from "../../scripts/controlProtocol/controlApi.js";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 120000);
const WARM_P95_MS = 150;
const executable = process.env.PYPROC_BROWSER || undefined;
let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) { passed += 1; console.log(`  PASS ${name}${detail ? ` (${detail})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`); }
}

const buttons = Array.from({ length: 3000 }, (_, index) => `<button>row ${index}</button>`).join("");
const pages = {
  "/": `<!doctype html><title>reuse</title><style id="rules"></style><style id="generated">p.gen::before { content: "AAA" }</style>
<main><input id="field" aria-label="Field" value="before"><input id="box" type="checkbox" aria-label="Box">
<input id="mixed" type="checkbox" aria-label="Mixed"><input id="validity" aria-label="Validity">
<select id="pick" aria-label="Pick"><option>a</option><option>b</option></select>
<span id="labelOne">Label one</span><span id="labelTwo">Label two</span><button id="labelled">unlabelled</button>
<button class="fav"></button><button id="inert">Inert me</button><button id="other">Other</button>
<div id="open"></div><x-state id="custom"></x-state><p id="gone">Going away</p><p class="gen">tail</p>${buttons}</main><script>
document.getElementById("open").attachShadow({ mode: "open" }).innerHTML = "<button>open inside</button>";
customElements.define("x-state", class extends HTMLElement {
  constructor() { super(); this.internals = this.attachInternals(); this.internals.role = "button";
    this.internals.ariaLabel = "Alpha"; this.tabIndex = 0; }
});
window.sheet = new CSSStyleSheet();
window.sheet.replaceSync('button.fav::before { content: "*" / "Favorite" }');
document.adoptedStyleSheets = [window.sheet];
document.getElementById("labelled").ariaLabelledByElements = [document.getElementById("labelOne")];
</script>`,
  "/closed": `<!doctype html><title>closed</title><main><div id="host"></div>
${buttons.slice(0, 2000)}</main><script>
window.closedRoot = document.getElementById("host").attachShadow({ mode: "closed" });
window.closedRoot.innerHTML = "<button>closed inside</button>";
</script>`,
  "/flip": `<!doctype html><title>flip</title><main><button id="flip">On</button>${buttons}</main><script>
setInterval(() => { const text = document.getElementById("flip").firstChild; text.data = text.data === "On" ? "Offline" : "On"; }, 23);
</script>`,
  "/second": "<!doctype html><title>second</title><p>second</p>",
};
const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(pages[req.url] || "");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const work = await mkdtemp(join(tmpdir(), "pyproc-perception-reuse-"));
const configPath = join(work, "manifest.json");
await writeFile(configPath, JSON.stringify({ schemaVersion: 1, engine: { enabled: false }, timeoutMs: TIMEOUT_MS,
  browser: { enabled: true, allowedOrigins: [origin], maxRisk: "externalEffect", externalEffects: "acknowledged",
    actions: ["snapshot", "click", "press"], methods: ["Runtime.evaluate"], purpose: "Verify warm situate reuse",
    artifacts: {}, ...(executable ? { executable } : {}) } }, null, 2));

let client = null;
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(q * values.length))];
try {
  client = await PyProcControlClient.start(configPath, { command: [process.execPath, join(ROOT, "scripts",
    "pyprocControl.mjs")], cwd: ROOT, startupTimeoutMs: TIMEOUT_MS, shutdownTimeoutMs: 10000 });
  const open = async (path) => {
    const target = (await client.openTarget(`${origin}${path}`, { expectedRisk: "externalEffect", waitUntil: "load" })).output;
    return (await client.attachSession(target.targetRef)).output;
  };
  const reused = async () => (await client.inspectSpace()).output.perception.reusedObservations;
  const tools = (session) => {
    const perception = client.perception(session);
    return {
      situate: (select, need = ["fact"]) => perception.situate({ requirements: [{ requirementRef: "requirement:gate",
        select, need, cardinality: "one" }] }, { visual: { mode: "off" } }),
      run: (expression) => client.command(session, "Runtime.evaluate", { expression, returnByValue: true },
        { expectedRisk: "externalEffect" }),
      act: (action) => client.act(session, [{ expectedRisk: "externalEffect", ...action }]),
    };
  };
  // The facts the situation states about the one entity it found, by predicate (null when it found none).
  const factOf = (result) => {
    const situation = result?.situation || {};
    const entityRef = situation.requirements?.[0]?.entityRefs?.[0];
    if (!entityRef) return null;
    return Object.fromEntries((situation.facts || []).filter((fact) => fact.subjectRef === entityRef)
      .map((fact) => [fact.predicate, fact.value]));
  };

  const session = await open("/");
  const { situate, run, act } = tools(session);

  // Warm: the first situate reads the page; the rest answer from it while nothing changes.
  const warm = [];
  for (let index = 0; index < 14; index += 1) {
    const started = performance.now();
    const situation = await situate({ role: "button", name: `row ${index * 200}` }, ["fact", "affordance"]);
    warm.push(performance.now() - started);
    if (!factOf(situation)) throw new Error(`row ${index * 200} was not found`);
  }
  const reusedWarm = await reused();
  const p95 = quantile(warm.slice(2), 0.95);
  check("an unchanged page is answered from the last capture after the first read", reusedWarm >= 12,
    `${reusedWarm} reused of ${warm.length}`);
  check(`warm situate on 3,000 buttons is at most ${WARM_P95_MS} ms at P95`, p95 <= WARM_P95_MS,
    `P95 ${Math.round(p95)} ms, P50 ${Math.round(quantile(warm.slice(2), 0.5))} ms, first ${Math.round(warm[0])} ms`);

  // Never stale: each change is read, whatever a DOM snapshot or a mutation observer would have seen.
  const graphValue = (name) => client.observe(session, { expectedRisk: "read", representation: "apx.graph",
    query: { role: "textbox", name } }).then((result) => ({ situation: { requirements: [{ entityRefs: ["field"] }],
    facts: [{ subjectRef: "field", predicate: "semantic.value", value: result.output.entities?.[0]?.semantic?.value }] } }));
  const changes = [
    ["text", "document.querySelectorAll('main > button')[20].textContent = 'renamed row'",
      () => situate({ role: "button", name: "renamed row" }), (facts) => facts?.["semantic.role"] === "button"],
    // A situation states no field values; the graph observation (the same capture, the same reuse) does.
    ["value set by script", "document.getElementById('field').value = 'after'", () => graphValue("Field"),
      (facts) => facts?.["semantic.value"] === "after"],
    ["checked set by script", "document.getElementById('box').checked = true",
      () => situate({ role: "checkbox", name: "Box" }), (facts) => [true, "true"].includes(facts?.["semantic.state.checked"])],
    ["indeterminate set by script", "document.getElementById('mixed').indeterminate = true",
      () => situate({ role: "checkbox", name: "Mixed" }), (facts) => facts?.["semantic.state.checked"] === "mixed"],
    ["custom validity", "document.getElementById('validity').setCustomValidity('bad')",
      () => situate({ role: "textbox", name: "Validity" }), (facts) => facts?.["semantic.state.invalid"] === true],
    ["element reference set as a property",
      "document.getElementById('labelled').ariaLabelledByElements = [document.getElementById('labelTwo')]",
      () => situate({ role: "button", name: "Label two" }), (facts) => facts !== null],
    ["ElementInternals name", "document.getElementById('custom').internals.ariaLabel = 'Beta'",
      () => situate({ role: "button", name: "Beta" }), (facts) => facts !== null],
    ["CSS alt text in a constructed sheet", "sheet.replaceSync('button.fav::before { content: \"*\" / \"Unfavorite\" }')",
      () => situate({ role: "button", name: "Unfavorite" }), (facts) => facts !== null],
    ["inertness in a constructed sheet",
      "sheet.replaceSync('button.fav::before { content: \"*\" / \"Unfavorite\" } #inert { interactivity: inert }')",
      () => situate({ role: "button", name: "Inert me" }, ["fact", "affordance"]),
      (facts) => facts === null || facts["interaction.actionable"] === false],
    // Chromium lists the inline text box of changed generated content twice; the page is still read, once per node.
    ["generated content changed by CSSOM", "document.getElementById('generated').sheet.cssRules[0].style.content = '\"BBB\"'",
      () => situate({ role: "StaticText", name: "BBB" }), (facts) => facts !== null],
    ["open shadow root", "document.getElementById('open').shadowRoot.querySelector('button').textContent = 'open changed'",
      () => situate({ role: "button", name: "open changed" }), (facts) => facts !== null],
    ["style rule", "document.getElementById('rules').sheet.insertRule('#gone { display: none }', 0)",
      () => situate({ role: "paragraph", name: "Going away" }), (facts) => facts === null
        || facts["geometry.visible"] === false],
    ["focus", "document.getElementById('field').focus()",
      () => situate({ role: "textbox", name: "Field" }), (facts) => facts?.["semantic.state.focused"] === true],
    // A select's picker is state no DOM change shows: opened by a trusted click, closed by a trusted Escape.
    ["select picker opened", () => act({ kind: "click", selector: "#pick" }),
      () => situate({ role: "combobox", name: "Pick" }), (facts) => facts?.["semantic.state.expanded"] === true],
    ["select picker closed", () => act({ kind: "press", key: "Escape" }),
      () => situate({ role: "combobox", name: "Pick" }), (facts) => facts?.["semantic.state.expanded"] === false],
    // Out of the viewport, the first row is no longer actionable as it was before the scroll.
    ["scroll", "window.scrollTo(0, 5000)",
      () => situate({ role: "button", name: "row 0" }), (facts) => facts?.["interaction.actionable"] === false],
  ];
  const settledOn = async (select) => {
    await situate(select);
    await situate(select);
    return reused();
  };
  for (const [label, change, read, holds] of changes) {
    const before = await settledOn({ role: "button", name: "row 1" });
    if (typeof change === "function") await change(); else await run(change);
    const facts = factOf(await read().catch(() => null));
    const after = await reused();
    check(`a change (${label}) is read, never answered from the last capture`, after === before && holds(facts),
      JSON.stringify({ reusedBefore: before, reusedAfter: after, facts }).slice(0, 500));
  }

  // Focus in a tab in the background moves without any focus event.
  const second = await open("/second");
  let before = await settledOn({ role: "button", name: "row 1" });
  await run("document.getElementById('other').focus()");
  let facts = factOf(await situate({ role: "button", name: "Other" }).catch(() => null));
  check("focus moved in a background tab is read", (await reused()) === before && facts?.["semantic.state.focused"] === true,
    JSON.stringify({ reusedBefore: before, facts }).slice(0, 400));
  await client.detachSession(second).catch(() => {});

  // A document rewritten in place keeps its context; its next focus change is read too.
  await run("document.open(); document.write('<button id=a>First</button><button id=b>Second</button>'); document.close()");
  facts = factOf(await situate({ role: "button", name: "First" }).catch(() => null));
  before = await settledOn({ role: "button", name: "First" });
  await run("document.getElementById('b').focus()");
  facts = factOf(await situate({ role: "button", name: "Second" }).catch(() => null));
  check("a focus change after document.open is read", (await reused()) === before && facts?.["semantic.state.focused"] === true,
    JSON.stringify({ reusedBefore: before, facts }).slice(0, 400));

  // A closed shadow root's states are out of reach: that page is always read in full, and its changes are read.
  const closed = tools(await open("/closed"));
  before = await reused();
  for (let index = 0; index < 4; index += 1) await closed.situate({ role: "button", name: "row 3" });
  await closed.run("window.closedRoot.querySelector('button').textContent = 'closed changed'");
  facts = factOf(await closed.situate({ role: "button", name: "closed changed" }).catch(() => null));
  check("a page with a closed shadow root is never answered from a capture", (await reused()) === before && facts !== null,
    JSON.stringify({ reusedBefore: before, facts }).slice(0, 300));

  // A page that changes all the time is never answered from a capture, whatever state it is in when read again.
  const flip = tools(await open("/flip"));
  before = await reused();
  for (let index = 0; index < 30; index += 1) {
    await flip.situate({ role: "button", name: index % 2 ? "On" : "Offline" }).catch(() => null);
  }
  check("a page that changes every 23 ms is never answered from a capture", (await reused()) === before,
    `${(await reused()) - before} reused of 30`);
} catch (error) {
  check("perception reuse gate has no exception", false, String(error?.stack || error).slice(-1600));
} finally {
  if (client) await client.close().catch(() => {});
  server.close();
  await rm(work, { recursive: true, force: true });
}
console.log(`\n결과: ${failed ? "RED" : "GREEN"} (${passed}/${passed + failed})`);
process.exit(failed ? 1 : 0);
