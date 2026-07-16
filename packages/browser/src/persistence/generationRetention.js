// generationRetention.js - 모든 group의 HEAD/PREV를 root로 하는 generation과 blob reachability 계산.
import { WebMachineError } from "@web-machine/core";

export function generationStorageKey(groupId, generationId) {
  return `${groupId}\n${generationId}`;
}

function payloadDigest(entry) {
  const digest = entry?.payload?.digest;
  return typeof digest === "string" && digest ? digest : null;
}

export function generationBlobDigests(record) {
  const manifest = record?.manifest;
  if (!manifest || typeof manifest !== "object") {
    throw new WebMachineError("WEB_MACHINE_GENERATION_CORRUPT", "retention: generation manifest 없음");
  }
  const digests = new Set();
  for (const entry of [...(manifest.machines || []), ...(manifest.devices || [])]) {
    const digest = payloadDigest(entry);
    if (!digest) throw new WebMachineError("WEB_MACHINE_GENERATION_CORRUPT", "retention: payload digest 없음");
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
  for (const [key, record] of generations) {
    if (record?.manifest?.groupId === groupId && !retainedGenerationKeys.has(key)) deletedGenerationKeys.push(key);
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
