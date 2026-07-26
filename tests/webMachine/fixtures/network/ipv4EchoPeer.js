// ipv4EchoPeer.js - packet network probe용 최소 ARP/ICMP peer.
//
// 프레임 조립·해석은 src의 순수 계약(contracts/ipv4Frames.js)을 그대로 쓴다. 한때 이 파일이
// 같은 로직을 손으로 갖고 있었고, 그래서 "두 guest가 한 스위치에서 바이트를 교환한다"는 주장의
// 한쪽 끝이 시험용 사본이었다. 로직이 src로 승격된 뒤에도 사본을 남겨두면 프레임 법이 두 벌로
// 갈리므로(외부 감사 지적, 2026-07-27) 여기는 스위치 배선과 통계만 남긴다.
import { buildArpReply, buildIcmpEchoReply, toAddressBytes } from "../../../../src/machine/index.js";

export function createIpv4EchoPeer({
  network,
  endpointId = "ipv4EchoPeer",
  macAddress = [0x02, 0, 0, 0, 0, 1],
  ipv4Address = [10, 77, 0, 1],
}) {
  if (!network || network.kind !== "network" || network.mode !== "packet" || typeof network.connect !== "function") {
    throw new TypeError("packet network가 필요하다");
  }
  const mac = toAddressBytes(macAddress, 6, "macAddress");
  const ip = toAddressBytes(ipv4Address, 4, "ipv4Address");
  const stats = { receivedFrames: 0, arpRequests: 0, echoRequests: 0, replies: 0, ignoredFrames: 0 };
  let port;
  port = network.connect({
    endpointId,
    receive: async (frame) => {
      stats.receivedFrames += 1;
      let reply = buildArpReply(frame, mac, ip);
      if (reply) stats.arpRequests += 1;
      else {
        reply = buildIcmpEchoReply(frame, mac, ip);
        if (reply) stats.echoRequests += 1;
      }
      if (!reply) {
        stats.ignoredFrames += 1;
        return;
      }
      stats.replies += 1;
      await port.send(reply);
    },
  });
  return Object.freeze({
    close: () => port.close(),
    inspect: () => ({ ...stats, endpointId: String(endpointId), macAddress: [...mac], ipv4Address: [...ip] }),
  });
}
