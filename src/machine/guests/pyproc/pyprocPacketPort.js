// pyprocPacketPort.js - Layer 5/guests: 파이썬 guest와 공통 packet network port 사이의 변환 경계.
// v86PacketPort의 대칭짝이다: 저쪽은 NIC bus를, 이쪽은 파이썬 인터프리터를 스위치에 붙인다.
//
// 왜 필요했나: 스위치(MemoryEthernetSwitch)와 프레임 계약과 권한 게이트는 이미 있었는데 붙일
// port가 v86 쪽 하나뿐이었다. 그래서 파이썬 머신은 `network` 권한을 갖고도 그 권한을 쓸 코드가
// 없었고, 두 guest가 바이트를 교환할 경로는 0이었다(2026-07-27 감사: 북극성 문장의 "여러 guest가
// 올라간 컴퓨터"가 공존까지만 참이고 통신은 아니었다).
//
// 두 티어를 준다.
//  1. 자동 응답: ARP 요청과 ICMP echo에 이 endpoint의 MAC/IP로 답한다. 그래서 상대 guest는
//     파이썬 쪽에 아무 코드가 없어도 ping이 통한다(장치가 있으면 주소가 살아 있어야 한다).
//  2. 파이썬 표면: `pyprocNet` 모듈로 프레임을 직접 보내고 받는다. 자동 응답만 주면 그것은
//     장치가 아니라 장식이다. 파이썬이 자기 프로토콜을 쌓을 수 있어야 장치 계약이 성립한다.
import { WebMachineError } from "../../contracts/webMachineError.js";
import { buildArpReply, buildIcmpEchoReply, describeFrame, toAddressBytes } from "../../contracts/ipv4Frames.js";

// 파이썬 표면. **값 경계다: 이 소스는 JS 프록시를 하나도 심지 않는다.** 바이트는 hex로 건넌다.
// 근거는 실측이다(workerGuest 캠페인 A~O, 2026-08-01): setGlobal로 심은 JS 프록시가 힙에 있으면
// 그 힙 이미지로 부활한 커널은 프록시 경로 전부가 트랩한다. 이미지가 Pyodide의 핸들 할당기 상태를
// 통째로 나르기 때문이라, 부활 커널이 다른 이름으로 새로 만든 프록시조차 죽는다. 반대로 순수
// 파이썬 큐 + run()의 인자와 반환값으로만 바이트가 건너는 표면은 이미지를 그대로 건넌다(케이스 O).
// 그래서 파이썬은 리스트만 들고, 바이트는 base64 문자열로 소스에 실려 들어오고 나간다.
// 파이썬 쪽 계약(send/recv/pending/address)은 한 글자도 바뀌지 않는다: 소비자 코드는 그대로다.
// 프레임을 소스에 싣는 코덱. contracts/byteCodec을 안 쓰는 이유는 층 규칙이다: 그 파일은
// btoa/Buffer(브라우저 전역)를 만지므로 platform이고, guest는 순수 계약만 소비한다. hex는
// 전역 없이 성립하는 순수 변환이라 여기 여섯 줄로 산다(사본 논쟁이 아니라 층 경계의 결과다).
const HEX = "0123456789abcdef";
function hexFromFrame(bytes) {
  let out = "";
  for (const byte of bytes) out += HEX[byte >> 4] + HEX[byte & 15];
  return out;
}
function frameFromHex(text) {
  const bytes = new Uint8Array(text.length / 2);
  for (let at = 0; at < bytes.length; at += 1) bytes[at] = parseInt(text.slice(at * 2, at * 2 + 2), 16);
  return bytes;
}

const BOOTSTRAP = (macLiteral, ipv4Literal, endpointLiteral) => `
import sys as _pyprocSys, types as _pyprocTypes

class _PyprocNetQueues:
    def __init__(self):
        self.inbox = []
        self.outbox = []

if '_pyprocNetState' not in globals():
    _pyprocNetState = _PyprocNetQueues()
_pyprocNetMod = _pyprocTypes.ModuleType('pyprocNet')

def _pyprocNetSend(frame):
    payload = bytes(frame)
    _pyprocNetState.outbox.append(payload)
    return len(payload)

def _pyprocNetRecv():
    return _pyprocNetState.inbox.pop(0) if _pyprocNetState.inbox else None

def _pyprocNetIngest(encoded):
    for chunk in encoded.split(','):
        if chunk:
            _pyprocNetState.inbox.append(bytes.fromhex(chunk))
    return len(_pyprocNetState.inbox)

def _pyprocNetDrain():
    out = ','.join(frame.hex() for frame in _pyprocNetState.outbox)
    _pyprocNetState.outbox.clear()
    return out

_pyprocNetMod.send = _pyprocNetSend
_pyprocNetMod.recv = _pyprocNetRecv
_pyprocNetMod.pending = lambda: len(_pyprocNetState.inbox)
_pyprocNetMod.address = lambda: {'mac': ${macLiteral}, 'ipv4': ${ipv4Literal}, 'endpointId': ${endpointLiteral}}
_pyprocSys.modules['pyprocNet'] = _pyprocNetMod
`;
export class PyprocPacketPort {
  // queueLimit: 파이썬이 안 읽어도 메모리가 무한히 늘지 않게 하는 상한. 넘으면 가장 오래된
  // 프레임을 버리고 그 사실을 센다(조용히 버리지 않는다는 뜻: inspect에 droppedFrames로 남는다).
  constructor({ device, endpointId, macAddress = [0x02, 0, 0, 0, 0, 2], ipv4Address = [10, 77, 0, 2], queueLimit = 256 } = {}) {
    if (!device || device.kind !== "network" || device.mode !== "packet" || typeof device.connect !== "function") {
      throw new TypeError("a packet network device is required");
    }
    if (!endpointId) throw new TypeError("endpointId is required");
    if (!Number.isInteger(queueLimit) || queueLimit < 1) throw new TypeError("queueLimit must be an integer >= 1");
    this._device = device;
    this._endpointId = String(endpointId);
    this._mac = toAddressBytes(macAddress, 6, "macAddress");
    this._ipv4 = toAddressBytes(ipv4Address, 4, "ipv4Address");
    this._queueLimit = queueLimit;
    this._inbox = [];
    this._port = null;
    this._runtime = null;
    this._pending = new Set();
    this._stats = {
      receivedFrames: 0, sentFrames: 0, arpReplies: 0, echoReplies: 0,
      queuedFrames: 0, droppedFrames: 0, sendErrors: 0,
    };
    this._lastError = null;
  }

  // 런타임에 파이썬 표면을 심고 스위치에 붙는다. 순서가 중요하다: connect가 먼저면 첫 프레임이
  // 파이썬 표면 없는 큐에 들어갈 수 있으므로 큐만 쓰는 수신 경로를 먼저 세운다.
  attach(runtime) {
    if (!runtime || typeof runtime.run !== "function" || typeof runtime.setGlobal !== "function") {
      throw new TypeError("a pyproc Runtime is required");
    }
    if (this._port) throw new WebMachineError("WEB_MACHINE_GUEST_STATE", `pyproc packet port is already attached: ${this._endpointId}`);
    this._runtime = runtime;
    this.installPythonSurface();
    this._port = this._device.connect({ endpointId: this._endpointId, receive: (frame) => this._receive(frame) });
  }

  // 파이썬 표면을 심는다. 멱등이다: 이미 큐가 있으면(이미지가 나른 경우, 또는 재부착) 그것을
  // 유지하고 모듈만 다시 세운다. 예전 판본은 여기서 JS 함수 프록시를 심었고 그것이 이미지
  // 이식성을 깨뜨렸다(캠페인 근본 원인). 지금 들어가는 것은 순수 파이썬과 리터럴뿐이다.
  installPythonSurface() {
    const runtime = this._runtime;
    if (!runtime) throw new WebMachineError("WEB_MACHINE_GUEST_STATE", `pyproc packet port has no runtime: ${this._endpointId}`);
    // 주소는 리터럴로 소스에 굽는다: 값이므로 프록시가 필요 없고, 이미지를 그대로 건넌다.
    runtime.run(BOOTSTRAP(
      JSON.stringify([...this._mac]),
      JSON.stringify([...this._ipv4]),
      JSON.stringify(this._endpointId),
    ));
  }

  // 턴 경계의 펌프. 값 경계라 바이트가 저절로 건너지 않는다: 들어온 프레임을 파이썬 inbox에
  // 넣고, 파이썬이 send한 것을 스위치로 내보낸다. 어댑터가 매 요청 앞뒤로 부른다(파이썬이
  // 스택에 있는 동안 run()을 다시 부르는 재진입을 피하는 유일한 지점이 턴 경계다).
  pump() {
    if (!this._runtime || !this._port) return { ingested: 0, drained: 0 };
    // 시간여행이 설치 이전 경계로 되감기면 이 이름들이 없다. 그때 펌프가 던지면 파이썬을 쓰지도
    // 않는 요청까지 전부 죽는다(감사 실측). 표면이 없으면 다시 심는 것이 옳다: 설치는 멱등이다.
    if (this._runtime.run("'_pyprocNetDrain' in globals()") !== true) this.installPythonSurface();
    let ingested = 0;
    // 큐를 먼저 비우면 ingest가 던졌을 때 그 프레임들이 사라진다(감사 실측). 성공 뒤에 비운다.
    // 길이 0 프레임은 이 경계를 건너지 못하므로(구분자가 ','다) 애초에 큐에 넣지 않는다:
    // 이더넷 프레임은 최소 14바이트라 0바이트는 유효한 입력이 아니고, 세면 통계가 거짓말을 한다.
    const pending = this._inbox.filter((frame) => frame.byteLength > 0);
    if (pending.length) {
      const encoded = pending.map((frame) => hexFromFrame(frame)).join(",");
      this._runtime.run(`_pyprocNetIngest(${JSON.stringify(encoded)})`);
      ingested = pending.length;
    }
    this._inbox.length = 0;
    const drainedText = String(this._runtime.run("_pyprocNetDrain()") || "");
    const frames = drainedText ? drainedText.split(",").filter(Boolean).map((chunk) => frameFromHex(chunk)) : [];
    for (const frame of frames) this.send(frame);
    return { ingested, drained: frames.length };
  }

  // 이미지 직전에 표면을 걷어낼 이유가 사라졌다. 예전에는 살아있는 JS 프록시가 힙에 있으면
  // 그 힙이 다른 프로세스에서 되살아나지 못해서(2026-07-27 실측) 뜨기 전에 걷고 다시 심었는데,
  // 그 파이썬 층 수리는 애초에 닿을 수 없는 곳을 겨눈 것이었다(2026-08-01 근본 원인). 표면이
  // 값 경계가 된 지금은 걷을 것이 없고, 이미지는 큐까지 그대로 나른다. 호출부 호환을 위해
  // 두 메서드는 남기되 아무것도 하지 않는다는 사실을 이름이 아니라 이 주석이 말한다.
  removePythonSurface() {}

  // 프레임 하나를 스위치로 보낸다. 파이썬에서도 이 경로를 쓴다(표면이 둘이면 통계가 갈린다).
  send(frame) {
    if (!this._port) throw new WebMachineError("WEB_MACHINE_GUEST_STATE", `pyproc packet port is not attached: ${this._endpointId}`);
    const bytes = frame instanceof Uint8Array ? frame : Uint8Array.from(frame || []);
    this._stats.sentFrames += 1;
    const pending = Promise.resolve()
      .then(() => this._port.send(bytes))
      .catch((error) => {
        this._stats.sendErrors += 1;
        this._lastError = String(error?.message || error);
      })
      .finally(() => this._pending.delete(pending));
    this._pending.add(pending);
    return bytes.byteLength;
  }

  async drain() {
    while (this._pending.size) await Promise.allSettled([...this._pending]);
  }

  detach() {
    if (!this._port) return;
    this._port.close();
    this._port = null;
    this._inbox.length = 0;
  }

  inspect() {
    return {
      mode: "packet",
      endpointId: this._endpointId,
      attached: !!this._port,
      macAddress: [...this._mac],
      ipv4Address: [...this._ipv4],
      pendingInbox: this._inbox.length,
      ...this._stats,
      lastError: this._lastError,
    };
  }

  // 빈 큐는 undefined로 답한다. JS `null`은 파이썬에 `JsNull`로 건너가 `is None`이 거짓이 되고,
  // 그러면 소비자의 `while (frame := recv()) is not None` 루프가 조용히 무한이 된다.
  _shift() {
    return this._inbox.shift();
  }

  // 자동 응답을 먼저 시도하고, 응답 대상이 아니면 파이썬 큐에 넣는다. 응답한 프레임도 큐에
  // 넣는다: 파이썬이 "무엇이 왔는지" 볼 수 있어야 자기 프로토콜을 쌓을 수 있다.
  _receive(frame) {
    this._stats.receivedFrames += 1;
    const arp = buildArpReply(frame, this._mac, this._ipv4);
    if (arp) {
      this._stats.arpReplies += 1;
      this.send(arp);
    } else {
      const echo = buildIcmpEchoReply(frame, this._mac, this._ipv4);
      if (echo) {
        this._stats.echoReplies += 1;
        this.send(echo);
      }
    }
    if (this._inbox.length >= this._queueLimit) {
      this._inbox.shift();
      this._stats.droppedFrames += 1;
    }
    this._inbox.push(frame.slice());
    this._stats.queuedFrames += 1;
  }

  // 파이썬 없이도 프레임 분류를 볼 수 있게(probe와 진단용). 순수 계약을 그대로 노출한다.
  static describe(frame) {
    return describeFrame(frame);
  }
}
