// guestWorker.js - the worker side of the workerGuest campaign: a pyproc kernel hosted off the main
// thread, driven by the same request shapes the in-process adapter accepts.
//
// This is deliberately thin. The question the campaign asks is whether the *adapter contract* is the
// right seam, so this file does the minimum needed to answer it: boot a kernel, run code, answer
// history requests, and report. If the seam is right, nothing here needs to know it is in a worker.
//
// FINDING (2026-07-27, recorded in the campaign README): this uses `bootRuntime`, not `bootSession`.
// A worker has no `document`, so the engine script cannot be injected as a tag; the runtime already
// handles that through its `loadPyodide` option, which a worker consumer supplies after importing
// pyodide.mjs itself. But `bootSession` does not forward `loadPyodide` from its manifest, so the
// deterministic-replay boot cannot currently be worker-hosted at all. That is a one-line passthrough
// in `src/session/session.js` and it belongs in the graduation commit, not smuggled in from a probe.
// SECOND FINDING: importing `bootRuntime` from `src/runtime/index.js` (what `pyproc/runtime` points at)
// yields a Runtime whose `enable*` factories do not exist - `rt.enableReactive is not a function`.
// The bindings are installed at import time by `src/composition/runtimeApi.js`, whose own header says
// both index.js and pyproc/runtime consume it, but package.json points ./runtime at the rank-0 barrel
// instead. So this worker imports the composition root. That defect is the campaign's, not this
// probe's, and it is recorded in the README.
// Until then this worker gets `run` plus a reactive controller, which is what the blocking assertion
// needs, and the campaign records that history/export are not yet crossed.
import { boot as bootRuntime } from "../../../src/composition/runtimeApi.js";

let rt = null;
let reactive = null;

function replyError(reqId, error) {
  postMessage({
    reqId,
    type: "error",
    code: error?.code || "PYPROC_WORKER_TASK_ERROR",
    message: String(error?.message || error),
  });
}

onmessage = async (event) => {
  const message = event.data || {};
  const { reqId } = message;
  try {
    if (message.type === "boot") {
      const manifest = message.manifest || {};
      const indexURL = manifest.indexURL || "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/";
      // The worker imports the engine itself and hands loadPyodide to the runtime, so no script tag
      // and no globalThis mutation is needed.
      const engine = await import(indexURL + "pyodide.mjs");
      rt = await bootRuntime({
        indexURL,
        ...(manifest.env ? { env: manifest.env } : {}),
        loadPyodide: (cfg) => engine.loadPyodide(cfg),
      });
      reactive = rt.enableReactive();
      reactive.checkpoint(); // cp0, the same boundary the in-process adapter establishes
      postMessage({ reqId, type: "ok", heapBytes: rt.memory.byteLength() });
      return;
    }
    if (!rt) throw new Error("guestWorker: not booted");
    if (message.type === "run") {
      const value = rt.run(String(message.code || ""));
      // Values cross postMessage, so only structured-cloneable results return. That is a genuine
      // constraint of worker hosting and is recorded in the campaign rather than hidden by a cast.
      postMessage({ reqId, type: "ok", value: typeof value === "bigint" ? String(value) : value });
      return;
    }
    if (message.type === "checkpoint") {
      const info = reactive.checkpoint();
      postMessage({ reqId, type: "ok", index: info.index, changedPages: info.changedPages });
      return;
    }
    if (message.type === "historyDepth") {
      postMessage({ reqId, type: "ok", depth: reactive.tree().length, live: reactive.liveIdx });
      return;
    }
    if (message.type === "inspect") {
      postMessage({ reqId, type: "ok", heapBytes: rt.memory.byteLength(), ready: true });
      return;
    }
    if (message.type === "shutdown") {
      rt = null;
      reactive = null;
      postMessage({ reqId, type: "ok" });
      return;
    }
    throw new Error(`guestWorker: unsupported request ${message.type}`);
  } catch (error) {
    replyError(reqId, error);
  }
};
