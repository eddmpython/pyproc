import {
  MemoryMachineStore,
  createMachineFleet,
  createWebComputer,
} from "../../src/machine/index.js";
import { createFakeGuestFactory } from "../webMachine/contracts/fakeGuestAdapter.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectCode(operation, expected) {
  let actual = "";
  try { await operation(); }
  catch (error) { actual = error?.code || String(error); }
  assert(actual === expected, `expected ${expected}, got ${actual || "success"}`);
}

const lockManager = {
  request(_name, _options, callback) { return Promise.resolve().then(callback); },
};

function computerFactory({ store, metricsByMachine, failShutdownFor = null, ownerSerial }) {
  return ({ machineId, environmentFingerprint }) => {
    const metrics = metricsByMachine[machineId] ||= {};
    if (failShutdownFor === machineId && metrics.failShutdownsRemaining === undefined) {
      metrics.failShutdownsRemaining = 1;
    }
    const baseFactory = createFakeGuestFactory({ adapterVersion: "fleet-v1", metrics });
    const adapterFactory = failShutdownFor === machineId
      ? () => {
          const base = baseFactory();
          return {
            capabilities: base.capabilities,
            boot: (...args) => base.boot(...args),
            pause: (...args) => base.pause(...args),
            resume: (...args) => base.resume(...args),
            snapshot: (...args) => base.snapshot(...args),
            restore: (...args) => base.restore(...args),
            request: (...args) => base.request(...args),
            inspect: () => base.inspect(),
            async shutdown(...args) {
              if (metrics.failShutdownsRemaining > 0) {
                metrics.failShutdownsRemaining -= 1;
                throw new Error("injected runtime cleanup failure");
              }
              return base.shutdown(...args);
            },
          };
        }
      : baseFactory;
    const computer = createWebComputer({
      createMachines: false,
      adapters: { fleetFake: adapterFactory },
      cryptoProvider: globalThis.crypto,
      durability: {
        groupId: `fleet/${machineId}`,
        store,
        lockManager,
        ownerId: `${machineId}-owner-${++ownerSerial.value}`,
        environmentFingerprint,
      },
    });
    const machine = computer.host.createMachine({
      machineId: "runtime",
      adapterId: "fleetFake",
      manifest: { initialValue: machineId.length },
      permissions: { devices: ["console"] },
    });
    computer.adoptMachines(new Map([[machine.machineId, machine]]));
    return computer;
  };
}

export async function assertMachineFleetContract() {
  const store = new MemoryMachineStore();
  const metrics = {};
  const ownerSerial = { value: 0 };
  const createComputer = computerFactory({ store, metricsByMachine: metrics, ownerSerial });
  let leaseSerial = 0;
  let now = 100;
  const fleet = createMachineFleet({
    hotLimit: 1,
    idFactory: () => `lease-${++leaseSerial}`,
    nowFactory: () => ++now,
  });
  for (const machineId of ["alpha", "beta", "gamma"]) {
    fleet.register({ machineId, environmentFingerprint: "fleet-env-v1", createComputer });
  }

  const alpha = await fleet.acquire("alpha", "edit");
  const alphaOwnerEpoch = alpha.ownerEpoch;
  assert(await fleet.use(alpha, (computer) => computer.machine("runtime").request({ type: "increment", by: 37 })) === 42,
    "hot Machine request did not run");
  fleet.release(alpha, {});

  const beta = await fleet.acquire("beta", "test");
  const afterAdmission = fleet.inspect();
  assert(afterAdmission.hot === 1 && afterAdmission.machines.alpha.state === "cold",
    "hot admission did not suspend the safe LRU Machine");
  assert(metrics.alpha.shutdowns === 1, "cold transition did not terminate the runtime owner");
  assert(Object.values(afterAdmission.machines.alpha.resources).every((value) => value === 0),
    "cold Machine retained a reported resource owner");
  const alphaHead = await store.readHead("fleet/alpha");
  assert(alphaHead?.head === afterAdmission.machines.alpha.generationId, "cold generation is not durable HEAD");
  fleet.release(beta, {});

  const alpha2 = await fleet.resume("alpha", "resume");
  assert(alpha2.ownerEpoch > alphaOwnerEpoch, "resume did not acquire a newer owner epoch");
  assert(await fleet.use(alpha2, (computer) => computer.machine("runtime").request({ type: "get" })) === 42,
    "new runtime owner did not restore the exact generation");
  await expectCode(() => fleet.use(alpha, () => undefined), "WEB_MACHINE_FLEET_LEASE_STALE");

  fleet.release(alpha2, { unresolvedEffects: 1, outcomeUnknown: true });
  await expectCode(() => fleet.acquire("beta", "must not evict unknown effect"), "WEB_MACHINE_FLEET_CAPACITY");
  assert(metrics.alpha.shutdowns === 1, "unsafe Machine was automatically terminated");

  const failedStore = new MemoryMachineStore();
  const failedMetrics = {};
  const failedFleet = createMachineFleet({ hotLimit: 1, idFactory: () => "failed-lease" });
  failedFleet.register({
    machineId: "failed",
    environmentFingerprint: "fleet-env-v1",
    createComputer: computerFactory({ store: failedStore, metricsByMachine: failedMetrics, ownerSerial: { value: 0 } }),
  });
  const failedLease = await failedFleet.acquire("failed");
  failedFleet.release(failedLease, {});
  const originalCommit = failedStore.commitGeneration.bind(failedStore);
  failedStore.commitGeneration = async () => {
    throw Object.assign(new Error("injected commit conflict"), { code: "WEB_MACHINE_HEAD_CONFLICT" });
  };
  await expectCode(() => failedFleet.suspend("failed", { lease: failedLease }), "WEB_MACHINE_HEAD_CONFLICT");
  failedStore.commitGeneration = originalCommit;
  assert(failedMetrics.failed.shutdowns === 0 && failedFleet.inspect().machines.failed.state === "hot",
    "failed commit shut down the runtime or claimed cold success");
  assert(failedFleet.inspect().machines.failed.safety.unsaved === true, "failed commit did not fence automatic suspend");

  const cleanupStore = new MemoryMachineStore();
  const cleanupMetrics = {};
  const cleanupFleet = createMachineFleet({ hotLimit: 1, idFactory: () => "cleanup-lease" });
  cleanupFleet.register({
    machineId: "cleanup",
    environmentFingerprint: "fleet-env-v1",
    createComputer: computerFactory({
      store: cleanupStore,
      metricsByMachine: cleanupMetrics,
      failShutdownFor: "cleanup",
      ownerSerial: { value: 0 },
    }),
  });
  const cleanupLease = await cleanupFleet.acquire("cleanup");
  cleanupFleet.release(cleanupLease, {});
  await expectCode(
    () => cleanupFleet.suspend("cleanup", { lease: cleanupLease }),
    "WEB_MACHINE_SUSPEND_CLEANUP_INCOMPLETE",
  );
  assert(cleanupFleet.inspect().machines.cleanup.state === "cleanupIncomplete",
    "cleanup failure was mislabeled cold");
  const cleaned = await cleanupFleet.retryCleanup("cleanup");
  assert(cleaned.state === "cold" && cleanupFleet.inspect().machines.cleanup.resources.workers === 0,
    "cleanup retry did not publish cold after runtime termination");

  const ownerCleanupStore = new MemoryMachineStore();
  const ownerCleanupMetrics = {};
  const releaseOwner = ownerCleanupStore.releaseOwner.bind(ownerCleanupStore);
  let ownerReleaseFailures = 1;
  ownerCleanupStore.releaseOwner = async (token) => {
    if (ownerReleaseFailures > 0) {
      ownerReleaseFailures -= 1;
      throw new Error("injected owner release failure");
    }
    return releaseOwner(token);
  };
  const ownerCleanupFleet = createMachineFleet({ hotLimit: 1, idFactory: () => "owner-cleanup-lease" });
  ownerCleanupFleet.register({
    machineId: "ownerCleanup",
    environmentFingerprint: "fleet-env-v1",
    createComputer: computerFactory({
      store: ownerCleanupStore,
      metricsByMachine: ownerCleanupMetrics,
      ownerSerial: { value: 0 },
    }),
  });
  const ownerCleanupLease = await ownerCleanupFleet.acquire("ownerCleanup");
  ownerCleanupFleet.release(ownerCleanupLease, {});
  await expectCode(
    () => ownerCleanupFleet.suspend("ownerCleanup", { lease: ownerCleanupLease }),
    "WEB_MACHINE_SUSPEND_CLEANUP_INCOMPLETE",
  );
  assert(ownerCleanupFleet.inspect().machines.ownerCleanup.state === "cleanupIncomplete",
    "transient owner release failure was mislabeled cold");
  const ownerCleaned = await ownerCleanupFleet.retryCleanup("ownerCleanup");
  assert(ownerCleaned.state === "cold" && ownerCleanupMetrics.ownerCleanup.shutdowns === 1,
    "owner cleanup retry repeated runtime work or failed to publish cold");

  const mismatchFleet = createMachineFleet({ hotLimit: 1, idFactory: () => "mismatch-lease" });
  mismatchFleet.register({
    machineId: "alpha",
    environmentFingerprint: "fleet-env-v2",
    createComputer: computerFactory({ store, metricsByMachine: metrics, ownerSerial }),
  });
  await expectCode(() => mismatchFleet.acquire("alpha"), "WEB_MACHINE_ENVIRONMENT_MISMATCH");

  await expectCode(() => fleet.setHotLimit(0), "TypeError: hot limit must be an integer >= 1");
}
