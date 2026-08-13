import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { DelegatedTabAuthority } from "../../scripts/actuation/delegatedTab/delegatedTabAuthority.js";

async function errorOf(operation) {
  try { await operation(); return null; } catch (error) { return error; }
}

export async function assertDelegatedTabContract() {
  let id = 0;
  const authority = new DelegatedTabAuthority({ now: () => 1000 + id,
    idFactory: () => `delegated_${++id}` });
  const bootstrapCapability = "B".repeat(48);
  const host = { tabId: 3, url: "http://127.0.0.1:43121/control", bootstrapCapability };
  const target = { tabId: 8, url: "https://signed-in.example/work" };
  assert.equal((await errorOf(() => authority.authorize({ ...target, operation: "observe",
    bootstrapCapability, leaseRef: "delegatedTabLease:none", tabEpoch: 1 })))?.code,
  "DELEGATED_AUTHORITY_REVOKED");
  assert.equal(authority.requestHost(host).state, "awaitingHostGesture");
  assert.equal((await errorOf(() => authority.grantGesture(target)))?.code, "DELEGATED_GESTURE_INVALID");
  assert.equal(authority.grantGesture(host).state, "hostBound");
  const lease = authority.grantGesture(target);
  const granted = authority.authorize({ ...target, operation: "observe", bootstrapCapability,
    leaseRef: lease.leaseRef, tabEpoch: lease.tabEpoch });
  assert.equal(granted.authoritySha256, lease.authoritySha256);
  authority.navigation({ tabId: target.tabId, url: "https://signed-in.example/next" });
  const sameOrigin = authority.inspect().target;
  assert.equal(sameOrigin.tabEpoch, lease.tabEpoch + 1);
  assert.equal((await errorOf(() => authority.authorize({ ...target, operation: "observe",
    bootstrapCapability, leaseRef: lease.leaseRef, tabEpoch: lease.tabEpoch })))?.code,
  "DELEGATED_AUTHORITY_REVOKED");
  authority.authorize({ ...target, url: "https://signed-in.example/next", operation: "observe",
    bootstrapCapability, leaseRef: sameOrigin.leaseRef, tabEpoch: sameOrigin.tabEpoch });
  assert.equal((await errorOf(() => authority.authorize({ ...target, operation: "rawCommand",
    bootstrapCapability, leaseRef: sameOrigin.leaseRef, tabEpoch: sameOrigin.tabEpoch })))?.code,
  "DELEGATED_AUTHORITY_REVOKED");
  authority.navigation({ tabId: target.tabId, url: "https://other.example/work" });
  assert.equal((await errorOf(() => authority.authorize({ ...target, operation: "act",
    bootstrapCapability, leaseRef: lease.leaseRef, tabEpoch: lease.tabEpoch })))?.code,
  "DELEGATED_AUTHORITY_REVOKED");
  const next = authority.grantGesture(target);
  authority.closeTab(host.tabId);
  assert.equal((await errorOf(() => authority.authorize({ ...target, operation: "act",
    bootstrapCapability, leaseRef: next.leaseRef, tabEpoch: next.tabEpoch })))?.code,
  "DELEGATED_AUTHORITY_REVOKED");

  const extensionRoot = new URL("../../scripts/actuation/delegatedTab/extension/", import.meta.url);
  const packageManifest = JSON.parse(await readFile(
    new URL("../../package.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("manifest.json", extensionRoot), "utf8"));
  const worker = await readFile(new URL("serviceWorker.js", extensionRoot), "utf8");
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, packageManifest.version);
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "scripting"]);
  assert.equal(Object.hasOwn(manifest, "host_permissions"), false);
  assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);
  assert.equal(manifest.permissions.includes("debugger"), false);
  assert.equal(/chrome\.debugger|chrome\.nativeMessaging|WebSocket|fetch\s*\(/.test(worker), false);
  assert.equal(worker.includes("chrome.action.onClicked"), true);
  assert.equal(worker.includes("chrome.tabs.onUpdated") && worker.includes("chrome.tabs.onRemoved"), true);
  assert.equal(worker.includes("DELEGATED_AUTHORITY_REVOKED"), true);
}
