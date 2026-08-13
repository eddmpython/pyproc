// serviceWorker.js - activeTab delegation with two explicit action gestures and no standing host permission.
const pendingHosts = new Map();
const locators = new Map();
let host = null;
let lease = null;
let tabEpoch = 0;
let leaseRevision = 0;

function exactOrigin(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch (error) { return null; }
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((entry) => entry.toString(16).padStart(2, "0")).join("");
}

function publicLease() {
  return lease ? { leaseRef: lease.leaseRef, origin: lease.origin, tabEpoch: lease.tabEpoch,
    authoritySha256: lease.authoritySha256 } : null;
}

function revokeTarget() {
  leaseRevision += 1;
  lease = null;
  locators.clear();
  void chrome.action.setBadgeText({ text: "" });
}

async function bindOrGrant(tab) {
  const origin = exactOrigin(tab.url);
  const pending = pendingHosts.get(tab.id);
  if (!host && pending?.origin === origin) {
    host = { ...pending, boundAt: Date.now() };
    pendingHosts.clear();
    await chrome.action.setBadgeText({ tabId: tab.id, text: "HOST" });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#245d42" });
    return;
  }
  if (!host || tab.id === host.tabId || !origin || origin.startsWith("http://127.0.0.1:")) return;
  const probe = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({
    origin: location.origin, title: document.title.slice(0, 300), readyState: document.readyState,
  }) });
  if (probe.length !== 1 || probe[0].result?.origin !== origin) return;
  tabEpoch += 1;
  leaseRevision += 1;
  const leaseRef = `delegatedTabLease:${crypto.randomUUID()}`;
  lease = { leaseRef, tabId: tab.id, origin, tabEpoch,
    authoritySha256: await sha256(JSON.stringify({ hostOrigin: host.origin, targetOrigin: origin,
      tabEpoch, requestRef: host.requestRef })) };
  locators.clear();
  await chrome.action.setBadgeText({ tabId: tab.id, text: "ON" });
  await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#245d42" });
}

function implicitRole(element) {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a" && element.hasAttribute("href")) return "link";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    const type = (element.getAttribute("type") || "text").toLowerCase();
    if (["button", "submit", "reset"].includes(type)) return "button";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    return "textbox";
  }
  return null;
}

function capturePage(maxEntities) {
  const elements = [...document.querySelectorAll("button,a[href],input,select,textarea,[role],[tabindex]")];
  const rows = [];
  for (const element of elements.slice(0, maxEntities)) {
    const path = [];
    let current = element;
    while (current && current !== document.documentElement) {
      const parent = current.parentElement;
      if (!parent) break;
      path.push([...parent.children].indexOf(current));
      current = parent;
    }
    const rect = element.getBoundingClientRect();
    const role = implicitRole(element);
    const name = String(element.getAttribute("aria-label") || element.getAttribute("title")
      || element.innerText || element.value || "").trim().replace(/\s+/g, " ").slice(0, 300);
    rows.push({ path: path.reverse(), fingerprint: { tag: element.tagName, role, name }, entity: {
      role, name, disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
      checked: "checked" in element ? Boolean(element.checked) : null,
      selected: element.getAttribute("aria-selected") === "true",
      expanded: element.getAttribute("aria-expanded") === "true",
      actionable: rect.width > 0 && rect.height > 0,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    } });
  }
  return { origin: location.origin, title: document.title.slice(0, 300), rows,
    truncated: elements.length > rows.length, omitted: Math.max(0, elements.length - rows.length) };
}

function actuatePage(path, fingerprint, action, value) {
  let element = document.documentElement;
  for (const index of path) element = element?.children?.[index] || null;
  const role = implicitRole(element);
  const name = String(element?.getAttribute?.("aria-label") || element?.getAttribute?.("title")
    || element?.innerText || element?.value || "").trim().replace(/\s+/g, " ").slice(0, 300);
  if (!element || element.tagName !== fingerprint.tag || role !== fingerprint.role || name !== fingerprint.name) {
    return { state: "stale", effectOutcome: "notSent" };
  }
  if (action === "click") element.click();
  else if (action === "focus") element.focus();
  else if (action === "fill" && (typeof value === "string" || typeof value === "number")) {
    element.focus(); element.value = String(value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (action === "check" || action === "uncheck") {
    const desired = action === "check";
    if (Boolean(element.checked) !== desired) element.click();
  } else if (action === "scroll") element.scrollIntoView({ block: "center", inline: "nearest" });
  else return { state: "unsupported", effectOutcome: "notSent" };
  return { state: "sent", effectOutcome: "applied", role, name };
}

async function authorize(message, sender, operation) {
  const senderOrigin = exactOrigin(sender.url);
  if (!host || sender.tab?.id !== host.tabId || senderOrigin !== host.origin
    || await sha256(String(message.bootstrapCapability || "")) !== host.capabilitySha256
    || !lease || message.leaseRef !== lease.leaseRef || message.tabEpoch !== lease.tabEpoch
    || !["observe", "act"].includes(operation)) throw new Error("DELEGATED_AUTHORITY_REVOKED");
}

async function externalMessage(message, sender) {
  if (message?.protocol !== "pyproc.delegatedTab" || message.version !== 1) {
    throw new Error("DELEGATED_MESSAGE_INVALID");
  }
  const senderOrigin = exactOrigin(sender.url);
  if (message.operation === "host.request") {
    if (!Number.isInteger(sender.tab?.id) || !senderOrigin?.startsWith("http://127.0.0.1:")
      || !/^[A-Za-z0-9_-]{32,256}$/.test(message.bootstrapCapability || "")) {
      throw new Error("DELEGATED_HOST_INVALID");
    }
    const requestRef = `delegationRequest:${crypto.randomUUID()}`;
    pendingHosts.set(sender.tab.id, { requestRef, tabId: sender.tab.id, origin: senderOrigin,
      capabilitySha256: await sha256(message.bootstrapCapability), requestedAt: Date.now() });
    const commands = await chrome.commands.getAll();
    const actionShortcut = commands.find((entry) => entry.name === "_execute_action")?.shortcut || "";
    return { state: "awaitingHostGesture", requestRef, hostOrigin: senderOrigin, actionShortcut };
  }
  if (message.operation === "inspect") {
    if (!host || sender.tab?.id !== host.tabId || senderOrigin !== host.origin
      || await sha256(String(message.bootstrapCapability || "")) !== host.capabilitySha256) {
      throw new Error("DELEGATED_HOST_UNBOUND");
    }
    return { hostBound: true, target: publicLease() };
  }
  await authorize(message, sender, message.operation);
  if (message.operation === "observe") {
    const maxEntities = Number.isInteger(message.maxEntities)
      ? Math.max(1, Math.min(500, message.maxEntities)) : 120;
    const output = await chrome.scripting.executeScript({ target: { tabId: lease.tabId },
      func: capturePage, args: [maxEntities] });
    const capture = output[0]?.result;
    if (!capture || capture.origin !== lease.origin) { revokeTarget(); throw new Error("DELEGATED_TARGET_STALE"); }
    const entities = capture.rows.map((row) => {
      const entityRef = `entity:${crypto.randomUUID()}`;
      const locatorRef = `locator:${crypto.randomUUID()}`;
      locators.set(locatorRef, { path: row.path, fingerprint: row.fingerprint, entityRef,
        leaseRef: lease.leaseRef, tabEpoch: lease.tabEpoch });
      return { entityRef, locatorRef, ...row.entity };
    });
    return { origin: capture.origin, title: capture.title, entities,
      completeness: capture.truncated ? "truncated" : "complete", omitted: capture.omitted,
      lease: publicLease() };
  }
  const locator = locators.get(message.locatorRef);
  if (!locator || locator.leaseRef !== lease.leaseRef || locator.tabEpoch !== lease.tabEpoch) {
    throw new Error("DELEGATED_LOCATOR_STALE");
  }
  locators.delete(message.locatorRef);
  const output = await chrome.scripting.executeScript({ target: { tabId: lease.tabId }, func: actuatePage,
    args: [locator.path, locator.fingerprint, message.action, message.value] });
  const result = output[0]?.result;
  if (!result) throw new Error("DELEGATED_EFFECT_UNKNOWN");
  return { ...result, entityRef: locator.entityRef, lease: publicLease() };
}

chrome.action.onClicked.addListener((tab) => { void bindOrGrant(tab); });
chrome.commands.onCommand.addListener((command) => {
  if (command !== "_execute_action") return;
  void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab && bindOrGrant(tab));
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const origin = exactOrigin(changeInfo.url);
  if (lease?.tabId === tabId && lease.origin !== origin) revokeTarget();
  else if (lease?.tabId === tabId) {
    const previous = lease;
    revokeTarget();
    tabEpoch += 1;
    const nextEpoch = tabEpoch;
    const revision = leaseRevision;
    void sha256(JSON.stringify({ hostOrigin: host.origin, targetOrigin: origin,
      tabEpoch: nextEpoch, requestRef: host.requestRef })).then((authoritySha256) => {
      if (leaseRevision !== revision || lease || !host) return;
      lease = { ...previous, tabEpoch: nextEpoch, authoritySha256 };
    });
  }
  if (host?.tabId === tabId && host.origin !== origin) { host = null; revokeTarget(); }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  pendingHosts.delete(tabId);
  if (lease?.tabId === tabId) revokeTarget();
  if (host?.tabId === tabId) { host = null; revokeTarget(); }
});
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  externalMessage(message, sender).then((output) => sendResponse({ ok: true, output }),
    (error) => sendResponse({ ok: false, error: { code: String(error?.message || "DELEGATED_FAILED") } }));
  return true;
});
