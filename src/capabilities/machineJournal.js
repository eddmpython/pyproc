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
import { PAGE_SIZE as PAGE } from "../runtime/memoryLayout.js";
import { PyProcError } from "../runtime/errors.js";
import { parseSha256Address, sha256Hex, verifySha256 } from "../runtime/contentDigest.js";
import { growHeapTo } from "../runtime/heapGrow.js";
import { commitState, openState } from "../state/refProtocol.js";
import { decodeStateObject, validateStateCommit, validateStateTree } from "../state/objectModel.js";
import { BLOB_KEY, JournalBlobStore } from "./journalBlobStore.js";
import { JournalKernelStore } from "./journalKernelStore.js";
import {
  DEFAULT_MACHINE_HOME_PATH,
  applyMachineHome,
  collectMachineHome,
  validateMachineHomeMeta,
} from "./machineHome.js";

const DEFAULT_AUTO_PACK_LOOSE_BLOBS = 128;
const DEFAULT_AUTO_PACK_LOOSE_MB = 8;

function journalCorrupt(message, cause) {
  return new PyProcError("PYPROC_JOURNAL_CORRUPT", message, cause !== undefined ? { cause } : undefined);
}

function normalizeAutoPackPolicy(policy) {
  if (!policy) return null;
  if (policy !== true && (typeof policy !== "object" || Array.isArray(policy))) throw new PyProcError("PYPROC_INPUT_INVALID", "journal.autoPack: true 또는 정책 객체가 필요하다");
  const cfg = policy === true ? {} : policy;
  const looseBlobs = cfg.looseBlobs ?? DEFAULT_AUTO_PACK_LOOSE_BLOBS;
  const looseMB = cfg.looseMB ?? DEFAULT_AUTO_PACK_LOOSE_MB;
  if (!(Number.isFinite(looseBlobs) && looseBlobs >= 1)) throw new PyProcError("PYPROC_INPUT_INVALID", "journal.autoPack: looseBlobs는 1 이상이어야 한다");
  if (!(Number.isFinite(looseMB) && looseMB > 0)) throw new PyProcError("PYPROC_INPUT_INVALID", "journal.autoPack: looseMB는 0보다 커야 한다");
  return { looseBlobs, looseBytes: looseMB * 1048576 };
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
    this._onStatus = typeof cfg.onStatus === "function" ? cfg.onStatus : null;
    this._pruneAfterCommit = cfg.pruneAfterCommit === true;
    this._timer = null;
    this._lastSeq = -1;
    this._sp = null;
    this._busy = false;
    this._h0Key = null; // 리플레이 경계(cp0) 지문 캐시. 커밋/부활의 결정성 대조 축.
    this._legacyCleaned = false;
    this.commits = 0;
    this.pagesWritten = 0; // 실제 디스크에 쓴 페이지(dedupe로 걸러진 것은 제외)
    this.packs = 0;
    this.packBytes = 0;
  }

  // 리플레이 경계(cp0)의 지문: 경계 해시 배열 전체의 SHA-256. 같은 엔진 + 같은 매니페스트라야 같다.
  // 커밋마다 commit.env.h0에 싣고, recover가 대조한다(엔진이 바뀐 채 부활하면 조용한 힙 오염이므로).
  async _boundaryKey() {
    if (!this._h0Key) {
      const h0 = this._reactive.hashes[0];
      this._h0Key = await sha256Hex(new Uint8Array(h0.buffer, h0.byteOffset, h0.byteLength));
    }
    return this._h0Key;
  }

  // 유휴 감시 시작. execSeq가 멈춘 채 idleMs가 지나면 커밋한다(실행 중에는 끼어들지 않는다).
  start() {
    if (!this._dir) throw new PyProcError("PYPROC_INPUT_INVALID", "journal: cfg.dir(FileSystemDirectoryHandle)이 필요하다");
    if (!this._reactive) throw new PyProcError("PYPROC_INPUT_INVALID", "journal: cfg.reactive(ReactiveController)가 필요하다");
    if (this._timer) return this;
    // 저널 디스크(OPFS)가 브라우저 압박 시 지워지는 best-effort 캐시로 남지 않게 지속 스토리지를
    // 요청한다. 거부돼도 동작은 계속된다(내구성 능력의 계약상 요청은 이 능력의 몫이다).
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
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

  // 지금 상태를 커밋한다(수동 호출도 계약: 중요한 경계에서 명시적으로 남길 수 있다).
  // 저장은 커널 커밋 한 호출이다: sha256 승격은 정확히 이 지점에서만 일어난다(collectDelta는
  // 페이지 목록만 주고, 페이지 바이트의 주소화·dedupe·쓰기 순서 법은 커널이 소유한다).
  async commit() {
    if (this._busy) return null;
    this._busy = true;
    try {
      const r = this._reactive, mem = this._rt.memory;
      r.checkpoint(); // 경계 닫기(cp0 대비 차이가 곧 사용자 상태)
      const { pages } = r.collectDelta(0, r.liveIdx, { pack: false }); // 델타 수집의 정본(세션 저장과 같은 프리미티브)
      const home = this._homePath
        ? collectMachineHome(this._rt.fs, this._homePath, { required: false, errorPrefix: "journal.commit" })
        : null;
      const files = home && home.bin.length ? [{ id: "home", bytes: home.bin, meta: home.meta }] : [];
      const committedAt = new Date().toISOString();
      this._kernel.resetCache();
      const committed = await commitState(globalThis.crypto, this._kernel, {
        pages: pages.map((p) => [p, mem.slicePage(p)]),
        pageSize: PAGE,
        heapLen: mem.byteLength(),
        sp: this._reactive.stackSave() ?? this._sp,
        files,
        env: { h0: await this._boundaryKey() },
        createdAt: committedAt,
      });
      await this._cleanupLegacyRefs();
      this.commits++; this.pagesWritten += committed.pagesWrote;
      const result = {
        pages: pages.length,
        wrote: committed.pagesWrote,
        mb: +(committed.pagesWrote * PAGE / 1048576).toFixed(1),
        committedAt,
        ...(home ? { home: { files: home.meta.entries.filter((entry) => entry.type === "file").length, mb: +(home.bin.length / 1048576).toFixed(1), wrote: committed.filesWrote > 0 } } : {}),
      };
      const autoPack = await this._autoPackAfterCommit(result);
      if (autoPack) result.autoPack = autoPack;
      if (this._pruneAfterCommit) result.pruned = r.pruneTo(r.liveIdx);
      return result;
    } finally { this._busy = false; }
  }

  // 이관 완료 청소: 커널 refs가 섰으니 루트의 구 세대 파일(HEAD.json/PREV.json)은 죽은
  // 무게이고, 살아남으면 "커널 refs가 전부 유실된 미래"에 더 오래된 상태로 조용히 되감기는
  // 위험만 남긴다. blob/은 공유 CAS라 남긴다(live 판정은 pack/prune 몫). best-effort:
  // 삭제 실패는 커밋 성공을 물릴 사유가 아니고, 커널 refs 우선순위가 구 세대를 가린다.
  async _cleanupLegacyRefs() {
    if (this._legacyCleaned) return;
    for (const name of ["HEAD.json", "PREV.json"]) {
      try { await this._dir.removeEntry(name); } catch (e) {}
    }
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
      if (!commitBytes) throw journalCorrupt(`journal.pack: commit 오브젝트 없음(${r.ref.commit.slice(0, 20)}..)`);
      const commit = validateStateCommit(decodeStateObject(commitBytes));
      keys.add(parseSha256Address(commit.tree));
      const treeBytes = await this._kernel.readObject(commit.tree);
      if (!treeBytes) throw journalCorrupt(`journal.pack: tree 오브젝트 없음(${commit.tree.slice(0, 20)}..)`);
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

  async _readLiveHeads() {
    const heads = [];
    for (const name of ["HEAD.json", "PREV.json"]) {
      const generation = await this._readGeneration(name);
      if (generation.head) heads.push(generation.head);
      else if (generation.corrupt) throw journalCorrupt(`journal.pack: ${generation.corrupt}`);
    }
    return heads;
  }

  _legacyLiveKeys(heads, keys) {
    for (const head of heads) {
      for (const key of Object.values(head.pages || {})) keys.add(key);
      if (head.home && head.home.key) keys.add(head.home.key);
    }
    return keys;
  }

  async _liveKeys() {
    const keys = new Set();
    await this._kernelLiveKeys(keys);
    this._legacyLiveKeys(await this._readLiveHeads(), keys); // 이관 전이면 구 세대도 live다
    keys.delete(null);
    return keys;
  }

  // 현재 세대들이 참조하는 live blob만 새 pack 파일 1개에 묶는다. recover는 loose와 pack을
  // 모두 읽으므로 기존 저널과 호환된다.
  async pack() {
    if (this._busy) return null;
    this._busy = true;
    try {
      return await this._packNow();
    } finally { this._busy = false; }
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
  // "파일 없음"(첫 부팅)과 "파일 파손"(손상)을 구분한다: 손상을 첫 부팅으로 위장하면
  // 저널이 있는데도 조용히 빈 머신으로 부팅하는 데이터 유실이 된다(외부 평가 적발).
  async _readGeneration(name) {
    let text;
    try { text = await (await (await this._dir.getFileHandle(name)).getFile()).text(); }
    catch (e) {
      if (e.name === "NotFoundError") return { missing: true };
      return { corrupt: `${name} 읽기 실패: ${e.name}` };
    }
    try { return { head: JSON.parse(text) }; }
    catch (e) { return { corrupt: `${name} JSON 파손` }; }
  }

  // 구 세대 1개를 힙에 적용한다. blob은 내용 주소와 실제 바이트를 재대조해 저장 후 파손을
  // 잡는다. h0 불일치는 손상이 아니라 환경 불일치라 즉시 던진다.
  async _applyGeneration(head) {
    const mem = this._rt.memory;
    if (head.h0 && head.h0 !== await this._boundaryKey()) {
      throw new PyProcError("PYPROC_REPLAY_MISMATCH", "journal.recover: 리플레이 경계 지문(h0) 불일치. 다른 엔진/매니페스트의 저널이다(조용한 힙 오염 방지).");
    }
    growHeapTo((code) => this._rt.run(code), () => mem.byteLength(), head.heapLen, "journal.recover");
    // 성장 루프와 부팅 뒤 드리프트를 cp0으로 지운 위에 저널 페이지를 적용한다.
    this._reactive.restore(0, head.sp);
    const entries = Object.entries(head.pages);
    const buffered = [];
    const blobCache = new Map();
    const readCache = {};
    for (const [p, key] of entries) {
      let bytes = blobCache.get(key);
      if (!bytes) {
        bytes = await this._blobs.read(key, readCache);
        if (!(await verifySha256(bytes, key)).ok) throw journalCorrupt(`journal.recover: blob 파손(${key.slice(0, 12)}..)`);
        blobCache.set(key, bytes);
      }
      buffered.push([+p, bytes]); // 전량 검증 후에 쓴다(부분 적용 상태 방지)
    }
    let homePayload = null;
    if (head.home) {
      const { key, ...meta } = head.home;
      try {
        const bin = key ? await this._blobs.read(key, readCache) : new Uint8Array(0);
        if (key && !(await verifySha256(bin, key)).ok) throw journalCorrupt(`journal.recover: home blob 파손(${key.slice(0, 12)}..)`);
        validateMachineHomeMeta(meta, bin.length);
        homePayload = { meta, bin };
      } catch (e) {
        if (e && e.code === "PYPROC_JOURNAL_CORRUPT") throw e;
        throw journalCorrupt(`journal.recover: home 세대 파손(${String(e.message || e).slice(-180)})`);
      }
    }
    for (const [p, bytes] of buffered) mem.writePage(p, bytes);
    mem.stackRestore(head.sp);
    const home = homePayload ? applyMachineHome(this._rt.fs, homePayload.meta, homePayload.bin) : null;
    this._reactive.checkpoint(); // 부활 상태를 새 경계로
    this._lastSeq = this._rt.execSeq;
    return {
      pages: entries.length,
      mb: +(entries.length * PAGE / 1048576).toFixed(1),
      committedAt: head.committedAt || null,
      ...(home ? { home } : {}),
    };
  }

  // 커널 세대 1개를 힙에 적용한다. 검증(verify-on-read, h0 대조, HEAD->PREV 후퇴)은 openState가
  // 끝냈고, 여기는 힙 성장 + 경계 되감기 + 페이지/홈 적용만 한다.
  _applyKernelGeneration(opened) {
    const mem = this._rt.memory;
    const { tree, pages, files, commit } = opened;
    growHeapTo((code) => this._rt.run(code), () => mem.byteLength(), tree.heapLen, "journal.recover");
    this._reactive.restore(0, tree.sp);
    for (const [p, bytes] of pages) mem.writePage(p, bytes);
    mem.stackRestore(tree.sp);
    let home = null;
    const homeEntry = files ? files.get("home") : null;
    if (homeEntry) {
      try { validateMachineHomeMeta(homeEntry.meta, homeEntry.bytes.length); }
      catch (e) { throw journalCorrupt(`journal.recover: home 세대 파손(${String(e.message || e).slice(-180)})`, e); }
      home = applyMachineHome(this._rt.fs, homeEntry.meta, homeEntry.bytes);
    }
    this._reactive.checkpoint(); // 부활 상태를 새 경계로
    this._lastSeq = this._rt.execSeq;
    return {
      pages: pages.size,
      mb: +(pages.size * PAGE / 1048576).toFixed(1),
      committedAt: commit.createdAt || null,
      ...(opened.fallback ? { fallback: true } : {}),
      ...(home ? { home } : {}),
    };
  }

  // 저널 재생: 커널 refs(state/)가 있으면 그쪽이 정본이다(HEAD -> corruption 한정 PREV 후퇴는
  // openState가 소유). 커널 refs가 전무할 때만 구 포맷(루트 HEAD.json)을 읽는다 - 이관 후
  // 남은 구 세대로 되감기는 것을 구조로 차단한다. 힙 크기/경계 지문 불일치는 손상이 아니므로
  // 후퇴 없이 즉시 예외(다른 엔진/매니페스트).
  async recover() {
    this._kernel.resetCache();
    const head = await this._kernel.readRef("HEAD");
    const prev = await this._kernel.readRef("PREV");
    if (!(head.missing && prev.missing)) {
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
    const cur = await this._readGeneration("HEAD.json");
    if (cur.head) {
      try { return await this._applyGeneration(cur.head); }
      catch (e) {
        if (!e || e.code !== "PYPROC_JOURNAL_CORRUPT") throw e; // 환경 불일치는 후퇴 대상이 아니다
        cur.corrupt = e.message;
      }
    }
    const legacyPrev = await this._readGeneration("PREV.json");
    if (legacyPrev.head) {
      const r = await this._applyGeneration(legacyPrev.head);
      r.fallback = true; // 직전 세대로 부활했음을 알린다(마지막 커밋 1개 유실)
      return r;
    }
    if (cur.missing && legacyPrev.missing) return null; // 저널 없음 = 첫 부팅
    throw journalCorrupt(`journal.recover: 저널 파손(${cur.corrupt || "HEAD 없음"} / ${legacyPrev.corrupt || "PREV 없음"}). 첫 부팅으로 위장하지 않는다.`);
  }
}
