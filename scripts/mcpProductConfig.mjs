// mcpProductConfig.mjs - installed pyproc-mcp manifest validation and environment projection.
import { readFile } from "node:fs/promises";
import { lstatSync, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { parseBrowserControlConfig } from "./browserControl/mcpBrowserControl.js";
import { normalizeBrowserViewport } from "./browserControl/browserViewport.js";
import {
  AUTOMATION_RECORDING_MAX_ARTIFACT_BYTES,
  AUTOMATION_RECORDING_MAX_TOTAL_ARTIFACT_BYTES,
} from "./automationSpace/automationRecording.js";

const ROOT_KEYS = new Set(["schemaVersion", "engine", "browser", "timeoutMs"]);
const ENGINE_KEYS = new Set(["root", "indexURL"]);
const BROWSER_KEYS = new Set([
  "enabled", "provider", "executable", "headed", "gpu", "allowedOrigins", "maxRisk", "actions", "methods",
  "fileRoots", "externalEffects", "purpose", "artifacts", "viewport",
  "recording",
]);
const RECORDING_KEYS = new Set([
  "mode", "file", "overwrite", "recordingId", "finalSha256", "startCursor", "prefixSha256",
]);
const ARTIFACT_KEYS = new Set([
  "maxArtifactBytes", "maxTotalBytes", "maxArtifacts", "inlineMaxBytes", "ttlMs",
]);
const CONTROLLED_ENV = Object.freeze([
  "PYPROC_MCP_ENGINE_ROOT", "PYPROC_INDEX_URL", "PYPROC_MCP_TIMEOUT", "PYPROC_BROWSER_CONTROL",
  "PYPROC_AUTOMATION_PROVIDER",
  "PYPROC_BROWSER", "PYPROC_HEADED", "PYPROC_GPU", "PYPROC_BROWSER_ALLOWED_ORIGINS",
  "PYPROC_BROWSER_MAX_RISK", "PYPROC_BROWSER_ACTIONS", "PYPROC_BROWSER_METHODS",
  "PYPROC_BROWSER_FILE_ROOTS", "PYPROC_BROWSER_EXTERNAL_EFFECTS", "PYPROC_BROWSER_PURPOSE",
  "PYPROC_BROWSER_ARTIFACT_MAX_BYTES", "PYPROC_BROWSER_ARTIFACT_TOTAL_BYTES",
  "PYPROC_BROWSER_ARTIFACT_MAX_COUNT", "PYPROC_BROWSER_ARTIFACT_INLINE_BYTES",
  "PYPROC_BROWSER_ARTIFACT_TTL_MS",
  "PYPROC_BROWSER_VIEWPORT",
  "PYPROC_AUTOMATION_RECORDING",
]);

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function knownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new TypeError(`${label} does not accept ${key}`);
}

function positiveInteger(value, label, maximum) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${label} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function stringArray(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)
    || value.some((entry) => typeof entry !== "string" || !entry.trim())) {
    throw new TypeError(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array of non-empty strings`);
  }
  if (new Set(value).size !== value.length) throw new TypeError(`${label} must not contain duplicates`);
  return value.map((entry) => entry.trim());
}

function optionalBoolean(value, label, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
}

function normalizedEngine(input) {
  const engine = plainObject(input, "engine");
  knownKeys(engine, ENGINE_KEYS, "engine");
  if (Number(engine.root !== undefined) + Number(engine.indexURL !== undefined) !== 1) {
    throw new TypeError("engine requires exactly one of root or indexURL");
  }
  if (engine.root !== undefined) {
    if (typeof engine.root !== "string" || !isAbsolute(engine.root)) {
      throw new TypeError("engine.root must be an absolute directory");
    }
    let root;
    try { root = realpathSync(resolve(engine.root)); }
    catch (error) { throw new TypeError(`engine.root is unavailable: ${engine.root}`); }
    if (!statSync(root).isDirectory()) throw new TypeError("engine.root must be a directory");
    for (const file of ["pyodide.js", "pyodide-lock.json"]) {
      try {
        if (!statSync(join(root, file)).isFile()) throw new Error("not a file");
      } catch (error) {
        throw new TypeError(`engine.root is missing ${file}`);
      }
    }
    return Object.freeze({ root });
  }
  if (typeof engine.indexURL !== "string" || !engine.indexURL) {
    throw new TypeError("engine.indexURL must be an absolute HTTP(S) URL");
  }
  let url;
  try { url = new URL(engine.indexURL); }
  catch (error) { throw new TypeError("engine.indexURL must be an absolute HTTP(S) URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TypeError("engine.indexURL must be an HTTP(S) URL without credentials, query, or fragment");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return Object.freeze({ indexURL: url.href });
}

function normalizedArtifacts(input = {}) {
  const artifacts = plainObject(input, "browser.artifacts");
  knownKeys(artifacts, ARTIFACT_KEYS, "browser.artifacts");
  const normalized = {};
  if (artifacts.maxArtifactBytes !== undefined) normalized.maxArtifactBytes = positiveInteger(
    artifacts.maxArtifactBytes, "browser.artifacts.maxArtifactBytes", 64 * 1024 * 1024);
  if (artifacts.maxTotalBytes !== undefined) normalized.maxTotalBytes = positiveInteger(
    artifacts.maxTotalBytes, "browser.artifacts.maxTotalBytes", 512 * 1024 * 1024);
  if (artifacts.maxArtifacts !== undefined) normalized.maxArtifacts = positiveInteger(
    artifacts.maxArtifacts, "browser.artifacts.maxArtifacts", 1024);
  if (artifacts.inlineMaxBytes !== undefined) normalized.inlineMaxBytes = positiveInteger(
    artifacts.inlineMaxBytes, "browser.artifacts.inlineMaxBytes", 4 * 1024 * 1024);
  if (artifacts.ttlMs !== undefined) normalized.ttlMs = positiveInteger(
    artifacts.ttlMs, "browser.artifacts.ttlMs", 24 * 60 * 60 * 1000);
  return Object.freeze(normalized);
}

function normalizedRecording(input, provider, artifacts) {
  if (input === undefined) {
    if (provider === "replay") throw new TypeError("browser.provider replay requires browser.recording");
    return null;
  }
  const recording = plainObject(input, "browser.recording");
  knownKeys(recording, RECORDING_KEYS, "browser.recording");
  const expectedMode = provider === "replay" ? "replay" : "record";
  if (recording.mode !== expectedMode) throw new TypeError(`browser.recording.mode must be ${expectedMode}`);
  if (typeof recording.file !== "string" || !isAbsolute(recording.file)) {
    throw new TypeError("browser.recording.file must be an absolute path");
  }
  const file = resolve(recording.file);
  const overwrite = optionalBoolean(recording.overwrite, "browser.recording.overwrite");
  let fileExists = false;
  if (expectedMode === "replay") {
    try {
      if (!lstatSync(file).isFile()) throw new Error("not a file");
    } catch (error) {
      throw new TypeError(`browser.recording.file is unavailable: ${file}`);
    }
  } else {
    try {
      if (!statSync(realpathSync(dirname(file))).isDirectory()) throw new Error("not a directory");
    } catch (error) {
      throw new TypeError(`browser.recording.file parent is unavailable: ${dirname(file)}`);
    }
    try {
      const target = lstatSync(file);
      if (!target.isFile()) throw new TypeError("browser.recording.file must be a regular file");
      fileExists = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  if (expectedMode === "record" && fileExists && !overwrite) {
    throw new TypeError("browser.recording.file already exists; set overwrite true to replace it");
  }
  if (recording.startCursor !== undefined && (!Number.isInteger(recording.startCursor)
    || recording.startCursor < 0 || recording.startCursor > 10000000)) {
    throw new TypeError("browser.recording.startCursor must be an integer from 0 to 10000000");
  }
  if (recording.prefixSha256 !== undefined && !/^[0-9a-f]{64}$/.test(recording.prefixSha256)) {
    throw new TypeError("browser.recording.prefixSha256 must be a lowercase SHA-256 digest");
  }
  if (recording.recordingId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(recording.recordingId)) {
    throw new TypeError("browser.recording.recordingId is invalid");
  }
  if (recording.finalSha256 !== undefined && !/^[0-9a-f]{64}$/.test(recording.finalSha256)) {
    throw new TypeError("browser.recording.finalSha256 must be a lowercase SHA-256 digest");
  }
  if (expectedMode === "record" && (recording.startCursor !== undefined || recording.prefixSha256 !== undefined
    || recording.recordingId !== undefined || recording.finalSha256 !== undefined)) {
    throw new TypeError("record mode does not accept replay pins or cursor");
  }
  if (expectedMode === "replay" && (!recording.recordingId || !recording.finalSha256)) {
    throw new TypeError("replay mode requires recordingId and finalSha256 pins");
  }
  if (expectedMode === "replay" && (recording.startCursor || 0) > 0 && !recording.prefixSha256) {
    throw new TypeError("nonzero replay startCursor requires prefixSha256");
  }
  if (expectedMode === "replay" && overwrite) {
    throw new TypeError("replay mode does not accept overwrite");
  }
  if (artifacts.maxArtifactBytes > AUTOMATION_RECORDING_MAX_ARTIFACT_BYTES
    || artifacts.maxTotalBytes > AUTOMATION_RECORDING_MAX_TOTAL_ARTIFACT_BYTES) {
    throw new TypeError("browser recording artifact limits exceed the recording format limits");
  }
  return Object.freeze({ mode: expectedMode, file, ...(expectedMode === "record" ? { overwrite } : {}),
    ...(recording.recordingId === undefined ? {} : { recordingId: recording.recordingId }),
    ...(recording.finalSha256 === undefined ? {} : { finalSha256: recording.finalSha256 }),
    ...(recording.startCursor === undefined ? {} : { startCursor: recording.startCursor }),
    ...(recording.prefixSha256 === undefined ? {} : { prefixSha256: recording.prefixSha256 }) });
}

function normalizedBrowser(input = { enabled: false }) {
  const browser = plainObject(input, "browser");
  knownKeys(browser, BROWSER_KEYS, "browser");
  const enabled = optionalBoolean(browser.enabled, "browser.enabled");
  if (!enabled) {
    const extra = Object.keys(browser).filter((key) => key !== "enabled");
    if (extra.length) throw new TypeError(`disabled browser does not accept ${extra[0]}`);
    return Object.freeze({ enabled: false });
  }
  if (browser.executable !== undefined && (typeof browser.executable !== "string" || !isAbsolute(browser.executable))) {
    throw new TypeError("browser.executable must be an absolute file path");
  }
  const provider = browser.provider === undefined ? "nativeCdp" : browser.provider;
  if (!["nativeCdp", "frame", "replay"].includes(provider)) {
    throw new TypeError("browser.provider must be nativeCdp, frame, or replay");
  }
  if (browser.maxRisk !== undefined && typeof browser.maxRisk !== "string") {
    throw new TypeError("browser.maxRisk must be a string");
  }
  if (browser.externalEffects !== undefined && typeof browser.externalEffects !== "string") {
    throw new TypeError("browser.externalEffects must be a string");
  }
  if (browser.purpose !== undefined && typeof browser.purpose !== "string") {
    throw new TypeError("browser.purpose must be a string");
  }
  const purpose = (browser.purpose || "").trim();
  const artifacts = normalizedArtifacts(browser.artifacts);
  const normalized = {
    enabled: true,
    provider,
    ...(browser.executable === undefined ? {} : { executable: resolve(browser.executable) }),
    headed: optionalBoolean(browser.headed, "browser.headed"),
    gpu: optionalBoolean(browser.gpu, "browser.gpu"),
    allowedOrigins: stringArray(browser.allowedOrigins, "browser.allowedOrigins", { allowEmpty: false }),
    maxRisk: browser.maxRisk || "read",
    actions: stringArray(browser.actions, "browser.actions", { allowEmpty: false }),
    methods: browser.methods === undefined ? [] : stringArray(browser.methods, "browser.methods"),
    fileRoots: browser.fileRoots === undefined ? [] : stringArray(browser.fileRoots, "browser.fileRoots"),
    externalEffects: browser.externalEffects || "",
    purpose,
    artifacts,
    recording: normalizedRecording(browser.recording, provider, artifacts),
    ...(browser.viewport === undefined ? {} : {
      viewport: normalizeBrowserViewport(browser.viewport, { label: "browser.viewport" }),
    }),
  };
  for (const root of normalized.fileRoots) {
    if (!isAbsolute(root)) throw new TypeError(`browser.fileRoots entry must be absolute: ${root}`);
  }
  return Object.freeze(normalized);
}

function projectedEnvironment(config, baseEnv = {}) {
  const env = { ...baseEnv };
  for (const key of CONTROLLED_ENV) delete env[key];
  env.PYPROC_MCP_TIMEOUT = String(config.timeoutMs);
  if (config.engine.root) env.PYPROC_MCP_ENGINE_ROOT = config.engine.root;
  else env.PYPROC_INDEX_URL = config.engine.indexURL;
  if (!config.browser.enabled) return env;
  const browser = config.browser;
  env.PYPROC_BROWSER_CONTROL = "1";
  env.PYPROC_AUTOMATION_PROVIDER = browser.provider;
  if (browser.executable) env.PYPROC_BROWSER = browser.executable;
  if (browser.headed) env.PYPROC_HEADED = "1";
  if (browser.gpu) env.PYPROC_GPU = "1";
  env.PYPROC_BROWSER_ALLOWED_ORIGINS = browser.allowedOrigins.join(",");
  env.PYPROC_BROWSER_MAX_RISK = browser.maxRisk;
  env.PYPROC_BROWSER_ACTIONS = browser.actions.join(",");
  env.PYPROC_BROWSER_METHODS = browser.methods.join(",");
  env.PYPROC_BROWSER_FILE_ROOTS = browser.fileRoots.join(delimiter);
  if (browser.externalEffects) env.PYPROC_BROWSER_EXTERNAL_EFFECTS = browser.externalEffects;
  if (browser.purpose) env.PYPROC_BROWSER_PURPOSE = browser.purpose;
  if (browser.viewport) env.PYPROC_BROWSER_VIEWPORT = JSON.stringify(browser.viewport);
  if (browser.recording) env.PYPROC_AUTOMATION_RECORDING = JSON.stringify(browser.recording);
  const artifactEnv = {
    maxArtifactBytes: "PYPROC_BROWSER_ARTIFACT_MAX_BYTES",
    maxTotalBytes: "PYPROC_BROWSER_ARTIFACT_TOTAL_BYTES",
    maxArtifacts: "PYPROC_BROWSER_ARTIFACT_MAX_COUNT",
    inlineMaxBytes: "PYPROC_BROWSER_ARTIFACT_INLINE_BYTES",
    ttlMs: "PYPROC_BROWSER_ARTIFACT_TTL_MS",
  };
  for (const [key, envKey] of Object.entries(artifactEnv)) {
    if (browser.artifacts[key] !== undefined) env[envKey] = String(browser.artifacts[key]);
  }
  return env;
}

export function validateMcpProductConfig(input, { baseEnv = {} } = {}) {
  const value = plainObject(input, "pyproc-mcp config");
  knownKeys(value, ROOT_KEYS, "pyproc-mcp config");
  if (value.schemaVersion !== 1) throw new TypeError("schemaVersion must be 1");
  const config = Object.freeze({
    schemaVersion: 1,
    engine: normalizedEngine(value.engine),
    browser: normalizedBrowser(value.browser),
    timeoutMs: value.timeoutMs === undefined ? 180000
      : positiveInteger(value.timeoutMs, "timeoutMs", 900000),
  });
  const env = projectedEnvironment(config, baseEnv);
  const browserControl = config.browser.enabled
    ? parseBrowserControlConfig(env, { timeoutMs: config.timeoutMs })
    : null;
  return Object.freeze({ config, env: Object.freeze(env), browserControl });
}

export async function loadMcpProductConfig(file, options = {}) {
  if (!file || typeof file !== "string") throw new TypeError("--config requires a JSON file");
  const configPath = resolve(file);
  let source;
  try { source = await readFile(configPath, "utf8"); }
  catch (error) { throw new Error(`cannot read pyproc-mcp config: ${configPath}`); }
  let input;
  try { input = JSON.parse(source); }
  catch (error) { throw new TypeError(`invalid pyproc-mcp JSON: ${error.message}`); }
  return Object.freeze({ configPath, ...validateMcpProductConfig(input, options) });
}

export function applyMcpProductEnvironment(env) {
  for (const key of CONTROLLED_ENV) delete process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (CONTROLLED_ENV.includes(key)) process.env[key] = value;
  }
}
