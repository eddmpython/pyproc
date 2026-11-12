#!/usr/bin/env node
// controlProtocolServer.mjs - 언어 중립 Control Protocol을 stdio NDJSON으로 제공한다.
import { createControlProduct } from "./controlProtocol/controlProduct.mjs";
import { ControlServer, controlReconnectFromEnvironment } from "./controlProtocol/controlServer.mjs";

const reconnect = controlReconnectFromEnvironment();
const product = await createControlProduct();
let shutdownPromise = null;

function shutdown(code = 0) {
  shutdownPromise ||= (async () => {
    const stopped = server.stop();
    try { await product.close(); } catch {}
    await stopped;
    await server.flush();
    process.exit(code);
  })();
  return shutdownPromise;
}

const server = new ControlServer({
  host: product.host,
  operations: product.operationCatalog.map((operation) => operation.name),
  reconnect,
  // Attached automation sessions are what a returning client can pick up again.
  holds: () => (product.browserControl?.attachedSessions() || 0) > 0,
  onEnd: (code) => void shutdown(code),
});

// A host that outlives its client keeps writing diagnostics to a stderr nobody reads.
process.stderr.on("error", () => {});
// A user-browser host without a Machine launches no browser of its own.
process.stderr.write(`pyproc control: ${product.browserSession?.browser || "the user's own browser"} -> ${
  product.pageUrl || "about:blank (browser-only host)"}\n`);
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

server.serve(process.stdin, process.stdout);
