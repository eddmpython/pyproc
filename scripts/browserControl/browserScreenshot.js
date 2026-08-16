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

function reportedNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boundsError(source, reason, measured) {
  const details = Object.freeze({
    reason,
    source,
    measured: Object.freeze({
      x: reportedNumber(measured.x),
      y: reportedNumber(measured.y),
      cssWidth: reportedNumber(measured.width),
      cssHeight: reportedNumber(measured.height),
      scale: reportedNumber(measured.scale),
      scaledCssPixels: reportedNumber(measured.scaledCssPixels),
    }),
    limits: Object.freeze({
      maxCssDimension: BROWSER_SCREENSHOT_MAX_CSS_DIMENSION,
      maxScaledCssPixels: BROWSER_SCREENSHOT_MAX_CSS_PIXELS,
      minScale: 0.1,
      maxScale: 3,
    }),
    recovery: Object.freeze({ automatic: false, viewportScrollMayTriggerEffects: true }),
  });
  return new BrowserControlError("BROWSER_AUTOMATION_SCREENSHOT_BOUNDS",
    `browser screenshot ${source} exceeds the supported ${reason} bounds`, {
      outcome: "notSent",
      retryable: false,
      details,
    });
}

export function validateBrowserScreenshotBounds({ source, x = 0, y = 0, width, height, scale = 1 }) {
  const measured = {
    x: Number(x),
    y: Number(y),
    width: Number(width),
    height: Number(height),
    scale: Number(scale),
  };
  measured.scaledCssPixels = measured.width * measured.height * measured.scale * measured.scale;
  if (!Number.isFinite(measured.scale) || measured.scale < 0.1 || measured.scale > 3) {
    throw boundsError(source, "scale", measured);
  }
  if (!Number.isFinite(measured.x) || !Number.isFinite(measured.y) || measured.x < 0 || measured.y < 0) {
    throw boundsError(source, "origin", measured);
  }
  if (!Number.isFinite(measured.width) || !Number.isFinite(measured.height)
    || measured.width <= 0 || measured.height <= 0
    || measured.width > BROWSER_SCREENSHOT_MAX_CSS_DIMENSION
    || measured.height > BROWSER_SCREENSHOT_MAX_CSS_DIMENSION) {
    throw boundsError(source, "dimension", measured);
  }
  if (measured.x > BROWSER_SCREENSHOT_MAX_CSS_DIMENSION
    || measured.y > BROWSER_SCREENSHOT_MAX_CSS_DIMENSION
    || measured.x + measured.width > BROWSER_SCREENSHOT_MAX_CSS_DIMENSION
    || measured.y + measured.height > BROWSER_SCREENSHOT_MAX_CSS_DIMENSION) {
    throw boundsError(source, "extent", measured);
  }
  if (measured.scaledCssPixels > BROWSER_SCREENSHOT_MAX_CSS_PIXELS) {
    throw boundsError(source, "area", measured);
  }
  return Object.freeze(measured);
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
    // 최신 CDP의 CSS pixel 필드를 우선한다. deprecated contentSize는 device pixel일 수 있다.
    const content = metrics.cssContentSize || metrics.contentSize || {};
    let clip = null;
    let cssWidth;
    let cssHeight;
    if (options.clip) {
      const bounds = validateBrowserScreenshotBounds({
        source: "clip",
        ...options.clip,
        scale: options.clip.scale ?? 1,
      });
      clip = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, scale: bounds.scale };
      cssWidth = bounds.width;
      cssHeight = bounds.height;
    } else if (options.fullPage === true) {
      const bounds = validateBrowserScreenshotBounds({
        source: "content",
        width: content.width,
        height: content.height,
      });
      cssWidth = bounds.width;
      cssHeight = bounds.height;
      clip = { x: 0, y: 0, width: bounds.width, height: bounds.height, scale: 1 };
    } else {
      const bounds = validateBrowserScreenshotBounds({
        source: "viewport",
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      });
      cssWidth = bounds.width;
      cssHeight = bounds.height;
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
