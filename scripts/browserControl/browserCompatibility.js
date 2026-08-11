// browserCompatibility.js - repository browser broker의 CDP 및 Chromium 지원 경계.
import { BrowserControlError, BROWSER_CONTROL_ERROR_CODES } from "./browserControlPort.js";

export const BROWSER_CONTROL_CDP_PROTOCOL_MAJOR = 1;
export const BROWSER_CONTROL_MIN_CHROMIUM_MAJOR = 137;

function text(value, limit = 120) {
  const result = String(value || "");
  return result.length > limit ? result.slice(0, limit) : result;
}

export function inspectBrowserCompatibility(version = {}) {
  const protocolVersion = text(version.protocolVersion, 40);
  const product = text(version.product, 120);
  const match = /^(Chrome|HeadlessChrome|Chromium|Edg)\/(\d+)(?:\.|$)/.exec(product);
  const browserFamily = match?.[1] || "unknown";
  const browserMajor = match ? Number(match[2]) : 0;
  const protocolMajor = Number(protocolVersion.split(".")[0]);
  const reasons = [];
  if (protocolMajor !== BROWSER_CONTROL_CDP_PROTOCOL_MAJOR) {
    reasons.push(`CDP protocol major ${protocolVersion || "unknown"} is unsupported`);
  }
  if (!match) reasons.push(`browser product ${product || "unknown"} is not a supported Chromium family`);
  else if (browserMajor < BROWSER_CONTROL_MIN_CHROMIUM_MAJOR) {
    reasons.push(`Chromium major ${browserMajor} is below ${BROWSER_CONTROL_MIN_CHROMIUM_MAJOR}`);
  }
  return Object.freeze({
    supported: reasons.length === 0,
    protocolVersion,
    requiredProtocolMajor: BROWSER_CONTROL_CDP_PROTOCOL_MAJOR,
    product,
    browserFamily,
    browserMajor,
    minimumBrowserMajor: BROWSER_CONTROL_MIN_CHROMIUM_MAJOR,
    jsVersion: text(version.jsVersion, 80),
    reasons: Object.freeze(reasons),
  });
}

export function assertBrowserCompatibility(version) {
  const compatibility = inspectBrowserCompatibility(version);
  if (!compatibility.supported) {
    throw new BrowserControlError(BROWSER_CONTROL_ERROR_CODES.commandUnsupported,
      `browser CDP compatibility check failed: ${compatibility.reasons.join("; ")}`,
      { outcome: "notSent", retryable: false });
  }
  return compatibility;
}
