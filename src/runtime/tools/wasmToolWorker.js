// wasmToolWorker.js - one bounded WASI command per isolated worker.
import { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory, Directory } from "../engines/wasi/browserWasiShim.js";

class OutputLimitError extends Error {}

function buildEntries(files, directories = []) {
  const root = new Map();
  for (const path of directories) {
    const parts = path.split("/").filter(Boolean);
    let node = root;
    for (const part of parts) {
      if (!node.has(part)) node.set(part, new Map());
      const child = node.get(part);
      if (!(child instanceof Map)) throw new TypeError(`Directory path collision: ${path}`);
      node = child;
    }
  }
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let node = root;
    for (let index = 0; index < parts.length - 1; index++) {
      if (!node.has(parts[index])) node.set(parts[index], new Map());
      const child = node.get(parts[index]);
      if (!(child instanceof Map)) throw new TypeError(`File path collision: ${file.path}`);
      node = child;
    }
    if (!parts.length || node.has(parts.at(-1))) throw new TypeError(`Duplicate file path: ${file.path}`);
    node.set(parts.at(-1), file.bytes);
  }
  const directory = (entries) => new Directory([...entries].map(([name, value]) => [
    name,
    value instanceof Map ? directory(value) : new File(value),
  ]));
  return [...root].map(([name, value]) => [name, value instanceof Map ? directory(value) : new File(value)]);
}

function snapshotFiles(directory, prefix = "") {
  const files = [];
  for (const [name, entry] of [...directory.contents.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const path = `${prefix}/${name}`;
    if (entry instanceof Directory) files.push(...snapshotFiles(entry, path));
    else if (entry instanceof File) files.push({ path, bytes: entry.data.slice() });
    else throw new TypeError(`Unsupported tool filesystem entry: ${path}`);
  }
  return files;
}

function outputSink(limit, state, onText) {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return { fd: new ConsoleStdout((bytes) => {
    state.bytes += bytes.byteLength;
    if (state.bytes > limit) throw new OutputLimitError(`Command output exceeded ${limit} bytes`);
    onText(decoder.decode(bytes, { stream: true }));
  }), flush: () => onText(decoder.decode()) };
}

self.onmessage = async (event) => {
  const message = event.data;
  if (message?.type !== "run") return;
  const startedAt = performance.now();
  let stdout = "";
  let stderr = "";
  let stdoutSink = null;
  let stderrSink = null;
  try {
    const output = { bytes: 0 };
    stdoutSink = outputSink(message.maxOutputBytes, output, (text) => { stdout += text; });
    stderrSink = outputSink(message.maxOutputBytes, output, (text) => { stderr += text; });
    const root = new PreopenDirectory("/", buildEntries(message.files, message.directories));
    const fds = [
      new OpenFile(new File(message.stdin)),
      stdoutSink.fd,
      stderrSink.fd,
      root,
    ];
    const wasi = new WASI([message.command, ...message.args], ["TERM=dumb", "NO_COLOR=1", "HOME=/home"], fds,
      { debug: false });
    const { instance } = await WebAssembly.instantiate(message.wasmBytes, {
      wasi_snapshot_preview1: wasi.wasiImport,
    });
    const exitCode = wasi.start(instance);
    stdoutSink.flush();
    stderrSink.flush();
    const files = message.captureFiles ? snapshotFiles(root.dir) : [];
    self.postMessage({ type: "result", requestId: message.requestId, ok: true,
      exitCode, stdout, stderr, files,
      workerDurationMs: Math.round(performance.now() - startedAt) },
    files.map((file) => file.bytes.buffer));
  } catch (error) {
    stdoutSink?.flush();
    stderrSink?.flush();
    self.postMessage({ type: "result", requestId: message.requestId, ok: false,
      error: String(error?.message || error).slice(-500),
      errorKind: error instanceof OutputLimitError ? "outputLimit" : "execution",
      stdout, stderr, workerDurationMs: Math.round(performance.now() - startedAt) });
  }
};
