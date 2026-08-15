// opfsStateStore.js - Layer 1(state): store 계약의 OPFS 드라이버.
// 위치·이름은 소비자가 dir 핸들로 준다(하드코딩 없음). 주소는 sha256 접두 정본 형식이고
// objects/<hex> 파일명은 이 드라이버의 인코딩 세부다(주소가 아니다). 원자성은 backend 책임:
// createWritable은 close 시 원자 교체라 ref 부분 쓰기는 없다(저널 HEAD와 같은 근거).
// 계약 문면은 refProtocol.js 상단이 정본이다.
import { PyProcError } from "../runtime/errors.js";
import { normalizeBrowserStorageWriteError } from "../runtime/browserStorageDurability.js";
import { SHA256_ADDRESS_RE, parseSha256Address } from "../runtime/contentDigest.js";

const OBJECT_DIR = "objects";
const HEX_RE = /^[0-9a-f]{64}$/;

async function writeEntry(directory,name,bytes,context) {
  let existed = true;
  let handle = null;
  let writable = null;
  try {
    try { handle = await directory.getFileHandle(name); }
    catch (error) {
      if (error?.name !== "NotFoundError") throw error;
      existed = false;
      handle = await directory.getFileHandle(name,{create:true});
    }
    writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
  }
  catch (error) {
    if (writable) try { await writable.abort(); } catch (ignored) {}
    if (!existed) try { await directory.removeEntry(name); } catch (ignored) {}
    throw normalizeBrowserStorageWriteError(error,context);
  }
}

export class OpfsStateStore {
  constructor(dir) {
    if (!dir || typeof dir.getFileHandle !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "OpfsStateStore: a FileSystemDirectoryHandle is required");
    }
    this._dir = dir;
    this._objectDir = null;
  }
  _fileName(address) {
    if (!SHA256_ADDRESS_RE.test(address)) throw new PyProcError("PYPROC_INPUT_INVALID", `OpfsStateStore: malformed address (${address})`);
    return parseSha256Address(address); // 파일명 = hex(드라이버 인코딩 세부). 코덱은 코어만 안다
  }
  async _objects(create) {
    if (this._objectDir) return this._objectDir;
    try {
      const dir = await this._dir.getDirectoryHandle(OBJECT_DIR, { create });
      if (create) this._objectDir = dir; // 생성 이후에만 캐시(없음 판정을 캐시하지 않는다)
      return dir;
    } catch (e) {
      if (e.name === "NotFoundError") return null;
      throw e;
    }
  }
  async hasObject(address) {
    const dir = await this._objects(false);
    if (!dir) return false;
    try { await dir.getFileHandle(this._fileName(address)); return true; }
    catch (e) { if (e.name === "NotFoundError") return false; throw e; }
  }
  async writeObject(address, bytes) {
    const dir = await this._objects(true);
    const fileName = this._fileName(address);
    await writeEntry(dir,fileName,bytes,{ operation:"state.writeObject", address, requiredBytes:bytes.byteLength });
  }
  async readObject(address) {
    const dir = await this._objects(false);
    if (!dir) return null;
    try { return new Uint8Array(await (await (await dir.getFileHandle(this._fileName(address))).getFile()).arrayBuffer()); }
    catch (e) { if (e.name === "NotFoundError") return null; throw e; }
  }
  // ref 3상 판독: 파일 없음(첫 부팅)과 파손(손상)을 구분한다. 손상을 첫 부팅으로 위장하면
  // 저널이 있는데도 빈 머신으로 부팅하는 데이터 유실이 된다(machineJournal과 같은 계약).
  async readRef(name) {
    let text;
    try { text = await (await (await this._dir.getFileHandle(name + ".json")).getFile()).text(); }
    catch (e) {
      if (e.name === "NotFoundError") return { missing: true };
      return { corrupt: `${name} 읽기 실패(${e.name})` };
    }
    try {
      const ref = JSON.parse(text);
      if (typeof ref?.commit !== "string" || !SHA256_ADDRESS_RE.test(ref.commit)) return { corrupt: `${name} 주소 형식 위반` };
      return { ref: { commit: ref.commit } };
    } catch (e) {
      return { corrupt: `${name} JSON 파손` };
    }
  }
  async writeRef(name, ref) {
    if (typeof ref?.commit !== "string") throw new PyProcError("PYPROC_INPUT_INVALID", "OpfsStateStore: ref.commit is required");
    const value = JSON.stringify({ commit: ref.commit });
    await writeEntry(this._dir,name + ".json",value,{ operation:"state.writeRef", ref:name,
      requiredBytes:new TextEncoder().encode(value).byteLength });
  }
  // ref 열거: state 디렉터리의 <name>.json 전부(오브젝트 디렉터리는 제외). 가지 목록의 정본은
  // 색인 파일이 아니라 실재하는 ref 파일이다(색인은 두 번째 진실이 되어 표류한다).
  async listRefs() {
    const names = [];
    for await (const name of this._dir.keys()) {
      if (name.endsWith(".json")) names.push(name.slice(0, -".json".length));
    }
    return names.sort();
  }
  async removeRef(name) {
    try { await this._dir.removeEntry(name + ".json"); }
    catch (e) { if (e.name !== "NotFoundError") throw e; }
  }
  // fence 미사용 단일 컨트롤러 store: owner는 없다(kernelElection의 Web Locks가 단일성을 구조
  // 보장하는 저널 경로가 이 드라이버의 첫 소비자다). 멀티탭 fence는 조율자가 owner를 주입하는
  // store(coordinator 위임 단계의 IndexedDB backend)가 소유한다.
  async readOwner() { return null; }
  async countObjects() {
    const dir = await this._objects(false);
    if (!dir) return 0;
    let n = 0;
    for await (const name of dir.keys()) if (HEX_RE.test(name)) n++;
    return n;
  }
}
