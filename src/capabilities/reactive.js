// reactive.js - Layer 2 능력: 복원 기반 리액티브.
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
import { PAGE_SIZE as PAGE, bytesToMb } from "../runtime/memoryLayout.js";
import { PyProcError } from "../runtime/errors.js";
import { hashDiffPages, packPages } from "../runtime/heapDelta.js";
import { normalizeRetentionPolicy, retentionExceeded } from "./reactive/retentionPolicy.js";

// 노드 하나의 희소 해시 겹침: 바뀐 페이지만 [page, a, b] 3워드로 담는다. 페이지 번호가
// 오름차순인 것은 pageHashes가 페이지를 오름차순으로 도는 데서 온다(hashesAt은 순서를 요구하지
// 않지만, 정렬돼 있으면 사람이 읽을 수 있고 이진 탐색 여지가 남는다).
function sparseHashes(pages, count, hashes) {
  const overlay = new Uint32Array(count * 3);
  let k = 0;
  for (const p of pages) { overlay[k++] = p; overlay[k++] = hashes[2 * p]; overlay[k++] = hashes[2 * p + 1]; }
  return overlay;
}

// Runtime.enableReactive()가 이 컨트롤러를 만든다(런타임당 1개 memoize = 다중 컨트롤러의
// 상호 비가시 복원이 낳는 조용한 오염을 구조적으로 제거). 소비자는 checkpoint/restore만 쓴다.
export class ReactiveController {
  constructor(rt) {
    this._rt = rt; this._mem = rt.memory;
    // hashes[0]은 경계의 전량 배열이고, 그 위 노드는 **희소 겹침**이다: 바뀐 페이지만
    // [page, a, b] 3워드로 담는다(hashesAt 주석에 표현과 복원 규칙이 있다). 노드마다 힙 전량의
    // 해시를 들고 있던 자리가 여기다 - 512MB 힙이면 노드당 64KB였고 1000노드면 64MB였다.
    this.base = null; this.deltas = []; this.hashes = []; this.parents = []; this.liveIdx = -1; this.prevHashes = null;
    this.pageCounts = []; // 노드별 페이지 수. 희소 겹침은 길이로 힙 크기를 말해주지 못한다.
    this.sps = []; // 노드별 스택 포인터(체크포인트 시점의 stackSave). cp.restore()가 소비한다.
    this._seqAt = -1; // 마지막 checkpoint/restore 시점의 Runtime.execSeq (경계 위반 감지)
    this._retentionPolicy = null;
    this._lastPressure = null;
    this._boundaryEpoch = 0; // 경계(cp0)가 옮겨간 횟수. rebase가 올린다.
  }
  _requireNode(j, op) {
    if (!Number.isInteger(j) || j < 0 || j >= this.deltas.length) {
      throw new PyProcError("PYPROC_INPUT_INVALID", `${op}: checkpoint index out of range (${j})`);
    }
    if (this.deltas[j] === null) throw new PyProcError("PYPROC_CHECKPOINT_PRUNED", `${op}: checkpoint ${j} was pruned`);
  }
  // 현재 힙 상태를 체크포인트로 저장. 첫 호출=base 통째, 이후=바뀐 페이지 델타.
  // 새 노드의 부모 = 지금의 live 노드(과거로 여행한 뒤라면 그 도착점 = 분기).
  // 반환 핸들: { index, ..., sp, restore(opts) }. restore()가 sp 운반 의식을 대체한다.
  checkpoint() {
    const mem = this._mem;
    const handle = (index, info) => Object.freeze({
      ...info, index, sp: this.sps[index],
      restore: (opts = {}) => this.restoreLive(index, null, opts),
    });
    if (this.base === null) {
      const hashes = mem.pageHashes();
      this.base = mem.sliceAll(); this.deltas.push(new Map()); this.parents.push(-1);
      this.hashes.push(hashes); this.prevHashes = hashes; this.liveIdx = 0;
      this.pageCounts.push(hashes.length / 2);
      this.sps.push(mem.stackSave());
      this._seqAt = this._rt.execSeq; // 경계 닫힘
      const result = handle(0, { changedPages: 0, deltaBytes: this.base.length, kind: "base" });
      this._applyRetention("checkpoint");
      return result;
    }
    const parent = this.liveIdx; // 델타의 기준이자 나무의 부모
    // 해시 배열은 페이지당 2워드 interleave(실효 64비트). 두 워드 모두 같아야 "안 바뀜".
    // 주사와 수집이 한 번의 순회다: 페이지를 해시하려고 방금 읽은 자리에서 바로 복사하므로
    // 변경분을 다시 도는 두 번째 통과가 없다(판정 법은 hashDiffPages와 같고 게이트가 문다).
    const delta = new Map();
    const hashes = mem.pageHashes(this.prevHashes, (p) => delta.set(p, mem.slicePage(p)));
    this.deltas.push(delta); this.hashes.push(sparseHashes(delta.keys(), delta.size, hashes));
    this.parents.push(parent); this.prevHashes = hashes; this.pageCounts.push(hashes.length / 2);
    this.sps.push(mem.stackSave());
    this.liveIdx = this.deltas.length - 1;
    this._seqAt = this._rt.execSeq; // 경계 닫힘
    let bytes = 0; for (const b of delta.values()) bytes += b.length;
    const result = handle(this.deltas.length - 1, { changedPages: delta.size, deltaBytes: bytes, kind: "delta", parent });
    this._applyRetention("checkpoint");
    return result;
  }
  // 노드 j의 전량 해시 배열. 저장 표현은 "경계 전량 + 노드별 희소 겹침"이라 전량이 필요한
  // 소비자(라이브-차분 복원의 목표, 델타 수집의 양끝, 저널의 주소 캐시)는 여기서 받는다.
  //
  // 복원 규칙은 _targetBytes와 같다: 루트에서 j까지의 겹침을 순서대로 덮으면 가까운 조상이
  // 이긴다. 라이브 노드는 이미 전량이 prevHashes에 있으므로 그대로 준다(가장 잦은 호출이다).
  // 비용은 O(페이지 수 + 경로 위 변경 페이지 수)이고, 그 결과는 페이지 쓰기보다 훨씬 싸다.
  hashesAt(j) {
    this._requireNode(j, "hashesAt");
    if (j === this.liveIdx && this.prevHashes) return this.prevHashes;
    if (j === 0) return this.hashes[0];
    const path = [];
    for (let k = j; k >= 1; k = this.parents[k]) {
      if (this.hashes[k] === null) throw new PyProcError("PYPROC_CHECKPOINT_PRUNED", `hashesAt: checkpoint ${k} on the root->${j} path was pruned`);
      path.push(k);
    }
    const out = new Uint32Array(2 * this.pageCounts[j]);
    const root = this.hashes[0];
    out.set(root.subarray(0, Math.min(root.length, out.length)));
    for (let i = path.length - 1; i >= 0; i--) {
      const overlay = this.hashes[path[i]];
      for (let t = 0; t < overlay.length; t += 3) {
        const at = 2 * overlay[t];
        // j보다 나중에 자란 페이지는 이 노드의 힙에 없다(경로 위 후손의 성장분).
        if (at + 1 < out.length) { out[at] = overlay[t + 1]; out[at + 1] = overlay[t + 2]; }
      }
    }
    return out;
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
    // 전량 해시를 liveIdx보다 먼저 뽑는다. 뒤로 미루면 라이브 지름길이 옛 prevHashes를 준다.
    const targetH = this.hashesAt(j);
    this.liveIdx = j; this.prevHashes = targetH;
    this._noteRestore();
  }
  // 라이브-차분 복원: 저장 해시 비교만(재해싱 0) -> 다른 페이지만 write. 인접 시간여행 즉시.
  // 전제는 파일 상단의 "실행 경계 계약" 참조. 성장 처리: 현재 힙이 목표보다 크면 목표 범위
  // 밖 페이지도 base로 되돌려야 dlmalloc/break 정합이 깨지지 않는다. liveH.length 기준 순회.
  // opts.rehash: 경계 계약이 깨졌을 수 있으면(실행 중 예외 = checkpoint 없이 더러워진 힙)
  // 저장 해시 대신 현재 힙을 재해시해 비교한다(브라우저 노트북 실측, 2026-07-11).
  restoreLive(j, savedSP, opts = {}) {
    this._requireNode(j, "restoreLive");
    const mem = this._mem, targetH = this.hashesAt(j);
    // 경계 위반(마지막 checkpoint/restore 이후 상태 변이) 감지 시 자동으로 재해시 경로 승격.
    const rehash = !!opts.rehash || this._rt.execSeq !== this._seqAt;
    const liveH = rehash ? mem.pageHashes() : this.prevHashes;
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
    this.liveIdx = j; this.prevHashes = targetH;
    this._noteRestore();
    return { pagesWritten: written, mbWritten: bytesToMb(wroteBytes, 2), rehashed: rehash };
  }

  // 두 체크포인트 사이의 사용자 상태를 { pages, bin }으로 수집한다(세션 저장/저널 커밋/이미지
  // 내보내기의 공용 프리미티브). 페이지 바이트는 현재 힙에서 읽으므로 toIdx는 live 노드여야
  // 하고(경계 닫힘 전제), 호출 직전에 checkpoint()로 경계를 닫는 것이 정본 사용법이다.
  collectDelta(fromIdx = 0, toIdx = this.liveIdx, opts = {}) {
    this._requireNode(fromIdx, "collectDelta");
    this._requireNode(toIdx, "collectDelta");
    if (toIdx !== this.liveIdx) {
      throw new PyProcError("PYPROC_INPUT_INVALID", `collectDelta: toIdx (${toIdx}) must be the live node (${this.liveIdx}); page bytes are read from the current heap`);
    }
    const mem = this._mem;
    const pages = hashDiffPages(this.hashesAt(fromIdx), this.hashesAt(toIdx));
    // pack:false = 페이지 목록만 필요한 소비자(저널 커밋)가 델타 전체 재할당을 피한다.
    // packPages가 즉시 bin에 복사하므로 여기서 사본을 먼저 만들 이유가 없다(그 사이에 파이썬이
    // 돌지 않는다). 예전에는 slicePage 사본 -> bin 복사로 델타 바이트마다 두 벌이 생겼다.
    const bin = opts.pack === false ? null : packPages((p) => mem.viewPageUnsafe(p), pages, PAGE);
    return { pages, bin, sp: mem.stackSave(), heapLen: mem.byteLength() };
  }

  // 외부 변이 신고: getGlobal이 준 라이브 PyProxy 호출처럼 execSeq에 잡히지 않는 힙 변이를
  // 소비자가 알리는 신호다. 다음 restoreLive가 자동으로 재해시 경로로 승격된다.
  // (모든 프록시 호출을 계측하는 값싼 방법은 없다: 계약 + 신고 채널이 정직한 경계다.)
  markDirty() {
    this._rt.noteStateMutation();
  }

  // 경계(cp0)가 옮겨간 횟수. rebase가 base를 전진시키면 hashes[0]이 바뀌므로 그 지문을
  // 캐시하는 소비자(저널의 h0)가 자기 캐시를 버릴 수 있어야 한다.
  get boundaryEpoch() { return this._boundaryEpoch; }

  // 선형 역사의 배출 밸브. pruneTo는 경로 **밖** 노드만 놓으므로, 문장마다 체크포인트를 찍는
  // 지배적 사용 모양(부모 체인이 선형)에서는 한 바이트도 돌려주지 못한다. rebase는 경로 자체를
  // base로 접어 넣는다: 루트->j의 델타를 순서대로 base에 적용하고 그 지점을 새 경계로 삼는다.
  //
  // 잃는 것은 j 이전으로의 시간여행이고 그것은 이미 표현 가능한 결말이다(PYPROC_CHECKPOINT_PRUNED).
  // **경계가 바뀐다**: hashes[0]이 j의 해시가 되므로 이전 경계로 쓴 저널과 이미지는 h0 불일치로
  // 거부된다. 그래서 이것은 브레이킹이고, boundaryEpoch로 소비자가 그 사실을 관측한다.
  rebaseTo(j) {
    this._requireNode(j, "rebaseTo");
    if (j !== this.liveIdx) {
      throw new PyProcError("PYPROC_INPUT_INVALID", `rebaseTo: only the live node can become the new boundary (live ${this.liveIdx}, asked ${j}).`);
    }
    const pruned = this.pruneTo(j); // 경로 밖은 먼저 놓는다(접을 대상은 경로뿐이다)
    const path = [];
    for (let k = j; k >= 1; k = this.parents[k]) path.push(k);
    let foldedBytes = 0;
    for (let i = path.length - 1; i >= 0; i--) {
      for (const [p, bytes] of this.deltas[path[i]]) {
        const at = p * PAGE;
        if (at + bytes.length > this.base.length) {
          // 성장분은 base 밖이다. base를 늘려 그 바이트를 담는다(경계가 곧 그 힙이어야 한다).
          const grown = new Uint8Array(at + bytes.length);
          grown.set(this.base);
          this.base = grown;
        }
        this.base.set(bytes, at);
        foldedBytes += bytes.length;
      }
    }
    this.hashes[0] = this.hashesAt(j); // 새 경계는 전량 배열이다(그 위 노드만 희소 겹침)
    this.pageCounts[0] = this.pageCounts[j];
    this.sps[0] = this.sps[j];
    this.deltas[0] = new Map();
    for (const k of path) { this.deltas[k] = null; this.hashes[k] = null; this.sps[k] = null; }
    this.liveIdx = 0;
    this.prevHashes = this.hashes[0];
    this._boundaryEpoch++;
    return { foldedNodes: path.length, foldedMB: bytesToMb(foldedBytes, 2), prunedNodes: pruned.freedNodes, baseMB: bytesToMb(this.base.length, 2) };
  }

  // 루트->j 부모 체인 밖 노드의 델타/해시를 해제한다(체크포인트 나무의 배출 밸브).
  // 인덱스 안정성을 위해 배열 길이는 유지하고 내용만 비운다. 해제된 노드의 복원은
  // PYPROC_CHECKPOINT_PRUNED로 거부된다. liveIdx는 경로 위에 있어야 한다.
  pruneTo(j) {
    this._requireNode(j, "pruneTo");
    const keep = new Set([0]);
    for (let k = j; k >= 1; k = this.parents[k]) keep.add(k);
    if (!keep.has(this.liveIdx)) {
      throw new PyProcError("PYPROC_INPUT_INVALID", `pruneTo: liveIdx (${this.liveIdx}) is off the root->${j} path. Restore to a node on that path first.`);
    }
    let freedNodes = 0, freedBytes = 0;
    for (let k = 1; k < this.deltas.length; k++) {
      if (keep.has(k) || this.deltas[k] === null) continue;
      for (const b of this.deltas[k].values()) freedBytes += b.length;
      this.deltas[k] = null; this.hashes[k] = null; this.sps[k] = null;
      freedNodes++;
    }
    return { freedNodes, freedMB: bytesToMb(freedBytes, 2), keptNodes: keep.size };
  }

  // 나무 전체 해제: base/델타/해시를 놓는다. 기존 노드로의 복원은 전부 거부되고(범위 밖),
  // 다음 checkpoint()가 새 base로 새 나무를 시작한다(컨트롤러 정체성은 유지 = memoize와 정합).
  dispose() {
    this.base = null; this.deltas = []; this.hashes = []; this.parents = []; this.sps = []; this.pageCounts = [];
    this.prevHashes = null; this.liveIdx = -1; this._seqAt = -1;
    this._lastPressure = null;
    this._boundaryEpoch++;
  }

  // 나무 조회(머신의 git): 노드마다 부모와 자식. 분기 UI와 원장이 읽는다.
  tree() {
    return this.parents.map((parent, index) => ({
      index, parent,
      children: this.parents.reduce((acc, p, i) => { if (p === index) acc.push(i); return acc; }, []),
    }));
  }

  // 현재 메모리 비용을 exact byte로 관측한다. base/delta뿐 아니라 저장된 hash 배열도 포함한다.
  // 브라우저/엔진 내부 overhead는 알 수 없으므로 이 값은 컨트롤러 소유 바이트의 하한이다.
  stats() {
    const active = [];
    let deltaBytes = 0, hashBytes = 0, prunedNodes = 0;
    for (let i = 0; i < this.deltas.length; i++) {
      const delta = this.deltas[i];
      if (delta === null) { prunedNodes++; continue; }
      active.push(i);
      if (i > 0) for (const bytes of delta.values()) deltaBytes += bytes.length;
      const hashes = this.hashes[i];
      if (hashes) hashBytes += hashes.byteLength;
    }
    // 라이브 노드의 전량 배열은 저장 표현 밖에 산다(희소 겹침만으로는 매 체크포인트마다
    // 전량을 다시 만들어야 해서 경계 비용이 두 배가 된다). 실제로 상주하므로 여기 센다.
    if (this.prevHashes && this.prevHashes !== this.hashes[0]) hashBytes += this.prevHashes.byteLength;
    const children = new Map(active.map((index) => [index, 0]));
    for (const index of active) {
      const parent = this.parents[index];
      if (children.has(parent)) children.set(parent, children.get(parent) + 1);
    }
    let liveDepth = 0;
    for (let cursor = this.liveIdx; cursor >= 0 && this.deltas[cursor] !== null; cursor = this.parents[cursor]) liveDepth++;
    const baseBytes = this.base?.byteLength || 0;
    const totalBytes = baseBytes + deltaBytes + hashBytes;
    return Object.freeze({
      baseBytes,
      deltaBytes,
      hashBytes,
      totalBytes,
      totalMB: bytesToMb(totalBytes, 2),
      nodeSlots: this.deltas.length,
      activeNodes: active.length,
      prunedNodes,
      branches: [...children.values()].filter((count) => count > 1).length,
      liveIdx: this.liveIdx,
      liveDepth,
      pressure: this._lastPressure,
    });
  }

  // budget은 soundness를 바꾸지 않는다. 초과 시 기본 동작은 관측이고, pruneBranches=true일 때만
  // live 경로 밖 분기를 해제한다. live 경로 자체를 자동 삭제하거나 rebase하지 않는다.
  setRetentionPolicy(policy = null) {
    if (policy === null) {
      this._retentionPolicy = null;
      this._lastPressure = null;
      return null;
    }
    const normalized = normalizeRetentionPolicy(policy);
    this._retentionPolicy = normalized;
    this._applyRetention("policy");
    return Object.freeze({ ...normalized });
  }

  _applyRetention(trigger) {
    if (!this._retentionPolicy || this.base === null) return null;
    const before = this.stats();
    const exceeded = retentionExceeded(this._retentionPolicy, before);
    if (!exceeded.length) {
      this._lastPressure = null;
      return null;
    }
    let pruned = null;
    if (this._retentionPolicy.pruneBranches && before.branches > 0 && this.liveIdx >= 0) {
      pruned = this.pruneTo(this.liveIdx);
    }
    // 가지치기는 경로 밖만 놓는다. 선형 역사에서는 그것이 0바이트이고, 그 모양이 지배적이다
    // (문장마다 체크포인트). 정책이 여전히 초과면 경로 자체를 접는다.
    let rebased = null;
    if (this._retentionPolicy.rebaseLinear && this.liveIdx > 0 && retentionExceeded(this._retentionPolicy, this.stats()).length) {
      rebased = this.rebaseTo(this.liveIdx);
    }
    const event = Object.freeze({ trigger, exceeded: Object.freeze(exceeded), before, after: this.stats(), pruned, rebased });
    this._lastPressure = event;
    if (this._retentionPolicy.onPressure) {
      try { this._retentionPolicy.onPressure(event); }
      catch (error) { queueMicrotask(() => { throw error; }); }
    }
    return event;
  }

  // base(기준 힙 사본)를 OPFS 등 파일 핸들로 백업/이동한다. RAM은 줄지 않는다(복원 경로가
  // base 상주를 전제하므로 해제 경로가 없다. 메모리 배출 밸브는 pruneTo/dispose가 정본).
  // 실측(attempts/runtimeParity/opfsCheckpointProbe): 30MB 쓰기 256ms, 읽기 46ms, 로드본 복원 정확.
  // 핸들은 소비자가 준다(위치·이름 하드코딩 없음). dir는 FileSystemDirectoryHandle.
  async saveBase(dir, name) {
    if (this.base === null) throw new PyProcError("PYPROC_INPUT_INVALID", "saveBase: no base yet (call checkpoint() first)");
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(this.base); await w.close();
    return { bytes: this.base.length };
  }
  async loadBase(dir, name) {
    const file = await (await dir.getFileHandle(name)).getFile();
    const loaded = new Uint8Array(await file.arrayBuffer());
    if (this.base !== null && loaded.length !== this.base.length) {
      throw new PyProcError("PYPROC_INPUT_INVALID", `loadBase: size mismatch (file ${loaded.length} vs base ${this.base.length})`);
    }
    this.base = loaded;
    return { bytes: loaded.length };
  }
  stackSave() { return this._mem.stackSave(); }
  storageMB() { return Math.round(bytesToMb(this.stats().totalBytes, 2)); }
}
