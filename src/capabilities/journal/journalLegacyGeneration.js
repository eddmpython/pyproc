// journalLegacyGeneration.js - Layer 2: 구 포맷(루트 HEAD.json v2/v3) 읽기 전용 경로.
//
// 이 포맷의 writer는 이미 없다. 첫 커널 커밋이 성공하면 구 ref를 지우므로, 여기 남은 것은
// "아직 이관되지 않은 저널을 한 번 더 읽어 준다"는 호환 약속뿐이다. 그 약속을 한 파일에 모은
// 이유는 은퇴가 파일 하나 삭제가 되게 하기 위해서다. 은퇴 시점은 계약 실태 표에 적는다.
//
// 상시 경로가 여기 얹혀 있다는 사실을 잊지 말 것: pack/prune의 live 판정은 커널 세대와 구
// 세대의 **합집합**이어야 하고(legacyLiveKeys), 그 갈래가 빠지면 살아 있는 blob이 지워진다.
// 브라우저 게이트의 "journal prune: 이관 전 구 세대 blob을 live로 지킨다"가 그것을 문다.
import { PyProcError } from "../../runtime/errors.js";
import { verifySha256 } from "../../runtime/contentDigest.js";
import { materializeHeapGeneration } from "../image/heapMaterialize.js";
import { validateMachineHomeMeta } from "../image/machineHome.js";
import { readJsonFile } from "./journalJsonFile.js";

// 세대 파일 1개 판독: { head } | { missing: true } | { corrupt: 사유 }.
export async function readLegacyGeneration(dir, name) {
  const read = await readJsonFile(dir, name);
  return "value" in read ? { head: read.value } : read;
}

// 구 ref 청소: 커널 refs가 섰으니 루트의 구 세대 파일은 죽은 무게다. blob/은 공유 CAS라 남긴다
// (live 판정은 pack/prune 몫). best-effort: 삭제 실패는 커밋 성공을 물릴 사유가 아니다.
export async function cleanupLegacyRefs(dir) {
  for (const name of ["HEAD.json", "PREV.json"]) {
    try { await dir.removeEntry(name); } catch (e) { /* 이미 없거나 잠긴 파일: 다음 커밋이 다시 시도한다 */ }
  }
}

// 구 세대 두 개(HEAD/PREV)가 참조하는 blob 키. 이관 전 저널에서 이 키들은 live다.
export async function legacyLiveKeys(dir, keys, onCorrupt) {
  for (const name of ["HEAD.json", "PREV.json"]) {
    const generation = await readLegacyGeneration(dir, name);
    if (generation.corrupt) throw onCorrupt(generation.corrupt);
    if (!generation.head) continue;
    for (const key of Object.values(generation.head.pages || {})) keys.add(key);
    if (generation.head.home && generation.head.home.key) keys.add(generation.head.home.key);
  }
  return keys;
}

// 구 세대 1개를 힙에 적용한다. blob은 내용 주소와 실제 바이트를 재대조해 저장 후 파손을 잡는다.
// h0 불일치는 손상이 아니라 환경 불일치라 즉시 던진다.
export async function applyLegacyGeneration({ head, rt, reactive, blobs, boundaryKey, corrupt }) {
  if (head.h0 && head.h0 !== await boundaryKey()) {
    throw new PyProcError("PYPROC_REPLAY_MISMATCH", "journal.recover: replay-boundary fingerprint (h0) mismatch. This journal belongs to a different engine or manifest; refusing rather than silently corrupting the heap.");
  }
  const buffered = [];
  const blobCache = new Map();
  const readCache = {};
  for (const [p, key] of Object.entries(head.pages)) {
    let bytes = blobCache.get(key);
    if (!bytes) {
      bytes = await blobs.read(key, readCache);
      if (!(await verifySha256(bytes, key)).ok) throw corrupt(`journal.recover: blob is corrupt (${key.slice(0, 12)}..)`);
      blobCache.set(key, bytes);
    }
    buffered.push([+p, bytes]); // 전량 검증 후에 쓴다(부분 적용 상태 방지)
  }
  let homePayload = null;
  if (head.home) {
    const { key, ...meta } = head.home;
    try {
      const bin = key ? await blobs.read(key, readCache) : new Uint8Array(0);
      if (key && !(await verifySha256(bin, key)).ok) throw corrupt(`journal.recover: home blob is corrupt (${key.slice(0, 12)}..)`);
      validateMachineHomeMeta(meta, bin);
      homePayload = { meta, bin };
    } catch (e) {
      if (e && e.code === "PYPROC_JOURNAL_CORRUPT") throw e;
      throw corrupt(`journal.recover: home generation is corrupt (${String(e.message || e).slice(-180)})`);
    }
  }
  // 물질화 순서는 heapMaterialize가 정본이다(검증은 위에서 전량 끝냈다 = 부분 적용 없음).
  const applied = materializeHeapGeneration({
    rt, reactive, label: "journal.recover",
    heapLen: head.heapLen, sp: head.sp, pages: buffered,
    home: homePayload ? { meta: homePayload.meta, payload: homePayload.bin } : null,
    wrapHomeError: (e) => corrupt(`journal.recover: home generation is corrupt (${String(e.message || e).slice(-180)})`, e),
  });
  return {
    pages: applied.pages,
    mb: applied.mb,
    committedAt: head.committedAt || null,
    ...(applied.home ? { home: applied.home } : {}),
  };
}
