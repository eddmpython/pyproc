#!/usr/bin/env node
// pyprocPlayground.mjs - 설치 패키지 그래프에서 첫 Python을 여는 소비자 명령.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { firstSuccessProbe } from "./playground/firstSuccessContract.js";
import { createPlaygroundServer, PLAYGROUND_PAGE_PATH } from "./playground/playgroundServer.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PORT = 8790;

const HELP = `Usage:
  pyproc-playground [--port <n>]
  pyproc-playground --probe
  pyproc-playground --help

Serve the installed pyproc package with Cross-Origin-Opener-Policy and
Cross-Origin-Embedder-Policy, then open the first-success page.

Options:
  --port <n>  Listen port (default ${DEFAULT_PORT}; 0 binds an ephemeral port)
  --probe     Print the first-success contract as JSON and exit
  --help      Show this help
`;

function parseArgs(argv) {
  const options = { probe: false, port: DEFAULT_PORT };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") return { help: true };
    if (token === "--probe") { options.probe = true; continue; }
    if (token === "--port") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 0) throw new TypeError("--port must be a non-negative integer");
      options.port = value;
      continue;
    }
    throw new TypeError(`unknown option: ${token}`);
  }
  return options;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  const probe = firstSuccessProbe();
  if (options.probe) {
    process.stdout.write(`${JSON.stringify(probe)}\n`);
    process.exit(0);
  }
  const server = createPlaygroundServer({ root: PACKAGE_ROOT });
  await new Promise((resolveListen) => server.listen(options.port, "127.0.0.1", resolveListen));
  const address = server.address();
  process.stdout.write(`pyproc playground\n  package: ${PACKAGE_ROOT}\n  url: http://127.0.0.1:${address.port}${PLAYGROUND_PAGE_PATH}\n  python: ${probe.python}\n`);
}
