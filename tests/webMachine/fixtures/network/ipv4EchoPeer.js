// ipv4EchoPeer.js - packet network probe용 최소 ARP/ICMP peer.
const ETHERNET_MIN_BYTES = 60;
const ETHER_TYPE_IPV4 = 0x0800;
const ETHER_TYPE_ARP = 0x0806;

function addressBytes(value, length, label) {
  const bytes = value instanceof Uint8Array ? value.slice() : Uint8Array.from(value || []);
  if (bytes.byteLength !== length) throw new TypeError(`${label} 길이는 ${length}여야 한다`);
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

function checksum(bytes, offset, length) {
  let sum = 0;
  for (let index = 0; index < length; index += 2) {
    const high = bytes[offset + index];
    const low = index + 1 < length ? bytes[offset + index + 1] : 0;
    sum += (high << 8) | low;
    while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  }
  return (~sum) & 0xffff;
}

function arpReply(frame, macAddress, ipv4Address) {
  if (frame.byteLength < 42 || readUint16(frame, 12) !== ETHER_TYPE_ARP) return null;
  if (readUint16(frame, 14) !== 1 || readUint16(frame, 16) !== ETHER_TYPE_IPV4 || frame[18] !== 6 || frame[19] !== 4) return null;
  if (readUint16(frame, 20) !== 1 || !sameBytes(frame, 38, ipv4Address)) return null;
  const reply = new Uint8Array(42);
  reply.set(frame.subarray(22, 28), 0);
  reply.set(macAddress, 6);
  writeUint16(reply, 12, ETHER_TYPE_ARP);
  writeUint16(reply, 14, 1);
  writeUint16(reply, 16, ETHER_TYPE_IPV4);
  reply[18] = 6;
  reply[19] = 4;
  writeUint16(reply, 20, 2);
  reply.set(macAddress, 22);
  reply.set(ipv4Address, 28);
  reply.set(frame.subarray(22, 28), 32);
  reply.set(frame.subarray(28, 32), 38);
  return paddedFrame(reply);
}

function echoReply(frame, macAddress, ipv4Address) {
  if (frame.byteLength < 42 || readUint16(frame, 12) !== ETHER_TYPE_IPV4) return null;
  const ipOffset = 14;
  const headerBytes = (frame[ipOffset] & 0x0f) * 4;
  const totalBytes = readUint16(frame, ipOffset + 2);
  if ((frame[ipOffset] >>> 4) !== 4 || headerBytes < 20 || totalBytes < headerBytes + 8) return null;
  if (ipOffset + totalBytes > frame.byteLength || frame[ipOffset + 9] !== 1 || !sameBytes(frame, ipOffset + 16, ipv4Address)) return null;
  const icmpOffset = ipOffset + headerBytes;
  if (frame[icmpOffset] !== 8 || frame[icmpOffset + 1] !== 0) return null;

  const reply = paddedFrame(frame.slice(0, ipOffset + totalBytes));
  reply.set(frame.subarray(6, 12), 0);
  reply.set(macAddress, 6);
  reply.set(frame.subarray(ipOffset + 12, ipOffset + 16), ipOffset + 16);
  reply.set(ipv4Address, ipOffset + 12);
  reply[ipOffset + 8] = 64;
  reply[ipOffset + 10] = 0;
  reply[ipOffset + 11] = 0;
  writeUint16(reply, ipOffset + 10, checksum(reply, ipOffset, headerBytes));
  reply[icmpOffset] = 0;
  reply[icmpOffset + 2] = 0;
  reply[icmpOffset + 3] = 0;
  writeUint16(reply, icmpOffset + 2, checksum(reply, icmpOffset, totalBytes - headerBytes));
  return reply;
}

export function createIpv4EchoPeer({
  network,
  endpointId = "ipv4EchoPeer",
  macAddress = [0x02, 0, 0, 0, 0, 1],
  ipv4Address = [10, 77, 0, 1],
}) {
  if (!network || network.kind !== "network" || network.mode !== "packet" || typeof network.connect !== "function") {
    throw new TypeError("packet network가 필요하다");
  }
  const mac = addressBytes(macAddress, 6, "macAddress");
  const ip = addressBytes(ipv4Address, 4, "ipv4Address");
  const stats = { receivedFrames: 0, arpRequests: 0, echoRequests: 0, replies: 0, ignoredFrames: 0 };
  let port;
  port = network.connect({
    endpointId,
    receive: async (frame) => {
      stats.receivedFrames += 1;
      let reply = arpReply(frame, mac, ip);
      if (reply) stats.arpRequests += 1;
      else {
        reply = echoReply(frame, mac, ip);
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
