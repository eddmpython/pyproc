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

const ROOT_KEYS = new Set(["schemaVersion", "engine", "browser", "executionMemory", "effectTransactions", "appSpace", "replayGraph", "actuation", "timeoutMs"]);
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
const EXECUTION_MEMORY_KEYS = new Set(["enabled", "root", "importRoots", "secretEnv"]);
const EFFECT_TRANSACTION_KEYS = new Set(["enabled", "approvalAuthorities"]);
const APPROVAL_AUTHORITY_KEYS = new Set(["authorityId", "publicKeyFile"]);
const APP_SPACE_KEYS = new Set(["enabled", "apps", "maxStateBytes"]);
const APP_IDENTITY_KEYS = new Set(["appId", "origin", "adapterVersion", "stateSchema"]);
const REPLAY_GRAPH_KEYS = new Set(["enabled"]);
const ACTUATION_KEYS = new Set(["enabled"]);
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
  "PYPROC_EXECUTION_MEMORY_ROOT", "PYPROC_EXECUTION_MEMORY_IMPORT_ROOTS",
  "PYPROC_EXECUTION_MEMORY_SECRET_VALUES",
  "PYPROC_EFFECT_TRANSACTIONS", "PYPROC_EFFECT_APPROVAL_AUTHORITIES", "PYPROC_EFFECT_SECRET_BINDINGS",
  "PYPROC_APP_SPACE",
  "PYPROC_REPLAY_GRAPH",
  "PYPROC_ACTUATION", "PYPROC_ACTUATION_VALUE_BINDINGS",
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
  const recording = normalizedRecording(browser.recording, provider, artifacts);
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
    ...(recording === null ? {} : { recording }),
    ...(browser.viewport === undefined ? {} : {
      viewport: normalizeBrowserViewport(browser.viewport, { label: "browser.viewport" }),
    }),
  };
  for (const root of normalized.fileRoots) {
    if (!isAbsolute(root)) throw new TypeError(`browser.fileRoots entry must be absolute: ${root}`);
  }
  return Object.freeze(normalized);
}

function normalizedExecutionMemory(input = { enabled: false }, baseEnv = {}) {
  const memory = plainObject(input, "executionMemory");
  knownKeys(memory, EXECUTION_MEMORY_KEYS, "executionMemory");
  const enabled = optionalBoolean(memory.enabled, "executionMemory.enabled");
  if (!enabled) {
    const extra = Object.keys(memory).filter((key) => key !== "enabled");
    if (extra.length) throw new TypeError(`disabled executionMemory does not accept ${extra[0]}`);
    return Object.freeze({ config: Object.freeze({ enabled: false }), secretValues: Object.freeze([]),
      secretBindings: Object.freeze({}) });
  }
  if (typeof memory.root !== "string" || !isAbsolute(memory.root)) {
    throw new TypeError("executionMemory.root must be an absolute directory path");
  }
  const root = resolve(memory.root);
  const importRoots = memory.importRoots === undefined ? []
    : stringArray(memory.importRoots, "executionMemory.importRoots").map((entry) => {
      if (!isAbsolute(entry)) throw new TypeError("executionMemory.importRoots entries must be absolute");
      return resolve(entry);
    });
  const secretEnv = memory.secretEnv === undefined ? [] : stringArray(memory.secretEnv, "executionMemory.secretEnv");
  const secretValues = secretEnv.map((name) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new TypeError(`executionMemory.secretEnv name is invalid: ${name}`);
    const value = baseEnv[name];
    if (typeof value !== "string" || !value) throw new TypeError(`executionMemory secret environment variable is unavailable: ${name}`);
    if (Buffer.byteLength(value) < 8) {
      throw new TypeError(`executionMemory secret environment variable is too short for binary redaction: ${name}`);
    }
    return value;
  });
  return Object.freeze({ config: Object.freeze({ enabled: true, root, importRoots: Object.freeze(importRoots),
    secretEnv: Object.freeze(secretEnv) }), secretValues: Object.freeze(secretValues),
    secretBindings: Object.freeze(Object.fromEntries(secretEnv.map((name, index) => [name, secretValues[index]]))) });
}

function normalizedEffectTransactions(input = { enabled: false }, { executionMemory, browser } = {}) {
  const effect = plainObject(input, "effectTransactions");
  knownKeys(effect, EFFECT_TRANSACTION_KEYS, "effectTransactions");
  const enabled = optionalBoolean(effect.enabled, "effectTransactions.enabled");
  if (!enabled) {
    const extra = Object.keys(effect).filter((key) => key !== "enabled");
    if (extra.length) throw new TypeError(`disabled effectTransactions does not accept ${extra[0]}`);
    return Object.freeze({ enabled: false });
  }
  if (!executionMemory.enabled) throw new TypeError("effectTransactions requires executionMemory.enabled true");
  if (!browser.enabled || browser.maxRisk !== "externalEffect" || browser.externalEffects !== "acknowledged") {
    throw new TypeError("effectTransactions requires an acknowledged externalEffect browser profile");
  }
  if (!Array.isArray(effect.approvalAuthorities) || effect.approvalAuthorities.length < 1
    || effect.approvalAuthorities.length > 16) {
    throw new TypeError("effectTransactions.approvalAuthorities requires 1 to 16 entries");
  }
  const seen = new Set();
  const approvalAuthorities = effect.approvalAuthorities.map((entry, index) => {
    const authority = plainObject(entry, `effectTransactions.approvalAuthorities[${index}]`);
    knownKeys(authority, APPROVAL_AUTHORITY_KEYS, `effectTransactions.approvalAuthorities[${index}]`);
    if (!/^[A-Za-z][A-Za-z0-9._:-]{0,127}$/.test(String(authority.authorityId || ""))
      || seen.has(authority.authorityId)) throw new TypeError("effect transaction approval authorityId is invalid or duplicated");
    seen.add(authority.authorityId);
    if (typeof authority.publicKeyFile !== "string" || !isAbsolute(authority.publicKeyFile)) {
      throw new TypeError("effect transaction publicKeyFile must be absolute");
    }
    let publicKeyFile;
    try {
      publicKeyFile = realpathSync(resolve(authority.publicKeyFile));
      if (!statSync(publicKeyFile).isFile()) throw new Error("not a file");
    } catch (error) { throw new TypeError(`effect transaction public key is unavailable: ${authority.publicKeyFile}`); }
    return Object.freeze({ authorityId: authority.authorityId, publicKeyFile });
  });
  return Object.freeze({ enabled: true, approvalAuthorities: Object.freeze(approvalAuthorities) });
}

function normalizedAppSpace(input = { enabled: false }, { executionMemory, effectTransactions, browser } = {}) {
  const appSpace = plainObject(input, "appSpace");
  knownKeys(appSpace, APP_SPACE_KEYS, "appSpace");
  const enabled = optionalBoolean(appSpace.enabled, "appSpace.enabled");
  if (!enabled) {
    const extra = Object.keys(appSpace).filter((key) => key !== "enabled");
    if (extra.length) throw new TypeError(`disabled appSpace does not accept ${extra[0]}`);
    return Object.freeze({ enabled: false });
  }
  if (!executionMemory.enabled || !effectTransactions.enabled || !browser.enabled || browser.provider !== "frame") {
    throw new TypeError("appSpace requires Execution Memory, Rehearse-Commit, and browser.provider frame");
  }
  if (!Array.isArray(appSpace.apps) || appSpace.apps.length < 1 || appSpace.apps.length > 32) {
    throw new TypeError("appSpace.apps requires 1 to 32 configured identities");
  }
  const seen = new Set();
  const apps = appSpace.apps.map((entry, index) => {
    const app = plainObject(entry, `appSpace.apps[${index}]`);
    knownKeys(app, APP_IDENTITY_KEYS, `appSpace.apps[${index}]`);
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+){1,15}$/.test(String(app.appId || "")) || seen.has(app.appId)) {
      throw new TypeError("appSpace appId is invalid or duplicated");
    }
    seen.add(app.appId);
    let origin;
    try { origin = new URL(app.origin); } catch (error) { throw new TypeError("appSpace app origin is invalid"); }
    if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== app.origin
      || !browser.allowedOrigins.includes(app.origin)) throw new TypeError("appSpace app origin must be an exact allowed origin");
    if (typeof app.adapterVersion !== "string" || !app.adapterVersion || app.adapterVersion.length > 64
      || typeof app.stateSchema !== "string" || !app.stateSchema || app.stateSchema.length > 128) {
      throw new TypeError("appSpace adapterVersion and stateSchema are invalid");
    }
    return Object.freeze({ appId: app.appId, origin: app.origin,
      adapterVersion: app.adapterVersion, stateSchema: app.stateSchema });
  });
  return Object.freeze({ enabled: true, apps: Object.freeze(apps),
    maxStateBytes: appSpace.maxStateBytes === undefined ? 1024 * 1024
      : positiveInteger(appSpace.maxStateBytes, "appSpace.maxStateBytes", 8 * 1024 * 1024) });
}

function normalizedReplayGraph(input = { enabled: false }, { executionMemory } = {}) {
  const replayGraph = plainObject(input, "replayGraph");
  knownKeys(replayGraph, REPLAY_GRAPH_KEYS, "replayGraph");
  const enabled = optionalBoolean(replayGraph.enabled, "replayGraph.enabled");
  if (enabled && !executionMemory.enabled) {
    throw new TypeError("replayGraph requires executionMemory.enabled true");
  }
  return Object.freeze({ enabled });
}

function normalizedActuation(input = { enabled: false }, { executionMemory, browser, appSpace } = {}) {
  const actuation = plainObject(input, "actuation");
  knownKeys(actuation, ACTUATION_KEYS, "actuation");
  const enabled = optionalBoolean(actuation.enabled, "actuation.enabled");
  if (enabled && (!executionMemory.enabled || !browser.enabled)) {
    throw new TypeError("actuation requires executionMemory.enabled and browser.enabled true");
  }
  if (enabled && browser.provider === "frame" && !appSpace.enabled) {
    throw new TypeError("actuation with browser.provider frame requires appSpace.enabled true");
  }
  const motorActions = new Set(["click", "focus", "fill", "select", "check", "uncheck", "scroll", "drag"]);
  if (enabled && (browser.maxRisk !== "externalEffect" || !browser.actions.includes("snapshot")
    || !browser.actions.some((action) => motorActions.has(action)))) {
    throw new TypeError("actuation requires snapshot and at least one permitted external-effect Motor action");
  }
  return Object.freeze({ enabled });
}

function projectedEnvironment(config, baseEnv = {}, executionMemorySecrets = [], effectSecretBindings = {}) {
  const env = { ...baseEnv };
  for (const key of CONTROLLED_ENV) delete env[key];
  env.PYPROC_MCP_TIMEOUT = String(config.timeoutMs);
  if (config.engine.root) env.PYPROC_MCP_ENGINE_ROOT = config.engine.root;
  else env.PYPROC_INDEX_URL = config.engine.indexURL;
  if (config.executionMemory.enabled) {
    env.PYPROC_EXECUTION_MEMORY_ROOT = config.executionMemory.root;
    env.PYPROC_EXECUTION_MEMORY_IMPORT_ROOTS = config.executionMemory.importRoots.join(delimiter);
    env.PYPROC_EXECUTION_MEMORY_SECRET_VALUES = JSON.stringify(executionMemorySecrets);
  }
  if (config.effectTransactions.enabled) {
    env.PYPROC_EFFECT_TRANSACTIONS = "1";
    env.PYPROC_EFFECT_APPROVAL_AUTHORITIES = JSON.stringify(config.effectTransactions.approvalAuthorities);
    env.PYPROC_EFFECT_SECRET_BINDINGS = JSON.stringify(effectSecretBindings);
  }
  if (config.appSpace.enabled) env.PYPROC_APP_SPACE = JSON.stringify({
    apps: config.appSpace.apps,
    maxStateBytes: config.appSpace.maxStateBytes,
  });
  if (config.replayGraph.enabled) env.PYPROC_REPLAY_GRAPH = "1";
  if (config.actuation.enabled) {
    env.PYPROC_ACTUATION = "1";
    env.PYPROC_ACTUATION_VALUE_BINDINGS = JSON.stringify(effectSecretBindings);
  }
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
  const executionMemory = normalizedExecutionMemory(value.executionMemory, baseEnv);
  const browser = normalizedBrowser(value.browser);
  const effectTransactions = normalizedEffectTransactions(value.effectTransactions, {
    executionMemory: executionMemory.config, browser,
  });
  const appSpace = normalizedAppSpace(value.appSpace, {
    executionMemory: executionMemory.config, effectTransactions, browser,
  });
  const replayGraph = normalizedReplayGraph(value.replayGraph, { executionMemory: executionMemory.config });
  const actuation = normalizedActuation(value.actuation, {
    executionMemory: executionMemory.config, browser, appSpace,
  });
  const config = Object.freeze({
    schemaVersion: 1,
    engine: normalizedEngine(value.engine),
    browser,
    executionMemory: executionMemory.config,
    effectTransactions,
    appSpace,
    replayGraph,
    actuation,
    timeoutMs: value.timeoutMs === undefined ? 180000
      : positiveInteger(value.timeoutMs, "timeoutMs", 900000),
  });
  const env = projectedEnvironment(config, baseEnv, executionMemory.secretValues,
    effectTransactions.enabled || actuation.enabled ? executionMemory.secretBindings : {});
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
  const validationOptions = Object.hasOwn(options, "baseEnv") ? options : { ...options, baseEnv: process.env };
  return Object.freeze({ configPath, ...validateMcpProductConfig(input, validationOptions) });
}

export function applyMcpProductEnvironment(env) {
  for (const key of CONTROLLED_ENV) delete process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (CONTROLLED_ENV.includes(key)) process.env[key] = value;
  }
}
