#!/usr/bin/env node
// pyprocControl.mjs - Control Protocol 제품 진입점과 manifest preflight.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
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
  pyproc-control eyes audit --config <file> --contract-root <dir> --repository-root <dir> --output-dir <relative-dir> --environment <id>
  pyproc-control eyes verify --config <file> --reference-dir <dir> --current-dir <dir>
  pyproc-control eyes replay --config <file> --pack-dir <dir>
  pyproc-control --config <file> [--check]

Options:
  --config <file>  Version 1 product manifest with an engine and optional automation authority
  --check          Validate the manifest, engine, browser executable, and permissions, then exit
  --timeout-ms <n> Bound one invoke request
  --help           Show this help
  --version        Print the installed package version
`;

function parseEyesArgs(argv) {
  const mode = argv[0];
  if (!new Set(["audit", "verify", "replay"]).has(mode)) {
    throw new TypeError("eyes requires audit, verify, or replay");
  }
  const values = {};
  const names = new Map([
    ["--config", "config"], ["--contract-root", "contractRoot"],
    ["--repository-root", "repositoryRoot"], ["--output-dir", "outputDir"],
    ["--environment", "environmentId"], ["--reference-dir", "referenceDir"],
    ["--current-dir", "currentDir"], ["--pack-dir", "packDir"],
    ["--timeout-ms", "timeoutMs"],
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const key = names.get(argv[index]);
    if (!key) throw new TypeError(`unknown eyes option: ${argv[index]}`);
    const value = argv[++index];
    if (!value) throw new TypeError(`${argv[index - 1]} requires a value`);
    values[key] = key === "timeoutMs" ? Number(value) : value;
  }
  const required = mode === "audit" ? ["config", "contractRoot", "repositoryRoot", "outputDir", "environmentId"]
    : mode === "verify" ? ["config", "referenceDir", "currentDir"] : ["config", "packDir"];
  for (const key of required) if (!values[key]) throw new TypeError(`eyes ${mode} requires ${key}`);
  if (values.timeoutMs !== undefined && (!Number.isFinite(values.timeoutMs) || values.timeoutMs < 1)) {
    throw new TypeError("--timeout-ms must be positive");
  }
  return Object.freeze({ mode, ...values });
}

function gitBytes(repositoryRoot, args) {
  try { return execFileSync("git", ["-C", repositoryRoot, ...args], { encoding: "buffer", windowsHide: true }); }
  catch (error) { throw new Error(`repository identity failed: git ${args.join(" ")}`); }
}

function repositoryIdentity(repositoryRoot) {
  const commit = gitBytes(repositoryRoot, ["rev-parse", "HEAD"]).toString("utf8").trim();
  const tree = gitBytes(repositoryRoot, ["rev-parse", "HEAD^{tree}"]);
  const diff = gitBytes(repositoryRoot, ["diff", "--binary", "HEAD", "--", "."]);
  const untracked = gitBytes(repositoryRoot, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const diffHash = createHash("sha256").update(diff).update(Buffer.from([0])).update(untracked).digest("hex");
  return Object.freeze({ commit,
    treeSha256: `sha256:${createHash("sha256").update(tree).digest("hex")}`,
    diffSha256: `sha256:${diffHash}`, untracked: untracked.byteLength > 0 });
}

function printableResult(result) {
  return {
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
  };
}

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
  } else if (argv[0] === "eyes") {
    const args = parseEyesArgs(argv.slice(1));
    const client = await PyProcControlClient.start(args.config);
    try {
      const requestOptions = args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs };
      const result = args.mode === "audit"
        ? await client.auditExperience(resolve(args.contractRoot), { repositoryRoot: resolve(args.repositoryRoot),
          outputDir: args.outputDir, environmentId: args.environmentId,
          repository: repositoryIdentity(resolve(args.repositoryRoot)), ...requestOptions })
        : args.mode === "verify"
          ? await client.verifyExperience(resolve(args.referenceDir), resolve(args.currentDir), requestOptions)
          : await client.replayEvidencePack(resolve(args.packDir), requestOptions);
      process.stdout.write(`${JSON.stringify(printableResult(result), null, 2)}\n`);
      if (result.output.verdict === "rejected") process.exitCode = 1;
      else if (result.output.verdict === "incomplete") process.exitCode = 2;
    } finally {
      await client.close();
    }
  } else if (argv[0] === "run" || argv[0] === "invoke") {
    const args = argv[0] === "run" ? parseMachineRunArguments(argv.slice(1))
      : parseMachineInvokeArguments(argv.slice(1));
    const client = await PyProcControlClient.start(args.config);
    try {
      const operation = argv[0] === "run" ? "machine.run" : args.operation;
      const input = argv[0] === "run" ? { code: args.code } : args.input;
      const result = await client.request(operation, input,
        args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs });
      process.stdout.write(`${JSON.stringify(printableResult(result), null, 2)}\n`);
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
          executionMemory: loaded.config.executionMemory.enabled ? {
            enabled: true,
            root: loaded.config.executionMemory.root,
            importRoots: loaded.config.executionMemory.importRoots,
            secretEnv: loaded.config.executionMemory.secretEnv,
          } : { enabled: false },
          effectTransactions: loaded.config.effectTransactions.enabled ? {
            enabled: true,
            approvalAuthorities: loaded.config.effectTransactions.approvalAuthorities,
          } : { enabled: false },
          appSpace: loaded.config.appSpace.enabled ? loaded.config.appSpace : { enabled: false },
          replayGraph: loaded.config.replayGraph,
          actuation: loaded.config.actuation,
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
