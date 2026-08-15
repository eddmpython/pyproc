// browserScreenshot.js - ordered screenshot capture, layout guard와 format 검증.
import { BrowserControlError } from "./browserControlPort.js";

export const BROWSER_SCREENSHOT_FORMATS = Object.freeze(["png", "jpeg", "webp"]);
export const BROWSER_SCREENSHOT_MAX_CSS_DIMENSION = 32768;
export const BROWSER_SCREENSHOT_MAX_CSS_PIXELS = 64 * 1024 * 1024;

const MIME = Object.freeze({ png: "image/png", jpeg: "image/jpeg", webp: "image/webp" });

function validSignature(bytes, format) {
  if (format === "png") {
    return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  if (format === "jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function boundedDimension(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > BROWSER_SCREENSHOT_MAX_CSS_DIMENSION) {
    throw new BrowserControlError("BROWSER_AUTOMATION_SCREENSHOT_BOUNDS",
      `browser screenshot ${label} is outside the supported CSS bounds`, { outcome: "notSent" });
  }
  return number;
}

function boundedScale(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0.1 || number > 3) {
    throw new BrowserControlError("BROWSER_AUTOMATION_SCREENSHOT_BOUNDS",
      "browser screenshot clip scale is outside the supported bounds", { outcome: "notSent" });
  }
  return number;
}

export class BrowserScreenshot {
  constructor({ command, artifactStore } = {}) {
    if (typeof command !== "function") throw new TypeError("browser screenshot command callback is required");
    if (!artifactStore || typeof artifactStore.put !== "function") {
      throw new TypeError("browser screenshot artifact store is required");
    }
    this._command = command;
    this._artifactStore = artifactStore;
  }

  async capture(sessionRef, options, commandResults, signal) {
    const format = options.format || "png";
    const layout = await this._command(sessionRef, "Page.getLayoutMetrics", {}, commandResults, signal);
    const metrics = layout.result || {};
    const viewport = metrics.cssVisualViewport || metrics.visualViewport || {};
    const content = metrics.contentSize || {};
    let clip = null;
    let cssWidth;
    let cssHeight;
    if (options.clip) {
      clip = { ...options.clip, scale: boundedScale(options.clip.scale ?? 1) };
      cssWidth = boundedDimension(clip.width, "clip width");
      cssHeight = boundedDimension(clip.height, "clip height");
    } else if (options.fullPage === true) {
      cssWidth = boundedDimension(content.width, "content width");
      cssHeight = boundedDimension(content.height, "content height");
      clip = { x: 0, y: 0, width: cssWidth, height: cssHeight, scale: 1 };
    } else {
      cssWidth = boundedDimension(viewport.clientWidth, "viewport width");
      cssHeight = boundedDimension(viewport.clientHeight, "viewport height");
    }
    const scale = clip?.scale ?? 1;
    if (cssWidth * cssHeight * scale * scale > BROWSER_SCREENSHOT_MAX_CSS_PIXELS) {
      throw new BrowserControlError("BROWSER_AUTOMATION_SCREENSHOT_BOUNDS",
        "browser screenshot exceeds the CSS pixel area limit", { outcome: "notSent" });
    }
    const captured = await this._command(sessionRef, "Page.captureScreenshot", {
      format,
      ...(options.quality === undefined ? {} : { quality: options.quality }),
      fromSurface: true,
      captureBeyondViewport: options.fullPage === true || !!options.clip,
      ...(clip ? { clip } : {}),
      ...(options.optimizeForSpeed === undefined ? {} : { optimizeForSpeed: options.optimizeForSpeed }),
    }, commandResults, signal);
    const data = captured.result?.data;
    if (typeof data !== "string") {
      throw new BrowserControlError("BROWSER_AUTOMATION_ARTIFACT_INVALID",
        "browser screenshot returned no encoded bytes", { outcome: "notSent" });
    }
    const bytes = Buffer.from(data, "base64");
    if (!validSignature(bytes, format)) {
      throw new BrowserControlError("BROWSER_AUTOMATION_ARTIFACT_INVALID",
        `browser screenshot returned an invalid ${format} signature`, { outcome: "notSent" });
    }
    return this._artifactStore.put(bytes, {
      kind: "screenshot",
      mimeType: MIME[format],
      format,
      cssWidth,
      cssHeight,
      fullPage: options.fullPage === true,
    }, { inline: options.inline !== false });
  }
}
