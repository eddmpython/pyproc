// journalBlobStore.js - Layer 1: 저널의 내용 주소 blob 저장소(loose + pack).
//
// 저장 형식: blob/<sha256> loose CAS. pack() 후에는 PACKS.json + pack/*.bin도 같은 CAS로 읽는다
// (loose와 pack 모두 recover 호환). 키가 곧 내용의 SHA-256이라 같은 페이지는 몇 번 커밋해도
// 한 번만 쓰인다(dedupe).
//
// 왜 machineJournal에서 나왔나: 저널은 "언제 커밋하는가"(유휴 정책)와 "무엇이 살아있는가"
// (세대/복원)를 결정하고, 여기는 "바이트를 어디에 어떻게 두는가"만 안다. 한 파일에 있으면
// 커밋 주기 정책을 고치는 사람과 pack 포맷을 고치는 사람이 같은 파일을 만진다.
// 이 저장소는 힙도 런타임도 모른다: 디렉터리 핸들 하나가 전부다.
import { PyProcError } from "../runtime/errors.js";
import { verifySha256 } from "../runtime/contentDigest.js";

const BLOB_DIR = "blob";
const PACK_DIR = "pack";
const PACK_INDEX = "PACKS.json";
export const BLOB_KEY = /^[0-9a-f]{64}$/;

function journalCorrupt(message) {
  return new PyProcError("PYPROC_JOURNAL_CORRUPT", message);
}

function notFound(e) {
  return e && e.name === "NotFoundError";
}

function newPackFileName() {
  const r = new Uint32Array(2);
  crypto.getRandomValues(r);
  return `pack-${Date.now().toString(36)}-${r[0].toString(36)}${r[1].toString(36)}.bin`;
}

export class JournalBlobStore {
  constructor(dir) { this._dir = dir; }

  // 읽기 cache는 호출자가 들고 있는 빈 객체다: 한 번의 커밋/복원 안에서 PACKS.json과 pack
  // 파일 핸들을 재사용해 OPFS 왕복을 줄인다(경계를 넘어 살아남으면 안 되므로 필드가 아니다).
  async has(key, cache = {}) {
    let blobDir;
    try { blobDir = await this._dir.getDirectoryHandle(BLOB_DIR); }
    catch (e) {
      if (!notFound(e)) throw e;
    }
    if (blobDir) {
      try {
        await blobDir.getFileHandle(key);
        return true;
      } catch (e) {
        if (!notFound(e)) throw e;
      }
    }
    if (!cache.packIndex) cache.packIndex = await this.readPackIndex();
    return cache.packIndex.packs.some((pack) => pack.blobs && pack.blobs[key]);
  }

  async write(key, bytes) {
    const blobDir = await this._dir.getDirectoryHandle(BLOB_DIR, { create: true });
    const fh = await blobDir.getFileHandle(key, { create: true });
    const w = await fh.createWritable();
    await w.write(bytes);
    await w.close();
  }

  async readLoose(key) {
    let blobDir;
    try { blobDir = await this._dir.getDirectoryHandle(BLOB_DIR); }
    catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
    try {
      return new Uint8Array(await (await (await blobDir.getFileHandle(key)).getFile()).arrayBuffer());
    } catch (e) {
      if (notFound(e)) return null;
      throw e;
    }
  }

  async readPacked(key, cache = {}) {
    if (!cache.packIndex) cache.packIndex = await this.readPackIndex();
    const index = cache.packIndex;
    if (!index.packs.length) return null;
    if (!cache.packDir) {
      try { cache.packDir = await this._dir.getDirectoryHandle(PACK_DIR); }
      catch (e) {
        if (notFound(e)) return null;
        throw e;
      }
    }
    if (!cache.packFiles) cache.packFiles = new Map();
    for (let i = index.packs.length - 1; i >= 0; i--) {
      const pack = index.packs[i];
      const entry = pack.blobs && pack.blobs[key];
      if (!entry) continue;
      let file = cache.packFiles.get(pack.file);
      if (!file) {
        file = await (await cache.packDir.getFileHandle(pack.file)).getFile();
        cache.packFiles.set(pack.file, file);
      }
      const offset = Number(entry.offset);
      const length = Number(entry.length);
      if (!Number.isFinite(offset) || !Number.isFinite(length) || offset < 0 || length <= 0) {
        throw journalCorrupt(`journal.pack: pack index entry 파손(${key.slice(0, 12)}..)`);
      }
      return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    }
    return null;
  }

  async read(key, cache = {}) {
    const loose = await this.readLoose(key);
    if (loose) return loose;
    const packed = await this.readPacked(key, cache);
    if (packed) return packed;
    throw journalCorrupt(`journal.recover: blob 없음(${key.slice(0, 12)}..)`);
  }

  async looseStats() {
    let blobDir;
    try { blobDir = await this._dir.getDirectoryHandle(BLOB_DIR); }
    catch (e) {
      if (notFound(e)) return { count: 0, bytes: 0, mb: 0 };
      throw e;
    }
    let count = 0;
    let bytes = 0;
    for await (const name of blobDir.keys()) {
      if (!BLOB_KEY.test(name)) continue;
      count++;
      bytes += (await (await blobDir.getFileHandle(name)).getFile()).size;
    }
    return { count, bytes, mb: +(bytes / 1048576).toFixed(1) };
  }

  async readPackIndex() {
    let text;
    try { text = await (await (await this._dir.getFileHandle(PACK_INDEX)).getFile()).text(); }
    catch (e) {
      if (notFound(e)) return { version: 1, packs: [] };
      throw e;
    }
    const index = JSON.parse(text);
    if (index.version !== 1 || !Array.isArray(index.packs)) {
      throw journalCorrupt("journal.pack: PACKS.json 형식이 맞지 않는다");
    }
    return index;
  }

  async writePackIndex(index) {
    const fh = await this._dir.getFileHandle(PACK_INDEX, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(index));
    await w.close();
  }

  async removeLooseBlobs(predicate) {
    let removed = 0;
    let blobDir;
    try { blobDir = await this._dir.getDirectoryHandle(BLOB_DIR); }
    catch (e) {
      if (notFound(e)) return removed;
      throw e;
    }
    for await (const name of blobDir.keys()) {
      if (!BLOB_KEY.test(name) || !predicate(name)) continue;
      await blobDir.removeEntry(name);
      removed++;
    }
    return removed;
  }

  async removePackFilesExcept(kept) {
    let removed = 0;
    let packDir;
    try { packDir = await this._dir.getDirectoryHandle(PACK_DIR); }
    catch (e) {
      if (notFound(e)) return removed;
      throw e;
    }
    for await (const name of packDir.keys()) {
      if (kept.has(name)) continue;
      await packDir.removeEntry(name);
      removed++;
    }
    return removed;
  }

  // live blob만 새 pack 파일 1개로 묶는다. 어느 키가 live인지는 세대를 아는 저널이 정한다.
  // 순서가 계약이다: pack 데이터 파일을 먼저 쓰고, PACKS.json을 마지막에 교체하고, 그 다음에
  // loose를 지운다. 중간에 죽어도 이전 상태로 읽히게 하기 위함이다.
  async packLive(liveKeys) {
    if (!liveKeys.length) {
      const looseRemoved = await this.removeLooseBlobs(() => true);
      const packsRemoved = await this.removePackFilesExcept(new Set());
      await this.writePackIndex({ version: 1, packs: [] });
      return { liveKeys: 0, packed: 0, bytes: 0, mb: 0, looseRemoved, packsRemoved };
    }
    const packDir = await this._dir.getDirectoryHandle(PACK_DIR, { create: true });
    const file = newPackFileName();
    const fh = await packDir.getFileHandle(file, { create: true });
    const w = await fh.createWritable();
    const blobs = {};
    let offset = 0;
    const readCache = {};
    try {
      for (const key of liveKeys) {
        const bytes = await this.read(key, readCache);
        // 내용 주소를 재대조한다: 저장 후 파손을 pack이 그대로 옮기면 안 된다.
        if (!(await verifySha256(bytes, key)).ok) throw journalCorrupt(`journal.pack: blob 파손(${key.slice(0, 12)}..)`);
        await w.write(bytes);
        blobs[key] = { offset, length: bytes.byteLength };
        offset += bytes.byteLength;
      }
      await w.close();
    } catch (e) {
      if (w.abort) await w.abort().catch(() => {});
      throw e;
    }
    await this.writePackIndex({
      version: 1,
      packs: [{ file, createdAt: new Date().toISOString(), bytes: offset, blobs }],
    });
    const looseRemoved = await this.removeLooseBlobs(() => true);
    const packsRemoved = await this.removePackFilesExcept(new Set([file]));
    return {
      liveKeys: liveKeys.length,
      packed: liveKeys.length,
      bytes: offset,
      mb: +(offset / 1048576).toFixed(1),
      looseRemoved,
      packsRemoved,
    };
  }
}
