// stateKernelDraft.js - stateKernel 캠페인의 커널 시안(승격 전 프로토타입, attempts 전용).
// 내구 구역 오브젝트 모델(blob/tree/commit) + fence 선택형 ref CAS의 초안이다.
// 순수 규율을 시안부터 지킨다: 브라우저 전역 접근 없이 cryptoProvider/store 주입으로만 동작.
// 오류는 시안이라 Error + kind 필드다(승격 시 PyProcError 코드 카탈로그로 간다):
//   kind = "corrupt"(digest/형식 불일치, PREV 후퇴 가능) | "envMismatch"(h0 불일치, 후퇴 금지)
//        | "staleFence"(소유권 전제조건 위반) | "input"(인자 계약)

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const ADDRESS_RE = /^sha256:[0-9a-f]{64}$/;
const HEX_RE = /^[0-9a-f]{64}$/;

function draftError(kind, message) {
  const e = new Error(message);
  e.kind = kind;
  return e;
}

// 주소 = "sha256:<hex>" 하나. 알고리즘 자기 기술형이 공개 파일 포맷의 장기 계약에 강하다.
export async function addressOf(cryptoProvider, bytes) {
  if (!cryptoProvider?.subtle) throw draftError("input", "addressOf: cryptoProvider.subtle이 필요하다");
  const digest = new Uint8Array(await cryptoProvider.subtle.digest("SHA-256", bytes));
  return "sha256:" + [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// canonical JSON: 키 정렬 + finite 수만. 같은 값이면 어디서 인코딩해도 같은 주소가 나온다.
export function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw draftError("input", "canonicalJson: finite 수만 담는다");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  throw draftError("input", `canonicalJson: 미지원 타입(${typeof value})`);
}

export function encodeObject(value) { return textEncoder.encode(canonicalJson(value)); }
export function decodeObject(bytes) { return JSON.parse(textDecoder.decode(bytes)); }

// tree: 타입 있는 엔트리. pageTable은 힙 커밋 전용, payload는 machine generation 같은 불투명 바이트.
export function pageTableTree({ pageSize, heapLen, sp, pages }) {
  if (!Array.isArray(pages)) throw draftError("input", "pageTableTree: pages 배열이 필요하다");
  for (const [p, addr] of pages) {
    if (!Number.isInteger(p) || p < 0) throw draftError("input", `pageTableTree: 페이지 번호 위반(${p})`);
    if (!ADDRESS_RE.test(addr)) throw draftError("input", `pageTableTree: 주소 형식 위반(${addr})`);
  }
  return { kind: "pageTable", pageSize, heapLen, sp, pages };
}

export function payloadTree({ entries }) {
  if (!Array.isArray(entries)) throw draftError("input", "payloadTree: entries 배열이 필요하다");
  for (const e of entries) {
    if (typeof e.id !== "string" || !e.id) throw draftError("input", "payloadTree: entry.id 위반");
    if (!ADDRESS_RE.test(e.address)) throw draftError("input", `payloadTree: 주소 형식 위반(${e.address})`);
    if (!Number.isInteger(e.byteLength) || e.byteLength < 0) throw draftError("input", "payloadTree: byteLength 위반");
  }
  return { kind: "payload", entries };
}

// OPFS store 드라이버 시안. 주소는 "sha256:<hex>"이고 파일명 인코딩(objects/<hex>)은 드라이버 세부다.
export class OpfsDraftStore {
  constructor(dir) {
    if (!dir) throw draftError("input", "OpfsDraftStore: FileSystemDirectoryHandle이 필요하다");
    this._dir = dir;
  }
  _fileName(address) {
    if (!ADDRESS_RE.test(address)) throw draftError("input", `store: 주소 형식 위반(${address})`);
    return address.slice("sha256:".length);
  }
  async _objects(create) { return this._dir.getDirectoryHandle("objects", { create }); }
  async hasObject(address) {
    try { await (await this._objects(false)).getFileHandle(this._fileName(address)); return true; }
    catch (e) { if (e.name === "NotFoundError") return false; throw e; }
  }
  async writeObject(address, bytes) {
    const dir = await this._objects(true);
    const fh = await dir.getFileHandle(this._fileName(address), { create: true });
    const w = await fh.createWritable(); await w.write(bytes); await w.close();
  }
  async readObject(address) {
    let dir;
    try { dir = await this._objects(false); }
    catch (e) { if (e.name === "NotFoundError") throw draftError("corrupt", `store: objects 없음(${address})`); throw e; }
    try { return new Uint8Array(await (await (await dir.getFileHandle(this._fileName(address))).getFile()).arrayBuffer()); }
    catch (e) { if (e.name === "NotFoundError") throw draftError("corrupt", `store: 오브젝트 없음(${address})`); throw e; }
  }
  async countObjects() {
    let dir;
    try { dir = await this._objects(false); } catch (e) { if (e.name === "NotFoundError") return 0; throw e; }
    let n = 0;
    for await (const name of dir.keys()) if (HEX_RE.test(name)) n++;
    return n;
  }
  // ref 판독 3상: { ref } | { missing } | { corrupt }. 손상을 첫 부팅으로 위장하지 않는다.
  async readRef(name) {
    let text;
    try { text = await (await (await this._dir.getFileHandle(name + ".json")).getFile()).text(); }
    catch (e) { if (e.name === "NotFoundError") return { missing: true }; return { corrupt: `${name} 읽기 실패(${e.name})` }; }
    try {
      const ref = JSON.parse(text);
      if (!ADDRESS_RE.test(ref.commit)) return { corrupt: `${name} 주소 형식 위반` };
      return { ref };
    } catch (e) { return { corrupt: `${name} JSON 파손` }; }
  }
  async writeRef(name, ref) {
    const fh = await this._dir.getFileHandle(name + ".json", { create: true });
    const w = await fh.createWritable(); await w.write(JSON.stringify(ref)); await w.close();
  }
  async deleteRef(name) {
    try { await this._dir.removeEntry(name + ".json"); } catch (e) { if (e.name !== "NotFoundError") throw e; }
  }
  // 소유권 시안: owner.json 한 레코드. claim이 epoch를 올린다(멀티탭 fence의 최소형).
  async readOwner() {
    try { return JSON.parse(await (await (await this._dir.getFileHandle("owner.json")).getFile()).text()); }
    catch (e) { if (e.name === "NotFoundError") return null; throw e; }
  }
  async claimOwner(ownerId) {
    const cur = await this.readOwner();
    const token = { ownerId, epoch: (cur?.epoch || 0) + 1 };
    const fh = await this._dir.getFileHandle("owner.json", { create: true });
    const w = await fh.createWritable(); await w.write(JSON.stringify(token)); await w.close();
    return token;
  }
}

async function verifiedRead(cryptoProvider, store, address) {
  const bytes = await store.readObject(address);
  if (await addressOf(cryptoProvider, bytes) !== address) {
    throw draftError("corrupt", `verify-on-read: digest 불일치(${address.slice(0, 20)}..)`);
  }
  return bytes;
}

// 커밋 프로토콜. 쓰기 순서 법이 계약이다:
//   (1) page/payload blob -> (2) tree 오브젝트 -> (3) commit 오브젝트 -> (4) PREV 보존 -> (5) HEAD 교체.
// 어느 지점에서 크래시해도 구 HEAD가 가리키는 세대는 완전하다(probe 3이 지점별로 주입 검증).
// fence가 있으면 HEAD 교체 직전에 현 owner와 대조한다(stale 거부).
export async function commitDraft(cryptoProvider, store, input) {
  const { pages = null, payloads = null, heapLen = null, sp = null, pageSize = null, env = {}, fence = null, parents = [] } = input;
  let wrote = 0, deduped = 0;
  const putBlob = async (bytes) => {
    const address = await addressOf(cryptoProvider, bytes);
    if (await store.hasObject(address)) { deduped++; return address; }
    await store.writeObject(address, bytes); wrote++;
    return address;
  };
  // (1) payload 먼저
  let tree;
  if (pages) {
    const table = [];
    for (const [p, bytes] of pages) table.push([p, await putBlob(bytes)]);
    tree = pageTableTree({ pageSize, heapLen, sp, pages: table });
  } else if (payloads) {
    const entries = [];
    for (const { id, bytes } of payloads) entries.push({ id, address: await putBlob(bytes), byteLength: bytes.length });
    tree = payloadTree({ entries });
  } else {
    throw draftError("input", "commitDraft: pages 또는 payloads가 필요하다");
  }
  // (2) tree
  const treeBytes = encodeObject(tree);
  const treeAddress = await addressOf(cryptoProvider, treeBytes);
  if (!(await store.hasObject(treeAddress))) await store.writeObject(treeAddress, treeBytes);
  // (3) commit
  const commit = { parents, tree: treeAddress, env, fence: fence ? { ownerId: fence.ownerId, epoch: fence.epoch } : null };
  const commitBytes = encodeObject(commit);
  const commitAddress = await addressOf(cryptoProvider, commitBytes);
  if (!(await store.hasObject(commitAddress))) await store.writeObject(commitAddress, commitBytes);
  // fence 전제조건: HEAD 교체 직전 대조. stale이면 여기서 끝난다(HEAD 불변).
  if (fence) {
    const owner = await store.readOwner();
    if (!owner || owner.ownerId !== fence.ownerId || owner.epoch !== fence.epoch) {
      throw draftError("staleFence", `commitDraft: stale fence(${fence.ownerId}/${fence.epoch} vs ${owner?.ownerId}/${owner?.epoch})`);
    }
  }
  // (4) PREV 보존 (5) HEAD 교체
  const head = await store.readRef("HEAD");
  if (head.ref) await store.writeRef("PREV", head.ref);
  else if (head.corrupt) throw draftError("corrupt", `commitDraft: HEAD 파손 위에 커밋하지 않는다(${head.corrupt})`);
  await store.writeRef("HEAD", { commit: commitAddress });
  return { commitAddress, treeAddress, wrote, deduped };
}

async function materialize(cryptoProvider, store, ref, expectH0) {
  const commitBytes = await verifiedRead(cryptoProvider, store, ref.commit);
  const commit = decodeObject(commitBytes);
  // env 불일치는 손상이 아니다: PREV 후퇴 없이 즉시 예외(다른 엔진의 세대로 부활 = 조용한 힙 오염).
  if (expectH0 != null && commit.env?.h0 !== expectH0) {
    throw draftError("envMismatch", `openDraft: 리플레이 경계 지문(h0) 불일치(${String(commit.env?.h0).slice(0, 12)}.. != ${String(expectH0).slice(0, 12)}..)`);
  }
  const tree = decodeObject(await verifiedRead(cryptoProvider, store, commit.tree));
  if (tree.kind === "pageTable") {
    const pages = new Map();
    for (const [p, address] of tree.pages) pages.set(p, await verifiedRead(cryptoProvider, store, address));
    return { commit, tree, pages };
  }
  if (tree.kind === "payload") {
    const entries = new Map();
    for (const e of tree.entries) {
      const bytes = await verifiedRead(cryptoProvider, store, e.address);
      if (bytes.length !== e.byteLength) throw draftError("corrupt", `openDraft: payload 길이 불일치(${e.id})`);
      entries.set(e.id, bytes);
    }
    return { commit, tree, entries };
  }
  throw draftError("corrupt", `openDraft: 알 수 없는 tree kind(${tree.kind})`);
}

// 부활 프로토콜: HEAD -> (corruption에 한해) PREV 후퇴 -> 둘 다 없으면 첫 부팅(null),
// 둘 다 파손이면 명시 예외. envMismatch는 후퇴 대상이 아니다(즉시 던짐).
export async function openDraft(cryptoProvider, store, opts = {}) {
  const head = await store.readRef("HEAD");
  let headFailure = head.corrupt || null;
  if (head.ref) {
    try { return { ...await materialize(cryptoProvider, store, head.ref, opts.expectH0), generation: "head" }; }
    catch (e) {
      if (e.kind !== "corrupt") throw e; // envMismatch 등은 후퇴 없이 그대로
      headFailure = e.message;
    }
  }
  const prev = await store.readRef("PREV");
  if (prev.ref) {
    const r = await materialize(cryptoProvider, store, prev.ref, opts.expectH0);
    return { ...r, generation: "prev", fallback: true, headFailure };
  }
  if (head.missing && prev.missing) return null; // 첫 부팅
  throw draftError("corrupt", `openDraft: 세대 파손(HEAD: ${headFailure || "없음"} / PREV: ${prev.corrupt || "없음"}). 첫 부팅으로 위장하지 않는다.`);
}
