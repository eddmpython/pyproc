// entranceCli.js - strict argument compiler for existing Machine Entrance commands.
import { isAbsolute, resolve } from "node:path";

const VALUE_OPTIONS = new Map([
  ["--recipe", "recipe"],
  ["--project-root", "projectRoot"],
  ["--out", "outputDir"],
  ["--engine-root", "engineRoot"],
  ["--engine-index-url", "engineIndexURL"],
  ["--browser", "executable"],
  ["--origin", "allowedOrigins"],
  ["--action", "actions"],
  ["--method", "methods"],
  ["--file-root", "fileRoots"],
  ["--max-risk", "maxRisk"],
  ["--purpose", "purpose"],
  ["--timeout-ms", "timeoutMs"],
  ["--viewport-width", "viewportWidth"],
  ["--viewport-height", "viewportHeight"],
  ["--device-scale-factor", "deviceScaleFactor"],
  ["--artifact-max-bytes", "artifactMaxBytes"],
  ["--artifact-total-bytes", "artifactTotalBytes"],
  ["--artifact-max-count", "artifactMaxCount"],
  ["--artifact-inline-bytes", "artifactInlineBytes"],
  ["--artifact-ttl-ms", "artifactTtlMs"],
  ["--recording-file", "recordingFile"],
  ["--recording-id", "recordingId"],
  ["--recording-sha256", "recordingSha256"],
  ["--start-cursor", "startCursor"],
  ["--prefix-sha256", "prefixSha256"],
  ["--execution-memory-root", "executionMemoryRoot"],
  ["--execution-memory-import-root", "executionMemoryImportRoots"],
  ["--execution-memory-secret-env", "executionMemorySecretEnv"],
]);
const REPEATABLE = new Set([
  "allowedOrigins", "actions", "methods", "fileRoots", "executionMemoryImportRoots",
  "executionMemorySecretEnv",
]);
const FLAG_OPTIONS = new Map([
  ["--acknowledge-effects", "acknowledgeEffects"],
  ["--overwrite", "overwrite"],
  ["--dry-run", "dryRun"],
  ["--headed", "headed"],
  ["--gpu", "gpu"],
  ["--mobile", "mobile"],
  ["--touch", "touch"],
]);

function positiveInteger(value, label, maximum) {
  if (!/^[1-9][0-9]*$/.test(value)) throw new TypeError(`${label} must be a positive integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) throw new TypeError(`${label} exceeds ${maximum}`);
  return number;
}

function nonnegativeInteger(value, label, maximum) {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new TypeError(`${label} must be a non-negative integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) throw new TypeError(`${label} exceeds ${maximum}`);
  return number;
}

function parseRaw(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (VALUE_OPTIONS.has(option)) {
      const key = VALUE_OPTIONS.get(option);
      const value = argv[++index];
      if (!value) throw new TypeError(`${option} requires a value`);
      if (REPEATABLE.has(key)) {
        if (!parsed[key]) parsed[key] = [];
        parsed[key].push(value);
      } else {
        if (parsed[key] !== undefined) throw new TypeError(`${option} may be provided once`);
        parsed[key] = value;
      }
    } else if (FLAG_OPTIONS.has(option)) {
      const key = FLAG_OPTIONS.get(option);
      if (parsed[key]) throw new TypeError(`${option} may be provided once`);
      parsed[key] = true;
    } else {
      throw new TypeError(`unknown pyproc-mcp init option: ${option}`);
    }
  }
  return parsed;
}

function recordingFrom(raw, projectRoot) {
  const present = ["recordingFile", "recordingId", "recordingSha256", "startCursor", "prefixSha256"]
    .some((key) => raw[key] !== undefined);
  if (!present) return undefined;
  if (!raw.recordingFile) throw new TypeError("replayPinned requires --recording-file");
  return {
    mode: "replay",
    file: isAbsolute(raw.recordingFile) ? raw.recordingFile : resolve(projectRoot, raw.recordingFile),
    ...(raw.recordingId === undefined ? {} : { recordingId: raw.recordingId }),
    ...(raw.recordingSha256 === undefined ? {} : { finalSha256: raw.recordingSha256 }),
    ...(raw.startCursor === undefined ? {} : {
      startCursor: nonnegativeInteger(raw.startCursor, "--start-cursor", 10000000),
    }),
    ...(raw.prefixSha256 === undefined ? {} : { prefixSha256: raw.prefixSha256 }),
  };
}

function viewportFrom(raw) {
  const present = ["viewportWidth", "viewportHeight", "deviceScaleFactor", "mobile", "touch"]
    .some((key) => raw[key] !== undefined);
  if (!present) return undefined;
  if (raw.viewportWidth === undefined || raw.viewportHeight === undefined) {
    throw new TypeError("viewport options require --viewport-width and --viewport-height");
  }
  let scale;
  if (raw.deviceScaleFactor !== undefined) {
    scale = Number(raw.deviceScaleFactor);
    if (!Number.isFinite(scale) || scale < 0.1 || scale > 4) {
      throw new TypeError("--device-scale-factor must be from 0.1 to 4");
    }
  }
  return {
    width: positiveInteger(raw.viewportWidth, "--viewport-width", 10000),
    height: positiveInteger(raw.viewportHeight, "--viewport-height", 10000),
    ...(scale === undefined ? {} : { deviceScaleFactor: scale }),
    ...(raw.mobile ? { mobile: true } : {}),
    ...(raw.touch ? { touch: true } : {}),
  };
}

function artifactsFrom(raw) {
  const mapping = [
    ["artifactMaxBytes", "maxArtifactBytes", "--artifact-max-bytes", 64 * 1024 * 1024],
    ["artifactTotalBytes", "maxTotalBytes", "--artifact-total-bytes", 512 * 1024 * 1024],
    ["artifactMaxCount", "maxArtifacts", "--artifact-max-count", 1024],
    ["artifactInlineBytes", "inlineMaxBytes", "--artifact-inline-bytes", 4 * 1024 * 1024],
    ["artifactTtlMs", "ttlMs", "--artifact-ttl-ms", 24 * 60 * 60 * 1000],
  ];
  const selected = mapping.filter(([rawKey]) => raw[rawKey] !== undefined);
  if (!selected.length) return undefined;
  return Object.fromEntries(selected.map(([rawKey, key, label, maximum]) => [key,
    positiveInteger(raw[rawKey], label, maximum)]));
}

function executionMemoryFrom(raw, projectRoot) {
  const present = ["executionMemoryRoot", "executionMemoryImportRoots", "executionMemorySecretEnv"]
    .some((key) => raw[key] !== undefined);
  if (!present) return undefined;
  if (!raw.executionMemoryRoot) {
    throw new TypeError("Execution Memory options require --execution-memory-root");
  }
  const absolute = (value) => isAbsolute(value) ? value : resolve(projectRoot, value);
  return {
    enabled: true,
    root: absolute(raw.executionMemoryRoot),
    importRoots: (raw.executionMemoryImportRoots || []).map(absolute),
    secretEnv: raw.executionMemorySecretEnv || [],
  };
}

export function parseMachineProfileInitArguments(argv, { cwd = process.cwd() } = {}) {
  if (!Array.isArray(argv)) throw new TypeError("pyproc-mcp init arguments must be an array");
  const raw = parseRaw(argv);
  const projectRoot = resolve(cwd, raw.projectRoot || ".");
  if (!raw.recipe) throw new TypeError("pyproc-mcp init requires --recipe");
  const recording = recordingFrom(raw, projectRoot);
  const viewport = viewportFrom(raw);
  const artifacts = artifactsFrom(raw);
  const executionMemory = executionMemoryFrom(raw, projectRoot);
  const profile = {
    recipe: raw.recipe,
    ...(raw.engineRoot === undefined ? {} : {
      engineRoot: isAbsolute(raw.engineRoot) ? raw.engineRoot : resolve(projectRoot, raw.engineRoot),
    }),
    ...(raw.engineIndexURL === undefined ? {} : { engineIndexURL: raw.engineIndexURL }),
    ...(raw.executable === undefined ? {} : { executable: raw.executable }),
    ...(raw.headed ? { headed: true } : {}),
    ...(raw.gpu ? { gpu: true } : {}),
    ...(raw.allowedOrigins === undefined ? {} : { allowedOrigins: raw.allowedOrigins }),
    ...(raw.actions === undefined ? {} : { actions: raw.actions }),
    ...(raw.methods === undefined ? {} : { methods: raw.methods }),
    ...(raw.fileRoots === undefined ? {} : { fileRoots: raw.fileRoots }),
    ...(raw.maxRisk === undefined ? {} : { maxRisk: raw.maxRisk }),
    ...(raw.purpose === undefined ? {} : { purpose: raw.purpose }),
    ...(raw.acknowledgeEffects ? { externalEffects: "acknowledged" } : {}),
    ...(raw.timeoutMs === undefined ? {} : {
      timeoutMs: positiveInteger(raw.timeoutMs, "--timeout-ms", 900000),
    }),
    ...(viewport === undefined ? {} : { viewport }),
    ...(artifacts === undefined ? {} : { artifacts }),
    ...(recording === undefined ? {} : { recording }),
    ...(executionMemory === undefined ? {} : { executionMemory }),
  };
  return Object.freeze({
    projectRoot,
    outputDir: raw.outputDir || ".pyproc",
    overwrite: raw.overwrite === true,
    dryRun: raw.dryRun === true,
    profile: Object.freeze(profile),
  });
}

function parseSingleValueOptions(argv, allowed, command) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const key = allowed.get(option);
    if (!key) throw new TypeError(`unknown ${command} option: ${option}`);
    const value = argv[++index];
    if (!value) throw new TypeError(`${option} requires a value`);
    if (parsed[key] !== undefined) throw new TypeError(`${option} may be provided once`);
    parsed[key] = value;
  }
  return parsed;
}

export function parseMachineDoctorArguments(argv) {
  const parsed = parseSingleValueOptions(argv, new Map([["--config", "config"]]), "pyproc-control doctor");
  if (!parsed.config) throw new TypeError("pyproc-control doctor requires --config <file>");
  return Object.freeze({ config: parsed.config });
}

export function parseMachineInvokeArguments(argv) {
  const parsed = parseSingleValueOptions(argv, new Map([
    ["--config", "config"], ["--operation", "operation"], ["--input", "input"],
    ["--timeout-ms", "timeoutMs"],
  ]), "pyproc-control invoke");
  if (!parsed.config) throw new TypeError("pyproc-control invoke requires --config <file>");
  if (!parsed.operation) throw new TypeError("pyproc-control invoke requires --operation <name>");
  let input = {};
  if (parsed.input !== undefined) {
    try { input = JSON.parse(parsed.input); }
    catch (error) { throw new TypeError(`--input must be JSON: ${error.message}`); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("--input must be a JSON object");
  }
  return Object.freeze({
    config: parsed.config,
    operation: parsed.operation,
    input: Object.freeze(input),
    ...(parsed.timeoutMs === undefined ? {} : {
      timeoutMs: positiveInteger(parsed.timeoutMs, "--timeout-ms", 900000),
    }),
  });
}

export function parseMachineRunArguments(argv) {
  const parsed = parseSingleValueOptions(argv, new Map([
    ["--config", "config"], ["--code", "code"], ["--timeout-ms", "timeoutMs"],
  ]), "pyproc-control run");
  if (!parsed.config) throw new TypeError("pyproc-control run requires --config <file>");
  if (parsed.code === undefined) throw new TypeError("pyproc-control run requires --code <python>");
  return Object.freeze({
    config: parsed.config,
    code: parsed.code,
    ...(parsed.timeoutMs === undefined ? {} : {
      timeoutMs: positiveInteger(parsed.timeoutMs, "--timeout-ms", 900000),
    }),
  });
}
