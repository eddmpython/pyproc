// socketPyWorker.js - module 워커: 진짜 Pyodide(Python)를 부팅하고 파이썬 socket 심을 WS->TCP
// 릴레이 브리지에 배선한다. Python socket.recv()가 진짜 인터넷 바이트를 받는다(블로킹은
// Atomics.wait으로, main이 WS/릴레이를 서비스). = 벽2 아웃바운드의 "진짜 파이썬" 배선 증명.
// 값 채널: ctl[flag,type,len] + data SAB. Python -> js.bridge* (동기) -> Atomics.wait -> main WS.

let ctl, data;

// 이벤트 하나를 블로킹으로 받는다(파이썬 recv/connect가 멈추는 지점). type: 1 connected/2 data/3 closed/4 error.
function waitEvent() {
  Atomics.wait(ctl, 0, 0);
  const type = Atomics.load(ctl, 1);
  const len = Atomics.load(ctl, 2);
  const bytes = data.slice(0, len);
  Atomics.store(ctl, 0, 0);
  Atomics.notify(ctl, 0);
  postMessage({ type: "drained" });
  return { type, bytes };
}

// Pyodide Python이 부를 동기 브리지(js.bridge*). Python->JS 호출은 동기라 여기서 블로킹이 성립한다.
self.bridgeConnect = (host, port) => { postMessage({ type: "dial", host, port }); const e = waitEvent(); if (e.type !== 1) throw new Error("connect 실패 type=" + e.type); };
self.bridgeSend = (payload) => { const u = payload && payload.toJs ? payload.toJs() : payload; postMessage({ type: "send", bytes: Uint8Array.from(u) }); };
self.bridgeRecv = () => { const e = waitEvent(); return e.type === 3 ? new Uint8Array(0) : e.bytes; };

onmessage = async (m) => {
  if (m.data.type !== "boot") return;
  ctl = new Int32Array(m.data.ctlSab);
  data = new Uint8Array(m.data.dataSab);
  try {
    // v314는 classic 워커(importScripts)를 지원 안 해 module 워커 + pyodide.mjs 동적 import를 쓴다.
    const { loadPyodide } = await import(m.data.indexURL + "pyodide.mjs");
    const pyodide = await loadPyodide({ indexURL: m.data.indexURL });
    // 파이썬 socket 심: socket.socket()을 릴레이 소켓으로 대체한다. requests/urllib3/http.client가
    // 이 심을 그대로 쓴다(같은 socket API). 여기선 raw connect/send/recv로 진짜 TCP를 증명한다.
    pyodide.runPython(`
import socket, js

class RelaySocket:
    def __init__(self, *args, **kwargs):
        pass
    def connect(self, addr):
        js.bridgeConnect(addr[0], addr[1])
    def sendall(self, payload):
        js.bridgeSend(bytes(payload))
    def send(self, payload):
        js.bridgeSend(bytes(payload))
        return len(payload)
    def recv(self, bufsize=65536):
        chunk = js.bridgeRecv()
        return bytes(chunk.to_py())
    def settimeout(self, seconds):
        pass
    def close(self):
        pass

socket.socket = lambda *args, **kwargs: RelaySocket()
`);
    // 진짜 파이썬 코드: socket으로 example.com:80에 raw HTTP -> raw 응답 수집.
    const result = pyodide.runPython(`
sock = socket.socket()
sock.connect(('example.com', 80))
sock.sendall(b'GET / HTTP/1.0\\r\\nHost: example.com\\r\\nConnection: close\\r\\n\\r\\n')
buf = b''
while True:
    part = sock.recv()
    if not part:
        break
    buf += part
sock.close()
statusLine = buf.split(b'\\r\\n')[0].decode('latin-1')
[statusLine, len(buf), b'<html' in buf.lower()]
`).toJs();
    postMessage({ type: "result", ok: true, status: result[0], len: result[1], hasBody: result[2] });
  } catch (e) {
    postMessage({ type: "result", ok: false, error: String(e).slice(0, 300) });
  }
};
