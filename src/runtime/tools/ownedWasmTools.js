// ownedWasmTools.js - source-pinned WASI command identity and immutable runtime limits.

export const OWNED_WASM_TOOL_PROTOCOL = "pyproc.wasm-tool-layer";
export const OWNED_WASM_TOOL_VERSION = 1;

export const OWNED_WASM_TOOL_LIMITS = Object.freeze({
  maxArgs: 128,
  maxArgBytes: 16 * 1024,
  maxFiles: 1024,
  maxFileBytes: 8 * 1024 * 1024,
  maxSnapshotBytes: 32 * 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
  maxStdinBytes: 1024 * 1024,
  defaultTimeoutMs: 15000,
  maxTimeoutMs: 60000,
});

const RIPGREP = Object.freeze({
  command: "rg",
  version: "15.1.0",
  revision: "af60c2de9d85e7f3d81c78601669468cf02dabab",
  target: "wasm32-wasip1",
  binaryPath: "src/runtime/tools/owned/rg.wasm",
  binarySha256: "sha256:4d89e862853619ad81e3104bb97a725b5db6793932569831bebda9496d81812a",
  byteLength: 2193626,
  source: "https://github.com/BurntSushi/ripgrep",
  sourceTag: "15.1.0",
  license: "MIT OR Unlicense",
  capabilities: Object.freeze(["recursive-search", "regex", "glob", "file-type-filter"]),
});

export const OWNED_WASM_TOOLS = Object.freeze([RIPGREP]);

export function ownedWasmToolURL(tool = RIPGREP) {
  if (tool.command !== "rg") throw new TypeError(`Unsupported owned tool: ${String(tool.command)}`);
  return new URL("./owned/rg.wasm", import.meta.url).href;
}

export function inspectOwnedWasmTools() {
  return Object.freeze({
    protocol: OWNED_WASM_TOOL_PROTOCOL,
    version: OWNED_WASM_TOOL_VERSION,
    execution: "isolated-worker",
    filesystem: "read-only-input-snapshot",
    network: false,
    shellParsing: false,
    limits: OWNED_WASM_TOOL_LIMITS,
    commands: Object.freeze(OWNED_WASM_TOOLS.map((tool) => Object.freeze({ ...tool }))),
  });
}
