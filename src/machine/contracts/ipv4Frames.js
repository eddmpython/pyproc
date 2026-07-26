// ipv4Frames.js - Layer 5/pure: Ethernet/ARP/IPv4/ICMP 프레임의 순수 해석과 조립.
// 순수 함수만. import 0, browser 전역 0, guest 이름 0. guest가 직접 소비해야 하므로 순수 집합에 산다.
//
// 왜 이 파일이 src에 있나: 같은 로직이 packet probe의 fixture(JS로 손으로 쓴 ARP/ICMP 응답자)에만
// 있었다. 그래서 "두 guest가 한 스위치에서 바이트를 교환한다"는 주장의 한쪽 끝이 언제나
// 시험용 가짜였다(2026-07-27 감사). 프레임 해석은 장치 계약의 일부이므로 라이브러리가 갖는다.
//
// 스코프는 최소한이다: ARP 요청에 답하고 ICMP echo에 답한다. 그 둘이 "ping이 통한다"의 전부이고,
// TCP/UDP 스택은 guest 안의 파이썬이 쌓을 일이다(이 층은 프레임 경계까지만 안다).
const ETHERNET_MIN_BYTES = 60; // 패딩 하한(IEEE 802.3). 짧은 프레임은 수신측이 버린다.
const ETHER_TYPE_IPV4 = 0x0800;
const ETHER_TYPE_ARP = 0x0806;
const ARP_HARDWARE_ETHERNET = 1;
const ARP_OPERATION_REQUEST = 1;
const ARP_OPERATION_REPLY = 2;
const IP_PROTOCOL_ICMP = 1;
const ICMP_ECHO_REQUEST = 8;
const ICMP_ECHO_REPLY = 0;
const DEFAULT_TTL = 64;

export function toAddressBytes(value, length, label) {
  const bytes = value instanceof Uint8Array ? value.slice() : Uint8Array.from(value || []);
  if (bytes.byteLength !== length) throw new TypeError(`${label} must be ${length} bytes`);
  return bytes;
}

function readUint16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function writeUint16(bytes, offset, value) {
  bytes[offset] = value >>> 8;
  bytes[offset + 1] = value & 0xff;
}

function sameBytes(bytes, offset, expected) {
  for (let index = 0; index < expected.byteLength; index += 1) {
    if (bytes[offset + index] !== expected[index]) return false;
  }
  return true;
}

function paddedFrame(value) {
  if (value.byteLength >= ETHERNET_MIN_BYTES) return value;
  const frame = new Uint8Array(ETHERNET_MIN_BYTES);
  frame.set(value);
  return frame;
}

// 인터넷 체크섬(RFC 1071). 1의 보수 합의 보수.
export function internetChecksum(bytes, offset, length) {
  let sum = 0;
  for (let index = 0; index < length; index += 2) {
    const high = bytes[offset + index];
    const low = index + 1 < length ? bytes[offset + index + 1] : 0;
    sum += (high << 8) | low;
    while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  }
  return (~sum) & 0xffff;
}

// 내 IPv4 주소를 묻는 ARP 요청이면 응답 프레임을, 아니면 null.
export function buildArpReply(frame, macAddress, ipv4Address) {
  if (frame.byteLength < 42 || readUint16(frame, 12) !== ETHER_TYPE_ARP) return null;
  if (readUint16(frame, 14) !== ARP_HARDWARE_ETHERNET || readUint16(frame, 16) !== ETHER_TYPE_IPV4) return null;
  if (frame[18] !== 6 || frame[19] !== 4) return null;
  if (readUint16(frame, 20) !== ARP_OPERATION_REQUEST || !sameBytes(frame, 38, ipv4Address)) return null;
  const reply = new Uint8Array(42);
  reply.set(frame.subarray(22, 28), 0); // 목적지 = 요청자 MAC
  reply.set(macAddress, 6);
  writeUint16(reply, 12, ETHER_TYPE_ARP);
  writeUint16(reply, 14, ARP_HARDWARE_ETHERNET);
  writeUint16(reply, 16, ETHER_TYPE_IPV4);
  reply[18] = 6;
  reply[19] = 4;
  writeUint16(reply, 20, ARP_OPERATION_REPLY);
  reply.set(macAddress, 22);
  reply.set(ipv4Address, 28);
  reply.set(frame.subarray(22, 28), 32);
  reply.set(frame.subarray(28, 32), 38);
  return paddedFrame(reply);
}

// 내 IPv4 주소로 온 ICMP echo 요청이면 응답 프레임을, 아니면 null.
export function buildIcmpEchoReply(frame, macAddress, ipv4Address) {
  if (frame.byteLength < 42 || readUint16(frame, 12) !== ETHER_TYPE_IPV4) return null;
  const ipOffset = 14;
  const headerBytes = (frame[ipOffset] & 0x0f) * 4;
  const totalBytes = readUint16(frame, ipOffset + 2);
  if ((frame[ipOffset] >>> 4) !== 4 || headerBytes < 20 || totalBytes < headerBytes + 8) return null;
  if (ipOffset + totalBytes > frame.byteLength) return null;
  if (frame[ipOffset + 9] !== IP_PROTOCOL_ICMP || !sameBytes(frame, ipOffset + 16, ipv4Address)) return null;
  const icmpOffset = ipOffset + headerBytes;
  if (frame[icmpOffset] !== ICMP_ECHO_REQUEST || frame[icmpOffset + 1] !== 0) return null;

  const reply = paddedFrame(frame.slice(0, ipOffset + totalBytes));
  reply.set(frame.subarray(6, 12), 0);
  reply.set(macAddress, 6);
  reply.set(frame.subarray(ipOffset + 12, ipOffset + 16), ipOffset + 16); // 보낸 쪽이 목적지가 된다
  reply.set(ipv4Address, ipOffset + 12);
  reply[ipOffset + 8] = DEFAULT_TTL;
  writeUint16(reply, ipOffset + 10, 0); // 체크섬 필드를 0으로 두고 계산한다
  writeUint16(reply, ipOffset + 10, internetChecksum(reply, ipOffset, headerBytes));
  reply[icmpOffset] = ICMP_ECHO_REPLY;
  writeUint16(reply, icmpOffset + 2, 0);
  writeUint16(reply, icmpOffset + 2, internetChecksum(reply, icmpOffset, totalBytes - headerBytes));
  return reply;
}

// 프레임의 최소 분류. 파이썬 쪽이 무엇을 받았는지 알 수 있게 해석 결과를 값으로 준다.
export function describeFrame(frame) {
  if (!(frame instanceof Uint8Array) || frame.byteLength < 14) return { kind: "short", byteLength: frame?.byteLength || 0 };
  const etherType = readUint16(frame, 12);
  if (etherType === ETHER_TYPE_ARP) {
    return { kind: "arp", operation: frame.byteLength >= 22 ? readUint16(frame, 20) : 0, byteLength: frame.byteLength };
  }
  if (etherType !== ETHER_TYPE_IPV4) return { kind: "other", etherType, byteLength: frame.byteLength };
  const protocol = frame.byteLength >= 24 ? frame[23] : 0;
  const icmpType = protocol === IP_PROTOCOL_ICMP && frame.byteLength >= 35 ? frame[14 + (frame[14] & 0x0f) * 4] : null;
  return { kind: "ipv4", protocol, icmpType, byteLength: frame.byteLength };
}
