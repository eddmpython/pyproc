// perceptionReuseProduct.mjs - warm situate through the public Control client. On an unchanged page of 3,000 buttons a
// situate after the first answers from the last full capture (its evidence, the DOM snapshot, layout metrics, focus
// moves and document, is unchanged): warm P95 at most 150 ms. It never answers stale: after each kind of change a DOM
// mutation observer misses (a value or checked property set by script, text inside an open or a closed shadow root, a
// style rule), and after text, focus, and scroll changes, the next situate reads the page again and shows the change.
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
const page = `<!doctype html><title>reuse</title><style id="rules"></style>
<main><input id="field" aria-label="Field" value="before"><input id="box" type="checkbox" aria-label="Box">
<div id="open"></div><div id="closed"></div><p id="gone">Going away</p>${buttons}</main><script>
document.getElementById("open").attachShadow({ mode: "open" }).innerHTML = "<button>open inside</button>";
window.closedRoot = document.getElementById("closed").attachShadow({ mode: "closed" });
window.closedRoot.innerHTML = "<button>closed inside</button>";
</script>`;
const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(page);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const work = await mkdtemp(join(tmpdir(), "pyproc-perception-reuse-"));
const configPath = join(work, "manifest.json");
await writeFile(configPath, JSON.stringify({ schemaVersion: 1, engine: { enabled: false }, timeoutMs: TIMEOUT_MS,
  browser: { enabled: true, allowedOrigins: [origin], maxRisk: "externalEffect", externalEffects: "acknowledged",
    actions: ["snapshot"], methods: ["Runtime.evaluate"], purpose: "Verify warm situate reuse", artifacts: {},
    ...(executable ? { executable } : {}) } }, null, 2));

let client = null;
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(q * values.length))];
try {
  client = await PyProcControlClient.start(configPath, { command: [process.execPath, join(ROOT, "scripts",
    "pyprocControl.mjs")], cwd: ROOT, startupTimeoutMs: TIMEOUT_MS, shutdownTimeoutMs: 10000 });
  const target = (await client.openTarget(`${origin}/`, { expectedRisk: "externalEffect", waitUntil: "load" })).output;
  const session = (await client.attachSession(target.targetRef)).output;
  const perception = client.perception(session);
  const situate = (select, need = ["fact"]) => perception.situate({ requirements: [{ requirementRef: "requirement:gate",
    select, need, cardinality: "one" }] }, { visual: { mode: "off" } });
  const reused = async () => (await client.inspectSpace()).output.perception.reusedObservations;
  const run = (expression) => client.command(session, "Runtime.evaluate", { expression, returnByValue: true },
    { expectedRisk: "externalEffect" });
  // The facts the situation states about the one entity it found, by predicate (null when it found none).
  const factOf = (result) => {
    const situation = result?.situation || {};
    const entityRef = situation.requirements?.[0]?.entityRefs?.[0];
    if (!entityRef) return null;
    return Object.fromEntries((situation.facts || []).filter((fact) => fact.subjectRef === entityRef)
      .map((fact) => [fact.predicate, fact.value]));
  };

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

  // Never stale: each change is read, whatever a mutation observer would have seen.
  const changes = [
    ["text", "document.querySelectorAll('button')[7].textContent = 'renamed row'",
      () => situate({ role: "button", name: "renamed row" }), (facts) => facts?.["semantic.role"] === "button"],
    // A situation states no field values; the graph observation (the same capture, the same reuse) does.
    ["value set by script", "document.getElementById('field').value = 'after'",
      () => client.observe(session, { expectedRisk: "read", representation: "apx.graph",
        query: { role: "textbox", name: "Field" } }).then((result) => ({ situation: { requirements: [{ entityRefs:
          ["field"] }], facts: [{ subjectRef: "field", predicate: "semantic.value",
          value: result.output.entities?.[0]?.semantic?.value }] } })),
      (facts) => facts?.["semantic.value"] === "after"],
    ["checked set by script", "document.getElementById('box').checked = true",
      () => situate({ role: "checkbox", name: "Box" }), (facts) => [true, "true"].includes(facts?.["semantic.state.checked"])],
    ["open shadow root", "document.getElementById('open').shadowRoot.querySelector('button').textContent = 'open changed'",
      () => situate({ role: "button", name: "open changed" }), (facts) => facts !== null],
    ["closed shadow root", "window.closedRoot.querySelector('button').textContent = 'closed changed'",
      () => situate({ role: "button", name: "closed changed" }), (facts) => facts !== null],
    ["style rule", "document.getElementById('rules').sheet.insertRule('#gone { display: none }', 0)",
      () => situate({ role: "paragraph", name: "Going away" }), (facts) => facts === null
        || facts["geometry.visible"] === false],
    ["focus", "document.getElementById('field').focus()",
      () => situate({ role: "textbox", name: "Field" }), (facts) => facts?.["semantic.state.focused"] === true],
    // Out of the viewport, the first row is no longer actionable as it was before the scroll.
    ["scroll", "window.scrollTo(0, 5000)",
      () => situate({ role: "button", name: "row 0" }), (facts) => facts?.["interaction.actionable"] === false],
  ];
  for (const [label, expression, read, holds] of changes) {
    await situate({ role: "button", name: "row 1" });
    const before = await reused();
    await run(expression);
    const facts = factOf(await read().catch(() => null));
    const after = await reused();
    check(`a change (${label}) is read, never answered from the last capture`, after === before && holds(facts),
      JSON.stringify({ reusedBefore: before, reusedAfter: after, facts }).slice(0, 500));
  }
} catch (error) {
  check("perception reuse gate has no exception", false, String(error?.stack || error).slice(-1600));
} finally {
  if (client) await client.close().catch(() => {});
  server.close();
  await rm(work, { recursive: true, force: true });
}
console.log(`\n결과: ${failed ? "RED" : "GREEN"} (${passed}/${passed + failed})`);
process.exit(failed ? 1 : 0);
