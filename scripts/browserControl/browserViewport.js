// browserViewport.js - 설치 manifest와 CDP session이 공유하는 결정적 viewport 계약.

export const BROWSER_VIEWPORT_MAX_CSS_DIMENSION = 10000;
export const BROWSER_VIEWPORT_MAX_DEVICE_SCALE = 10;

const VIEWPORT_KEYS = new Set(["width", "height", "deviceScaleFactor", "mobile", "touch"]);

function integer(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > BROWSER_VIEWPORT_MAX_CSS_DIMENSION) {
    throw new TypeError(`${label} must be an integer from 1 to ${BROWSER_VIEWPORT_MAX_CSS_DIMENSION}`);
  }
  return value;
}

function boolean(value, label, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
}

export function normalizeBrowserViewport(input, { label = "browser viewport" } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError(`${label} must be an object`);
  for (const key of Object.keys(input)) if (!VIEWPORT_KEYS.has(key)) throw new TypeError(`${label} does not accept ${key}`);
  const deviceScaleFactor = input.deviceScaleFactor === undefined ? 1 : Number(input.deviceScaleFactor);
  if (!Number.isFinite(deviceScaleFactor) || deviceScaleFactor < 0.1
    || deviceScaleFactor > BROWSER_VIEWPORT_MAX_DEVICE_SCALE) {
    throw new TypeError(`${label}.deviceScaleFactor must be from 0.1 to ${BROWSER_VIEWPORT_MAX_DEVICE_SCALE}`);
  }
  return Object.freeze({
    width: integer(input.width, `${label}.width`),
    height: integer(input.height, `${label}.height`),
    deviceScaleFactor,
    mobile: boolean(input.mobile, `${label}.mobile`),
    touch: boolean(input.touch, `${label}.touch`),
  });
}

export function parseBrowserViewportEnvironment(value) {
  if (value === undefined || value === "") return null;
  let input;
  try { input = JSON.parse(String(value)); }
  catch (error) { throw new TypeError("PYPROC_BROWSER_VIEWPORT must be valid JSON"); }
  return normalizeBrowserViewport(input, { label: "PYPROC_BROWSER_VIEWPORT" });
}

export function browserViewportCommands(viewport) {
  if (!viewport) return Object.freeze([]);
  const value = normalizeBrowserViewport(viewport);
  return Object.freeze([
    Object.freeze({
      method: "Emulation.setDeviceMetricsOverride",
      params: Object.freeze({
        width: value.width,
        height: value.height,
        deviceScaleFactor: value.deviceScaleFactor,
        mobile: value.mobile,
        screenWidth: value.width,
        screenHeight: value.height,
      }),
    }),
    Object.freeze({
      method: "Emulation.setTouchEmulationEnabled",
      params: Object.freeze({ enabled: value.touch, maxTouchPoints: value.touch ? 5 : 1 }),
    }),
  ]);
}

export async function applyBrowserViewport(send, viewport) {
  if (typeof send !== "function") throw new TypeError("browser viewport send callback is required");
  for (const command of browserViewportCommands(viewport)) await send(command.method, command.params);
  return viewport || null;
}
