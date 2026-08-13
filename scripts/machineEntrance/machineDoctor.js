// machineDoctor.js - effect-free, actionable preflight for one strict Machine profile.
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFrameSpaceTools } from "../automationSpace/frameSpaceTools.js";
import { assertAutomationRecordingSelection, loadAutomationRecording } from "../automationSpace/automationRecording.js";
import { createBrowserControlTools } from "../browserControl/mcpBrowserControl.js";
import { findBrowser } from "../browserControl/browserLauncher.mjs";
import { CONTROL_PYTHON_TOOLS } from "../controlProtocol/controlProduct.mjs";
import { controlOperationCatalog } from "../controlProtocol/controlOperations.js";
import { loadMcpProductConfig } from "../mcpProductConfig.mjs";
import { inspectEngineDistribution } from "./engineInspection.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function check(code, severity, explanation, details = {}) {
  return Object.freeze({ code, severity, explanation, ...details });
}

function safeNext(configPath) {
  return Object.freeze({
    doctor: `pyproc-control doctor --config "${configPath}"`,
    start: `pyproc-control --config "${configPath}"`,
    run: `pyproc-control run --config "${configPath}" --code "40 + 2"`,
  });
}

async function installedVersion(packageRoot) {
  const value = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  if (typeof value.version !== "string") throw new Error("installed package version is unavailable");
  return value.version;
}

async function automationFacts(loaded) {
  if (!loaded.config.browser.enabled) {
    return Object.freeze({ enabled: false, provider: null, cdpEndpoint: false, operations: [] });
  }
  const provider = loaded.config.browser.provider;
  let replay = null;
  if (provider === "replay") {
    replay = await loadAutomationRecording(loaded.config.browser.recording.file);
    assertAutomationRecordingSelection(replay, loaded.config.browser.recording, loaded.browserControl);
  }
  const frameTools = provider === "frame" || (provider === "replay" && replay.provider.providerKind === "frame");
  const tools = frameTools ? createFrameSpaceTools(loaded.browserControl)
    : createBrowserControlTools(loaded.browserControl);
  return Object.freeze({
    enabled: true,
    provider,
    cdpEndpoint: provider === "nativeCdp",
    operations: controlOperationCatalog(tools).map((entry) => entry.name),
    ...(replay ? { replay: Object.freeze({ recordingId: replay.recordingId, entries: replay.entries.length,
      finalSha256: replay.finalSha256, sourceProvider: replay.provider.providerKind }) } : {}),
  });
}

export async function inspectMachineProfile(configPath, {
  browserFinder = findBrowser,
  engineInspector = inspectEngineDistribution,
  packageRoot = PACKAGE_ROOT,
} = {}) {
  const resolvedConfig = resolve(configPath);
  const checks = [];
  let loaded;
  try {
    loaded = await loadMcpProductConfig(resolvedConfig);
    checks.push(check("MACHINE_MANIFEST_VALID", "pass", "The strict version 1 manifest is valid."));
  } catch (error) {
    checks.push(check("MACHINE_MANIFEST_BLOCKED", "blocking", String(error?.message || error), {
      nextCommand: `Fix the reported manifest field, then run pyproc-control doctor --config "${resolvedConfig}"`,
    }));
    return Object.freeze({ ok: false, configPath: resolvedConfig, checks: Object.freeze(checks),
      blocking: Object.freeze(checks.filter((entry) => entry.severity === "blocking")),
      advisory: Object.freeze([]), next: safeNext(resolvedConfig) });
  }

  try {
    const version = await installedVersion(packageRoot);
    checks.push(check("MACHINE_PACKAGE_EXACT", "pass", `Installed pyproc package version ${version}.`, { version }));
  } catch (error) {
    checks.push(check("MACHINE_PACKAGE_BLOCKED", "blocking", String(error?.message || error)));
  }

  if (loaded.config.engine.root) {
    try {
      const engine = await engineInspector(loaded.config.engine.root);
      checks.push(check("MACHINE_ENGINE_VERIFIED", "pass",
        `Local engine ${engine.version} passed core and package digest verification.`, { engine }));
    } catch (error) {
      checks.push(check(error?.code || "MACHINE_ENGINE_BLOCKED", "blocking", String(error?.message || error), {
        nextCommand: `pyproc-engine --out "${loaded.config.engine.root}"`,
      }));
    }
  } else {
    checks.push(check("MACHINE_ENGINE_REMOTE", "advisory",
      "The immutable engine URL is syntactically valid; local bytes cannot be verified before retrieval.",
    { indexURL: loaded.config.engine.indexURL }));
  }

  try {
    const browser = browserFinder({ executable: loaded.config.browser.executable });
    checks.push(check("MACHINE_BROWSER_FOUND", "pass", "A supported Chromium-family Machine host was found.",
      { executable: browser }));
  } catch (error) {
    checks.push(check("MACHINE_BROWSER_BLOCKED", "blocking", String(error?.message || error), {
      nextCommand: "Set browser.executable to an absolute supported Chromium-family executable, then run doctor again.",
    }));
  }

  let automation = null;
  try {
    automation = await automationFacts(loaded);
    const pythonOperations = controlOperationCatalog(CONTROL_PYTHON_TOOLS).map((entry) => entry.name);
    checks.push(check(automation.enabled ? "MACHINE_AUTOMATION_AUTHORITY" : "MACHINE_AUTOMATION_CLOSED", "pass",
      automation.enabled
        ? `Automation provider ${automation.provider} is bounded by the expanded manifest.`
        : "Automation authority, browser actions, and the CDP endpoint are closed.",
    { automation, pythonOperations }));
  } catch (error) {
    checks.push(check("MACHINE_AUTOMATION_BLOCKED", "blocking", String(error?.message || error)));
  }

  checks.push(check("MACHINE_PROFILE_EPHEMERAL", "pass",
    "Runtime browser profiles are product-owned temporary directories; no default user profile is configured."));
  checks.push(check("MACHINE_TARGET_NOT_PROBED", "advisory",
    "Doctor does not send a network request. Target readiness is verified when the caller opens an allowed URL."));
  checks.push(check("MACHINE_PREFLIGHT_EFFECT_FREE", "pass",
    "Preflight did not launch a browser, create a profile, open a CDP endpoint, or send a target request."));

  const blocking = checks.filter((entry) => entry.severity === "blocking");
  const advisory = checks.filter((entry) => entry.severity === "advisory");
  return Object.freeze({
    ok: blocking.length === 0,
    schemaVersion: loaded.config.schemaVersion,
    configPath: loaded.configPath,
    checks: Object.freeze(checks),
    blocking: Object.freeze(blocking),
    advisory: Object.freeze(advisory),
    automation,
    next: safeNext(loaded.configPath),
  });
}
