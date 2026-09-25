// userBrowserSpace.js - AutomationSpace over one task window of the user's own Chrome or Edge, through the paired
// pyproc User Browser extension. Same operations and APX, Motor, and lifecycle contracts as NativeCdpSpace.
import { McpBrowserControl } from "../browserControl/mcpBrowserControl.js";
import { connectUserBrowserControl } from "../browserControl/userBrowser/userBrowserControl.mjs";
import { BrowserControlSpace } from "./browserControlSpace.js";

// No "storage": the provider never reads or changes the profile's cookies, storage, or caches.
export const USER_BROWSER_CAPABILITIES = Object.freeze([
  "dom",
  "network",
  "target",
  "runtime",
  "screenshot",
  "artifact",
  "perception",
  "actionConvergence",
]);

export class UserBrowserSpace extends BrowserControlSpace {
  constructor({ profileDir, config, browser, auditWriter, spaceId = "space:userBrowser" } = {}) {
    const implementation = new McpBrowserControl({ profileDir, config, auditWriter, providerKind: "userBrowser",
      brokerFactory: (options) => connectUserBrowserControl({ ...options, browser }) });
    super(implementation, { spaceId });
    this.config = config;
    this.browser = browser;
    this.providerKind = "userBrowser";
    this.capabilities = USER_BROWSER_CAPABILITIES;
  }
}
