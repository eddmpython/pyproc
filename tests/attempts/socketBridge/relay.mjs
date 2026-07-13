// relay.mjs - zero-dep WebSocket -> TCP 릴레이(probe용). 브라우저 탭은 raw TCP 소켓을 못 열지만,
// 밖으로 다이얼하는 WebSocket은 연다. 이 릴레이가 진짜 NIC를 만진다: WS로 "host:port 다이얼"을
// 받고 실제 TCP를 열어 바이트를 양방향 펌프한다. "탭용 소켓 릴레이" = 벽2 아웃바운드의 외부 조각.
// 의존성 0(RFC 6455 핸드셰이크 + 프레이밍을 node:crypto/net으로 직접). 소비자 교체 가능한 계약.
import { createServer } from "node:http";
import { connect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { createHash } from "node:crypto";

const PORT = Number(process.argv[2] || process.env.RELAY_PORT || 8791);
const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"; // RFC 6455 accept 계산 상수

// 서버->클라 프레임(마스크 없음). opcode: 0x1 text, 0x2 binary, 0x8 close.
function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
}

// 누적 버퍼에서 완성된 프레임을 모두 파싱(클라->서버는 항상 마스크됨). { frames, rest } 반환.
function parseFrames(buf) {
  const frames = []; let off = 0;
  while (off + 2 <= buf.length) {
    const b0 = buf[off], b1 = buf[off + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f; let pos = off + 2;
    if (len === 126) { if (pos + 2 > buf.length) break; len = buf.readUInt16BE(pos); pos += 2; }
    else if (len === 127) { if (pos + 8 > buf.length) break; len = Number(buf.readBigUInt64BE(pos)); pos += 8; }
    let mask = null;
    if (masked) { if (pos + 4 > buf.length) break; mask = buf.subarray(pos, pos + 4); pos += 4; }
    if (pos + len > buf.length) break;
    let payload = Buffer.from(buf.subarray(pos, pos + len));
    if (masked) for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
    frames.push({ opcode, payload });
    off = pos + len;
  }
  return { frames, rest: buf.subarray(off) };
}

const server = createServer((req, res) => { res.writeHead(426); res.end("upgrade required"); });

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) { socket.destroy(); return; }
  const accept = createHash("sha1").update(key + WS_MAGIC).digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
  );

  let tcp = null;             // 다이얼된 실제 TCP 소켓
  let acc = Buffer.alloc(0);  // WS 프레임 누적 버퍼
  const sendText = (obj) => socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify(obj))));
  const sendBin = (buf) => socket.write(encodeFrame(0x2, buf));

  socket.on("data", (chunk) => {
    acc = acc.length ? Buffer.concat([acc, chunk]) : chunk;
    const { frames, rest } = parseFrames(acc); acc = rest;
    for (const f of frames) {
      if (f.opcode === 0x8) { socket.end(); if (tcp) tcp.end(); return; }
      if (f.opcode === 0x1 && !tcp) {
        // 첫 텍스트 = 다이얼 요청 {host, port}
        let req2; try { req2 = JSON.parse(f.payload.toString()); } catch (e) { sendText({ type: "error", msg: "bad dial" }); continue; }
        // TLS 종단: port 443(또는 tls 플래그)이면 릴레이가 TLS 핸드셰이크를 한다. 그러면 파이썬은
        // 평문 HTTP를 보내고(ssl.wrap_socket은 패스스루로 스텁), 릴레이가 암복호화한다. 릴레이가
        // 평문을 보므로 end-to-end는 아니다(정직: 소비 제품이 신뢰하는 릴레이여야 한다).
        const useTls = req2.tls === true || req2.port === 443;
        const onReady = () => sendText({ type: "connected" });
        tcp = useTls
          ? tlsConnect({ host: req2.host, port: req2.port, servername: req2.host }, onReady)
          : connect({ host: req2.host, port: req2.port }, onReady);
        tcp.on("data", (d) => sendBin(d));
        tcp.on("error", (e) => sendText({ type: "error", msg: String(e.message || e) }));
        tcp.on("close", () => { sendText({ type: "closed" }); socket.end(encodeFrame(0x8, Buffer.alloc(0))); });
      } else if (f.opcode === 0x2 && tcp) {
        tcp.write(f.payload); // 클라 바이너리 = TCP로 쓸 raw 바이트
      }
    }
  });
  socket.on("close", () => { if (tcp) tcp.destroy(); });
  socket.on("error", () => { if (tcp) tcp.destroy(); });
});

server.listen(PORT, "127.0.0.1", () => console.log("relay listening ws://127.0.0.1:" + PORT));
