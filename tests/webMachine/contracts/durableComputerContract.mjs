// durableComputerContract.mjs - signed import의 commit 실패가 active pointer와 HEAD를 보존한다.
import {
  MemoryMachineStore,
  createMachineCryptoProvider,
  createWebComputer,
  createWebMachineKeyPair,
} from "../../../src/machine/index.js";
import { createFakeGuestFactory } from "./fakeGuestAdapter.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function runDurableComputerContract() {
  const store = new MemoryMachineStore();
  const signingKeyPair = await createWebMachineKeyPair(createMachineCryptoProvider(globalThis.crypto));
  const computer = createWebComputer({
    createMachines: false,
    adapters: { durableFake: createFakeGuestFactory({ adapterVersion: "atomic-v1" }) },
    durability: {
      groupId: "nodeAtomicImport",
      store,
      lockManager: { request: (_name, _options, callback) => Promise.resolve().then(callback) },
      ownerId: "nodeOwner",
      getSigningKeyPair: () => signingKeyPair,
    },
  });
  const machine = computer.host.createMachine({
    machineId: "atomicMachine",
    adapterId: "durableFake",
    manifest: { initialValue: 7 },
    permissions: { devices: ["console"] },
  });
  computer.adoptMachines(new Map([[machine.machineId, machine]]));
  try {
    await computer.initialize();
    await computer.save();
    const exported = await computer.exportImage();
    await computer.machine("atomicMachine").request({ type: "increment", by: 35 });
    const headBefore = (await store.readHead("nodeAtomicImport"))?.head;
    const originalCommitGeneration = store.commitGeneration.bind(store);
    store.commitGeneration = async () => {
      const error = new Error("injected generation conflict");
      error.code = "WEB_MACHINE_HEAD_CONFLICT";
      throw error;
    };
    let code = "";
    try {
      await computer.importImage(exported.file, {
        trustedPublicKeys: [signingKeyPair.publicKey],
        approvedPermissions: { atomicMachine: { devices: ["console"] } },
      });
    } catch (error) {
      code = error?.code || String(error);
    } finally {
      store.commitGeneration = originalCommitGeneration;
    }
    assert(code === "WEB_MACHINE_HEAD_CONFLICT", `commit 실패 코드 불일치: ${code}`);
    assert((await store.readHead("nodeAtomicImport"))?.head === headBefore, "commit 실패가 HEAD를 바꿨다");
    assert(computer.machine("atomicMachine").state === "running", "commit 실패가 기존 guest를 멈췄다");
    assert(await computer.machine("atomicMachine").request({ type: "get" }) === 42,
      "commit 실패가 기존 active context를 교체했다");
  } finally {
    await computer.dispose().catch(() => undefined);
  }
}
