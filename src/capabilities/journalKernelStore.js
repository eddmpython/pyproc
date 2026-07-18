// journalKernelStore.js - Layer 2(capabilities): 저널의 상태 커널 store 드라이버.
//
// 바이트는 기존 blob/<hex> CAS(JournalBlobStore, loose + pack)를 그대로 쓴다: 내용주소는
// 포맷 무관이라 구 저널의 blob이 새 세대의 dedupe 대상이 되고, pack 기계(크래시 안전 순서
// 포함)를 재사용한다. ref는 state/ 하위 디렉터리(OpfsStateStore 위임)에 산다: 구 포맷의
// 루트 HEAD.json과 파일이 겹치지 않아 이관에 크래시 창이 없다(어느 시점에 죽어도 커널 refs
// 또는 구 refs 중 하나는 완전하다). 커널 refs가 존재하면 항상 그쪽이 우선이다(오래된 구
// 세대로 조용히 되감기는 것을 차단).
import { PyProcError } from "../runtime/errors.js";
import { parseSha256Address } from "../runtime/contentDigest.js";
import { OpfsStateStore } from "../state/opfsStateStore.js";

const STATE_DIR = "state";

export class JournalKernelStore {
  constructor(dir, blobs) {
    this._dir = dir;
    this._blobs = blobs;
    this._refStore = null;
    this._cache = {}; // JournalBlobStore의 pack index/파일 핸들 캐시. 한 작업 단위로 리셋한다.
  }
  // 커밋/복원/pack 한 번의 경계에서 호출한다(캐시가 경계를 넘어 살아남으면 stale pack index를 본다).
  resetCache() { this._cache = {}; }
  _hex(address) {
    const hex = parseSha256Address(address);
    if (!hex) throw new PyProcError("PYPROC_INPUT_INVALID", `journal store: 주소 형식 위반(${address})`);
    return hex;
  }
  async _refs(create) {
    if (this._refStore) return this._refStore;
    try {
      const stateDir = await this._dir.getDirectoryHandle(STATE_DIR, { create });
      if (create) this._refStore = new OpfsStateStore(stateDir);
      return this._refStore ?? new OpfsStateStore(stateDir);
    } catch (e) {
      if (e.name === "NotFoundError") return null;
      throw e;
    }
  }
  async hasObject(address) { return this._blobs.has(this._hex(address), this._cache); }
  async writeObject(address, bytes) { return this._blobs.write(this._hex(address), bytes); }
  async readObject(address) {
    const hex = this._hex(address);
    const loose = await this._blobs.readLoose(hex);
    if (loose) return loose;
    return this._blobs.readPacked(hex, this._cache); // 없으면 null(판정은 프로토콜 몫)
  }
  async readRef(name) {
    const refs = await this._refs(false);
    if (!refs) return { missing: true };
    return refs.readRef(name);
  }
  async writeRef(name, ref) { return (await this._refs(true)).writeRef(name, ref); }
  // 저널은 단일 컨트롤러 경로다(kernelElection의 Web Locks가 단일성을 구조 보장). fence 없음.
  async readOwner() { return null; }
}
