// kernelPresence.js - Layer 4: 같은 origin의 탭들이 서로를 보고 있다는 사실 하나만 안다.
//
// 선출도 RPC도 모르는 순수 자료구조다: 누가 언제 보였는지, 얼마나 안 보이면 없는 것으로 치는지.
// KernelElection이 이 셋(참가자 표, 만료 정책, 정렬된 목록)을 자기 필드로 들고 있었고, 그래서
// "선출 로직을 읽는 사람"이 presence 만료 규칙을 먼저 통과해야 했다.
//
// 시간은 주입한다. 테스트가 시계를 밀 수 있어야 만료 정책을 실 함수로 판정할 수 있다.
export class KernelPresence {
  constructor(selfId, timeoutMs, now = () => Date.now()) {
    this.selfId = selfId;
    this._timeoutMs = timeoutMs;
    this._now = now;
    this._seen = new Map();
  }

  // 참가자를 봤다고 기록한다. 자기 자신도 같은 표에 산다(그래야 목록이 한 곳이다).
  note(id, at = this._now()) {
    if (id) this._seen.set(id, at);
    return this;
  }

  // 만료 청소. 자기 자신은 만료되지 않는다: 자기가 자기를 못 본다는 상태는 없다.
  expire(at = this._now()) {
    for (const [id, seenAt] of this._seen) {
      if (id !== this.selfId && at - seenAt > this._timeoutMs) this._seen.delete(id);
    }
    return this;
  }

  remove(id) {
    this._seen.delete(id);
    return this;
  }

  clear() {
    this._seen.clear();
    return this;
  }

  get size() {
    return this._seen.size;
  }

  // 관측 시점에서 살아 있는 참가자 목록(정렬). status()가 그대로 싣는다.
  // 자기 자신은 만료 판정을 받지 않는다(expire와 같은 규칙): 자기가 자기를 못 보는 상태는 없다.
  // 이 둘이 어긋나면 heartbeat 주기보다 긴 관측 간격에서 자기 이름이 목록에서 사라진다.
  liveIds(at = this._now()) {
    const cutoff = at - this._timeoutMs;
    return [...this._seen.entries()]
      .filter(([id, seenAt]) => id === this.selfId || seenAt >= cutoff)
      .map(([id]) => id)
      .sort();
  }
}
