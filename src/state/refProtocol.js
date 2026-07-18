// refProtocol.js - Layer 1(state): store 계약 위의 커밋/부활 프로토콜.
//
// store 계약(backend는 전부 주입, 원자성 구현은 backend 책임):
//   hasObject(address) -> boolean
//   writeObject(address, bytes) -> void
//   readObject(address) -> Uint8Array | null   (없으면 null. 판정은 프로토콜이 한다)
//   readRef(name) -> { ref: { commit } } | { missing: true } | { corrupt: 사유 }
//   writeRef(name, ref) -> void               (createWritable close 원자 교체 등 backend 몫)
//   readOwner() -> { ownerId, epoch } | null  (fence 미사용 store는 null 고정이면 된다)
//
// 쓰기 순서 법(커널 불변식, refCasProbe 크래시 6지점 실측으로 확정):
//   (1) blob -> (2) tree -> (3) commit -> (4) PREV 보존 -> (5) HEAD 교체.
//   어느 지점에서 크래시해도 구 HEAD가 가리키는 세대는 완전하다.
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

async function putObject(cryptoProvider, store, bytes, counters, bucket) {
  const address = await stateAddressOf(cryptoProvider, bytes);
  if (await store.hasObject(address)) { counters.deduped++; return address; }
  await store.writeObject(address, bytes);
  counters.wrote++;
  counters[bucket]++;
  return address;
}

// 커밋: input은 { pages, pageSize, heapLen, sp } 또는 { payloads }, 공통으로
// { env, fence, parents, createdAt }. fence가 있으면 HEAD 교체 직전에 현 owner와 대조한다
// (stale이면 PYPROC_STATE_FENCE_STALE, HEAD 불변).
export async function commitState(cryptoProvider, store, input = {}) {
  const { pages = null, payloads = null, files = [], env = {}, fence = null, parents = [], createdAt = null } = input;
  const counters = { wrote: 0, deduped: 0, pagesWrote: 0, filesWrote: 0, metaWrote: 0 };
  // (1) payload 먼저
  let tree;
  if (pages) {
    const table = [];
    for (const [p, bytes] of pages) table.push([p, await putObject(cryptoProvider, store, bytes, counters, "pagesWrote")]);
    const fileEntries = [];
    for (const { id, bytes, meta = null } of files) {
      fileEntries.push({ id, address: await putObject(cryptoProvider, store, bytes, counters, "filesWrote"), byteLength: bytes.length, meta });
    }
    tree = makePageTableTree({ pageSize: input.pageSize, heapLen: input.heapLen, sp: input.sp ?? null, pages: table, files: fileEntries });
  } else if (payloads) {
    const entries = [];
    for (const { id, bytes } of payloads) {
      entries.push({ id, address: await putObject(cryptoProvider, store, bytes, counters, "filesWrote"), byteLength: bytes.length });
    }
    tree = makePayloadTree({ entries });
  } else {
    throw new PyProcError("PYPROC_INPUT_INVALID", "commitState: pages 또는 payloads가 필요하다");
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
  // (4) PREV 보존 (5) HEAD 교체
  const head = await store.readRef("HEAD");
  if (head.corrupt) throw corrupt(`commitState: HEAD 파손 위에 커밋하지 않는다(${head.corrupt})`);
  if (head.ref) await store.writeRef("PREV", head.ref);
  await store.writeRef("HEAD", { commit: commitAddress });
  return {
    commitAddress, treeAddress,
    wrote: counters.wrote, deduped: counters.deduped,
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
      `openState: 리플레이 경계 지문(h0) 불일치(${String(commit.env.h0).slice(0, 16)}.. != ${String(expectH0).slice(0, 16)}..). 다른 엔진/매니페스트의 세대다.`);
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
export async function openState(cryptoProvider, store, opts = {}) {
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
