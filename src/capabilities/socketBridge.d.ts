// socketBridge.d.ts - pyproc/socket subpath의 타입 계약(위치 근거는 gpuCompute.d.ts와 같다).

  import type { Runtime } from "../../index.js";
export interface SocketBridgeConfig {
  /** WS->TCP 릴레이 URL(진짜 NIC를 만지는 외부 조각). 예: "ws://127.0.0.1:8791". 소비자 교체 가능. */
  relayURL: string;
}

/**
 * 파이썬 socket을 진짜 아웃바운드 TCP에 배선한다(http + https). socket.socket()/create_connection을
 * 얇은 WS->TCP 릴레이 소켓으로 심해 Python connect/send/recv가 임의 host:port로 진짜 TCP를 연다.
 * urllib/http.client가 같은 socket API라 따라오고, https는 릴레이가 port 443에서 TLS 종단(ssl.wrap_socket
 * 패스스루). 블로킹 recv = JSPI(run_sync)라 rt.runAsync 경로에서 동작. https는 릴레이가 평문을 보므로
 * e2e가 아니다(신뢰하는 릴레이 필요). 인바운드(공개 서버)는 물리 벽(역터널 릴레이). Chromium/Edge 전용.
 */
export class SocketBridge {
  install(): { installed: string[]; relayURL: string; jspi: boolean; note: string };
}
  // 소비: new SocketBridge(rt, cfg) 후 install(). Runtime.enableSocketBridge는 제거됐다(그래프 분리).
