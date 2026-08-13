// machineProfile.js - named authority recipes compiled into the existing strict product manifest.
import { validateMcpProductConfig } from "../mcpProductConfig.mjs";

export const MACHINE_PROFILE_RECIPES = Object.freeze([
  "pythonOnly",
  "observeLocal",
  "authorizedBrowser",
  "replayPinned",
]);

const INPUT_KEYS = new Set([
  "recipe", "engineRoot", "engineIndexURL", "timeoutMs", "executable", "headed", "gpu",
  "allowedOrigins", "actions", "methods", "fileRoots", "maxRisk", "externalEffects", "purpose",
  "artifacts", "viewport", "recording",
]);
const BROWSER_INPUT_KEYS = Object.freeze([...INPUT_KEYS].filter((key) => ![
  "recipe", "engineRoot", "engineIndexURL", "timeoutMs",
].includes(key)));
const OBSERVE_ACTIONS = Object.freeze(["snapshot", "screenshot", "waitFor"]);

function plainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function rejectUnknownKeys(input) {
  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.has(key)) throw new TypeError(`Machine Entrance profile does not accept ${key}`);
  }
}

function engineFrom(input) {
  if (Number(input.engineRoot !== undefined) + Number(input.engineIndexURL !== undefined) !== 1) {
    throw new TypeError("Machine Entrance profile requires exactly one of engineRoot or engineIndexURL");
  }
  return input.engineRoot !== undefined ? { root: input.engineRoot } : { indexURL: input.engineIndexURL };
}

function requiredArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a non-empty array`);
  return value;
}

function requireExplicitText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be explicit non-empty text`);
  const text = value.trim();
  if (/(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*\S+/i.test(text)) {
    throw new TypeError(`${label} must not contain secret material`);
  }
  return text;
}

function commonBrowser(input, { provider, actions, maxRisk }) {
  return {
    enabled: true,
    provider,
    ...(input.executable === undefined ? {} : { executable: input.executable }),
    ...(input.headed === undefined ? {} : { headed: input.headed }),
    ...(input.gpu === undefined ? {} : { gpu: input.gpu }),
    allowedOrigins: requiredArray(input.allowedOrigins, "allowedOrigins"),
    maxRisk,
    actions,
    methods: input.methods === undefined ? [] : input.methods,
    fileRoots: input.fileRoots === undefined ? [] : input.fileRoots,
    externalEffects: input.externalEffects || "",
    purpose: input.purpose || "",
    ...(input.artifacts === undefined ? {} : { artifacts: input.artifacts }),
    ...(input.viewport === undefined ? {} : { viewport: input.viewport }),
    ...(input.recording === undefined ? {} : { recording: input.recording }),
  };
}

function assertPythonOnly(input) {
  const leaked = BROWSER_INPUT_KEYS.find((key) => input[key] !== undefined);
  if (leaked) throw new TypeError(`pythonOnly does not accept ${leaked}`);
  return { enabled: false };
}

function observeLocalBrowser(input) {
  for (const key of ["actions", "methods", "fileRoots", "maxRisk", "recording"]) {
    if (input[key] !== undefined) throw new TypeError(`observeLocal does not accept ${key}`);
  }
  requireExplicitText(input.purpose, "observeLocal purpose");
  if (input.externalEffects !== "acknowledged") {
    throw new TypeError("observeLocal requires externalEffects acknowledged for initial navigation");
  }
  return commonBrowser(input, { provider: "nativeCdp", actions: OBSERVE_ACTIONS, maxRisk: "externalEffect" });
}

function authorizedBrowser(input) {
  const actions = requiredArray(input.actions, "authorizedBrowser actions");
  const maxRisk = requireExplicitText(input.maxRisk, "authorizedBrowser maxRisk");
  requireExplicitText(input.purpose, "authorizedBrowser purpose");
  if (input.recording !== undefined) throw new TypeError("authorizedBrowser does not accept recording");
  return commonBrowser(input, { provider: "nativeCdp", actions, maxRisk });
}

function replayPinnedBrowser(input) {
  const actions = requiredArray(input.actions, "replayPinned actions");
  const maxRisk = requireExplicitText(input.maxRisk, "replayPinned maxRisk");
  requireExplicitText(input.purpose, "replayPinned purpose");
  if (!input.recording) throw new TypeError("replayPinned requires recording pins");
  if (input.executable !== undefined || input.headed !== undefined || input.gpu !== undefined) {
    throw new TypeError("replayPinned does not accept a live browser executable or process option");
  }
  return commonBrowser(input, { provider: "replay", actions, maxRisk });
}

export function compileMachineProfile(input) {
  const value = plainObject(input, "Machine Entrance profile");
  rejectUnknownKeys(value);
  if (!MACHINE_PROFILE_RECIPES.includes(value.recipe)) {
    throw new TypeError(`Machine Entrance recipe must be one of ${MACHINE_PROFILE_RECIPES.join(", ")}`);
  }
  const browser = value.recipe === "pythonOnly" ? assertPythonOnly(value)
    : value.recipe === "observeLocal" ? observeLocalBrowser(value)
      : value.recipe === "authorizedBrowser" ? authorizedBrowser(value)
        : replayPinnedBrowser(value);
  return validateMcpProductConfig({
    schemaVersion: 1,
    engine: engineFrom(value),
    browser,
    ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs }),
  }).config;
}

export function serializeMachineProfile(input) {
  return `${JSON.stringify(compileMachineProfile(input), null, 2)}\n`;
}
