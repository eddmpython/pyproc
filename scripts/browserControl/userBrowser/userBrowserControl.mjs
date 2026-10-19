// userBrowserControl.mjs - a broker over the paired extension of the user's own browser, with the same port, policy,
// and automation contract as a browser pyproc launched. Only the target lifecycle differs: tabs of the task window.
// A session that blocks hosts or domains asks the extension for its request rules before the first tab opens, and
// starts nothing when the extension does not hold them.
import { BrowserControlError, BrowserControlPort, BROWSER_CONTROL_ERROR_CODES } from "../browserControlPort.js";
import { BrowserControlPolicy } from "../browserControlPolicy.js";
import { assertBrowserCompatibility } from "../browserCompatibility.js";
import { NodeBrowserControlBroker } from "../browserControlBroker.mjs";
import { ExtensionSiteGuard, assertBrowserRequestScope, normalizeBlockedDomains, normalizeBlockedHosts }
  from "../requestGuard.mjs";
import { siteBlockRules } from "./extension/siteBlock.js";
import { openUserBrowserConnection } from "./userBrowserChannel.mjs";
import { UserBrowserTransport } from "./userBrowserTransport.js";

/** The task window's tab lifecycle, in the shape the broker opens targets with. */
export function userBrowserTargets(connection) {
  return Object.freeze({
    kind: "user-browser",
    create: async (url) => (await connection.send("PyprocUserBrowser.openTab", { url })).targetId,
    attach: async (targetId) => (await connection.send("PyprocUserBrowser.attachTab", { targetId })).sessionId,
    detach: (sessionId) => connection.send("PyprocUserBrowser.detachSession", { sessionId }),
    close: (targetId) => connection.send("PyprocUserBrowser.closeTab", { targetId }),
  });
}

const sameNames = (said, asked) => Array.isArray(said) && said.length === asked.length
  && asked.every((name) => said.includes(name));

/**
 * Have the paired extension hold request rules over the whole profile for `hosts` and `domains`, before any tab of the
 * task opens, and return the guard that reports what they refuse. The extension must say it can (`capabilities` from
 * its hello), install them, and answer that it enforces exactly these lists with network prediction off (a refused
 * navigation then opens no connection either); anything else is USER_BROWSER_SITE_BLOCKING_UNAVAILABLE, and the caller
 * starts nothing.
 */
export async function blockUserBrowserSites(connection, { hosts, domains, capabilities = [] }) {
  const unavailable = (message, cause = undefined) => new BrowserControlError(
    BROWSER_CONTROL_ERROR_CODES.userBrowserSiteBlockingUnavailable, message, cause ? { cause } : {});
  if (!capabilities.includes("blockSites")) {
    throw unavailable("the paired User Browser extension does not block sites; it is older than this pyproc, so reload "
      + "it from the installed extension folder");
  }
  let answer;
  try {
    answer = await connection.send("PyprocUserBrowser.blockSites", { hosts, domains });
  } catch (error) {
    throw unavailable(`the paired User Browser extension did not block the sites: ${error?.message || error}`, error);
  }
  if (answer?.enforcedBy !== "extension" || !sameNames(answer.blockedHosts, hosts)
    || !sameNames(answer.blockedDomains, domains)) {
    throw unavailable("the paired User Browser extension did not confirm every blocked host and domain");
  }
  if (answer.preloading !== "off") {
    throw unavailable("the paired User Browser extension did not turn the browser's network prediction (page "
      + "preloading) off; another extension or a policy may keep it on");
  }
  return new ExtensionSiteGuard(connection, { blockedHosts: hosts, blockedDomains: domains,
    preloading: answer.preloading });
}

/**
 * The broker over an authenticated extension connection (`openUserBrowserConnection`'s answer). It owns the
 * connection from here on and closes it when it cannot start.
 */
export async function userBrowserBroker({ connection, product, protocolVersion, capabilities = [] }, {
  policy, timeoutMs, viewport = null, blockedHosts = [], blockedDomains = [], holdOutside = false,
}) {
  let guard = null;
  try {
    const compatibility = assertBrowserCompatibility({ protocolVersion, product });
    // Before the first tab, so no request of the task is ever sent without the rules.
    if (blockedHosts.length || blockedDomains.length) {
      guard = await blockUserBrowserSites(connection, { hosts: blockedHosts, domains: blockedDomains, capabilities });
    }
    const port = new BrowserControlPort({
      transport: new UserBrowserTransport(connection, { watchRequests: guard !== null }), policy });
    return new NodeBrowserControlBroker({ connection, port, compatibility, timeoutMs, viewport, guard,
      targets: userBrowserTargets(connection), holdOutside });
  } catch (error) {
    guard?.close();
    connection.close();
    throw error;
  }
}

export async function connectUserBrowserControl({
  browser,
  profileId = "",
  targetOrigins,
  methods,
  events = [],
  fileRoots = [],
  downloadRoot = null,
  maxRisk = "read",
  timeoutMs = 30000,
  viewport = null,
  requests = "any",
  blockedHosts = [],
  blockedDomains = [],
  holdOutside = false,
  env = process.env,
} = {}) {
  assertBrowserRequestScope({ requests, targetOrigins });
  if (requests !== "any") throw new TypeError("a user browser session cannot be read-only");
  const hosts = normalizeBlockedHosts(blockedHosts);
  const domains = normalizeBlockedDomains(blockedDomains);
  // The extension's rules take each name as host labels of letters, digits, and hyphens: a name they would refuse is
  // refused here, before the browser is reached.
  if (hosts.length || domains.length) siteBlockRules({ hosts, domains });
  const policy = new BrowserControlPolicy({ targetOrigins, methods, events, fileRoots, downloadRoot, maxRisk });
  return userBrowserBroker(await openUserBrowserConnection({ browser, profileId, timeoutMs, env }),
    { policy, timeoutMs, viewport, blockedHosts: hosts, blockedDomains: domains, holdOutside });
}
