// generationRetention.js - 모든 group의 HEAD/PREV를 root로 하는 generation과 blob reachability 계산.
import { WebMachineError } from "../contracts/webMachineError.js";

// 이 파일이 곧 machine측 gc다: "ref(전 그룹 HEAD/PREV) 도달 가능성 = liveness"라는 단일
// 법으로 세대·blob의 삭제 집합을 계산한다. 저널측 gc(machineJournal의 live 판정 + blobStore
// packLive의 크래시 안전 순서)와 같은 법의 두 구현이며, backend(IndexedDB vs OPFS)가 다를
// 뿐이다(state-kernel 6단계의 통일 실체).
export function generationStorageKey(groupId, generationId) {
  return `${groupId}\n${generationId}`;
}

// record.blobDigests = 커밋이 도달하는 blob 전수(commit·tree 오브젝트 포함)의 저장소 지역
// 색인이다. 정본은 commit 체인이고 복원은 색인을 신뢰하지 않는다(coordinator가 걷는다) -
// 색인이 거짓이어도 오염 반경은 gc뿐이다. 구 manifest 스키마는 미지원(P2 브레이킹, 원장 기록).
export function generationBlobDigests(record) {
  if (record?.schemaVersion !== 2 || !Array.isArray(record.blobDigests)) {
    throw new WebMachineError("WEB_MACHINE_GENERATION_CORRUPT", `retention: 지원하지 않는 generation record(schemaVersion ${record?.schemaVersion})`);
  }
  const digests = new Set();
  const addressForm = /^sha256:[0-9a-f]{64}$/;
  for (const digest of record.blobDigests) {
    if (typeof digest !== "string" || !addressForm.test(digest)) {
      throw new WebMachineError("WEB_MACHINE_GENERATION_CORRUPT", "retention: blob digest 형식 위반");
    }
    digests.add(digest);
  }
  return digests;
}

export function planGenerationRetention({ targetGroupId, heads, generations, blobDigests }) {
  const groupId = String(targetGroupId || "");
  if (!groupId) throw new TypeError("targetGroupId가 필요하다");
  const retainedGenerationKeys = new Set();
  for (const [headGroupId, head] of heads) {
    for (const generationId of [head?.head, head?.prev].filter(Boolean)) {
      const key = generationStorageKey(headGroupId, generationId);
      if (!generations.has(key)) {
        throw new WebMachineError("WEB_MACHINE_GENERATION_MISSING", `${headGroupId}: retention root 없음 ${generationId}`);
      }
      retainedGenerationKeys.add(key);
    }
  }

  const deletedGenerationKeys = [];
  const remainingRecords = [];
  const groupPrefix = `${groupId}\n`;
  for (const [key, record] of generations) {
    // 어느 그룹의 세대인가는 저장 키가 안다(record는 그룹을 모른다 - 커널 오브젝트는 위치 무관).
    if (String(key).startsWith(groupPrefix) && !retainedGenerationKeys.has(key)) deletedGenerationKeys.push(key);
    else remainingRecords.push(record);
  }

  const retainedBlobDigests = new Set();
  for (const record of remainingRecords) {
    for (const digest of generationBlobDigests(record)) retainedBlobDigests.add(digest);
  }
  const deletedBlobDigests = [...blobDigests].filter((digest) => !retainedBlobDigests.has(digest));
  return Object.freeze({
    retainedGenerationKeys: Object.freeze([...retainedGenerationKeys].sort()),
    deletedGenerationKeys: Object.freeze(deletedGenerationKeys.sort()),
    retainedBlobDigests: Object.freeze([...retainedBlobDigests].sort()),
    deletedBlobDigests: Object.freeze(deletedBlobDigests.sort()),
  });
}
