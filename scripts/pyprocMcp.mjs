#!/usr/bin/env node
// pyprocMcp.mjs - stable installed command for the persistent Python and scoped browser MCP server.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyMcpProductEnvironment, loadMcpProductConfig } from "./mcpProductConfig.mjs";
import { findBrowser } from "./browserControl/browserLauncher.mjs";
import { assertAutomationRecordingSelection, loadAutomationRecording } from "./automationSpace/automationRecording.js";
import { parseMachineProfileInitArguments } from "./machineEntrance/entranceCli.js";
import { initializeMachineProfile } from "./machineEntrance/profileInitializer.js";

const HELP = `Usage:
  pyproc-mcp init --recipe <name> --engine-root <directory> [options]
  pyproc-mcp --config <file> [--check]

Options:
  --config <file>  Version 1 product manifest with an engine and optional browser authority
  --check          Validate the manifest, engine, browser executable, and permissions, then exit
  --help           Show this help
  --version        Print the installed package version

Init recipes:
  pythonOnly        Browser automation authority remains closed
  observeLocal      Exact local origin with read actions and acknowledged initial navigation
  authorizedBrowser Explicit origins, actions, risk, purpose, and effect acknowledgement
  replayPinned      Exact recording identity and digest with no live provider

Run pyproc-mcp init with --dry-run to inspect paths without writing, and --overwrite to replace an
existing generated profile explicitly.
`;

const INIT_HELP = `Usage:
  pyproc-mcp init --recipe <name> (--engine-root <directory> | --engine-index-url <url>) [options]

Profile:
  --project-root <directory>  Existing project root, defaults to the current directory
  --out <directory>           Project-relative output, defaults to .pyproc
  --recipe <name>             pythonOnly, observeLocal, authorizedBrowser, or replayPinned
  --timeout-ms <n>            Product operation timeout
  --dry-run                   Compile and report paths without writing
  --overwrite                 Explicitly replace an existing generated profile

Browser authority:
  --browser <file>            Absolute Chromium-family executable
  --origin <origin>           Exact HTTP(S) origin, repeatable
  --action <name>             Allowed action, repeatable
  --method <name>             Allowed raw method, repeatable
  --file-root <directory>     Absolute guarded file root, repeatable
  --max-risk <risk>           Maximum fixed broker risk
  --purpose <text>            Explicit non-secret purpose
  --acknowledge-effects       Acknowledge the declared external-effect boundary
  --headed --gpu              Opt into headed or GPU browser process modes

Viewport and artifacts:
  --viewport-width <n> --viewport-height <n>
  --device-scale-factor <n> --mobile --touch
  --artifact-max-bytes <n> --artifact-total-bytes <n> --artifact-max-count <n>
  --artifact-inline-bytes <n> --artifact-ttl-ms <n>

Pinned replay:
  --recording-file <file> --recording-id <id> --recording-sha256 <sha256>
  --start-cursor <n> --prefix-sha256 <sha256>
`;

function parseArgs(argv) {
  let config = "";
  let check = false;
  let help = false;
  let version = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      config = argv[++index] || "";
      if (!config) throw new TypeError("--config requires a JSON file");
    } else if (arg === "--check") check = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--version" || arg === "-v") version = true;
    else throw new TypeError(`unknown pyproc-mcp option: ${arg}`);
  }
  return { config, check, help, version };
}

async function packageVersion() {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(await readFile(join(here, "..", "package.json"), "utf8")).version;
}

try {
  const argv = process.argv.slice(2);
  if (argv[0] === "init") {
    if (["--help", "-h"].includes(argv[1])) process.stdout.write(INIT_HELP);
    else {
      const initialized = await initializeMachineProfile(parseMachineProfileInitArguments(argv.slice(1)));
      process.stdout.write(`${JSON.stringify(initialized, null, 2)}\n`);
    }
  } else {
    const args = parseArgs(argv);
    if (args.help) {
    process.stdout.write(HELP);
    } else if (args.version) {
    process.stdout.write(`${await packageVersion()}\n`);
    } else {
      if (!args.config) throw new TypeError("pyproc-mcp requires --config <file>");
      const loaded = await loadMcpProductConfig(args.config);
      const browserExecutable = loaded.config.browser.enabled && loaded.config.browser.provider !== "replay"
        ? findBrowser({ executable: loaded.config.browser.executable })
        : null;
      if (args.check) {
        const replay = loaded.config.browser.provider === "replay"
          ? await loadAutomationRecording(loaded.config.browser.recording.file) : null;
        if (replay) assertAutomationRecordingSelection(replay, loaded.config.browser.recording, loaded.browserControl);
        process.stdout.write(`${JSON.stringify({
          ok: true,
          schemaVersion: loaded.config.schemaVersion,
          configPath: loaded.configPath,
          engine: loaded.config.engine.root ? { mode: "root", root: loaded.config.engine.root }
            : { mode: "indexURL", indexURL: loaded.config.engine.indexURL },
          browser: loaded.config.browser.enabled ? {
            enabled: true,
            provider: loaded.config.browser.provider,
            executable: browserExecutable,
            allowedOrigins: loaded.browserControl.targetOrigins,
            actions: loaded.browserControl.actions,
            rawMethods: loaded.browserControl.rawMethods,
            maxRisk: loaded.browserControl.maxRisk,
            artifacts: loaded.browserControl.artifacts,
            ...(loaded.config.browser.recording ? { recording: loaded.config.browser.recording } : {}),
            ...(replay ? { replay: { recordingId: replay.recordingId, entries: replay.entries.length,
              finalSha256: replay.finalSha256, sourceProvider: replay.provider.providerKind } } : {}),
          } : { enabled: false },
        }, null, 2)}\n`);
      } else {
        applyMcpProductEnvironment(loaded.env);
        await import("./mcpSandboxServer.mjs");
      }
    }
  }
} catch (error) {
  process.stderr.write(`pyproc-mcp: ${JSON.stringify({
    code: error?.code || "MACHINE_ENTRANCE_FAILED",
    message: String(error?.message || error),
    outcome: error?.outcome || "notSent",
    retryable: error?.retryable === true,
    nextCommand: process.argv[2] === "init"
      ? "Fix the reported init field and run pyproc-mcp init again."
      : "Fix the reported manifest or environment fact and run pyproc-control doctor again.",
  })}\n`);
  process.exitCode = 1;
}
