import { readFile } from "node:fs/promises";

import { sha256Address } from "../../src/runtime/contentDigest.js";
import { OwnedWasmToolLayer } from "../../src/runtime/tools/ownedWasmToolLayer.js";
import { OWNED_WASM_TOOLS, inspectOwnedWasmTools } from "../../src/runtime/tools/ownedWasmTools.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejectsCode(operation, expected) {
  let actual = null;
  try { await operation(); }
  catch (error) { actual = error?.code || String(error); }
  assert(actual === expected, `expected ${expected}, got ${actual}`);
}

export async function assertWasmToolLayer() {
  const contract = inspectOwnedWasmTools();
  const tool = OWNED_WASM_TOOLS[0];
  assert(contract.protocol === "pyproc.wasm-tool-layer" && contract.version === 1
    && contract.execution === "isolated-worker" && contract.filesystem === "read-only-input-snapshot"
    && contract.network === false && contract.shellParsing === false
    && contract.commands.length === 1 && tool.command === "rg" && tool.version === "15.1.0"
    && tool.revision === "af60c2de9d85e7f3d81c78601669468cf02dabab",
  "owned WASI tool identity or confinement drifted");

  const binary = await readFile(new URL("../../src/runtime/tools/owned/rg.wasm", import.meta.url));
  assert(binary.byteLength === tool.byteLength && await sha256Address(binary) === tool.binarySha256,
    "owned rg binary does not match its immutable manifest");

  const layer = new OwnedWasmToolLayer({ fetchImpl: async () => new Response(new Uint8Array(tool.byteLength)) });
  await rejectsCode(() => layer.run("shell", []), "PYPROC_INPUT_INVALID");
  await rejectsCode(() => layer.run("rg", ["x".repeat(contract.limits.maxArgBytes + 1)]), "PYPROC_INPUT_INVALID");
  await rejectsCode(() => layer.run("rg", [], { files: { "/home/bad\0.txt": "x" } }), "PYPROC_INPUT_INVALID");
  await rejectsCode(() => layer.run("rg", [], { files: {} }), "PYPROC_ASSET_INTEGRITY");
  layer.close();
  await rejectsCode(() => layer.run("rg", []), "PYPROC_PROCESS_UNAVAILABLE");
}
