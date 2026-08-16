// browserControl/index.js - package-internal browser integration composition surface.
export { BrowserAutomation, BROWSER_AUTOMATION_ERROR_CODES } from "./browserAutomation.js";
export {
  BROWSER_ACTIONABILITY_DEFAULT_TIMEOUT_MS,
  BROWSER_ACTIONABILITY_MAX_TIMEOUT_MS,
  BROWSER_ACTIONABILITY_POLL_MS,
  BROWSER_ACTIONABILITY_STABLE_POLLS,
  BROWSER_ACTIONABILITY_FUNCTION,
  browserActionabilityRequirements,
  waitForBrowserActionability,
} from "./browserActionability.js";
export {
  BROWSER_AUTOMATION_ACTIONS,
  BROWSER_AUTOMATION_DEFAULT_ACTIONS,
  inspectBrowserAutomationActions,
} from "./browserAutomationCatalog.js";
export { connectNodeBrowserControl, NodeBrowserControlBroker } from "./browserControlBroker.mjs";
export {
  BROWSER_CONTROL_CDP_PROTOCOL_MAJOR,
  BROWSER_CONTROL_MIN_CHROMIUM_MAJOR,
  assertBrowserCompatibility,
  inspectBrowserCompatibility,
} from "./browserCompatibility.js";
export {
  BrowserControlError,
  BrowserControlPort,
  BROWSER_CONTROL_ERROR_CODES,
  BROWSER_CONTROL_PROTOCOL_VERSION,
} from "./browserControlPort.js";
export { BrowserControlPolicy } from "./browserControlPolicy.js";
export {
  BROWSER_LOCATOR_KINDS,
  BROWSER_LOCATOR_MAX_FRAME_DEPTH,
  BROWSER_LOCATOR_MAX_VALUE,
  BROWSER_LOCATOR_SCHEMA,
  BROWSER_FRAME_LOCATOR_SCHEMA,
  actionLocator,
  browserLocatorExpression,
  describeBrowserLocator,
  parseBrowserLocatorCount,
  validateBrowserLocator,
} from "./browserLocator.js";
export { BrowserLifecycle } from "./browserLifecycle.js";
export { BrowserDownload } from "./browserDownload.js";
export {
  BrowserArtifactStore,
  BROWSER_ARTIFACT_DEFAULT_INLINE_BYTES,
  BROWSER_ARTIFACT_DEFAULT_MAX_BYTES,
  BROWSER_ARTIFACT_DEFAULT_MAX_COUNT,
  BROWSER_ARTIFACT_DEFAULT_TOTAL_BYTES,
  BROWSER_ARTIFACT_DEFAULT_TTL_MS,
  BROWSER_ARTIFACT_MAX_CHUNK_BYTES,
} from "./browserArtifactStore.js";
export {
  BrowserScreenshot,
  BROWSER_SCREENSHOT_FORMATS,
  BROWSER_SCREENSHOT_MAX_CSS_DIMENSION,
  BROWSER_SCREENSHOT_MAX_CSS_PIXELS,
  validateBrowserScreenshotBounds,
} from "./browserScreenshot.js";
export { BrowserObservation, redactBrowserUrl } from "./browserObservation.js";
export {
  BROWSER_OBSERVATION_DEFAULT_EVENTS,
  BROWSER_OBSERVATION_EVENTS,
  BROWSER_OBSERVATION_MAX_EVENTS,
  BROWSER_OBSERVATION_MAX_NODES,
  BROWSER_OBSERVATION_METHODS,
  BROWSER_OBSERVATION_PROPERTIES,
  BROWSER_OBSERVATION_TEXT_LIMIT,
} from "./browserObservationCatalog.js";
export {
  BrowserTrace,
  BROWSER_TRACE_MAX_COMMANDS_PER_STEP,
  BROWSER_TRACE_SCHEMA_VERSION,
} from "./browserTrace.js";
export {
  McpBrowserControl,
  browserToolErrorDetails,
  createBrowserControlTools,
  parseBrowserControlConfig,
} from "./mcpBrowserControl.js";
