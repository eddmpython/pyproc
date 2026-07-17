// machineStoreContract.mjs - public MachineStore 반환, 오류, fencing, retention의 Node 기준 suite.
import { MemoryMachineStore } from "../../../src/machine/index.js";

function generationRecord(groupId, generationId, machineDigest, deviceDigest = null) {
  return {
    manifest: {
      schemaVersion: 1,
      groupId,
      generationId,
      machines: [{ machineId: "machine", payload: { digest: machineDigest, byteLength: 1 } }],
      devices: deviceDigest ? [{ name: "disk", payload: { digest: deviceDigest, byteLength: 1 } }] : [],
    },
    manifestHash: `sha256:${generationId}`,
  };
}

async function errorCode(operation) {
  try {
    await operation();
    return "";
  } catch (error) {
    return error?.code || String(error);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function runMachineStoreContract(store, { groupId = "contract" } = {}) {
  if (!store || typeof store.commitGeneration !== "function") throw new TypeError("MachineStore가 필요하다");
  const owner1 = await store.claimOwner({ groupId, ownerId: "owner1" });
  assert(owner1.groupId === groupId && owner1.epoch === 1, "첫 owner token shape 불일치");
  const source = new Uint8Array([1]);
  const head1 = await store.commitGeneration({
    groupId,
    generationId: "g1",
    expectedHead: null,
    ownerToken: owner1,
    blobs: [{ digest: "digest-a", bytes: source }],
    record: generationRecord(groupId, "g1", "digest-a"),
  });
  source[0] = 9;
  assert(JSON.stringify(Object.keys(head1)) === JSON.stringify(["head", "prev", "ownerEpoch"]), "GenerationHead key drift");
  assert(head1.head === "g1" && head1.prev === null && head1.ownerEpoch === 1, "첫 HEAD 값 불일치");
  const firstRead = await store.getBlob("digest-a");
  assert(firstRead[0] === 1, "입력 bytes 격리 실패");
  firstRead[0] = 7;
  assert((await store.getBlob("digest-a"))[0] === 1, "반환 bytes 격리 실패");
  assert(await errorCode(() => store.getBlob("missing")) === "WEB_MACHINE_BLOB_MISSING", "missing blob 오류 drift");
  assert(await errorCode(() => store.readGeneration(groupId, "missing")) === "WEB_MACHINE_GENERATION_MISSING", "missing generation 오류 drift");

  const owner2 = await store.claimOwner({ groupId, ownerId: "owner2" });
  assert(owner2.epoch === 2, "successor epoch 불일치");
  const staleCommit = await errorCode(() => store.commitGeneration({
    groupId,
    generationId: "stale",
    expectedHead: "g1",
    ownerToken: owner1,
    blobs: [{ digest: "digest-stale", bytes: new Uint8Array([2]) }],
    record: generationRecord(groupId, "stale", "digest-stale"),
  }));
  assert(staleCommit === "WEB_MACHINE_OWNER_STALE", "stale commit 허용");
  assert(await errorCode(() => store.pruneRecoveryWindow({ groupId, ownerToken: owner1 })) === "WEB_MACHINE_OWNER_STALE", "stale prune 허용");
  assert(await errorCode(() => store.getBlob("digest-stale")) === "WEB_MACHINE_BLOB_MISSING", "stale blob publish됨");

  for (const [generationId, machineDigest, deviceDigest] of [
    ["g2", "digest-b", "digest-shared"],
    ["g3", "digest-c", "digest-shared"],
    ["g4", "digest-d", "digest-shared"],
  ]) {
    const expectedHead = (await store.readHead(groupId)).head;
    await store.commitGeneration({
      groupId,
      generationId,
      expectedHead,
      ownerToken: owner2,
      blobs: [
        { digest: machineDigest, bytes: new Uint8Array([generationId.charCodeAt(1)]) },
        { digest: deviceDigest, bytes: new Uint8Array([42]) },
      ],
      record: generationRecord(groupId, generationId, machineDigest, deviceDigest),
    });
  }
  const dryRun = await store.dryRunRecoveryWindow({ groupId, ownerToken: owner2 });
  assert(dryRun.deletedGenerations === 2 && dryRun.deletedBlobs === 2, "retention dry-run 불일치");
  assert((await store.readGeneration(groupId, "g1")).manifest.generationId === "g1", "dry-run이 generation 삭제");
  const pruned = await store.pruneRecoveryWindow({ groupId, ownerToken: owner2 });
  assert(pruned.deletedGenerations === 2 && pruned.retainedGenerations === 2, "retention generation window 불일치");
  assert(await errorCode(() => store.readGeneration(groupId, "g2")) === "WEB_MACHINE_GENERATION_MISSING", "old generation 보존됨");
  assert((await store.getBlob("digest-shared"))[0] === 42, "shared retained blob 삭제");
  const storage = await store.inspectStorage();
  assert(storage.generations === 2 && storage.blobs === 3, "pruned storage count 불일치");
  await store.releaseOwner(owner2);
  assert(await errorCode(() => store.assertOwner(owner2)) === "WEB_MACHINE_OWNER_STALE", "released owner가 active");
}

export function runMemoryMachineStoreContract() {
  return runMachineStoreContract(new MemoryMachineStore());
}
