// machineJournal.js - Layer 2 능력: WAL(write-ahead log) = 강제종료 내성.
// 머신이 자기 상태를 유휴마다 디스크에 남긴다. 탭이 크래시하거나 전원이 나가도
// 다음 부팅이 마지막 커밋으로 부활한다(hibernate는 pagehide 훅이 성공해야 살지만 이건 아니다).
//
// 재기초(state-kernel 3단계): 저장·무결성·세대 프로토콜은 상태 커널(state/refProtocol)로
// 내려갔고, 여기 남는 것은 정책이다 - 언제 커밋하는가(유휴 감시), 무엇을 묶는가(/home pack),
// 무엇이 살아있는가(pack/prune의 live 판정). 새 저장 형식 = blob/<hex> 공유 CAS(loose+pack)
// + state/HEAD.json·PREV.json(커널 ref). 구 형식(루트 HEAD.json v2/v3)은 읽기만 지원하고
// (감지형 legacy reader), 첫 커널 커밋이 성공하면 구 ref를 지운다(writer 즉시 단일화).
//
// 설계 근거(실측 2종, 2026-07-12):
//   journalProbe 5/5 - clean save 없이 커널을 버려도 리플레이 + 저널 재생으로 상태 재구성.
//   churnProbe 7/7  - **문장마다 커밋하면 안 된다**: no-op 문장조차 ~95페이지(6MB)를 더럽히고
//                     그 집합은 97% 고정이다(CPython eval/GC의 scratch 워킹셋, 사용자 상태와 무관).
//                     배치해도 고유 페이지는 1-5%만 주는데, **총 쓰기량은 88% 준다**(커밋 빈도가
//                     비용을 지배). 그래서 커밋 단위는 문장이 아니라 **유휴**다.
//
// 계약(정직하게): 크래시 시 잃는 것은 "마지막 커밋 이후"다. 문장 단위 내구성이 아니라
// 경계 일관성을 준다. 커밋 주기는 소비자가 정한다(하드코딩 없음).
import { requirePortableHeap } from "../imagePortability.js";
import { PAGE_SIZE as PAGE, bytesToMb, mbToBytes } from "../../runtime/memoryLayout.js";
import { PyProcError } from "../../runtime/errors.js";
import { parseSha256Address, sha256Hex, verifySha256 } from "../../runtime/contentDigest.js";
import { commitState, openState } from "../../state/refProtocol.js";
import { decodeStateObject, validateStateCommit, validateStateTree } from "../../state/objectModel.js";
import { materializeHeapGeneration } from "../heapMaterialize.js";
import { BLOB_KEY, JournalBlobStore } from "./journalBlobStore.js";
import { readJsonFile } from "./journalJsonFile.js";
import { applyLegacyGeneration, cleanupLegacyRefs, legacyLiveKeys, readLegacyGeneration } from "./journalLegacyGeneration.js";
import { JournalKernelStore } from "./journalKernelStore.js";
import { DEFAULT_MACHINE_HOME_PATH, collectMachineHome } from "../machineHome.js";

const DEFAULT_AUTO_PACK_LOOSE_BLOBS = 128;
const DEFAULT_AUTO_PACK_LOOSE_MB = 8;
const JOURNAL_MARKER_FILE = "journalMarker.json";
const JOURNAL_MARKER_VERSION = 1;
const JOURNAL_STORAGE_ENTRIES = Object.freeze([
  ["state", true],
  ["blob", true],
  ["pack", true],
  ["PACKS.json", false],
  ["HEAD.json", false],
  ["PREV.json", false],
]);

function journalCorrupt(message, cause) {
  return new PyProcError("PYPROC_JOURNAL_CORRUPT", message, cause !== undefined ? { cause } : undefined);
}

function journalEvicted(marker) {
  return new PyProcError(
    "PYPROC_JOURNAL_EVICTED",
    "journal.recover: a committed journal marker exists but HEAD and PREV are missing. The backing generations were removed; refusing to start a fresh machine.",
    { context: { marker } },
  );
}

function normalizeAutoPackPolicy(policy) {
  if (!policy) return null;
  if (policy !== true && (typeof policy !== "object" || Array.isArray(policy))) throw new PyProcError("PYPROC_INPUT_INVALID", "journal.autoPack: needs true or a policy object");
  const cfg = policy === true ? {} : policy;
  const looseBlobs = cfg.looseBlobs ?? DEFAULT_AUTO_PACK_LOOSE_BLOBS;
  const looseMB = cfg.looseMB ?? DEFAULT_AUTO_PACK_LOOSE_MB;
  if (!(Number.isFinite(looseBlobs) && looseBlobs >= 1)) throw new PyProcError("PYPROC_INPUT_INVALID", "journal.autoPack: looseBlobs must be at least 1");
  if (!(Number.isFinite(looseMB) && looseMB > 0)) throw new PyProcError("PYPROC_INPUT_INVALID", "journal.autoPack: looseMB must be greater than 0");
  return { looseBlobs, looseBytes: mbToBytes(looseMB) };
}

export class MachineJournal {
  // cfg.dir: FileSystemDirectoryHandle (필수. 위치는 소비자가 준다)
  // cfg.reactive: ReactiveController (필수. cp0 = 리플레이 경계여야 부활이 성립한다)
  // cfg.idleMs: 유휴 판정(기본 2000). 이 시간 동안 상태 변이가 없으면 커밋한다.
  // cfg.includeHome: 기본 true. /home/web 파일 트리를 힙 세대와 같은 HEAD에 묶는다.
  // cfg.homePath: 파일 트리 루트(기본 /home/web).
  // cfg.autoPack: false 기본. true면 512MB 실측 봉투(131 loose keys/8.2MB -> pack 1.1s)에 맞춰
  //                loose 128개 또는 8MB 이상에서 커밋 직후 pack한다. 객체로 임계값을 바꿀 수 있다.
  // cfg.onStatus: 선택 콜백. 유휴 커밋의 성공/실패를 관측한다({ kind: "commit" | "commitError", ... }).
  //               durable을 주장하는 능력의 실패는 조용히 삼켜지면 안 된다: onStatus가 없으면
  //               console.warn으로라도 남긴다(기존 동작 보존).
  // cfg.pruneAfterCommit: 기본 false. true면 커밋 직후 reactive.pruneTo(liveIdx)로 체크포인트
  //               나무를 라이브 경로만 남긴다(장수 머신의 RAM 배출 밸브). 같은 컨트롤러를
  //               다른 소비자(Terminal %undo 마크 등)와 공유하면 그쪽 노드도 잘리므로 소비자 결정.
  constructor(rt, cfg = {}) {
    this._rt = rt;
    this._dir = cfg.dir;
    // 바이트를 어디에 어떻게 두는가는 blob store가, 세대 프로토콜은 상태 커널이 안다.
    // 여기는 언제 커밋하고 무엇이 살아있는지만 정한다. dir이 없으면 start()가 명시로 거부한다.
    this._blobs = new JournalBlobStore(cfg.dir);
    this._kernel = new JournalKernelStore(cfg.dir, this._blobs);
    this._reactive = cfg.reactive;
    this._idleMs = cfg.idleMs || 2000;
    this._homePath = cfg.includeHome === false ? null : (cfg.homePath || DEFAULT_MACHINE_HOME_PATH);
    this._autoPack = normalizeAutoPackPolicy(cfg.autoPack);
    // 이식성 승인은 저널을 켤 때 한 번 선언한다(커밋마다 묻지 않는다: 정책은 세션 단위다).
    this._opts = { allowHostProxies: cfg.allowHostProxies === true };
    // 세대에 함께 실리는 소비자 payload. 저널은 그 내용을 모른다: id와 두 함수만 안다.
    // 이것이 있어야 "답이 내구적이다"와 "효과가 내구적이다"가 한 세대의 한 사실이 된다
    // (결과를 세대 밖에 두면 승계자가 힙에 없는 효과의 결과를 답할 수 있다).
    this._sidecar = cfg.sidecar && cfg.sidecar.id ? cfg.sidecar : null;
    this._onStatus = typeof cfg.onStatus === "function" ? cfg.onStatus : null;
    this._pruneAfterCommit = cfg.pruneAfterCommit === true;
    this._timer = null;
    this._persistenceRequested = false;
    this._lastSeq = -1;
    this._sp = null;
    this._busy = false;
    // 진행 중 작업을 값으로 드러낸다. 회수하는 쪽(machine dispose)이 stop() 뒤에 이것을
    // 기다리지 않으면, 이미 해제된 리액티브 컨트롤러를 읽는 커밋이 파손 세대를 쓸 수 있다.
    this._inFlight = null;
    this._h0Key = null; // 리플레이 경계(cp0) 지문 캐시. 커밋/부활의 결정성 대조 축.
    // 페이지 주소 캐시: page -> { a, b, address }. a/b는 직전 커밋 시점의 페이지 해시 두 워드다.
    // 커밋 비용이 "직전 변경분"이 아니라 "부팅 이후 누적 델타"에 비례하던 자리를 좁힌다:
    // 누적 델타의 대부분은 매 커밋 바이트가 같은데도 페이지마다 SHA-256 + 저장소 조회를 다시
    // 했다. 힙 해시는 체크포인트가 이미 계산해 두므로 이 대조는 추가 비용이 0이다.
    // 무효화: 저장소가 사라지는 경계(delete/resetStorage)와 부활(recover) 뒤.
    this._addressCache = new Map();
    this._legacyCleaned = false;
    this.commits = 0;
    // 지속 스토리지 승인 여부. null은 "아직 묻지 않았다"이고, false는 "거절당했다"이다. 이 값이
    // 보이지 않으면 소비자는 자기 내구 머신이 브라우저 압박에 지워질 수 있는지조차 모른다:
    // 커밋은 성공했는데 다음 부팅이 첫 부팅이 되는 실패 모드가 조용히 남는다.
    this.persistentStorage = null;
    this.pagesWritten = 0; // 실제 디스크에 쓴 페이지(dedupe로 걸러진 것은 제외)
    this.packs = 0;
    this.packBytes = 0;
  }

  // 배타 구간의 시작과 끝. _busy 불리언만으로는 "지금 도는 중"을 알 수 있어도 "끝날 때까지
  // 기다린다"를 표현할 수 없다. 회수 경로가 그 대기를 요구하므로 in-flight를 값으로 남긴다.
  _begin() {
    this._busy = true;
    let release = null;
    this._inFlight = new Promise((resolve) => { release = resolve; });
    return () => { this._busy = false; this._inFlight = null; release(); };
  }

  // 진행 중 작업이 끝날 때까지 기다린다(없으면 즉시 반환). stop() 뒤에 이것을 기다려야
  // 해제된 컨트롤러를 읽는 커밋이 남지 않는다.
  async settle() { while (this._inFlight) await this._inFlight; }

  // 리플레이 경계(cp0)의 지문: 경계 해시 배열 전체의 SHA-256. 같은 엔진 + 같은 매니페스트라야 같다.
  // 커밋마다 commit.env.h0에 싣고, recover가 대조한다(엔진이 바뀐 채 부활하면 조용한 힙 오염이므로).
  async _boundaryKey() {
    if (!this._h0Key) {
      const h0 = this._reactive.hashes[0];
      this._h0Key = await sha256Hex(new Uint8Array(h0.buffer, h0.byteOffset, h0.byteLength));
    }
    return this._h0Key;
  }

  // 저장소 지속성 요청은 idle timer와 별개다. 명령 경계마다 즉시 커밋하는 KernelElection은
  // timer를 켜면 같은 저널에 두 commit이 경합하지만, 브라우저 eviction 경계는 계속 알아야 한다.
  requestPersistentStorage() {
    if (this._persistenceRequested) return this;
    this._persistenceRequested = true;
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then((granted) => { this.persistentStorage = granted === true; }, () => { this.persistentStorage = false; });
    } else {
      this.persistentStorage = false; // 요청할 방법이 없는 환경 = 승인되지 않은 것과 같다
    }
    return this;
  }

  // 유휴 감시 시작. execSeq가 멈춘 채 idleMs가 지나면 커밋한다(실행 중에는 끼어들지 않는다).
  start() {
    if (!this._dir) throw new PyProcError("PYPROC_INPUT_INVALID", "journal: cfg.dir (a FileSystemDirectoryHandle) is required. Get one with navigator.storage.getDirectory()");
    if (!this._reactive) throw new PyProcError("PYPROC_INPUT_INVALID", "journal: cfg.reactive (a ReactiveController) is required");
    this.requestPersistentStorage();
    if (this._timer) return this;
    this._sp = this._reactive.stackSave();
    this._lastSeq = this._rt.execSeq;
    let idleSince = null;
    this._timer = setInterval(() => {
      if (this._busy) return;
      if (this._rt.execSeq !== this._lastSeq) { this._lastSeq = this._rt.execSeq; idleSince = Date.now(); return; }
      if (idleSince === null) return;                 // 변이가 아직 없었다(커밋할 게 없다)
      if (Date.now() - idleSince < this._idleMs) return;
      idleSince = null;
      // 커밋 실패가 머신을 죽이지는 않지만, durable 주장의 실패는 관측 가능해야 한다.
      this.commit().then(
        (result) => { if (result && this._onStatus) this._onStatus({ kind: "commit", result }); },
        (e) => {
          const error = e instanceof PyProcError ? e : new PyProcError("PYPROC_JOURNAL_IO", `journal.commit: ${String((e && e.message) || e).slice(-200)}`, { retryable: true, cause: e });
          if (this._onStatus) this._onStatus({ kind: "commitError", error });
          else console.warn("pyproc journal:", error);
        },
      );
    }, Math.max(200, Math.floor(this._idleMs / 4)));
    return this;
  }

  stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }

  async _readMarker() {
    const read = await readJsonFile(this._dir, JOURNAL_MARKER_FILE);
    if (!("value" in read)) return read; // missing | corrupt는 그대로 흐른다
    const marker = read.value;
    if (marker?.version !== JOURNAL_MARKER_VERSION || !["committed", "deleted"].includes(marker.state)) {
      return { corrupt: `${JOURNAL_MARKER_FILE} 형식 위반` };
    }
    return { marker: { version: marker.version, state: marker.state } };
  }

  async _writeMarker(state) {
    try {
      const fh = await this._dir.getFileHandle(JOURNAL_MARKER_FILE, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify({ version: JOURNAL_MARKER_VERSION, state }));
      await w.close();
    } catch (e) {
      throw new PyProcError("PYPROC_JOURNAL_IO", `journal marker write failed: ${String((e && e.message) || e).slice(-180)}`, { retryable: true, cause: e });
    }
  }

  // 지금 상태를 커밋한다(수동 호출도 계약: 중요한 경계에서 명시적으로 남길 수 있다).
  // 저장은 커널 커밋 한 호출이다: sha256 승격은 정확히 이 지점에서만 일어난다(collectDelta는
  // 페이지 목록만 주고, 페이지 바이트의 주소화·dedupe·쓰기 순서 법은 커널이 소유한다).
  async commit() {
    if (this._busy) return null;
    const endBusy = this._begin();
    try {
      // 저널 커밋도 "부활을 전제한 쓰기"다(recover가 새 탭의 새 커널로 되살린다). 그러므로
      // 세션 저장/내보내기와 같은 이식성 전제를 통과해야 한다: 힙에 JS 핸들이 있으면 그 세대는
      // 되살아나도 블로킹 표면을 못 쓴다. 감사 실측(2026-08-01)이 이 우회를 잡았다.
      requirePortableHeap(this._rt, "journal.commit", this._opts);
      const r = this._reactive, mem = this._rt.memory;
      r.checkpoint(); // 경계 닫기(cp0 대비 차이가 곧 사용자 상태)
      const { pages } = r.collectDelta(0, r.liveIdx, { pack: false }); // 델타 수집의 정본(세션 저장과 같은 프리미티브)
      const home = this._homePath
        ? collectMachineHome(this._rt.fs, this._homePath, { required: false, errorPrefix: "journal.commit" })
        : null;
      const files = home && home.bin.length ? [{ id: "home", bytes: home.bin, meta: home.meta }] : [];
      const sidecarBytes = this._sidecar ? this._sidecar.collect() : null;
      if (sidecarBytes && sidecarBytes.byteLength) files.push({ id: this._sidecar.id, bytes: sidecarBytes, meta: null });
      const committedAt = new Date().toISOString();
      const liveHashes = r.hashes[r.liveIdx];
      this._kernel.resetCache();
      const committed = await commitState(globalThis.crypto, this._kernel, {
        // 페이지 사본은 커밋이 그것을 쓸 때 만든다(전량 동시 상주 대신 한 장씩).
        // 해시가 직전 커밋과 같은 페이지는 이미 저장된 주소를 단언한다(해시+조회를 건너뛴다).
        pages: pages.map((p) => {
          const cached = this._addressCache.get(p);
          if (cached && cached.a === liveHashes[2 * p] && cached.b === liveHashes[2 * p + 1]) return [p, { address: cached.address }];
          return [p, () => mem.slicePage(p)];
        }),
        pageSize: PAGE,
        heapLen: mem.byteLength(),
        sp: this._reactive.stackSave() ?? this._sp,
        files,
        env: { h0: await this._boundaryKey() },
        createdAt: committedAt,
      });
      // 커밋이 성공한 뒤에만 캐시를 갱신한다. 실패한 커밋의 주소를 기억하면 다음 커밋이
      // 저장되지 않은 주소를 단언한다.
      for (const [page, address] of committed.pageTable || []) {
        this._addressCache.set(page, { a: liveHashes[2 * page], b: liveHashes[2 * page + 1], address });
      }
      await this._cleanupLegacyRefs();
      // HEAD가 완전히 선 뒤 marker를 쓴다. marker가 committed인데 훗날 HEAD/PREV가 모두
      // 사라지면 recover는 그 부재를 첫 부팅으로 해석하지 않는다. 첫 커밋 중간 크래시는
      // accepted commit이 아니므로 marker를 만들지 않는다.
      await this._writeMarker("committed");
      this.commits++; this.pagesWritten += committed.pagesWrote;
      const result = {
        pages: pages.length,
        wrote: committed.pagesWrote,
        // 주소 캐시가 건너뛴 페이지 수. 커밋 비용이 변경분에 비례하는지 보는 관측점이다.
        reused: committed.reused,
        mb: bytesToMb(committed.pagesWrote * PAGE),
        committedAt,
        ...(home ? { home: { files: home.meta.entries.filter((entry) => entry.type === "file").length, mb: bytesToMb(home.bin.length), wrote: committed.filesWrote > 0 } } : {}),
      };
      const autoPack = await this._autoPackAfterCommit(result);
      if (autoPack) result.autoPack = autoPack;
      if (this._pruneAfterCommit) result.pruned = r.pruneTo(r.liveIdx);
      return result;
    } finally { endBusy(); }
  }

  // 의도한 삭제는 backing store를 먼저 지우고 tombstone을 마지막에 쓴다. 중간 실패에서 옛
  // committed marker가 남으면 다음 recover가 eviction/corruption으로 fail-closed한다.
  async delete() {
    if (this._busy) throw new PyProcError("PYPROC_JOURNAL_IO", "journal.delete: journal is busy", { retryable: true });
    this.stop();
    const endBusy = this._begin();
    try {
      this._kernel.resetStorage();
      this._addressCache.clear();
      for (const [name, recursive] of JOURNAL_STORAGE_ENTRIES) {
        try { await this._dir.removeEntry(name, recursive ? { recursive: true } : undefined); }
        catch (e) {
          if (e.name !== "NotFoundError") {
            throw new PyProcError("PYPROC_JOURNAL_IO", `journal.delete: failed to remove ${name} (${e.name})`, { retryable: true, cause: e });
          }
        }
      }
      await this._writeMarker("deleted");
      this._kernel.resetStorage();
      this._addressCache.clear();
      this._legacyCleaned = false;
      return { deleted: true };
    } finally { endBusy(); }
  }

  // 이관 완료 청소: 커널 refs가 섰으니 루트의 구 세대 파일(HEAD.json/PREV.json)은 죽은
  // 무게이고, 살아남으면 "커널 refs가 전부 유실된 미래"에 더 오래된 상태로 조용히 되감기는
  // 위험만 남긴다. blob/은 공유 CAS라 남긴다(live 판정은 pack/prune 몫). best-effort:
  // 삭제 실패는 커밋 성공을 물릴 사유가 아니고, 커널 refs 우선순위가 구 세대를 가린다.
  async _cleanupLegacyRefs() {
    if (this._legacyCleaned) return;
    await cleanupLegacyRefs(this._dir);
    this._legacyCleaned = true;
  }

  async _autoPackAfterCommit(result) {
    if (!this._autoPack || !result || result.wrote <= 0) return null;
    const stats = await this._blobs.looseStats();
    if (stats.count < this._autoPack.looseBlobs && stats.bytes < this._autoPack.looseBytes) return null;
    const packed = await this._packNow();
    packed.trigger = { looseBlobs: stats.count, looseMB: stats.mb };
    return packed;
  }

  // ---- live 판정: 무엇이 살아있는가는 세대를 아는 저널이 정하고, 어떻게 묶는가는 store가 안다 ----

  // 커널 세대의 live 키(hex): commit/tree 오브젝트 자체도 live다(pack만으로 recover가 성립해야
  // 하므로). HEAD와 PREV 두 세대를 모두 지킨다(PREV 깊이 2 고정).
  async _kernelLiveKeys(keys) {
    for (const name of ["HEAD", "PREV"]) {
      const r = await this._kernel.readRef(name);
      if (r.corrupt) throw journalCorrupt(`journal.pack: state ${r.corrupt}`);
      if (!r.ref) continue;
      keys.add(parseSha256Address(r.ref.commit));
      const commitBytes = await this._kernel.readObject(r.ref.commit);
      if (!commitBytes) throw journalCorrupt(`journal.pack: commit object is missing (${r.ref.commit.slice(0, 20)}..)`);
      const commit = validateStateCommit(decodeStateObject(commitBytes));
      keys.add(parseSha256Address(commit.tree));
      const treeBytes = await this._kernel.readObject(commit.tree);
      if (!treeBytes) throw journalCorrupt(`journal.pack: tree object is missing (${commit.tree.slice(0, 20)}..)`);
      const tree = validateStateTree(decodeStateObject(treeBytes));
      if (tree.kind === "pageTable") {
        for (const [, address] of tree.pages) keys.add(parseSha256Address(address));
        for (const e of tree.files || []) keys.add(parseSha256Address(e.address));
      } else {
        for (const e of tree.entries) keys.add(parseSha256Address(e.address));
      }
    }
    return keys;
  }

  async _liveKeys() {
    const keys = new Set();
    await this._kernelLiveKeys(keys);
    // 이관 전이면 구 세대도 live다. 이 갈래가 빠지면 prune이 살아 있는 blob을 지운다.
    await legacyLiveKeys(this._dir, keys, (why) => journalCorrupt(`journal.pack: ${why}`));
    keys.delete(null);
    return keys;
  }

  // 현재 세대들이 참조하는 live blob만 새 pack 파일 1개에 묶는다. recover는 loose와 pack을
  // 모두 읽으므로 기존 저널과 호환된다.
  async pack() {
    if (this._busy) return null;
    const endBusy = this._begin();
    try {
      return await this._packNow();
    } finally { endBusy(); }
  }

  async _packNow() {
    this._kernel.resetCache();
    const liveKeys = [...await this._liveKeys()].filter((key) => BLOB_KEY.test(key)).sort();
    const result = await this._blobs.packLive(liveKeys);
    if (result.bytes) { this.packs++; this.packBytes += result.bytes; }
    return result;
  }

  // 세대들이 더 이상 참조하지 않는 loose blob과 PACKS.json에 없는 stale pack 파일을 지운다.
  // pack을 새로 만들지는 않으므로, 긴 실행 중간의 가벼운 청소에 쓴다.
  async prune() {
    this._kernel.resetCache();
    const liveKeys = await this._liveKeys();
    const looseRemoved = await this._blobs.removeLooseBlobs((key) => !liveKeys.has(key));
    const index = await this._blobs.readPackIndex();
    const indexedPacks = new Set(index.packs.map((pack) => pack.file));
    const packsRemoved = await this._blobs.removePackFilesExcept(indexedPacks);
    return { liveKeys: liveKeys.size, looseRemoved, packsRemoved };
  }

  // ---- legacy reader: 구 포맷(루트 HEAD.json v2/v3)은 읽기만 지원한다 ----

  // 세대 파일 1개 판독: { head } | { missing: true } | { corrupt: 사유 }.
  // 구 세대 적용은 legacy 모듈이 한다. 여기 남는 것은 컨텍스트 주입뿐이다.
  async _applyLegacy(head) {
    const applied = await applyLegacyGeneration({
      head, rt: this._rt, reactive: this._reactive, blobs: this._blobs,
      boundaryKey: () => this._boundaryKey(), corrupt: journalCorrupt,
    });
    this._lastSeq = this._rt.execSeq;
    return applied;
  }

  // 커널 세대 1개를 힙에 적용한다. 검증(verify-on-read, h0 대조, HEAD->PREV 후퇴)은 openState가
  // 끝냈고, 여기는 힙 성장 + 경계 되감기 + 페이지/홈 적용만 한다.
  _applyKernelGeneration(opened) {
    const { tree, pages, files, commit } = opened;
    if (this._sidecar) this._sidecar.apply((files && files.get(this._sidecar.id)?.bytes) || null);
    const applied = materializeHeapGeneration({
      rt: this._rt, reactive: this._reactive, label: "journal.recover",
      heapLen: tree.heapLen, sp: tree.sp, pages,
      home: (files && files.get("home")) || null,
      wrapHomeError: (e) => journalCorrupt(`journal.recover: home generation is corrupt (${String(e.message || e).slice(-180)})`, e),
    });
    this._lastSeq = this._rt.execSeq;
    return {
      pages: applied.pages,
      mb: applied.mb,
      committedAt: commit.createdAt || null,
      ...(opened.fallback ? { fallback: true } : {}),
      ...(applied.home ? { home: applied.home } : {}),
    };
  }

  // 저널 재생: 커널 refs(state/)가 있으면 그쪽이 정본이다(HEAD -> corruption 한정 PREV 후퇴는
  // openState가 소유). 커널 refs가 전무할 때만 구 포맷(루트 HEAD.json)을 읽는다 - 이관 후
  // 남은 구 세대로 되감기는 것을 구조로 차단한다. 힙 크기/경계 지문 불일치는 손상이 아니므로
  // 후퇴 없이 즉시 예외(다른 엔진/매니페스트).
  async recover() {
    this._kernel.resetCache();
    // 부활은 힙을 통째로 갈아끼운다. 이전 힙 기준의 페이지 해시로 주소를 단언하면 다음 커밋이
    // 다른 내용을 그 주소로 기록한 것처럼 만든다(조용한 오염). 캐시는 여기서 버린다.
    this._addressCache.clear();
    const markerRead = await this._readMarker();
    if (markerRead.corrupt) throw journalCorrupt(`journal.recover: ${markerRead.corrupt}`);
    const marker = markerRead.marker || null;
    const head = await this._kernel.readRef("HEAD");
    const prev = await this._kernel.readRef("PREV");
    if (!(head.missing && prev.missing)) {
      if (marker?.state === "deleted") {
        throw journalCorrupt("journal.recover: deleted tombstone conflicts with a live or corrupt state generation");
      }
      let opened;
      try {
        opened = await openState(globalThis.crypto, this._kernel, { expectH0: await this._boundaryKey() });
      } catch (e) {
        if (e instanceof PyProcError && e.code === "PYPROC_STATE_CORRUPT") {
          throw journalCorrupt(`journal.recover: ${e.message}`, e); // 공개 계약은 저널 코드다
        }
        throw e; // PYPROC_REPLAY_MISMATCH 등은 그대로(같은 계약)
      }
      if (!opened) return null;
      return this._applyKernelGeneration(opened); // fallback 여부는 result.fallback이 나른다(기존 계약)
    }
    // legacy: HEAD 세대로 부활하고, HEAD가 파손이면 PREV 세대로 후퇴한다(잃는 것은 마지막
    // 커밋 하나). 둘 다 없으면 null(첫 부팅), 둘 다 파손이면 명시적 예외.
    const cur = await readLegacyGeneration(this._dir, "HEAD.json");
    const legacyPrev = await readLegacyGeneration(this._dir, "PREV.json");
    if (marker?.state === "deleted") {
      if (cur.missing && legacyPrev.missing) return null;
      throw journalCorrupt("journal.recover: deleted tombstone conflicts with a legacy generation");
    }
    if (cur.head) {
      try { return await this._applyLegacy(cur.head); }
      catch (e) {
        if (!e || e.code !== "PYPROC_JOURNAL_CORRUPT") throw e; // 환경 불일치는 후퇴 대상이 아니다
        cur.corrupt = e.message;
      }
    }
    if (legacyPrev.head) {
      const r = await this._applyLegacy(legacyPrev.head);
      r.fallback = true; // 직전 세대로 부활했음을 알린다(마지막 커밋 1개 유실)
      return r;
    }
    if (cur.missing && legacyPrev.missing) {
      if (marker?.state === "committed") throw journalEvicted(marker);
      return null; // marker 없음 = 첫 부팅, deleted tombstone = 의도한 삭제
    }
    throw journalCorrupt(`journal.recover: journal is corrupt (${cur.corrupt || "no HEAD"} / ${legacyPrev.corrupt || "no PREV"}). Refusing to masquerade as a first boot.`);
  }
}
