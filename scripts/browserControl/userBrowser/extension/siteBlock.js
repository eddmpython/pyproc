// siteBlock.js - the hosts and domains a task never reaches, refused by this browser before any request is sent.
//
// While a task that blocks sites runs, the extension holds one set of declarativeNetRequest session rules over the
// whole profile: every tab, popup, frame, worker, and service worker, the user's own tabs included. A request whose
// address names a blocked host, or a host that is a blocked domain or lies under one, is refused before it leaves the
// browser, whatever it is: a navigation, each hop of a redirect, a subresource, a frame, a ping or beacon, a socket.
// The rules are not limited to the task's tabs, because a tab or worker a task page starts makes its first request
// before the extension could learn its id. Session rules end with the browser session, so a crash never leaves them
// past a restart; the extension also removes them when its task ends, its control host goes, a new control host
// connects, or its service worker starts again.
//
// While the rules are held, the profile's network prediction is off (the isolated browser starts with preloading off
// for the same reason): a navigation the rules refuse then opens no connection to the blocked host either, where
// prediction would open one (a TCP or TLS handshake, never a request) as the navigation starts. A profile where another
// extension or a policy keeps prediction on gets no rules at all: its task would still open connections to the blocked
// sites, so it does not start. Releasing the rules gives the setting back to the user.
//
// A blocked host is exact (`link.example.com` covers no other host); a blocked domain covers itself and every host
// under it (`example.com` covers `www.example.com`, never `notexample.com`). The browser hands rules the canonical
// address (lowercase, punycode, credentials before an `@`, a port), and a trailing dot names the same host, so each
// name becomes one anchored pattern on the address's host.

export const SITE_BLOCK_MAX = 64;
export const SITE_BLOCK_FIRST_RULE = 1000;
// Every request type the browser lets rules match. A block rule that names none skips main_frame, so all are named.
export const BLOCKED_RESOURCE_TYPES = Object.freeze(["main_frame", "sub_frame", "stylesheet", "script", "image",
  "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport", "webbundle",
  "other"]);
const LABEL = "(?!-)[a-z0-9-]{1,63}(?<!-)";
const HOST_NAME = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);

// The names one list holds: lowercase ASCII host names (the caller writes IDN in punycode), each once.
export function siteNames(values, field) {
  if (!Array.isArray(values)) throw new TypeError(`${field} must be a list of host names`);
  const names = [];
  for (const value of values) {
    const name = typeof value === "string" ? value.trim().replace(/\.$/, "").toLowerCase() : "";
    if (name.length > 253 || !HOST_NAME.test(name)) {
      throw new TypeError(`${field} entry must be one host name: ${JSON.stringify(value)}`);
    }
    if (!names.includes(name)) names.push(name);
  }
  if (names.length > SITE_BLOCK_MAX) throw new TypeError(`at most ${SITE_BLOCK_MAX} ${field}`);
  return Object.freeze(names);
}

// The address pattern of one name: scheme, optional credentials, then (for a domain) any hosts under it, the name,
// an optional trailing dot, an optional port, and the end of the authority.
export function sitePattern(name, { domain = false } = {}) {
  const host = name.replace(/\./g, "\\.");
  return `^[a-z][a-z0-9+.-]*://(?:[^/?#]*@)?${domain ? "(?:[^/?#@]*\\.)?" : ""}${host}\\.?(?::[0-9]*)?(?:[/?#]|$)`;
}

export function siteBlockRules({ hosts = [], domains = [] } = {}) {
  const exact = siteNames(hosts, "blockedHosts");
  const under = siteNames(domains, "blockedDomains");
  if (!exact.length && !under.length) throw new TypeError("site blocking needs a blocked host or domain");
  const named = [...exact.map((name) => [name, false]), ...under.map((name) => [name, true])];
  return named.map(([name, domain], index) => Object.freeze({
    id: SITE_BLOCK_FIRST_RULE + index,
    priority: 1,
    action: Object.freeze({ type: "block" }),
    condition: Object.freeze({ regexFilter: sitePattern(name, { domain }), isUrlFilterCaseSensitive: false,
      resourceTypes: BLOCKED_RESOURCE_TYPES }),
  }));
}

// Replace this extension's session rules with the task's, then read them back: the answer says the extension enforces
// them only when network prediction is off and every rule is in place as written. `api` is `{ dnr:
// chrome.declarativeNetRequest, prediction: chrome.privacy.network.networkPredictionEnabled }`.
export async function blockSites({ dnr, prediction }, { hosts = [], domains = [] } = {}) {
  const rules = siteBlockRules({ hosts, domains });
  for (const rule of rules) {
    const supported = await dnr.isRegexSupported({ regex: rule.condition.regexFilter, isCaseSensitive: false });
    if (!supported?.isSupported) throw new Error(`the browser cannot match ${rule.condition.regexFilter}`);
  }
  await prediction.set({ value: false });
  const predicting = await prediction.get({});
  if (predicting?.value !== false) {
    await unblockSites({ dnr, prediction });
    throw new Error("another extension or a policy keeps the browser's network prediction (page preloading) on, so a "
      + "refused navigation would still open a connection to the blocked site");
  }
  const before = await dnr.getSessionRules();
  await dnr.updateSessionRules({ removeRuleIds: before.map((rule) => rule.id), addRules: rules });
  const installed = new Map((await dnr.getSessionRules()).map((rule) => [rule.id, rule]));
  const missing = rules.filter((rule) => installed.get(rule.id)?.condition?.regexFilter !== rule.condition.regexFilter
    || installed.get(rule.id)?.action?.type !== "block");
  if (missing.length || installed.size !== rules.length) {
    await unblockSites({ dnr, prediction });
    throw new Error("the browser did not keep the site rules");
  }
  return Object.freeze({ enforcedBy: "extension", blockedHosts: siteNames(hosts, "blockedHosts"),
    blockedDomains: siteNames(domains, "blockedDomains"), rules: rules.length, preloading: "off" });
}

// Remove every session rule of this extension (it holds no others) and give network prediction back; true when no rule
// is left.
export async function unblockSites({ dnr, prediction }) {
  const held = await dnr.getSessionRules();
  if (held.length) await dnr.updateSessionRules({ removeRuleIds: held.map((rule) => rule.id) });
  await prediction.clear({});
  return (await dnr.getSessionRules()).length === 0;
}
