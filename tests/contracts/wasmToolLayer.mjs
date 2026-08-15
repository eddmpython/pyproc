import { readFile } from "node:fs/promises";

import { MachineToolHostBridge } from "../../src/machine/composition/machineToolHostBridge.js";
import { sha256Address } from "../../src/runtime/contentDigest.js";
import { wasi as wasiAbi } from "../../src/runtime/engines/wasi/browserWasiShim.js";
import { HOSTCALL_ERROR, HOSTCALL_OPCODE, HOSTCALL_STATE } from "../../src/runtime/kernel/hostcallProtocol.js";
import { OwnedWasmToolLayer } from "../../src/runtime/tools/ownedWasmToolLayer.js";
import { OWNED_WASM_TOOLS, inspectOwnedWasmTools } from "../../src/runtime/tools/ownedWasmTools.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejectsCode(operation, expected) {
  let actual = null;
  try { await operation(); }
  catch (error) { actual = error?.code || String(error); }
  assert(actual === expected, `expected ${expected}, got ${actual}`);
}

function request(requestKey, opcode, value) {
  return { requestKey, opcode, flags: 0, payload: encoder.encode(JSON.stringify(value)),
    responseCapacity: 1 << 20, deadlineMs: 1000, authorityRef: "authority:test",
    commandId: "command:test", kernelRef: "kernel:test" };
}

export async function assertWasmToolLayer() {
  const filestatBuffer = new ArrayBuffer(64);
  const filestatView = new DataView(filestatBuffer);
  const filestat = new wasiAbi.Filestat(3n, wasiAbi.FILETYPE_REGULAR_FILE, 7n);
  filestat.atim = 11n;
  filestat.mtim = 13n;
  filestat.ctim = 17n;
  filestat.write_bytes(filestatView, 0);
  assert(filestatView.getBigUint64(0, true) === 0n
    && filestatView.getBigUint64(8, true) === 3n
    && filestatView.getUint8(16) === wasiAbi.FILETYPE_REGULAR_FILE
    && filestatView.getBigUint64(24, true) === 0n
    && filestatView.getBigUint64(32, true) === 7n
    && filestatView.getBigUint64(40, true) === 11n
    && filestatView.getBigUint64(48, true) === 13n
    && filestatView.getBigUint64(56, true) === 17n,
  "WASI Preview1 filestat layout drifted");

  const contract = inspectOwnedWasmTools();
  const tool = OWNED_WASM_TOOLS[0];
  const git = OWNED_WASM_TOOLS[1];
  assert(contract.protocol === "pyproc.wasm-tool-layer" && contract.version === 1
    && contract.execution === "isolated-worker" && contract.filesystem === "per-command-snapshot-policy"
    && contract.network === false && contract.shellParsing === false
    && contract.commands.length === 2 && tool.command === "rg" && tool.version === "15.1.0"
    && tool.revision === "af60c2de9d85e7f3d81c78601669468cf02dabab"
    && tool.filesystem === "read-only-input-snapshot" && git.command === "git" && git.version === "1.9.7"
    && git.revision === "49e408b3208bc3093757a1c2db938d3590f3f412"
    && git.filesystem === "transactional-kernel-vfs" && git.network === false,
  "owned WASI tool identity or confinement drifted");

  const binary = await readFile(new URL("../../src/runtime/tools/owned/rg.wasm", import.meta.url));
  assert(binary.byteLength === tool.byteLength && await sha256Address(binary) === tool.binarySha256,
    "owned rg binary does not match its immutable manifest");
  const gitBinary = await readFile(new URL("../../src/runtime/tools/owned/git.wasm", import.meta.url));
  assert(gitBinary.byteLength === git.byteLength && await sha256Address(gitBinary) === git.binarySha256,
    "owned Git binary does not match its immutable manifest");

  const layer = new OwnedWasmToolLayer({ fetchImpl: async () => new Response(new Uint8Array(tool.byteLength)) });
  await rejectsCode(() => layer.run("shell", []), "PYPROC_INPUT_INVALID");
  await rejectsCode(() => layer.run("rg", ["x".repeat(contract.limits.maxArgBytes + 1)]), "PYPROC_INPUT_INVALID");
  await rejectsCode(() => layer.run("rg", [], { files: { "/home/bad\0.txt": "x" } }), "PYPROC_INPUT_INVALID");
  await rejectsCode(() => layer.run("git", []), "PYPROC_INPUT_INVALID");
  await rejectsCode(() => layer.run("git", [], { files: {} }), "PYPROC_INPUT_INVALID");
  await rejectsCode(() => layer.run("rg", [], { files: {} }), "PYPROC_ASSET_INTEGRITY");
  layer.close();
  await rejectsCode(() => layer.run("rg", []), "PYPROC_PROCESS_UNAVAILABLE");

  const calls = [];
  const bridge = new MachineToolHostBridge();
  bridge.attach("kernel:test", {
    inspect: () => contract,
    async run(command, args, options) {
      calls.push({ command, args, options });
      return { protocol: "pyproc.wasm-tool-receipt", command, exitCode: 0, stdout: "ok", stderr: "" };
    },
  });
  const inspected = await bridge.dispatch(request("tool:inspect", HOSTCALL_OPCODE.toolInspect, {}));
  const inspection = JSON.parse(decoder.decode(inspected.bytes));
  const ran = await bridge.dispatch(request("tool:run", HOSTCALL_OPCODE.toolRun,
    { command: "rg", args: ["--version"], options: { timeoutMs: 2500 } }));
  const receipt = JSON.parse(decoder.decode(ran.bytes));
  const invalid = await bridge.dispatch(request("tool:invalid", HOSTCALL_OPCODE.toolRun,
    { command: "rg", args: "not-an-array" }));
  assert(HOSTCALL_OPCODE.toolRun === 0x0400 && HOSTCALL_OPCODE.toolInspect === 0x0401
    && inspected.state === HOSTCALL_STATE.response
    && inspection.protocol === "pyproc.python-tool-bridge" && inspection.argvOnly === true
    && ran.state === HOSTCALL_STATE.response && receipt.protocol === "pyproc.wasm-tool-receipt"
    && calls.length === 1 && calls[0].args[0] === "--version" && calls[0].options.timeoutMs === 2500
    && invalid.state === HOSTCALL_STATE.error && invalid.errorCode === HOSTCALL_ERROR.provider,
  "Python argv tool bridge opcode, routing, receipt, or known-outcome failure drifted");
  bridge.close();
  const closed = await bridge.dispatch(request("tool:closed", HOSTCALL_OPCODE.toolInspect, {}));
  assert(closed.state === HOSTCALL_STATE.brokerLost && closed.errorCode === HOSTCALL_ERROR.brokerLost,
    "closed Python tool bridge did not fail closed");
}
