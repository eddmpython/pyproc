// machineJournal.js - Layer 1 능력: WAL(write-ahead log) = 강제종료 내성.
// 머신이 자기 상태를 유휴마다 디스크에 남긴다. 탭이 크래시하거나 전원이 나가도
// 다음 부팅이 마지막 커밋으로 부활한다(hibernate는 pagehide 훅이 성공해야 살지만 이건 아니다).
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
// 저장 형식: blob/<sha256> loose CAS + HEAD.json/PREV.json. pack() 후에는 PACKS.json + pack/*.bin도
// 같은 CAS blob 저장소로 읽는다(loose와 pack 모두 recover 호환).
import { PAGE_SIZE as PAGE } from "../runtime/memoryLayout.js";
import { PyProcError } from "../runtime/errors.js";
import { sha256Hex, verifySha256 } from "../runtime/contentDigest.js";
import { growHeapTo } from "../runtime/heapGrow.js";
import { BLOB_KEY, JournalBlobStore } from "./journalBlobStore.js";
import {
  DEFAULT_MACHINE_HOME_PATH,
  applyMachineHome,
  collectMachineHome,
  validateMachineHomeMeta,
} from "./machineHome.js";

const DEFAULT_AUTO_PACK_LOOSE_BLOBS = 128;
const DEFAULT_AUTO_PACK_LOOSE_MB = 8;

function journalCorrupt(message) {
  return new PyProcError("PYPROC_JOURNAL_CORRUPT", message);
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
    // 바이트를 어디에 어떻게 두는가는 blob store가 안다. 여기는 언제 커밋하고 무엇이
    // 살아있는지만 정한다. dir이 없으면 start()가 명시로 거부하므로 여기서는 만들기만 한다.
    this._blobs = new JournalBlobStore(cfg.dir);
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
    this.commits = 0;
    this.pagesWritten = 0; // 실제 디스크에 쓴 페이지(dedupe로 걸러진 것은 제외)
    this.packs = 0;
    this.packBytes = 0;
  }

  // 리플레이 경계(cp0)의 지문: 경계 해시 배열 전체의 SHA-256. 같은 엔진 + 같은 매니페스트라야 같다.
  // 커밋마다 HEAD에 싣고, recover가 대조한다(엔진이 바뀐 채 부활하면 조용한 힙 오염이므로).
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
  async commit() {
    if (this._busy) return null;
    this._busy = true;
    try {
      const r = this._reactive, mem = this._rt.memory;
      r.checkpoint(); // 경계 닫기(cp0 대비 차이가 곧 사용자 상태)
      const { pages } = r.collectDelta(0, r.liveIdx, { pack: false }); // 델타 수집의 정본(세션 저장과 같은 프리미티브)
      const map = {};
      const knownKeys = new Set();
      const lookupCache = {};
      let wrote = 0;
      for (const p of pages) {
        const bytes = mem.slicePage(p);
        const key = await sha256Hex(bytes);
        map[p] = key;
        if (knownKeys.has(key)) continue; // 같은 커밋 안의 반복 페이지는 OPFS 조회도 중복하지 않는다.
        if (await this._blobs.has(key, lookupCache)) {
          knownKeys.add(key);
          continue; // loose 또는 pack에 이미 있으면 dedupe(내용 주소)
        }
        await this._blobs.write(key, bytes);
        knownKeys.add(key);
        wrote++;
      }
      const home = this._homePath
        ? collectMachineHome(this._rt.fs, this._homePath, { required: false, errorPrefix: "journal.commit" })
        : null;
      let homeHead = null;
      let homeWrote = false;
      if (home) {
        let key = null;
        if (home.bin.length) {
          key = await sha256Hex(home.bin);
          if (!knownKeys.has(key) && !(await this._blobs.has(key, lookupCache))) {
            await this._blobs.write(key, home.bin);
            homeWrote = true;
          }
          knownKeys.add(key);
        }
        homeHead = { ...home.meta, key };
      }
      // HEAD는 마지막에 쓴다(append-only 순서 = 크래시가 어디서 나든 이전 HEAD는 무결).
      // 세대 2개: 새 HEAD를 쓰기 전에 현 HEAD를 PREV로 남긴다. HEAD가 손상돼도(파일 파손,
      // 미완 커밋) 직전 세대로 부활한다. createWritable은 close 시 원자 교체라 부분 쓰기는 없다.
      const committedAt = new Date().toISOString();
      const head = {
        version: homeHead ? 3 : 2,
        h0: await this._boundaryKey(),
        pages: map,
        sp: this._reactive.stackSave() ?? this._sp,
        heapLen: mem.byteLength(),
        committedAt,
        ...(homeHead ? { home: homeHead } : {}),
      };
      try {
        const cur = await (await (await this._dir.getFileHandle("HEAD.json")).getFile()).text();
        const pf = await this._dir.getFileHandle("PREV.json", { create: true });
        const pw = await pf.createWritable(); await pw.write(cur); await pw.close();
      } catch (e) { if (e.name !== "NotFoundError") throw e; } // 첫 커밋은 PREV 없음
      const hf = await this._dir.getFileHandle("HEAD.json", { create: true });
      const w = await hf.createWritable(); await w.write(JSON.stringify(head)); await w.close();
      this.commits++; this.pagesWritten += wrote;
      const result = {
        pages: pages.length,
        wrote,
        mb: +(wrote * PAGE / 1048576).toFixed(1),
        committedAt,
        ...(home ? { home: { files: home.meta.entries.filter((entry) => entry.type === "file").length, mb: +(home.bin.length / 1048576).toFixed(1), wrote: homeWrote } } : {}),
      };
      const autoPack = await this._autoPackAfterCommit(result);
      if (autoPack) result.autoPack = autoPack;
      if (this._pruneAfterCommit) result.pruned = r.pruneTo(r.liveIdx);
      return result;
    } finally { this._busy = false; }
  }

  async _autoPackAfterCommit(result) {
    if (!this._autoPack || !result || result.wrote <= 0) return null;
    const stats = await this._blobs.looseStats();
    if (stats.count < this._autoPack.looseBlobs && stats.bytes < this._autoPack.looseBytes) return null;
    const packed = await this._packNow();
    packed.trigger = { looseBlobs: stats.count, looseMB: stats.mb };
    return packed;
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

  _liveKeys(heads) {
    const keys = new Set();
    for (const head of heads) {
      for (const key of Object.values(head.pages || {})) keys.add(key);
      if (head.home && head.home.key) keys.add(head.home.key);
    }
    return keys;
  }

  // 현재 HEAD/PREV가 참조하는 live blob만 새 pack 파일 1개에 묶는다. recover는 loose와 pack을
  // 모두 읽으므로 기존 저널과 호환된다. PACKS.json은 pack 데이터 파일을 쓴 뒤 마지막에 교체한다.
  async pack() {
    if (this._busy) return null;
    this._busy = true;
    try {
      return await this._packNow();
    } finally { this._busy = false; }
  }

  // 무엇이 live인가는 세대를 아는 저널이 정하고, 어떻게 묶는가는 blob store가 안다.
  async _packNow() {
    const heads = await this._readLiveHeads();
    const liveKeys = [...this._liveKeys(heads)].filter((key) => BLOB_KEY.test(key)).sort();
    const result = await this._blobs.packLive(liveKeys);
    if (result.bytes) { this.packs++; this.packBytes += result.bytes; }
    return result;
  }

  // HEAD/PREV가 더 이상 참조하지 않는 loose blob과 PACKS.json에 없는 stale pack 파일을 지운다.
  // pack을 새로 만들지는 않으므로, 긴 실행 중간의 가벼운 청소에 쓴다.
  async prune() {
    const heads = await this._readLiveHeads();
    const liveKeys = this._liveKeys(heads);
    const looseRemoved = await this._blobs.removeLooseBlobs((key) => !liveKeys.has(key));
    const index = await this._blobs.readPackIndex();
    const indexedPacks = new Set(index.packs.map((pack) => pack.file));
    const packsRemoved = await this._blobs.removePackFilesExcept(indexedPacks);
    return { liveKeys: liveKeys.size, looseRemoved, packsRemoved };
  }

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

  // 세대 1개를 힙에 적용한다. blob은 내용 주소(파일명 = SHA-256)와 실제 바이트를 재대조해
  // 저장 후 파손을 잡는다. h0 불일치는 손상이 아니라 환경 불일치라 즉시 던진다.
  // heapLen이 현재 커널보다 크면 Session.load와 같은 원리로 파이썬 할당 경로를 태워 성장시킨다.
  // JS에서 Memory.grow를 직접 부르면 Emscripten 글루의 클로저 뷰가 안 갱신되어 런타임이 깨진다.
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

  // 저널 재생: HEAD 세대로 부활하고, HEAD가 파손이면 PREV 세대로 후퇴한다(잃는 것은 마지막
  // 커밋 하나). 둘 다 없으면 null(첫 부팅), 둘 다 파손이면 명시적 예외.
  // 힙 크기/경계 지문 불일치는 손상이 아니므로 후퇴 없이 즉시 예외(다른 엔진/매니페스트).
  async recover() {
    const cur = await this._readGeneration("HEAD.json");
    if (cur.head) {
      try { return await this._applyGeneration(cur.head); }
      catch (e) {
        if (!e || e.code !== "PYPROC_JOURNAL_CORRUPT") throw e; // 환경 불일치는 후퇴 대상이 아니다
        cur.corrupt = e.message;
      }
    }
    const prev = await this._readGeneration("PREV.json");
    if (prev.head) {
      const r = await this._applyGeneration(prev.head);
      r.fallback = true; // 직전 세대로 부활했음을 알린다(마지막 커밋 1개 유실)
      return r;
    }
    if (cur.missing && prev.missing) return null; // 저널 없음 = 첫 부팅
    throw journalCorrupt(`journal.recover: 저널 파손(${cur.corrupt || "HEAD 없음"} / ${prev.corrupt || "PREV 없음"}). 첫 부팅으로 위장하지 않는다.`);
  }
}
