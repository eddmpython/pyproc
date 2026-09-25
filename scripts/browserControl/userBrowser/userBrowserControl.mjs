// userBrowserControl.mjs - a broker over the paired extension of the user's own browser, with the same port, policy,
// and automation contract as a browser pyproc launched. Only the target lifecycle differs: tabs of the task window.
import { BrowserControlPort } from "../browserControlPort.js";
import { BrowserControlPolicy } from "../browserControlPolicy.js";
import { assertBrowserCompatibility } from "../browserCompatibility.js";
import { NodeBrowserControlBroker } from "../browserControlBroker.mjs";
import { assertBrowserRequestScope } from "../requestGuard.mjs";
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

export async function connectUserBrowserControl({
  browser,
  targetOrigins,
  methods,
  events = [],
  fileRoots = [],
  downloadRoot = null,
  maxRisk = "read",
  timeoutMs = 30000,
  viewport = null,
  requests = "any",
  env = process.env,
} = {}) {
  assertBrowserRequestScope({ requests, targetOrigins });
  if (requests !== "any") throw new TypeError("a user browser session cannot be read-only");
  const policy = new BrowserControlPolicy({ targetOrigins, methods, events, fileRoots, downloadRoot, maxRisk });
  const { connection, product, protocolVersion } = await openUserBrowserConnection({ browser, timeoutMs, env });
  try {
    const compatibility = assertBrowserCompatibility({ protocolVersion, product });
    const port = new BrowserControlPort({ transport: new UserBrowserTransport(connection), policy });
    return new NodeBrowserControlBroker({ connection, port, compatibility, timeoutMs, viewport,
      targets: userBrowserTargets(connection) });
  } catch (error) {
    connection.close();
    throw error;
  }
}
