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
import { WebMachineError } from "../contracts/webMachineError.js";
import { buildArpReply, buildIcmpEchoReply, describeFrame, toAddressBytes } from "../contracts/ipv4Frames.js";

// 파이썬 표면. 경계를 넘는 변환은 명시적으로 한다: 암묵 변환은 Pyodide 판본에 따라 bytes를
// JsProxy로도 Uint8Array로도 만들어서, 어느 쪽이 오는지 모르는 코드가 된다. to_js/to_py가 계약이다.
const BOOTSTRAP = `
import sys as _pyprocSys, types as _pyprocTypes
from pyodide.ffi import to_js as _pyprocToJs

_pyprocNetMod = _pyprocTypes.ModuleType('pyprocNet')

def _pyprocNetSend(frame):
    return _pyprocNetSendFrame(_pyprocToJs(bytes(frame)))

def _pyprocNetRecv():
    value = _pyprocNetRecvFrame()
    if value is None:
        return None
    toPy = getattr(value, 'to_py', None)
    return bytes(toPy()) if toPy is not None else bytes(value)

def _pyprocNetAddressDict():
    value = _pyprocNetAddress()
    toPy = getattr(value, 'to_py', None)
    return toPy() if toPy is not None else value

_pyprocNetMod.send = _pyprocNetSend
_pyprocNetMod.recv = _pyprocNetRecv
_pyprocNetMod.pending = lambda: _pyprocNetPending()
_pyprocNetMod.address = _pyprocNetAddressDict
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

  // 파이썬 표면을 심는다. 여기 들어가는 것은 JS 함수 프록시이고, 그것이 힙에 남은 채로는
  // 이미지가 이동하지 못한다(아래 removePythonSurface의 근거).
  installPythonSurface() {
    const runtime = this._runtime;
    if (!runtime) throw new WebMachineError("WEB_MACHINE_GUEST_STATE", `pyproc packet port has no runtime: ${this._endpointId}`);
    runtime.setGlobal("_pyprocNetSendFrame", (frame) => this.send(frame));
    runtime.setGlobal("_pyprocNetRecvFrame", () => this._shift());
    runtime.setGlobal("_pyprocNetPending", () => this._inbox.length);
    runtime.setGlobal("_pyprocNetAddress", () => ({ mac: [...this._mac], ipv4: [...this._ipv4], endpointId: this._endpointId }));
    runtime.run(BOOTSTRAP);
  }

  // 스냅샷 직전에 파이썬 표면을 걷어낸다. 이 어댑터는 snapshotScope "portable"을 선언하는데,
  // 살아있는 JS 프록시가 힙에 있으면 그 힙은 다른 프로세스에서 되살아나지 못한다(실측
  // 2026-07-27: 배선 직후 web-computer 게이트가 `table index is out of bounds`로 죽었다.
  // 프록시가 가리키던 함수 테이블 항목이 새 인터프리터에 없다). 복원 뒤에는 다시 심는다.
  // 정직한 한계: 소비자 코드가 `import pyprocNet`으로 모듈 객체를 따로 붙들고 있으면 그
  // 참조까지 지우지는 못한다. 그래서 이 표면은 모듈 전역으로만 쓰는 것이 계약이다.
  removePythonSurface() {
    if (!this._runtime) return;
    this._runtime.run(
      "import sys as _pyprocSys\n"
      + "_pyprocSys.modules.pop('pyprocNet', None)\n"
      + "for _name in ('_pyprocNetSendFrame', '_pyprocNetRecvFrame', '_pyprocNetPending', '_pyprocNetAddress', '_pyprocNetMod', '_pyprocToJs'):\n"
      + "    globals().pop(_name, None)\n"
      + "del _name\n",
    );
  }

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
