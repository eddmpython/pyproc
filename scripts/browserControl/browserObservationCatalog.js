// browserObservationCatalog.js - artifact option, quota, required CDP surface의 SSOT.

export const BROWSER_OBSERVATION_MAX_EVENTS = 100;
export const BROWSER_OBSERVATION_DEFAULT_EVENTS = 40;
export const BROWSER_OBSERVATION_MAX_NODES = 1000;
export const BROWSER_OBSERVATION_TEXT_LIMIT = 300;

export const BROWSER_OBSERVATION_METHODS = Object.freeze([
  "Accessibility.enable",
  "Accessibility.getFullAXTree",
  "DOMSnapshot.captureSnapshot",
  "Network.enable",
  "Page.captureScreenshot",
  "Page.getLayoutMetrics",
  "Runtime.enable",
]);

export const BROWSER_OBSERVATION_EVENTS = Object.freeze([
  "Network.loadingFailed",
  "Network.requestWillBeSent",
  "Network.responseReceived",
  "Runtime.consoleAPICalled",
]);

export const BROWSER_OBSERVATION_PROPERTIES = Object.freeze({
  maxNodes: { type: "integer", minimum: 1, maximum: BROWSER_OBSERVATION_MAX_NODES },
  includeScreenshot: { type: "boolean" },
  includeConsole: { type: "boolean" },
  includeNetwork: { type: "boolean" },
  maxEvents: { type: "integer", minimum: 1, maximum: BROWSER_OBSERVATION_MAX_EVENTS },
});
