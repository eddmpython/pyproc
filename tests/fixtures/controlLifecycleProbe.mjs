import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PyProcControlClient } from "../../scripts/controlProtocol/controlApi.js";
import { controlBase, decodeControlFrame, encodeControlFrame }
  from "../../scripts/controlProtocol/controlProtocol.js";

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const selfPath = fileURLToPath(import.meta.url);

if (process.argv.includes("--fixture-server")) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on("line", (line) => {
    const frame = decodeControlFrame(line);
    if (frame.type !== "hello") return;
    process.stdout.write(encodeControlFrame({
      ...controlBase("hello"),
      requestId: frame.requestId,
      role: "server",
      peer: { name: "lifecycle-fixture", version: "1" },
      capabilities: { cancel: true, events: false,
        attachments: { encoding: "base64", maxChunkBytes: 262144 } },
      operations: [],
    }));
  });
} else if (invokedPath === selfPath) {
  const client = await PyProcControlClient.start("fixture-config.json", {
    command: [process.execPath, selfPath, "--fixture-server"],
    startupTimeoutMs: 5000,
    shutdownTimeoutMs: 250,
  });
  await client.close();
}
