import assert from "node:assert/strict";
import { appIdentity, canonicalJson, digest, PairedGenerationPrototype, stateEnvelope }
  from "./appTransactionPrototype.mjs";

let checks = 0;
const rejects = async (operation, pattern) => {
  await assert.rejects(Promise.resolve().then(operation), pattern);
  checks += 1;
};
const identity = appIdentity({ appId: "com.example.erp", origin: "https://app.example.test",
  adapterVersion: "1", stateSchema: "erp-state/3" });
assert.equal(identity.appId, "com.example.erp"); checks += 1;
await rejects(() => appIdentity({ ...identity, origin: "https://forged.example/path" }), /origin/);
assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 })); checks += 1;
await rejects(() => canonicalJson({ cookie: "private" }), /forbidden/);
await rejects(() => canonicalJson({ nested: { javascriptHeap: {} } }), /forbidden/);

const app = stateEnvelope({ identity, revision: "apprev:1", state: {
  route: "/invoice/7", form: { amount: 42 }, domain: { invoice: 7 }, records: [{ id: 7 }],
}, outbox: [{ intentSha256: "1".repeat(64), state: "staged" }] });
assert.equal(app.stateSha256, digest(app.state)); checks += 1;
assert.equal(app.outbox[0].state, "staged"); checks += 1;
await rejects(() => stateEnvelope({ identity, revision: "apprev:2", state: { secret: "leak" } }), /forbidden/);

const store = new PairedGenerationPrototype();
const machine = { imageSha256: "2".repeat(64), generation: `sha256:${"3".repeat(64)}` };
store.prepare({ pairId: "pair:base", app: { identity, revision: "apprev:1", state: app.state,
  outbox: app.outbox }, machine });
assert.equal(store.recover(), null); checks += 1;
await rejects(() => store.publish("pair:base", { expectedAppRevision: "apprev:stale" }), /stale/);
store.publish("pair:base", { expectedAppRevision: "apprev:1" });
assert.equal(store.recover().candidate.app.state.form.amount, 42); checks += 1;

const left = store.branch("pair:base", "pair:left", { revision: "apprev:left", state: {
  ...app.state, form: { amount: 10 },
} });
const right = store.branch("pair:base", "pair:right", { revision: "apprev:right", state: {
  ...app.state, form: { amount: 99 },
} });
store.publish("pair:left", { expectedAppRevision: "apprev:left" });
assert.equal(left.app.state.form.amount, 10); checks += 1;
assert.equal(right.app.state.form.amount, 99); checks += 1;
assert.equal(app.state.form.amount, 42); checks += 1;
await rejects(() => store.publish("pair:right", { expectedAppRevision: "apprev:right" }), /HEAD changed/);
await rejects(() => store.prepare({ pairId: "pair:bad", app: { identity, revision: "apprev:bad",
  state: {} }, machine: { imageSha256: "bad", generation: "bad" } }), /machine/);

console.log(`transactional AppSpace prototype: GREEN (${checks} checks)`);
