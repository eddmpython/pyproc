import { createFleetPrototype } from "./fleetPrototype.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function codeOf(error) {
  return error?.code || String(error);
}

function createHarness({ environmentFingerprint = "pyodide:test-v1", failCommit = false, failStop = false } = {}) {
  const metrics = { wakes: 0, commits: 0, verifies: 0, stops: 0, liveWorkers: 0, stopBeforeCommit: 0 };
  let value = 0;
  let generation = null;
  return {
    metrics,
    createDriver: async () => {
      let live = false;
      return {
        async wake({ generationId, environmentFingerprint: expected }) {
          if (expected !== environmentFingerprint) throw Object.assign(new Error("environment mismatch"), { code: "WEB_MACHINE_ENVIRONMENT_MISMATCH" });
          metrics.wakes += 1;
          metrics.liveWorkers += 1;
          live = true;
          if (generationId) {
            assert(generation?.generationId === generationId, "wrong generation requested");
            value = generation.value;
          }
          return { environmentFingerprint };
        },
        async drain() {},
        async commit() {
          metrics.commits += 1;
          if (failCommit) throw Object.assign(new Error("injected commit failure"), { code: "WEB_MACHINE_HEAD_CONFLICT" });
          generation = { generationId: `generation-${metrics.commits}`, value };
          return generation;
        },
        async verify(candidate) {
          metrics.verifies += 1;
          return candidate.generationId === generation?.generationId ? candidate : null;
        },
        async stop() {
          metrics.stops += 1;
          if (!generation) metrics.stopBeforeCommit += 1;
          if (failStop) throw new Error("injected cleanup failure");
          if (live) metrics.liveWorkers -= 1;
          live = false;
        },
        inspect() {
          return { ownerEpoch: metrics.wakes, resources: { workers: live ? 1 : 0, runtimes: live ? 1 : 0, deviceLeases: 0, timers: 0 } };
        },
        increment(by = 1) { value += by; return value; },
        value() { return value; },
      };
    },
  };
}

async function expectCode(operation, expected) {
  let actual = "";
  try { await operation(); }
  catch (error) { actual = codeOf(error); }
  assert(actual === expected, `expected ${expected}, got ${actual || "success"}`);
}

const alpha = createHarness();
const beta = createHarness();
const fleet = createFleetPrototype({ hotLimit: 1, idFactory: (() => { let n = 0; return () => `lease-${++n}`; })() });
fleet.register({ machineId: "alpha", environmentFingerprint: "pyodide:test-v1", createDriver: alpha.createDriver });
fleet.register({ machineId: "beta", environmentFingerprint: "pyodide:test-v1", createDriver: beta.createDriver });

const leaseA = await fleet.acquire("alpha", "edit");
assert(await fleet.use(leaseA, (driver) => driver.increment(41)) === 41, "hot Machine request failed");
fleet.release(leaseA);
const leaseB = await fleet.acquire("beta", "test");
assert(fleet.inspect().hot === 1, "hot limit exceeded");
assert(fleet.inspect().machines.alpha.state === "cold", "safe LRU candidate was not suspended");
assert(alpha.metrics.liveWorkers === 0 && alpha.metrics.commits === 1 && alpha.metrics.verifies === 1 && alpha.metrics.stops === 1,
  "commit, verify, stop order did not release the worker");
fleet.release(leaseB);

const leaseA2 = await fleet.resume("alpha", "resume");
assert(await fleet.use(leaseA2, (driver) => driver.value()) === 41, "exact generation did not resume");
await expectCode(() => fleet.use(leaseA, (driver) => driver.value()), "WEB_MACHINE_FLEET_LEASE_STALE");
fleet.release(leaseA2, { unresolvedEffects: 1, outcomeUnknown: true });
await expectCode(() => fleet.acquire("beta", "unsafe eviction"), "WEB_MACHINE_FLEET_CAPACITY");
assert(alpha.metrics.liveWorkers === 1, "unsafe Machine was stopped");

const failed = createHarness({ failCommit: true });
const failedFleet = createFleetPrototype({ hotLimit: 1, idFactory: () => "failed-lease" });
failedFleet.register({ machineId: "failed", environmentFingerprint: "pyodide:test-v1", createDriver: failed.createDriver });
const failedLease = await failedFleet.acquire("failed");
failedFleet.release(failedLease);
await expectCode(() => failedFleet.suspend("failed", { lease: failedLease }), "WEB_MACHINE_HEAD_CONFLICT");
assert(failed.metrics.stops === 0 && failed.metrics.stopBeforeCommit === 0 && failed.metrics.liveWorkers === 1,
  "commit failure terminated the runtime");
assert(failedFleet.inspect().machines.failed.safety.unsaved === true, "commit failure was not marked unsaved");

const cleanup = createHarness({ failStop: true });
const cleanupFleet = createFleetPrototype({ hotLimit: 1, idFactory: () => "cleanup-lease" });
cleanupFleet.register({ machineId: "cleanup", environmentFingerprint: "pyodide:test-v1", createDriver: cleanup.createDriver });
const cleanupLease = await cleanupFleet.acquire("cleanup");
cleanupFleet.release(cleanupLease);
await expectCode(() => cleanupFleet.suspend("cleanup", { lease: cleanupLease }), "WEB_MACHINE_FLEET_CLEANUP_INCOMPLETE");
assert(cleanupFleet.inspect().machines.cleanup.state === "stopping", "cleanup failure was mislabeled cold");

console.log("PASS hibernating Machine Fleet attempt: 16 checks");
