// refProtocol.js - Layer 1(state): store 계약 위의 커밋/부활 프로토콜.
//
// store 계약(backend는 전부 주입, 원자성 구현은 backend 책임):
//   hasObject(address) -> boolean
//   writeObject(address, bytes) -> void
//   readObject(address) -> Uint8Array | null   (없으면 null. 판정은 프로토콜이 한다)
//   readRef(name) -> { ref: { commit } } | { missing: true } | { corrupt: 사유 }
//   writeRef(name, ref) -> void               (createWritable close 원자 교체 등 backend 몫)
//   listRefs() -> string[]                    (가지 열거. 정본은 색인이 아니라 실재하는 ref다)
//   removeRef(name) -> void                   (없으면 no-op)
//   readOwner() -> { ownerId, epoch } | null  (fence 미사용 store는 null 고정이면 된다)
//
// 쓰기 순서 법(커널 불변식, refCasProbe 크래시 6지점 실측으로 확정):
//   (1) blob -> (2) tree -> (3) commit -> (4) PREV 보존 -> (5) HEAD 교체.
//   어느 지점에서 크래시해도 구 HEAD가 가리키는 세대는 완전하다.
//
// 이름 있는 ref(가지): 같은 법의 (1)-(3) 뒤 (5')가 그 ref 하나를 교체한다. PREV는 HEAD의
// 크래시 창이지 가지의 것이 아니므로 가지 커밋은 PREV에 손대지 않고, 가지 판독의 파손은
// 후퇴 없이 명시 예외다(물러날 곳이 없다). PREV로의 직접 커밋은 금지다: PREV는 HEAD 교체가
// 보존하는 산출물이지 쓰기 대상이 아니다. 힙 상태는 병합이 성립하지 않으므로 이 프로토콜에
// merge는 없다: 가지는 만들고(compare) 채택한다(adopt = 가지 세대를 물질화해 HEAD로 커밋).
//
// 복구 의미론 2축(1급 의미):
//   corruption(digest/형식 불일치) = PYPROC_STATE_CORRUPT, PREV 후퇴 가능.
//   environment mismatch(h0 불일치) = PYPROC_REPLAY_MISMATCH, 후퇴 금지 즉시 예외
//   (다른 엔진의 세대로 부활하는 조용한 힙 오염을 복구로 위장하지 않는다).
// PREV는 깊이 2 고정이다(reflog 창 일반화는 기각 기록 참조).
import { PyProcError } from "../runtime/errors.js";
import { verifySha256With } from "../runtime/contentDigest.js";
import {
  decodeStateObject,
  encodeStateObject,
  makePageTableTree,
  makePayloadTree,
  makeStateCommit,
  stateAddressOf,
  validateStateCommit,
  validateStateTree,
} from "./objectModel.js";

function corrupt(message) {
  return new PyProcError("PYPROC_STATE_CORRUPT", message);
}

async function putObject(cryptoProvider, store, bytes, counters, bucket, inFlight = null) {
  const address = await stateAddressOf(cryptoProvider, bytes);
  // 같은 주소를 동시에 쓰는 두 호출이 둘 다 hasObject=false를 보면 같은 파일에 겹쳐 쓴다.
  // CAS라 바이트는 같지만 카운터가 부풀고 저장소가 같은 파일을 두 번 연다. 주소별로 합류시킨다.
  if (inFlight) {
    const running = inFlight.get(address);
    if (running) { await running; counters.deduped++; return address; }
  }
  const task = (async () => {
    if (await store.hasObject(address)) { counters.deduped++; return; }
    await store.writeObject(address, bytes);
    counters.wrote++;
    counters[bucket]++;
  })();
  if (inFlight) inFlight.set(address, task);
  await task;
  return address;
}

// 동시에 띄우는 오브젝트 저장 수. 페이지마다 SHA-256과 저장소 왕복을 직렬로 기다리면 지연이
// 오브젝트 수만큼 곱해진다(각 단계는 독립이다: 주소는 내용에서만 나오고 서로 참조하지 않는다).
// 상한이 필요한 이유는 페이지 수천 개에서 파일 핸들이 폭발하기 때문이다. 값의 출처는 실측이
// 아니라 보수적 선택이고, 쓰기 순서 법(blob -> tree -> commit -> PREV -> HEAD)은 단계 사이의
// 순서라 이 병렬화가 건드리지 않는다.
const OBJECT_WRITE_CONCURRENCY = 8;

// ref 이름 법: HEAD는 기본 세대, PREV는 그 크래시 창(직접 쓰기 금지), 나머지는 가지다.
// 가지 이름은 저장 파일명(<name>.json)이 되므로 보수적으로 제한한다.
const REF_NAME_RE = /^[A-Za-z][A-Za-z0-9._-]{0,79}$/;
export function assertRefName(name, { forWrite = false } = {}) {
  const ref = String(name || "");
  if (!REF_NAME_RE.test(ref)) {
    throw new PyProcError("PYPROC_INPUT_INVALID", `state: malformed ref name (${ref}). Use letters, digits, dot, dash, underscore; start with a letter; at most 80 chars.`);
  }
  if (forWrite && ref === "PREV") {
    throw new PyProcError("PYPROC_INPUT_INVALID", "state: PREV is written only by HEAD replacement (the crash fallback), never directly.");
  }
  return ref;
}

// bounded concurrency map: 입력 순서를 유지한 결과 배열을 돌려준다.
async function mapBounded(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

// 커밋: input은 { pages, pageSize, heapLen, sp } 또는 { payloads }, 공통으로
// { env, fence, parents, createdAt, ref }. fence가 있으면 ref 교체 직전에 현 owner와 대조한다
// (stale이면 PYPROC_STATE_FENCE_STALE, ref 불변). ref 기본은 HEAD이고, 가지 이름이면 위
// 가지 법을 따른다(PREV 불변, 후퇴 없음).
export async function commitState(cryptoProvider, store, input = {}) {
  const { pages = null, payloads = null, files = [], env = {}, fence = null, parents = [], createdAt = null } = input;
  const refName = assertRefName(input.ref ?? "HEAD", { forWrite: true });
  const counters = { wrote: 0, deduped: 0, reused: 0, pagesWrote: 0, filesWrote: 0, metaWrote: 0 };
  // (1) payload 먼저
  let tree;
  let pageTable = null;
  if (pages) {
    const table = [];
    // 페이지 바이트는 lazy로 받는다: `[page, bytes]`도 `[page, () => bytes]`도 같다. 후자면
    // 호출자가 페이지 하나를 만들고 여기서 쓰고 놓으므로, 커밋 중 JS 상주가 델타 전량이 아니라
    // 페이지 하나로 내려간다(200MB 델타 커밋이 async 루프 내내 힙에 살아 있던 자리다).
    const pageList = [...pages];
    const inFlight = new Map();
    const addresses = await mapBounded(pageList, OBJECT_WRITE_CONCURRENCY, async ([p, source]) => {
      // 호출자가 "이 페이지는 이미 이 주소에 저장돼 있다"를 단언할 수 있다. 그 단언이 틀리면
      // tree가 없는 오브젝트를 가리키므로, 단언은 같은 저장소에 대한 직전 커밋의 성공과
      // 페이지 해시 불변을 함께 확인한 쪽만 할 수 있다(저널의 주소 캐시가 그 조건이다).
      if (source && typeof source === "object" && typeof source.address === "string") {
        counters.reused++;
        return source.address;
      }
      const bytes = typeof source === "function" ? source() : source;
      return putObject(cryptoProvider, store, bytes, counters, "pagesWrote", inFlight);
    });
    for (const [index, [p]] of pageList.entries()) table.push([p, addresses[index]]);
    const fileEntries = [];
    for (const { id, bytes, meta = null } of files) {
      fileEntries.push({ id, address: await putObject(cryptoProvider, store, bytes, counters, "filesWrote"), byteLength: bytes.length, meta });
    }
    pageTable = table;
    tree = makePageTableTree({ pageSize: input.pageSize, heapLen: input.heapLen, sp: input.sp ?? null, pages: table, files: fileEntries });
  } else if (payloads) {
    const entries = [];
    for (const { id, bytes } of payloads) {
      entries.push({ id, address: await putObject(cryptoProvider, store, bytes, counters, "filesWrote"), byteLength: bytes.length });
    }
    tree = makePayloadTree({ entries });
  } else {
    throw new PyProcError("PYPROC_INPUT_INVALID", "commitState: pages or payloads are required");
  }
  // (2) tree (3) commit
  const treeBytes = encodeStateObject(tree);
  const treeAddress = await putObject(cryptoProvider, store, treeBytes, counters, "metaWrote");
  const commit = makeStateCommit({ parents, tree: treeAddress, env, fence, createdAt });
  const commitBytes = encodeStateObject(commit);
  const commitAddress = await putObject(cryptoProvider, store, commitBytes, counters, "metaWrote");
  // fence 전제조건: HEAD 교체 직전 대조. stale이면 여기서 끝난다(HEAD 불변).
  if (fence) {
    const owner = await store.readOwner();
    if (!owner || owner.ownerId !== fence.ownerId || owner.epoch !== fence.epoch) {
      throw new PyProcError("PYPROC_STATE_FENCE_STALE",
        `commitState: stale fence(${fence.ownerId}/${fence.epoch} vs ${owner?.ownerId ?? "none"}/${owner?.epoch ?? 0})`,
        { context: { fence, owner } });
    }
  }
  // (4) PREV 보존 (5) HEAD 교체 - 또는 가지면 (5') 그 ref 하나만 교체(PREV는 HEAD의 창).
  if (refName === "HEAD") {
    const head = await store.readRef("HEAD");
    if (head.corrupt) throw corrupt(`commitState: HEAD 파손 위에 커밋하지 않는다(${head.corrupt})`);
    if (head.ref) await store.writeRef("PREV", head.ref);
    await store.writeRef("HEAD", { commit: commitAddress });
  } else {
    const existing = await store.readRef(refName);
    if (existing.corrupt) throw corrupt(`commitState: 파손된 ref 위에 커밋하지 않는다(${refName}: ${existing.corrupt})`);
    await store.writeRef(refName, { commit: commitAddress });
  }
  return {
    commitAddress, treeAddress,
    // 커밋된 page -> address. 호출자가 다음 커밋에서 주소를 단언하려면 이것이 필요하다.
    pageTable,
    wrote: counters.wrote, deduped: counters.deduped, reused: counters.reused,
    pagesWrote: counters.pagesWrote, filesWrote: counters.filesWrote, metaWrote: counters.metaWrote,
  };
}

async function verifiedRead(cryptoProvider, store, address) {
  const bytes = await store.readObject(address);
  if (bytes === null) throw corrupt(`state: 오브젝트 없음(${address.slice(0, 20)}..)`);
  const verdict = await verifySha256With(cryptoProvider, bytes, address);
  if (!verdict.ok) throw corrupt(`state: verify-on-read 불일치(${address.slice(0, 20)}..)`);
  return bytes;
}

async function materialize(cryptoProvider, store, ref, expectH0) {
  const commit = validateStateCommit(decodeStateObject(await verifiedRead(cryptoProvider, store, ref.commit)));
  // env 불일치는 손상이 아니다: PREV 후퇴 없이 즉시 예외.
  if (expectH0 != null && commit.env.h0 !== expectH0) {
    throw new PyProcError("PYPROC_REPLAY_MISMATCH",
      `openState: replay-boundary fingerprint (h0) mismatch (${String(commit.env.h0).slice(0, 16)}.. != ${String(expectH0).slice(0, 16)}..). This generation belongs to a different engine or manifest.`);
  }
  const tree = validateStateTree(decodeStateObject(await verifiedRead(cryptoProvider, store, commit.tree)));
  if (tree.kind === "pageTable") {
    const pages = new Map();
    for (const [p, address] of tree.pages) pages.set(p, await verifiedRead(cryptoProvider, store, address));
    const files = new Map();
    for (const e of tree.files || []) {
      const bytes = await verifiedRead(cryptoProvider, store, e.address);
      if (bytes.length !== e.byteLength) throw corrupt(`state: file 길이 불일치(${e.id})`);
      files.set(e.id, { bytes, meta: e.meta ?? null });
    }
    return { commit, commitAddress: ref.commit, tree, pages, files };
  }
  const entries = new Map();
  for (const e of tree.entries) {
    const bytes = await verifiedRead(cryptoProvider, store, e.address);
    if (bytes.length !== e.byteLength) throw corrupt(`state: payload 길이 불일치(${e.id})`);
    entries.set(e.id, bytes);
  }
  return { commit, commitAddress: ref.commit, tree, entries };
}

// 부활: HEAD -> (corruption에 한해) PREV 후퇴 -> 둘 다 없으면 첫 부팅(null),
// 둘 다 파손이면 명시 예외(손상을 첫 부팅으로 위장하지 않는다).
// opts.ref가 가지 이름이면 그 ref 하나만 판독한다: 없으면 null, 파손이면 즉시 예외
// (가지에는 PREV가 없으므로 물러날 곳이 없고, 위장은 데이터 유실이다).
export async function openState(cryptoProvider, store, opts = {}) {
  if (opts.ref !== undefined && opts.ref !== "HEAD") {
    const refName = assertRefName(opts.ref);
    const branch = await store.readRef(refName);
    if (branch.corrupt) throw corrupt(`openState: 가지 파손(${refName}: ${branch.corrupt}). 첫 부팅으로 위장하지 않는다.`);
    if (branch.missing || !branch.ref) return null;
    return { ...await materialize(cryptoProvider, store, branch.ref, opts.expectH0), generation: refName };
  }
  const head = await store.readRef("HEAD");
  let headFailure = head.corrupt || null;
  if (head.ref) {
    try { return { ...await materialize(cryptoProvider, store, head.ref, opts.expectH0), generation: "head" }; }
    catch (e) {
      if (!(e instanceof PyProcError) || e.code !== "PYPROC_STATE_CORRUPT") throw e; // mismatch 등은 후퇴 없이 그대로
      headFailure = e.message;
    }
  }
  const prev = await store.readRef("PREV");
  if (prev.ref) {
    const r = await materialize(cryptoProvider, store, prev.ref, opts.expectH0);
    return { ...r, generation: "prev", fallback: true, headFailure };
  }
  if (head.missing && prev.missing) return null; // 첫 부팅
  throw corrupt(`openState: 세대 파손(HEAD: ${headFailure || "없음"} / PREV: ${prev.corrupt || "없음"}). 첫 부팅으로 위장하지 않는다.`);
}
