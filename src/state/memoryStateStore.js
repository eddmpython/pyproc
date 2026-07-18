// memoryStateStore.js - Layer 1(state): store 계약의 인메모리 구현.
// 프로토콜 게이트(tests/run.mjs [state 커널] 음성 시험)와 임베더 테스트가 쓴다.
// 계약 문면은 refProtocol.js 상단이 정본이다.
import { PyProcError } from "../runtime/errors.js";

export class MemoryStateStore {
  constructor() {
    this._objects = new Map(); // address -> Uint8Array
    this._refs = new Map();    // name -> { commit }
    this._corruptRefs = new Map(); // name -> 사유 (테스트가 파손을 주입하는 채널)
    this._owner = null;
  }
  async hasObject(address) { return this._objects.has(address); }
  async writeObject(address, bytes) { this._objects.set(address, new Uint8Array(bytes)); }
  async readObject(address) {
    const bytes = this._objects.get(address);
    return bytes ? new Uint8Array(bytes) : null;
  }
  async readRef(name) {
    if (this._corruptRefs.has(name)) return { corrupt: this._corruptRefs.get(name) };
    const ref = this._refs.get(name);
    return ref ? { ref: { ...ref } } : { missing: true };
  }
  async writeRef(name, ref) {
    if (typeof ref?.commit !== "string") throw new PyProcError("PYPROC_INPUT_INVALID", "memoryStateStore: ref.commit이 필요하다");
    this._corruptRefs.delete(name);
    this._refs.set(name, { commit: ref.commit });
  }
  async readOwner() { return this._owner ? { ...this._owner } : null; }
  // fence 시험용 소유권: claim이 epoch를 올린다(실제 멀티탭 fence는 Web Locks 조율자가 발급).
  async claimOwner(ownerId) {
    this._owner = { ownerId: String(ownerId), epoch: (this._owner?.epoch || 0) + 1 };
    return { ...this._owner };
  }
  // 시험 전용 파손/삭제 주입 채널(첫 부팅 위장 금지 판정을 굽는 데 쓴다).
  corruptRef(name, reason = "주입된 파손") { this._refs.delete(name); this._corruptRefs.set(name, reason); }
  deleteRef(name) { this._refs.delete(name); this._corruptRefs.delete(name); }
  tamperObject(address, bytes) { this._objects.set(address, new Uint8Array(bytes)); }
  objectCount() { return this._objects.size; }
  // 삽입 순서의 [address, bytes] 목록. bundle 인코딩(배치 순서 = 삽입 순서)이 소비한다.
  entries() { return [...this._objects.entries()]; }
}
