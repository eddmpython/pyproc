#!/usr/bin/env node
// pyprocMcp.mjs - stable installed command for the persistent Python and scoped browser MCP server.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyMcpProductEnvironment, loadMcpProductConfig } from "./mcpProductConfig.mjs";
import { findBrowser } from "./browserControl/browserLauncher.mjs";

const HELP = `Usage: pyproc-mcp --config <file> [--check]

Options:
  --config <file>  Version 1 product manifest with an engine and optional browser authority
  --check          Validate the manifest, engine, browser executable, and permissions, then exit
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
    else throw new TypeError(`unknown pyproc-mcp option: ${arg}`);
  }
  return { config, check, help, version };
}

async function packageVersion() {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(await readFile(join(here, "..", "package.json"), "utf8")).version;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
  } else if (args.version) {
    process.stdout.write(`${await packageVersion()}\n`);
  } else {
    if (!args.config) throw new TypeError("pyproc-mcp requires --config <file>");
    const loaded = await loadMcpProductConfig(args.config);
    const browserExecutable = loaded.config.browser.enabled
      ? findBrowser({ executable: loaded.config.browser.executable })
      : null;
    if (args.check) {
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
        } : { enabled: false },
      }, null, 2)}\n`);
    } else {
      applyMcpProductEnvironment(loaded.env);
      await import("./mcpSandboxServer.mjs");
    }
  }
} catch (error) {
  process.stderr.write(`pyproc-mcp: ${error?.message || error}\n`);
  process.exitCode = 1;
}
