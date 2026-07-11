// reactive.js - Layer 1 능력: 복원 기반 리액티브.
// page-diff 체크포인트 체인 + 라이브-차분 복원 + 시간여행.
// WASM은 mprotect/dirty-page가 없어 실행 경계마다 완전 해시로 델타를 재구성한다.
// 완전 해시(Uint32 워드)가 sound의 열쇠 - 샘플링은 불완전 델타 -> 복원 크래시.
//
// 실행 경계 계약 (소비자가 지켜야 하는 규율):
//   restoreLive()는 "마지막 checkpoint()/restore() 이후 파이썬 실행이 없었다"를 전제한다.
//   저장된 liveIdx 해시가 현재 힙을 대변한다고 믿고 재해싱 없이 비교하기 때문이다(그래서 즉시).
//   실행을 했다면 반드시 checkpoint()로 경계를 닫고 나서 복원하라. 전제를 보장할 수 없으면
//   restore()(전체 복원, 안전 기준선)를 쓴다. 이 계약은 README 사용례와 함께 유지한다.
import { PAGE_SIZE as PAGE } from "../runtime/memoryCapability.js";

// Runtime.enableReactive()가 이 컨트롤러를 만든다. 소비자는 checkpoint/restore만 쓴다.
export class ReactiveController {
  constructor(rt) {
    this._mem = rt.memory;
    this.base = null; this.deltas = []; this.hashes = []; this.liveIdx = -1; this.prevHashes = null;
  }
  // 현재 힙 상태를 체크포인트로 저장. 첫 호출=base 통째, 이후=바뀐 페이지 델타.
  checkpoint() {
    const mem = this._mem, hashes = mem.pageHashes();
    if (this.base === null) {
      this.base = mem.sliceAll(); this.deltas.push(new Map());
      this.hashes.push(hashes); this.prevHashes = hashes; this.liveIdx = 0;
      return { index: 0, changedPages: 0, deltaBytes: this.base.length, kind: "base" };
    }
    const delta = new Map(), n = Math.min(hashes.length, this.prevHashes.length);
    for (let p = 0; p < n; p++) if (hashes[p] !== this.prevHashes[p]) delta.set(p, mem.slicePage(p));
    for (let p = this.prevHashes.length; p < hashes.length; p++) delta.set(p, mem.slicePage(p)); // 성장분
    this.deltas.push(delta); this.hashes.push(hashes); this.prevHashes = hashes;
    this.liveIdx = this.deltas.length - 1;
    let bytes = 0; for (const b of delta.values()) bytes += b.length;
    return { index: this.deltas.length - 1, changedPages: delta.size, deltaBytes: bytes, kind: "delta" };
  }
  _targetBytes(j, p) {
    for (let k = j; k >= 1; k--) if (this.deltas[k].has(p)) return this.deltas[k].get(p);
    const s = p * PAGE; return this.base.subarray(s, Math.min(s + PAGE, this.base.length));
  }
  // 전체 복원(안전 기준선): base 통째 + 델타 누적. 성장분은 base 범위 밖이라 자연 무시.
  restore(j, savedSP) {
    const mem = this._mem; mem.writeBase(this.base);
    for (let k = 1; k <= j; k++) for (const [p, b] of this.deltas[k]) mem.writePage(p, b);
    mem.stackRestore(savedSP);
    this.liveIdx = j; this.prevHashes = this.hashes[j];
  }
  // 라이브-차분 복원: 저장 해시 비교만(재해싱 0) -> 다른 페이지만 write. 인접 시간여행 즉시.
  // 전제는 파일 상단의 "실행 경계 계약" 참조. 성장 처리: 현재 힙이 목표보다 크면 목표 범위
  // 밖 페이지도 base로 되돌려야 dlmalloc/break 정합이 깨지지 않는다. liveH.length 기준 순회.
  restoreLive(j, savedSP) {
    const mem = this._mem, liveH = this.hashes[this.liveIdx], targetH = this.hashes[j];
    const nLive = liveH.length, nTarget = targetH.length;
    let written = 0, wroteBytes = 0;
    for (let p = 0; p < nLive; p++) {
      const th = p < nTarget ? targetH[p] : undefined;  // 목표 범위 밖(성장분)
      if (th !== undefined && liveH[p] === th) continue; // 이미 같으면 skip
      const want = p < nTarget ? this._targetBytes(j, p)
                   : this.base.subarray(p * PAGE, Math.min((p + 1) * PAGE, this.base.length));
      if (want.length === 0) continue; // base 범위도 밖이면 손대지 않음(진짜 목표엔 없던 물리페이지)
      mem.writePage(p, want); written++; wroteBytes += want.length;
    }
    mem.stackRestore(savedSP);
    this.liveIdx = j; this.prevHashes = this.hashes[j];
    return { pagesWritten: written, mbWritten: +(wroteBytes / 1048576).toFixed(2) };
  }
  timeTravel(j, savedSP) { return this.restoreLive(j, savedSP); }
  stackSave() { return this._mem.stackSave(); }
  storageMB() { let b = this.base ? this.base.length : 0; for (let k = 1; k < this.deltas.length; k++) for (const x of this.deltas[k].values()) b += x.length; return Math.round(b / 1048576); }
}
