// pendingRequests.js - Layer 4: 보낸 RPC의 대기 표. 정확히 한 번 보증의 클라이언트 절반이다.
//
// 순수 자료구조다: 누가 무엇을 어느 리더에게 보냈고, 타이머가 무엇이고, 지금 승계를 기다리는
// 중인지. 선출도 채널도 저널도 모른다. KernelElection이 이 표를 여덟 곳에서 직접 만지고 있었고,
// 그래서 "요청 하나의 수명"을 읽으려면 선출 로직을 통과해야 했다.
//
// 타이머는 주입한다(setTimer/clearTimer). 시계를 밀 수 있어야 park/resend 정책을 실 함수로
// 판정할 수 있고, 그 판정이 없으면 이 표의 규칙은 10분짜리 브라우저 레인에서만 증명된다.
export class PendingRequests {
  // 기본 타이머는 화살표로 감싼다. setTimeout 참조를 그대로 저장하면 브라우저에서 window
  // 바인딩을 잃어 "Illegal invocation"이 난다(설치 패키지 레인이 그것을 잡았다).
  constructor({ setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) } = {}) {
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._entries = new Map();
    this._seq = 0;
  }

  get size() {
    return this._entries.size;
  }

  nextId(participantId) {
    return `${participantId}/${++this._seq}`;
  }

  get(requestId) {
    return this._entries.get(requestId);
  }

  add(requestId, entry) {
    this._entries.set(requestId, entry);
    return entry;
  }

  delete(requestId) {
    const entry = this._entries.get(requestId);
    if (entry && entry.timer) this._clearTimer(entry.timer);
    this._entries.delete(requestId);
    return entry;
  }

  // 승계를 기다리는 요청이 하나라도 있는가. 있으면 새 명령도 그 뒤에 서야 호출자가 보낸
  // 순서와 리더가 실행한 순서가 같다.
  hasAwaitingLeader() {
    for (const entry of this._entries.values()) if (entry.awaitingLeader) return true;
    return false;
  }

  arm(requestId, timeoutMs, onTimeout) {
    const entry = this._entries.get(requestId);
    if (!entry) return null;
    entry.timer = this._setTimer(() => {
      this._entries.delete(requestId);
      onTimeout(entry);
    }, timeoutMs);
    return entry;
  }

  // 리더 교체 대기로 전환한다. 타이머를 끄는 이유는 "아직 모른다"이지 "모른다"가 아니기
  // 때문이다: 승계자가 세대를 부활시키면 그 세대가 결과 기록을 나른다.
  parkAll() {
    for (const entry of this._entries.values()) {
      if (entry.timer) this._clearTimer(entry.timer);
      entry.timer = null;
      entry.awaitingLeader = true;
    }
    return this;
  }

  // 대기 중인 요청을 순서대로 낸다. Map은 삽입 순서를 지키므로 줄 자체가 순서의 정본이다.
  parked() {
    return [...this._entries.entries()].filter(([, entry]) => entry.awaitingLeader);
  }

  // 전부 거부하고 표를 비운다. 반환값은 거부된 엔트리들이다(호출자가 어휘를 입힌다).
  drain() {
    const entries = [...this._entries.values()];
    for (const entry of entries) if (entry.timer) this._clearTimer(entry.timer);
    this._entries.clear();
    return entries;
  }
}
