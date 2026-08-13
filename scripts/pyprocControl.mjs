#!/usr/bin/env node
// pyprocControl.mjs - Control Protocol 제품 진입점과 manifest preflight.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findBrowser } from "./browserControl/browserLauncher.mjs";
import { assertAutomationRecordingSelection, loadAutomationRecording } from "./automationSpace/automationRecording.js";
import { applyMcpProductEnvironment, loadMcpProductConfig } from "./mcpProductConfig.mjs";
import { PyProcControlClient } from "./controlProtocol/controlApi.js";
import {
  parseMachineDoctorArguments,
  parseMachineInvokeArguments,
  parseMachineRunArguments,
} from "./machineEntrance/entranceCli.js";
import { inspectMachineProfile } from "./machineEntrance/machineDoctor.js";

const HELP = `Usage:
  pyproc-control doctor --config <file>
  pyproc-control run --config <file> --code <python>
  pyproc-control invoke --config <file> --operation <name> [--input <json>]
  pyproc-control --config <file> [--check]

Options:
  --config <file>  Version 1 product manifest with an engine and optional automation authority
  --check          Validate the manifest, engine, browser executable, and permissions, then exit
  --timeout-ms <n> Bound one invoke request
  --help           Show this help
  --version        Print the installed package version
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
    else throw new TypeError(`unknown pyproc-control option: ${arg}`);
  }
  return { config, check, help, version };
}

async function packageVersion() {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(await readFile(join(here, "..", "package.json"), "utf8")).version;
}

try {
  const argv = process.argv.slice(2);
  if (argv[0] === "doctor") {
    const args = parseMachineDoctorArguments(argv.slice(1));
    const report = await inspectMachineProfile(args.config);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } else if (argv[0] === "run" || argv[0] === "invoke") {
    const args = argv[0] === "run" ? parseMachineRunArguments(argv.slice(1))
      : parseMachineInvokeArguments(argv.slice(1));
    const client = await PyProcControlClient.start(args.config);
    try {
      const operation = argv[0] === "run" ? "machine.run" : args.operation;
      const input = argv[0] === "run" ? { code: args.code } : args.input;
      const result = await client.request(operation, input,
        args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs });
      process.stdout.write(`${JSON.stringify({
        terminal: result.terminal,
        outcome: result.outcome,
        output: result.output,
        attachments: result.attachments.map((attachment) => ({
          attachmentId: attachment.attachmentId,
          kind: attachment.kind,
          mimeType: attachment.mimeType,
          byteLength: attachment.byteLength,
          sha256: attachment.sha256,
          dataBase64: Buffer.from(attachment.bytes).toString("base64"),
        })),
      }, null, 2)}\n`);
    } finally {
      await client.close();
    }
  } else {
    const args = parseArgs(argv);
    if (args.help) {
    process.stdout.write(HELP);
    } else if (args.version) {
    process.stdout.write(`${await packageVersion()}\n`);
    } else {
      if (!args.config) throw new TypeError("pyproc-control requires --config <file>");
      const loaded = await loadMcpProductConfig(args.config);
      const browserExecutable = findBrowser({ executable: loaded.config.browser.enabled
        ? loaded.config.browser.executable : undefined });
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
          machineBrowser: browserExecutable,
          automation: loaded.config.browser.enabled ? {
            enabled: true,
            provider: loaded.config.browser.provider,
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
        await import("./controlProtocolServer.mjs");
      }
    }
  }
} catch (error) {
  process.stderr.write(`pyproc-control: ${JSON.stringify({
    code: error?.code || "MACHINE_ENTRANCE_FAILED",
    message: String(error?.message || error),
    outcome: error?.outcome || "notSent",
    retryable: error?.retryable === true,
    ...(error?.details === undefined ? {} : { details: error.details }),
  })}\n`);
  process.exitCode = 1;
}
