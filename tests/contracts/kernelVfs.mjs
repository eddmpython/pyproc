import { readFile } from "node:fs/promises";

import {
  KernelDeviceRegistry,
  KernelVfs,
  MemoryKernelVfsStore,
} from "../../src/runtime/kernel/kernelVfs.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejectionOf(operation) {
  try { await operation(); return null; }
  catch (error) { return error; }
}

async function openMemory(store, ownerId, clock) {
  const vfs = new KernelVfs(store, { volumeId: "contract", ownerId, leaseMs: 100, now: () => clock.value });
  await vfs.open();
  return vfs;
}

export async function assertKernelVfsContract() {
  const clock = { value: 0 };
  const store = new MemoryKernelVfsStore();
  const vfs = await openMemory(store, "owner:a", clock);
  const initialRoot = vfs.rootDigest;
  const first = vfs.beginTransaction();
  await first.write("/home/a.txt", "alpha");
  await first.write("/home/dir/b.bin", new Uint8Array([1, 2, 3]));
  const committed = await first.commit();
  assert(committed.baseRootDigest === initialRoot && committed.rootDigest === vfs.rootDigest
    && new TextDecoder().decode(await vfs.read("/home/a.txt")) === "alpha"
    && (await vfs.read("/home/dir/b.bin"))[2] === 3,
  "KernelVfs immutable object commit or read failed");
  const moved = vfs.beginTransaction();
  moved.rename("/home/a.txt", "/home/renamed.txt");
  moved.remove("/home/dir/b.bin");
  await moved.commit();
  assert(vfs.list().join(",") === "/home/renamed.txt", "KernelVfs rename or remove changed the wrong root");
  assert((await rejectionOf(() => first.write("/home/../escape", "x")))?.context?.kernelCode === "KERNEL_VFS_TRANSACTION_CLOSED",
    "closed VFS transaction was reused");
  const invalid = vfs.beginTransaction();
  assert((await rejectionOf(() => invalid.write("/home/../escape", "x")))?.context?.kernelCode === "KERNEL_VFS_PATH_INVALID",
    "KernelVfs accepted traversal");
  invalid.abort();

  const raceA = vfs.beginTransaction();
  const raceB = vfs.beginTransaction();
  await raceA.write("/home/race-a", "winner");
  await raceB.write("/home/race-b", "stale");
  const winner = await raceA.commit();
  const conflict = await rejectionOf(() => raceB.commit());
  assert(conflict?.context?.kernelCode === "KERNEL_VFS_HEAD_CONFLICT" && vfs.rootDigest === winner.rootDigest,
    "KernelVfs stale HEAD transaction was adopted");

  const expectedByStep = new Map([
    ["afterObjects", "base"], ["afterRoot", "base"], ["afterIntent", "base"], ["afterMarker", "base"],
    ["afterHead", "candidate"], ["afterAdoption", "candidate"],
  ]);
  for (const [step, expected] of expectedByStep) {
    const faultClock = { value: 0 };
    const faultStore = new MemoryKernelVfsStore();
    const owner = await openMemory(faultStore, `owner:${step}:a`, faultClock);
    const baseTx = owner.beginTransaction();
    await baseTx.write("/home/base", "base");
    const base = await baseTx.commit();
    const candidateTx = owner.beginTransaction();
    await candidateTx.write("/home/candidate", step);
    await rejectionOf(() => candidateTx.commit({ faultInjector(actualStep) {
      if (actualStep === step) throw new Error(`fault:${step}`);
    } }));
    faultClock.value = 101;
    const recovered = await openMemory(faultStore, `owner:${step}:b`, faultClock);
    const hasCandidate = recovered.list().includes("/home/candidate");
    assert((expected === "candidate") === hasCandidate,
      `KernelVfs recovery selected the wrong root after ${step}`);
    if (expected === "base") assert(recovered.rootDigest === base.rootDigest,
      `KernelVfs recovery changed the base root after ${step}`);
  }

  const recoveryClock = { value: 0 };
  const recoveryStore = new MemoryKernelVfsStore();
  const recoveryOwner = await openMemory(recoveryStore, "owner:recovery:a", recoveryClock);
  const recoveryTx = recoveryOwner.beginTransaction();
  await recoveryTx.write("/home/valid", "valid");
  const recoveryCommit = await recoveryTx.commit();
  recoveryStore.head.rootDigest = "sha256:" + "0".repeat(64);
  recoveryClock.value = 101;
  const recoveredFromAdoption = await openMemory(recoveryStore, "owner:recovery:b", recoveryClock);
  assert(recoveredFromAdoption.rootDigest === recoveryCommit.rootDigest
    && new TextDecoder().decode(await recoveredFromAdoption.read("/home/valid")) === "valid",
  "KernelVfs did not recover the newest valid adopted root after HEAD corruption");

  let allowDevice = false;
  const devices = new KernelDeviceRegistry({ authorize: () => allowDevice });
  const terminal = devices.register("terminal", {
    operations: ["write"],
    async invoke(operation, input) { return { operation, byteLength: input.byteLength }; },
    checkpointDisposition() { return "forbidden"; },
  });
  const denied = await rejectionOf(() => devices.invoke(terminal, "write", new Uint8Array([1])));
  allowDevice = true;
  const allowed = await devices.invoke(terminal, "write", new Uint8Array([1, 2]));
  assert(denied?.context?.kernelCode === "KERNEL_VFS_DEVICE_DENIED" && allowed.byteLength === 2
    && devices.checkpointResources()[0].disposition === "forbidden",
  "typed /dev provider skipped authority or checkpoint disposition");

  const boundaryTx = recoveredFromAdoption.beginTransaction();
  assert((await recoveredFromAdoption.inspectCheckpointBoundary()).activeTransactions === 1,
    "KernelVfs did not report an active transaction to checkpoint coordination");
  boundaryTx.abort();
  recoveredFromAdoption.writeTmp("/tmp/ephemeral", "tmp");
  assert(new TextDecoder().decode(await recoveredFromAdoption.read("/tmp/ephemeral")) === "tmp"
    && recoveredFromAdoption.mounts().some((mount) => mount.path === "/dev" && mount.provider === "typed-device"),
  "KernelVfs mount table or generation-local /tmp failed");

  const source = await readFile(new URL("../../src/runtime/kernel/kernelVfs.js", import.meta.url), "utf8");
  for (const forbidden of ["FS.registerDevice", ".makedev(", ".mkdev(", "HEAPU8"]) {
    assert(!source.includes(forbidden), `KernelVfs migrated path contains engine-specific filesystem access: ${forbidden}`);
  }
}
