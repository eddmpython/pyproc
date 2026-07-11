// reactive.js - Layer 1 능력: 복원 기반 리액티브.
// page-diff 체크포인트 체인 + 라이브-차분 복원 + 시간여행.
// WASM은 mprotect/dirty-page가 없어 실행 경계마다 완전 해시로 델타를 재구성한다.
// 완전 해시(Uint32 워드)가 sound의 열쇠 - 샘플링은 불완전 델타 -> 복원 크래시.
//
// 실행 경계 계약 (기계 강제, 2026-07-11부터):
//   restoreLive()의 즉시성(재해싱 0)은 "마지막 checkpoint()/restore() 이후 실행 없음"이 전제다.
//   이 전제를 Runtime.execSeq(상태 변이 카운터)로 O(1) 감지한다. 경계가 깨져 있으면(실행·예외·
//   setGlobal 등) 조용한 오염 대신 자동으로 재해시 경로로 승격해 복원한다. 반환값 rehashed로
//   어느 경로였는지 알 수 있고, opts.rehash로 강제할 수도 있다.
import { PAGE_SIZE as PAGE } from "../runtime/memoryCapability.js";

// Runtime.enableReactive()가 이 컨트롤러를 만든다. 소비자는 checkpoint/restore만 쓴다.
export class ReactiveController {
  constructor(rt) {
    this._rt = rt; this._mem = rt.memory;
    this.base = null; this.deltas = []; this.hashes = []; this.liveIdx = -1; this.prevHashes = null;
    this._seqAt = -1; // 마지막 checkpoint/restore 시점의 Runtime.execSeq (경계 위반 감지)
  }
  // 현재 힙 상태를 체크포인트로 저장. 첫 호출=base 통째, 이후=바뀐 페이지 델타.
  checkpoint() {
    const mem = this._mem, hashes = mem.pageHashes();
    if (this.base === null) {
      this.base = mem.sliceAll(); this.deltas.push(new Map());
      this.hashes.push(hashes); this.prevHashes = hashes; this.liveIdx = 0;
      this._seqAt = this._rt.execSeq; // 경계 닫힘
      return { index: 0, changedPages: 0, deltaBytes: this.base.length, kind: "base" };
    }
    // 해시 배열은 페이지당 2워드 interleave(실효 64비트). 두 워드 모두 같아야 "안 바뀜".
    const delta = new Map(), n = Math.min(hashes.length, this.prevHashes.length) / 2;
    for (let p = 0; p < n; p++)
      if (hashes[2 * p] !== this.prevHashes[2 * p] || hashes[2 * p + 1] !== this.prevHashes[2 * p + 1])
        delta.set(p, mem.slicePage(p));
    for (let p = this.prevHashes.length / 2; p < hashes.length / 2; p++) delta.set(p, mem.slicePage(p)); // 성장분
    this.deltas.push(delta); this.hashes.push(hashes); this.prevHashes = hashes;
    this.liveIdx = this.deltas.length - 1;
    this._seqAt = this._rt.execSeq; // 경계 닫힘
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
    this._seqAt = this._rt.execSeq;
  }
  // 라이브-차분 복원: 저장 해시 비교만(재해싱 0) -> 다른 페이지만 write. 인접 시간여행 즉시.
  // 전제는 파일 상단의 "실행 경계 계약" 참조. 성장 처리: 현재 힙이 목표보다 크면 목표 범위
  // 밖 페이지도 base로 되돌려야 dlmalloc/break 정합이 깨지지 않는다. liveH.length 기준 순회.
  // opts.rehash: 경계 계약이 깨졌을 수 있으면(실행 중 예외 = checkpoint 없이 더러워진 힙)
  // 저장 해시 대신 현재 힙을 재해시해 비교한다(dartlab 노트북 런타임에서 흡수, 2026-07-11).
  restoreLive(j, savedSP, opts = {}) {
    const mem = this._mem, targetH = this.hashes[j];
    // 경계 위반(마지막 checkpoint/restore 이후 상태 변이) 감지 시 자동으로 재해시 경로 승격.
    const rehash = !!opts.rehash || this._rt.execSeq !== this._seqAt;
    const liveH = rehash ? mem.pageHashes() : this.hashes[this.liveIdx];
    const nLive = liveH.length / 2, nTarget = targetH.length / 2; // 페이지당 2워드 interleave
    let written = 0, wroteBytes = 0;
    for (let p = 0; p < nLive; p++) {
      const inTarget = p < nTarget; // 밖이면 성장분
      if (inTarget && liveH[2 * p] === targetH[2 * p] && liveH[2 * p + 1] === targetH[2 * p + 1]) continue; // 이미 같으면 skip
      const want = inTarget ? this._targetBytes(j, p)
                   : this.base.subarray(p * PAGE, Math.min((p + 1) * PAGE, this.base.length));
      if (want.length === 0) continue; // base 범위도 밖이면 손대지 않음(진짜 목표엔 없던 물리페이지)
      mem.writePage(p, want); written++; wroteBytes += want.length;
    }
    mem.stackRestore(savedSP);
    this.liveIdx = j; this.prevHashes = this.hashes[j];
    this._seqAt = this._rt.execSeq;
    return { pagesWritten: written, mbWritten: +(wroteBytes / 1048576).toFixed(2), rehashed: rehash };
  }
  timeTravel(j, savedSP, opts = {}) { return this.restoreLive(j, savedSP, opts); }

  // base(기준 힙 사본)를 OPFS 등 파일 핸들로 내보내 RAM 부담을 옮긴다.
  // 실측(attempts/runtimeParity/opfsCheckpointProbe): 30MB 쓰기 256ms, 읽기 46ms, 로드본 복원 정확.
  // 핸들은 소비자가 준다(위치·이름 하드코딩 없음). dir는 FileSystemDirectoryHandle.
  async saveBase(dir, name) {
    if (this.base === null) throw new Error("saveBase: base가 없다(checkpoint() 먼저)");
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(this.base); await w.close();
    return { bytes: this.base.length };
  }
  async loadBase(dir, name) {
    const file = await (await dir.getFileHandle(name)).getFile();
    const loaded = new Uint8Array(await file.arrayBuffer());
    if (this.base !== null && loaded.length !== this.base.length) {
      throw new Error(`loadBase: 크기 불일치 (파일 ${loaded.length} vs base ${this.base.length})`);
    }
    this.base = loaded;
    return { bytes: loaded.length };
  }
  stackSave() { return this._mem.stackSave(); }
  storageMB() { let b = this.base ? this.base.length : 0; for (let k = 1; k < this.deltas.length; k++) for (const x of this.deltas[k].values()) b += x.length; return Math.round(b / 1048576); }
}
