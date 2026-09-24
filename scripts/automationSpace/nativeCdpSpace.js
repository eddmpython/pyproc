// nativeCdpSpace.js - broker-owned Chromium CDP implementation of AutomationSpace.
import { McpBrowserControl } from "../browserControl/mcpBrowserControl.js";
import { BrowserControlSpace } from "./browserControlSpace.js";

export const NATIVE_CDP_CAPABILITIES = Object.freeze([
  "dom",
  "network",
  "target",
  "storage",
  "runtime",
  "screenshot",
  "artifact",
  "perception",
  "actionConvergence",
]);

export class NativeCdpSpace extends BrowserControlSpace {
  constructor({ profileDir, cdpPipe, config, brokerFactory, auditWriter, control = null,
    spaceId = "space:native" } = {}) {
    const implementation = control || new McpBrowserControl({ profileDir, cdpPipe, config, brokerFactory, auditWriter });
    super(implementation, { spaceId });
    this.config = config || implementation.config;
    this.providerKind = "nativeCdp";
    this.capabilities = NATIVE_CDP_CAPABILITIES;
  }
}
