// portBridgedDevice.js - graduation item 3: can a device contract cross a worker boundary intact?
//
// The device lives on the host thread (the switch is shared between guests, so it has to). The guest
// that consumes it now lives in a worker. This file is the two halves of the crossing, and it exists
// to answer one question precisely: **which part of the contract survives the trip, and which part
// changes shape.** A bridge that quietly changes a contract is worse than no bridge, so the deviation
// is named here and asserted in the probe rather than discovered later by a consumer.
//
// What crosses unchanged:
//  - `kind` / `mode`, so `resolveRequiredDevice` and the port's own type check read the same values.
//  - `connect({ endpointId, receive })` returning `{ endpointId, send, close }`, synchronously.
//  - `send(frame)` returning a promise that resolves on delivery and rejects with the *same*
//    WebMachineError code the real device would have used.
//  - `receive(frame)` delivering a `Uint8Array` copy, one call per frame, in switch order.
//
// What changes shape (the campaign's finding, recorded rather than hidden):
//  - **A synchronous throw becomes a deferred rejection.** The real switch throws from `connect()`
//    itself on a duplicate endpointId. Across a message boundary the answer cannot be back before
//    `connect()` returns, so the bridged port carries the failure to the first `send()`/`close()`.
//    The code is preserved; the timing is not. Any consumer that relies on `connect()` throwing has
//    to move that expectation one call later.
import { WebMachineError } from "../../../src/machine/contracts/webMachineError.js";

const DEVICE_CHANNEL = "workerGuestDevice";

// Host side. `port` is one half of a MessageChannel whose other half the guest worker holds.
// Ownership is explicit: this side owns the real device port and closes it on `stop()`, so a worker
// that dies without closing does not leak an endpoint into the switch.
export function serveBridgedDevice({ port, device, label = "device" }) {
  if (!port || typeof port.postMessage !== "function") throw new TypeError("serveBridgedDevice: a MessagePort is required");
  if (!device || typeof device.connect !== "function") throw new TypeError("serveBridgedDevice: a connectable device is required");
  const openPorts = new Map();

  const reply = (reqId, body) => port.postMessage({ channel: DEVICE_CHANNEL, reqId, ok: true, ...body });
  const replyError = (reqId, error) => port.postMessage({
    channel: DEVICE_CHANNEL,
    reqId,
    ok: false,
    code: error?.code || "WEB_MACHINE_DEVICE_BRIDGE_FAILED",
    message: String(error?.message || error),
  });

  port.addEventListener("message", async (event) => {
    const message = event.data || {};
    if (message.channel !== DEVICE_CHANNEL) return;
    const { reqId, op, endpointId } = message;
    try {
      if (op === "connect") {
        // The real `receive` is a host-thread callback. Here it becomes a push message; the frame is
        // copied because the switch reuses its own buffers and a transfer would detach them.
        const opened = device.connect({
          endpointId,
          receive: (frame) => port.postMessage({
            channel: DEVICE_CHANNEL,
            push: "receive",
            endpointId,
            frame: frame instanceof Uint8Array ? frame.slice() : Uint8Array.from(frame || []),
          }),
        });
        openPorts.set(endpointId, opened);
        reply(reqId, {});
        return;
      }
      const opened = openPorts.get(endpointId);
      if (op === "send") {
        if (!opened) throw new WebMachineError("WEB_MACHINE_NETWORK_PORT_CLOSED", `the network port is closed: ${endpointId}`);
        await opened.send(message.frame);
        reply(reqId, {});
        return;
      }
      if (op === "close") {
        opened?.close();
        openPorts.delete(endpointId);
        reply(reqId, {});
        return;
      }
      throw new TypeError(`${label}: unsupported device op ${op}`);
    } catch (error) {
      replyError(reqId, error);
    }
  });
  port.start?.();

  return {
    stop() {
      for (const opened of openPorts.values()) opened.close();
      openPorts.clear();
    },
    openEndpoints: () => openPorts.size,
  };
}

// Guest side (inside the worker). Returns an object shaped like the real device, so the guest's port
// (PyprocPacketPort here) cannot tell the difference at the type level - which is the point: if it
// could, the adapter contract would not be the right seam.
export function createBridgedDevice({ port, kind, mode }) {
  if (!port || typeof port.postMessage !== "function") throw new TypeError("createBridgedDevice: a MessagePort is required");
  const pending = new Map();
  const receivers = new Map();
  let reqSeq = 0;

  port.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.channel !== DEVICE_CHANNEL) return;
    if (message.push === "receive") {
      receivers.get(message.endpointId)?.(message.frame);
      return;
    }
    const waiter = pending.get(message.reqId);
    if (!waiter) return;
    pending.delete(message.reqId);
    if (message.ok) waiter.resolve();
    else waiter.reject(new WebMachineError(message.code, message.message));
  });
  port.start?.();

  const call = (body, transfer = []) => new Promise((resolve, reject) => {
    const reqId = ++reqSeq;
    pending.set(reqId, { resolve, reject });
    port.postMessage({ channel: DEVICE_CHANNEL, reqId, ...body }, transfer);
  });

  return Object.freeze({
    kind,
    mode,
    connect({ endpointId, receive }) {
      if (!endpointId) throw new TypeError("an endpointId is required");
      if (typeof receive !== "function") throw new TypeError("a receive function is required");
      const id = String(endpointId);
      receivers.set(id, receive);
      // Optimistic by necessity: the ack cannot arrive before this function must return. The failure
      // is not swallowed - it is carried to the first send/close, with its original code.
      const connected = call({ op: "connect", endpointId: id });
      let closed = false;
      return Object.freeze({
        endpointId: id,
        send: (frame) => {
          if (closed) return Promise.reject(new WebMachineError("WEB_MACHINE_NETWORK_PORT_CLOSED", `the network port is closed: ${id}`));
          const bytes = frame instanceof Uint8Array ? frame : Uint8Array.from(frame || []);
          return connected.then(() => call({ op: "send", endpointId: id, frame: bytes }));
        },
        close: () => {
          if (closed) return;
          closed = true;
          receivers.delete(id);
          connected.then(() => call({ op: "close", endpointId: id })).catch(() => {});
        },
      });
    },
  });
}
