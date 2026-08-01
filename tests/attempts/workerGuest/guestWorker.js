// guestWorker.js - the worker side of the workerGuest campaign: a pyproc kernel hosted off the main
// thread, driven by the same request shapes the in-process adapter accepts.
//
// This is deliberately thin. The question the campaign asks is whether the *adapter contract* is the
// right seam, so this file does the minimum needed to answer it: boot a deterministic session, run
// code, answer history requests, carry its packet device across the boundary, and hand its image out.
// If the seam is right, nothing here needs to know it is in a worker - except for the two places a
// worker genuinely differs, and both are explicit:
//
//  1. **No document.** The engine script cannot be injected as a tag, so this worker imports
//     pyodide.mjs itself and hands `loadPyodide` to the session as a host capability. `bootSession`
//     used to drop that option (the campaign's first finding, fixed in src with its own gates), which
//     is why history, save, and export could not be worker-hosted at all.
//  2. **The devices live on the host thread.** The switch is shared between guests, so it cannot move
//     here. `createBridgedDevice` gives this side a device-shaped proxy; what survives the crossing
//     and what changes shape is documented in portBridgedDevice.js.
import { bootSession, openMachine } from "../../../src/session/session.js";
import { toErrorPayload } from "../../../src/runtime/errors.js";
import { DEFAULT_INDEX } from "../../../src/runtime/runtime.js";
import { PyprocPacketPort } from "../../../src/machine/guests/pyprocPacketPort.js";
import { createBridgedDevice } from "./portBridgedDevice.js";

let session = null;
let packetPort = null;
let devicePort = null;
let endpointId = null;
let network = null;
let indexURL = DEFAULT_INDEX;

const engineLoader = async (url) => {
  const engine = await import(url + "pyodide.mjs");
  return (cfg) => engine.loadPyodide(cfg);
};

// The packet port is attached the same way after a boot and after a restore, because a restored
// guest is a booted guest as far as its devices are concerned.
// The addresses come from the machine's manifest, not from this file: two guests on one switch need
// distinct hardware addresses, and "which address is this machine" is a declaration, not a default.
function attachPacketPort() {
  if (!devicePort || !endpointId) return;
  packetPort = new PyprocPacketPort({
    device: createBridgedDevice({ port: devicePort, kind: "network", mode: "packet" }),
    endpointId,
    ...(network?.macAddress ? { macAddress: network.macAddress } : {}),
    ...(network?.ipv4Address ? { ipv4Address: network.ipv4Address } : {}),
  });
  packetPort.attach(session.rt);
}

// The wire shape of an error is the runtime's, not this file's. The first edition of this worker
// invented a `message` field, so every failure arrived on the host as "unknown worker error" and hid
// its own cause - a probe that lies about why it failed is worse than a probe that fails.
function replyError(reqId, error) {
  postMessage({ reqId, type: "error", ...toErrorPayload(error) });
}

onmessage = async (event) => {
  const message = event.data || {};
  const { reqId } = message;
  try {
    if (message.type === "boot") {
      const manifest = message.manifest || {};
      indexURL = manifest.indexURL || DEFAULT_INDEX;
      const loadPyodide = await engineLoader(indexURL);
      session = await bootSession({ indexURL, ...(manifest.env ? { env: manifest.env } : {}), loadPyodide });
      devicePort = event.ports[0] || null;
      endpointId = message.endpointId || null;
      network = message.network || null;
      attachPacketPort();
      postMessage({ reqId, type: "ok", heapBytes: session.rt.memory.byteLength(), h0: await session._cp0Digest() });
      return;
    }
    // Restore stands beside boot, not behind the `not booted` guard: it is the other way a session
    // comes into existence. It revives through the same host-capability route, because the file's
    // manifest is JSON and cannot carry the engine loader.
    if (message.type === "restore") {
      indexURL = message.indexURL || indexURL;
      const loadPyodide = await engineLoader(indexURL);
      session = await openMachine(new Blob([message.bytes]), { trust: true, loadPyodide });
      devicePort = event.ports[0] || devicePort;
      endpointId = message.endpointId || endpointId;
      network = message.network || network;
      attachPacketPort();
      postMessage({ reqId, type: "ok", h0: await session._cp0Digest() });
      return;
    }
    if (!session) throw new Error("guestWorker: not booted");
    if (message.type === "run") {
      // 값 경계 표면은 턴 경계에서 펌프가 돌아야 바이트가 건넌다(in-process 어댑터와 같은 계약).
      // 워커에서도 같은 자리다: 파이썬이 스택에 있는 동안 run()을 다시 부를 수 없다.
      packetPort?.pump();
      const value = session.rt.run(String(message.code || ""));
      packetPort?.pump();
      // Values cross postMessage, so only structured-cloneable results return. That is a genuine
      // constraint of worker hosting and is recorded in the campaign rather than hidden by a cast.
      postMessage({ reqId, type: "ok", value: typeof value === "bigint" ? String(value) : value });
      return;
    }
    if (message.type === "checkpoint") {
      const info = session.reactive.checkpoint();
      postMessage({ reqId, type: "ok", index: info.index, changedPages: info.changedPages });
      return;
    }
    if (message.type === "historyDepth") {
      postMessage({ reqId, type: "ok", depth: session.reactive.tree().length, live: session.reactive.liveIdx });
      return;
    }
    if (message.type === "netInspect") {
      postMessage({ reqId, type: "ok", stats: packetPort ? packetPort.inspect() : null });
      return;
    }
    if (message.type === "snapshot") {
      // The surface is a value boundary now, so there is nothing to strip before an image: what
      // used to be removed and re-installed here was a JS handle, and that is exactly what could
      // not cross. One pump first, so frames Python already sent leave instead of riding along.
      packetPort?.pump();
      const image = await session.exportImage();
      const bytes = new Uint8Array(await image.arrayBuffer());
      postMessage({ reqId, type: "ok", bytes }, [bytes.buffer]);
      return;
    }
    if (message.type === "shutdown") {
      if (packetPort) {
        await packetPort.drain(); // frames already sent must leave the switch before the port closes
        packetPort.detach();
        packetPort = null;
      }
      session = null;
      postMessage({ reqId, type: "ok" });
      return;
    }
    throw new Error(`guestWorker: unsupported request ${message.type}`);
  } catch (error) {
    replyError(reqId, error);
  }
};
