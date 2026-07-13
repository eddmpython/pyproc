// socketWorker.js - probe: 블로킹 소켓을 비동기 WS 위에서. worker의 recv()가 main이 데이터를
// 넣을 때까지 Atomics.wait으로 멈춘다 = 파이썬 socket.recv()의 동기 의미(워커라 블로킹 합법).
// 값 채널: ctl[flag,type,len] + data SAB. worker->main(dial/send)은 postMessage(블로킹 아님),
// main->worker(connected/data/closed/error)는 SAB+Atomics(worker가 여기서 멈춘다).
let ctl, data;

// 이벤트 하나를 블로킹으로 받는다(파이썬 recv가 멈추는 지점). type: 1 connected/2 data/3 closed/4 error.
function waitEvent() {
  Atomics.wait(ctl, 0, 0);
  const type = Atomics.load(ctl, 1);
  const len = Atomics.load(ctl, 2);
  const bytes = data.slice(0, len);
  Atomics.store(ctl, 0, 0);      // 슬롯 비움
  Atomics.notify(ctl, 0);
  postMessage({ type: "drained" }); // main이 다음 이벤트를 채우도록
  return { type, bytes };
}

class BlockingSocket {
  connect(host, port) { postMessage({ type: "dial", host, port }); const e = waitEvent(); if (e.type !== 1) throw new Error("connect 실패 type=" + e.type); }
  send(bytes) { postMessage({ type: "send", bytes }); }
  recv() { const e = waitEvent(); if (e.type === 3) return new Uint8Array(0); if (e.type === 4) throw new Error("소켓 에러"); return e.bytes; }
}

onmessage = (m) => {
  if (m.data.type !== "boot") return;
  ctl = new Int32Array(m.data.ctlSab);
  data = new Uint8Array(m.data.dataSab);
  try {
    const sock = new BlockingSocket();
    const t0 = performance.now();
    // 파이썬처럼 동기 코드: connect -> send -> recv 루프. 각 호출이 진짜 블로킹.
    sock.connect("example.com", 80);
    sock.send(new TextEncoder().encode("GET / HTTP/1.0\r\nHost: example.com\r\nConnection: close\r\n\r\n"));
    let resp = "";
    for (;;) { const chunk = sock.recv(); if (chunk.length === 0) break; resp += new TextDecoder().decode(chunk); }
    postMessage({ type: "result", ok: true, ms: Math.round(performance.now() - t0), status: resp.split("\r\n")[0], len: resp.length, hasBody: /<html/i.test(resp) });
  } catch (e) { postMessage({ type: "result", ok: false, error: String(e).slice(0, 200) }); }
};
