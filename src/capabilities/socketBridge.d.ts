// socketBridge.d.ts - type contract of the pyproc/socket subpath (same placement rationale as gpuCompute.d.ts).

  import type { Runtime } from "../../index.js";
export interface SocketBridgeConfig {
  /** WS-to-TCP relay URL: the external piece that touches a real NIC, e.g. "ws://127.0.0.1:8791". Consumers may swap it. */
  relayURL: string;
}

/**
 * Wires Python sockets to real outbound TCP (http and https). It replaces socket.socket() and
 * create_connection with a thin WS-to-TCP relay socket, so Python connect/send/recv opens real
 * TCP to any host:port. urllib and http.client follow because they sit on the same socket API.
 * For https the relay terminates TLS on port 443 (ssl.wrap_socket is a pass-through). Blocking
 * recv needs JSPI (run_sync), so this works on the rt.runAsync path. Honest boundary: https is
 * not end-to-end, since the relay sees plaintext - you must trust the relay. Inbound (a public
 * server) is a physical wall and needs a reverse-tunnel relay. Chromium/Edge only.
 */
export class SocketBridge {
  install(): { installed: string[]; relayURL: string; jspi: boolean; note: string };
}
  // Usage: new SocketBridge(rt, cfg) then install(). Runtime.enableSocketBridge was removed to keep the graph split.
