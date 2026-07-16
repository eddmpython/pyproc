// reactive.js - Layer 1 능력: 복원 기반 리액티브.
// page-diff 체크포인트 **나무** + 라이브-차분 복원 + 시간여행/분기(머신의 git).
// WASM은 mprotect/dirty-page가 없어 실행 경계마다 완전 해시로 델타를 재구성한다.
// 완전 해시(Uint32 워드)가 sound의 열쇠 - 샘플링은 불완전 델타 -> 복원 크래시.
//
// 나무 구조(2026-07-12, branchProbe로 결함 재현 후 수정):
//   각 체크포인트의 델타는 "그때의 live 노드"와의 차이다. 과거로 시간여행한 뒤 새
//   체크포인트를 만들면(=%undo 후 새 문장) 그 노드의 부모는 인덱스-1이 아니라 여행
//   도착점이다. 선형 walk(k-1)는 버려진 형제 분기의 델타를 참조해 조용히 오염된다.
//   따라서 델타 해석은 반드시 부모 체인(parents)을 따른다. 분기는 공짜다: 어떤
//   노드로든 restoreLive 후 이어서 체크포인트하면 나무가 자란다.
//
// 실행 경계 계약 (기계 강제, 2026-07-11부터):
//   restoreLive()의 즉시성(재해싱 0)은 "마지막 checkpoint()/restore() 이후 실행 없음"이 전제다.
//   이 전제를 Runtime.execSeq(상태 변이 카운터)로 O(1) 감지한다. 경계가 깨져 있으면(실행·예외·
//   setGlobal 등) 조용한 오염 대신 자동으로 재해시 경로로 승격해 복원한다. 반환값 rehashed로
//   어느 경로였는지 알 수 있고, opts.rehash로 강제할 수도 있다.
import { PAGE_SIZE as PAGE } from "../runtime/memoryLayout.js";
import { PyProcError } from "../runtime/errors.js";
import { hashDiffPages, packPages } from "../runtime/heapDelta.js";

// Runtime.enableReactive()가 이 컨트롤러를 만든다(런타임당 1개 memoize = 다중 컨트롤러의
// 상호 비가시 복원이 낳는 조용한 오염을 구조적으로 제거). 소비자는 checkpoint/restore만 쓴다.
export class ReactiveController {
  constructor(rt) {
    this._rt = rt; this._mem = rt.memory;
    this.base = null; this.deltas = []; this.hashes = []; this.parents = []; this.liveIdx = -1; this.prevHashes = null;
    this.sps = []; // 노드별 스택 포인터(체크포인트 시점의 stackSave). cp.restore()가 소비한다.
    this._seqAt = -1; // 마지막 checkpoint/restore 시점의 Runtime.execSeq (경계 위반 감지)
  }
  _requireNode(j, op) {
    if (!Number.isInteger(j) || j < 0 || j >= this.deltas.length) {
      throw new PyProcError("PYPROC_INPUT_INVALID", `${op}: 체크포인트 인덱스 범위 위반(${j})`);
    }
    if (this.deltas[j] === null) throw new PyProcError("PYPROC_CHECKPOINT_PRUNED", `${op}: prune된 체크포인트(${j})다`);
  }
  // 현재 힙 상태를 체크포인트로 저장. 첫 호출=base 통째, 이후=바뀐 페이지 델타.
  // 새 노드의 부모 = 지금의 live 노드(과거로 여행한 뒤라면 그 도착점 = 분기).
  // 반환 핸들: { index, ..., sp, restore(opts) }. restore()가 sp 운반 의식을 대체한다.
  checkpoint() {
    const mem = this._mem, hashes = mem.pageHashes();
    const handle = (index, info) => Object.freeze({
      ...info, index, sp: this.sps[index],
      restore: (opts = {}) => this.restoreLive(index, null, opts),
    });
    if (this.base === null) {
      this.base = mem.sliceAll(); this.deltas.push(new Map()); this.parents.push(-1);
      this.hashes.push(hashes); this.prevHashes = hashes; this.liveIdx = 0;
      this.sps.push(mem.stackSave());
      this._seqAt = this._rt.execSeq; // 경계 닫힘
      return handle(0, { changedPages: 0, deltaBytes: this.base.length, kind: "base" });
    }
    const parent = this.liveIdx; // 델타의 기준이자 나무의 부모
    // 해시 배열은 페이지당 2워드 interleave(실효 64비트). 두 워드 모두 같아야 "안 바뀜".
    const delta = new Map();
    for (const p of hashDiffPages(this.prevHashes, hashes)) delta.set(p, mem.slicePage(p));
    this.deltas.push(delta); this.hashes.push(hashes); this.parents.push(parent); this.prevHashes = hashes;
    this.sps.push(mem.stackSave());
    this.liveIdx = this.deltas.length - 1;
    this._seqAt = this._rt.execSeq; // 경계 닫힘
    let bytes = 0; for (const b of delta.values()) bytes += b.length;
    return handle(this.deltas.length - 1, { changedPages: delta.size, deltaBytes: bytes, kind: "delta", parent });
  }
  // 노드 j의 페이지 p 내용 = 부모 체인을 거슬러 처음 만나는 델타(없으면 base).
  // 선형(k-1) walk는 버려진 형제 분기를 참조해 오염된다(branchProbe로 재현된 결함).
  _targetBytes(j, p) {
    for (let k = j; k >= 1; k = this.parents[k]) if (this.deltas[k].has(p)) return this.deltas[k].get(p);
    const s = p * PAGE; return this.base.subarray(s, Math.min(s + PAGE, this.base.length));
  }
  // 복원도 상태 변이다: 컨트롤러 밖 관찰자(저널 유휴 감시 등)가 복원을 경계 이벤트로
  // 보도록 execSeq에 기록하고, 자기 경계는 그 값으로 닫는다.
  _noteRestore() {
    this._rt.noteStateMutation();
    this._seqAt = this._rt.execSeq;
  }
  // 전체 복원(안전 기준선): base 통째 + 루트->j 경로의 델타 누적. 성장분은 base 범위 밖이라 자연 무시.
  // savedSP 생략(null/undefined) 시 노드에 저장된 sp를 쓴다.
  restore(j, savedSP) {
    this._requireNode(j, "restore");
    const mem = this._mem; mem.writeBase(this.base);
    const path = [];
    for (let k = j; k >= 1; k = this.parents[k]) path.push(k);
    for (let i = path.length - 1; i >= 0; i--) for (const [p, b] of this.deltas[path[i]]) mem.writePage(p, b);
    mem.stackRestore(savedSP ?? this.sps[j]);
    this.liveIdx = j; this.prevHashes = this.hashes[j];
    this._noteRestore();
  }
  // 라이브-차분 복원: 저장 해시 비교만(재해싱 0) -> 다른 페이지만 write. 인접 시간여행 즉시.
  // 전제는 파일 상단의 "실행 경계 계약" 참조. 성장 처리: 현재 힙이 목표보다 크면 목표 범위
  // 밖 페이지도 base로 되돌려야 dlmalloc/break 정합이 깨지지 않는다. liveH.length 기준 순회.
  // opts.rehash: 경계 계약이 깨졌을 수 있으면(실행 중 예외 = checkpoint 없이 더러워진 힙)
  // 저장 해시 대신 현재 힙을 재해시해 비교한다(dartlab 노트북 런타임에서 흡수, 2026-07-11).
  restoreLive(j, savedSP, opts = {}) {
    this._requireNode(j, "restoreLive");
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
    mem.stackRestore(savedSP ?? this.sps[j]);
    this.liveIdx = j; this.prevHashes = this.hashes[j];
    this._noteRestore();
    return { pagesWritten: written, mbWritten: +(wroteBytes / 1048576).toFixed(2), rehashed: rehash };
  }
  timeTravel(j, savedSP, opts = {}) { return this.restoreLive(j, savedSP, opts); }

  // 두 체크포인트 사이의 사용자 상태를 { pages, bin }으로 수집한다(세션 저장/저널 커밋/이미지
  // 내보내기의 공용 프리미티브). 페이지 바이트는 현재 힙에서 읽으므로 toIdx는 live 노드여야
  // 하고(경계 닫힘 전제), 호출 직전에 checkpoint()로 경계를 닫는 것이 정본 사용법이다.
  collectDelta(fromIdx = 0, toIdx = this.liveIdx, opts = {}) {
    this._requireNode(fromIdx, "collectDelta");
    this._requireNode(toIdx, "collectDelta");
    if (toIdx !== this.liveIdx) {
      throw new PyProcError("PYPROC_INPUT_INVALID", `collectDelta: toIdx(${toIdx})는 live 노드(${this.liveIdx})여야 한다(페이지 바이트는 현재 힙에서 읽는다)`);
    }
    const mem = this._mem;
    const pages = hashDiffPages(this.hashes[fromIdx], this.hashes[toIdx]);
    // pack:false = 페이지 목록만 필요한 소비자(저널 커밋)가 델타 전체 재할당을 피한다.
    const bin = opts.pack === false ? null : packPages((p) => mem.slicePage(p), pages, PAGE);
    return { pages, bin, sp: mem.stackSave(), heapLen: mem.byteLength() };
  }

  // 외부 변이 신고: getGlobal이 준 라이브 PyProxy 호출처럼 execSeq에 잡히지 않는 힙 변이를
  // 소비자가 알리는 신호다. 다음 restoreLive가 자동으로 재해시 경로로 승격된다.
  // (모든 프록시 호출을 계측하는 값싼 방법은 없다: 계약 + 신고 채널이 정직한 경계다.)
  markDirty() {
    this._rt.noteStateMutation();
  }

  // 루트->j 부모 체인 밖 노드의 델타/해시를 해제한다(체크포인트 나무의 배출 밸브).
  // 인덱스 안정성을 위해 배열 길이는 유지하고 내용만 비운다. 해제된 노드의 복원은
  // PYPROC_CHECKPOINT_PRUNED로 거부된다. liveIdx는 경로 위에 있어야 한다.
  pruneTo(j) {
    this._requireNode(j, "pruneTo");
    const keep = new Set([0]);
    for (let k = j; k >= 1; k = this.parents[k]) keep.add(k);
    if (!keep.has(this.liveIdx)) {
      throw new PyProcError("PYPROC_INPUT_INVALID", `pruneTo: liveIdx(${this.liveIdx})가 루트->${j} 경로 밖이다. 먼저 경로 위 노드로 복원하라.`);
    }
    let freedNodes = 0, freedBytes = 0;
    for (let k = 1; k < this.deltas.length; k++) {
      if (keep.has(k) || this.deltas[k] === null) continue;
      for (const b of this.deltas[k].values()) freedBytes += b.length;
      this.deltas[k] = null; this.hashes[k] = null; this.sps[k] = null;
      freedNodes++;
    }
    return { freedNodes, freedMB: +(freedBytes / 1048576).toFixed(2), keptNodes: keep.size };
  }

  // 나무 전체 해제: base/델타/해시를 놓는다. 기존 노드로의 복원은 전부 거부되고(범위 밖),
  // 다음 checkpoint()가 새 base로 새 나무를 시작한다(컨트롤러 정체성은 유지 = memoize와 정합).
  dispose() {
    this.base = null; this.deltas = []; this.hashes = []; this.parents = []; this.sps = [];
    this.prevHashes = null; this.liveIdx = -1; this._seqAt = -1;
  }

  // 나무 조회(머신의 git): 노드마다 부모와 자식. 분기 UI와 원장이 읽는다.
  tree() {
    return this.parents.map((parent, index) => ({
      index, parent,
      children: this.parents.reduce((acc, p, i) => { if (p === index) acc.push(i); return acc; }, []),
    }));
  }

  // base(기준 힙 사본)를 OPFS 등 파일 핸들로 백업/이동한다. RAM은 줄지 않는다(복원 경로가
  // base 상주를 전제하므로 해제 경로가 없다. 메모리 배출 밸브는 pruneTo/dispose가 정본).
  // 실측(attempts/runtimeParity/opfsCheckpointProbe): 30MB 쓰기 256ms, 읽기 46ms, 로드본 복원 정확.
  // 핸들은 소비자가 준다(위치·이름 하드코딩 없음). dir는 FileSystemDirectoryHandle.
  async saveBase(dir, name) {
    if (this.base === null) throw new PyProcError("PYPROC_INPUT_INVALID", "saveBase: base가 없다(checkpoint() 먼저)");
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(this.base); await w.close();
    return { bytes: this.base.length };
  }
  async loadBase(dir, name) {
    const file = await (await dir.getFileHandle(name)).getFile();
    const loaded = new Uint8Array(await file.arrayBuffer());
    if (this.base !== null && loaded.length !== this.base.length) {
      throw new PyProcError("PYPROC_INPUT_INVALID", `loadBase: 크기 불일치 (파일 ${loaded.length} vs base ${this.base.length})`);
    }
    this.base = loaded;
    return { bytes: loaded.length };
  }
  stackSave() { return this._mem.stackSave(); }
  storageMB() { let b = this.base ? this.base.length : 0; for (let k = 1; k < this.deltas.length; k++) for (const x of this.deltas[k].values()) b += x.length; return Math.round(b / 1048576); }
}
