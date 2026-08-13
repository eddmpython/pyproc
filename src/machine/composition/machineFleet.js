// machineFleet.js - Layer 5/composition: durable Web Computer 여러 대의 hot budget과 lease를 조율한다.
//
// Fleet은 guest나 저장 형식을 새로 만들지 않는다. createComputer가 만든 durable Web Computer의
// initialize/suspend 계약을 조합하고, safe terminal만 자동 동면시키며, stale lease가 새 owner의
// lifecycle을 바꾸지 못하게 한다. cold는 live computer 참조가 없고 검증된 generation만 있는 상태다.
import { WebMachineError } from "../contracts/webMachineError.js";

const COLD_RESOURCES = Object.freeze({ workers: 0, runtimes: 0, deviceLeases: 0, timers: 0 });

function error(code, message, details = null) {
  return new WebMachineError(code, message, details);
}

function normalizeSafety(value, { conservative = false } = {}) {
  const source = value && typeof value === "object" ? value : {};
  const safety = Object.freeze({
    activeCommands: Number(source.activeCommands || 0),
    pendingApprovals: Number(source.pendingApprovals || 0),
    unresolvedEffects: Number(source.unresolvedEffects || 0),
    outcomeUnknown: source.outcomeUnknown === true,
    unsaved: conservative || source.unsaved === true,
  });
  for (const field of ["activeCommands", "pendingApprovals", "unresolvedEffects"]) {
    if (!Number.isSafeInteger(safety[field]) || safety[field] < 0) {
      throw new TypeError(`fleet safety ${field} must be a non-negative safe integer`);
    }
  }
  return safety;
}

function isSafeTerminal(record) {
  const safety = record.safety;
  return record.activeCommands === 0
    && safety.activeCommands === 0
    && safety.pendingApprovals === 0
    && safety.unresolvedEffects === 0
    && safety.outcomeUnknown === false
    && safety.unsaved === false;
}

function resourcesOf(computer) {
  if (!computer) return COLD_RESOURCES;
  const inspection = computer.inspect();
  const machines = Object.values(inspection.machines || {});
  const runtimes = machines.filter((machine) => machine.guest !== null).length;
  const workers = machines.filter((machine) => machine.guest?.hosted === "worker" && machine.guest?.ready === true).length;
  return Object.freeze({
    workers,
    runtimes,
    deviceLeases: runtimes,
    // Guest-owned timers are not observable while hot. The fleet reports unknown instead of 0.
    timers: runtimes ? null : 0,
  });
}

function freezeLease(record, purpose) {
  const ownerEpoch = Number(record.computer?.inspect().owner?.epoch || 0);
  return Object.freeze({
    machineId: record.machineId,
    leaseId: record.leaseId,
    epoch: record.leaseEpoch,
    ownerEpoch,
    purpose: String(purpose || "work"),
  });
}

export function createMachineFleet({
  hotLimit = 1,
  idFactory = () => globalThis.crypto?.randomUUID?.(),
  nowFactory = () => Date.now(),
  chooseCandidate = null,
} = {}) {
  if (!Number.isSafeInteger(hotLimit) || hotLimit < 1) throw new TypeError("hotLimit must be an integer >= 1");
  if (typeof idFactory !== "function" || typeof nowFactory !== "function") {
    throw new TypeError("idFactory and nowFactory must be functions");
  }
  if (chooseCandidate !== null && typeof chooseCandidate !== "function") throw new TypeError("chooseCandidate must be a function");

  const records = new Map();
  let disposed = false;
  let mutationTail = Promise.resolve();

  const mutate = (operation) => {
    const next = mutationTail.then(operation, operation);
    mutationTail = next.catch(() => undefined);
    return next;
  };
  const assertLive = () => {
    if (disposed) throw error("WEB_MACHINE_FLEET_DISPOSED", "the Machine Fleet is disposed");
  };
  const get = (machineId) => {
    const record = records.get(String(machineId || ""));
    if (!record) throw error("WEB_MACHINE_FLEET_UNAVAILABLE", `Machine is not registered: ${String(machineId)}`);
    return record;
  };
  const consumesHotSlot = (record) => record.computer !== null;
  const hotRecords = () => [...records.values()].filter(consumesHotSlot);
  const validateLease = (record, lease, { active = null } = {}) => {
    if (!lease || lease.machineId !== record.machineId || lease.leaseId !== record.leaseId
      || lease.epoch !== record.leaseEpoch) {
      throw error("WEB_MACHINE_FLEET_LEASE_STALE", `${record.machineId}: stale fleet lease`);
    }
    if (active !== null && record.leaseActive !== active) {
      throw error("WEB_MACHINE_FLEET_LEASE_STALE", `${record.machineId}: lease active state changed`);
    }
    const currentOwnerEpoch = Number(record.computer?.inspect().owner?.epoch || 0);
    if (record.computer && lease.ownerEpoch !== currentOwnerEpoch) {
      throw error("WEB_MACHINE_FLEET_LEASE_STALE", `${record.machineId}: owner epoch changed`);
    }
  };
  const defaultCandidates = (excluded) => [...records.values()]
    .filter((record) => record.machineId !== excluded && record.state === "hot"
      && !record.leaseActive && !record.pinned && isSafeTerminal(record))
    .sort((left, right) => left.lastUsedAt - right.lastUsedAt);

  const selectCandidate = (excluded) => {
    const candidates = defaultCandidates(excluded);
    if (!chooseCandidate || candidates.length < 2) return candidates[0] || null;
    const chosenId = chooseCandidate(Object.freeze(candidates.map((record) => Object.freeze({
      machineId: record.machineId,
      lastUsedAt: record.lastUsedAt,
      priority: record.priority,
      pinned: record.pinned,
    }))));
    const chosen = candidates.find((record) => record.machineId === chosenId) || null;
    if (!chosen) throw error("WEB_MACHINE_FLEET_POLICY_INVALID", "chooseCandidate returned an ineligible Machine");
    return chosen;
  };

  const suspendRecord = async (record, { control, automatic = false } = {}) => {
    if (record.state !== "hot" || record.leaseActive || !isSafeTerminal(record) || record.pinned) {
      throw error("WEB_MACHINE_FLEET_UNSAFE", `${record.machineId}: Machine is not eligible for suspend`, {
        automatic,
        state: record.state,
        leaseActive: record.leaseActive,
        pinned: record.pinned,
        activeCommands: record.activeCommands,
        safety: record.safety,
      });
    }
    record.state = "draining";
    try {
      const receipt = await record.computer.suspend({ safety: record.safety, control });
      record.state = "stopping";
      if (receipt.terminal !== "suspended" || !receipt.generationId
        || receipt.environmentFingerprint !== record.environmentFingerprint) {
        throw error("WEB_MACHINE_FLEET_COMMIT_UNVERIFIED", `${record.machineId}: invalid suspend receipt`, { receipt });
      }
      record.generationId = receipt.generationId;
      record.computer = null;
      record.state = "cold";
      record.lastTerminal = "suspended";
      record.lastSuspend = receipt;
      record.safety = normalizeSafety({});
      return Object.freeze({ machineId: record.machineId, state: record.state, ...receipt });
    } catch (caught) {
      const lifecycle = record.computer?.inspect().lifecycleState;
      if (lifecycle === "cleanupIncomplete") {
        record.state = "cleanupIncomplete";
        record.lastTerminal = "cleanupIncomplete";
      } else if (lifecycle === "hot") {
        record.state = "hot";
        record.safety = normalizeSafety({ ...record.safety, unsaved: true });
        record.lastTerminal = "suspendFailed";
      } else {
        record.state = "failed";
        record.safety = normalizeSafety({ ...record.safety, unsaved: true });
        record.lastTerminal = "suspendFailed";
      }
      throw caught;
    }
  };

  const ensureCapacity = async (targetMachineId, desiredLimit = hotLimit, control) => {
    while (hotRecords().length >= desiredLimit) {
      const candidate = selectCandidate(targetMachineId);
      if (!candidate) {
        throw error("WEB_MACHINE_FLEET_CAPACITY", `hot limit ${desiredLimit} has no safe suspend candidate`, {
          hot: hotRecords().length,
          hotLimit: desiredLimit,
        });
      }
      await suspendRecord(candidate, { automatic: true, control });
    }
  };

  const acquireNow = async (machineId, purpose = "work", control) => {
    assertLive();
    const record = get(machineId);
    if (record.leaseActive) throw error("WEB_MACHINE_FLEET_BUSY", `${record.machineId}: a lease is already active`);
    if (record.state === "registered" || record.state === "cold") {
      await ensureCapacity(record.machineId, hotLimit, control);
      const priorState = record.state;
      record.state = "waking";
      let computer = null;
      try {
        computer = await record.createComputer({
          machineId: record.machineId,
          environmentFingerprint: record.environmentFingerprint,
        });
        if (!computer || typeof computer.initialize !== "function" || typeof computer.suspend !== "function") {
          throw new TypeError(`${record.machineId}: createComputer must return a durable Web Computer`);
        }
        record.computer = computer;
        const resumed = await computer.initialize({ control });
        if (resumed.lifecycleState !== "hot"
          || resumed.persistence?.environmentFingerprint !== record.environmentFingerprint) {
          throw error("WEB_MACHINE_ENVIRONMENT_MISMATCH", `${record.machineId}: wake environment did not match`, {
            expected: record.environmentFingerprint,
            actual: resumed.persistence?.environmentFingerprint ?? null,
          });
        }
        record.state = "hot";
        record.lastTerminal = resumed.startupMode === "restored" ? "resumed" : "booted";
        record.lastResume = resumed.persistence.lastResume;
      } catch (caught) {
        await computer?.dispose?.(control).catch(() => undefined);
        record.computer = null;
        record.state = priorState;
        record.lastTerminal = "wakeFailed";
        throw caught;
      }
    }
    if (record.state !== "hot") {
      throw error("WEB_MACHINE_FLEET_STATE", `${record.machineId}: cannot acquire while ${record.state}`);
    }
    const leaseId = idFactory();
    if (!leaseId) throw new TypeError("idFactory must return a non-empty lease id");
    record.leaseEpoch += 1;
    record.leaseId = String(leaseId);
    record.leaseActive = true;
    record.lastUsedAt = Number(nowFactory());
    return freezeLease(record, purpose);
  };

  const acquire = (machineId, purpose = "work", control) => mutate(() => acquireNow(machineId, purpose, control));

  return Object.freeze({
    register({
      machineId,
      environmentFingerprint,
      createComputer,
      prefetch = null,
      priority = 0,
      pinned = false,
    }) {
      assertLive();
      const id = String(machineId || "");
      const fingerprint = String(environmentFingerprint || "");
      if (!id || !fingerprint || typeof createComputer !== "function") {
        throw new TypeError("machineId, environmentFingerprint, and createComputer are required");
      }
      if (prefetch !== null && typeof prefetch !== "function") throw new TypeError("prefetch must be a function");
      if (records.has(id)) throw error("WEB_MACHINE_FLEET_DUPLICATE", `${id}: duplicate fleet Machine`);
      records.set(id, {
        machineId: id,
        environmentFingerprint: fingerprint,
        createComputer,
        prefetch,
        priority: Number(priority || 0),
        pinned: pinned === true,
        state: "registered",
        computer: null,
        generationId: null,
        leaseEpoch: 0,
        leaseId: null,
        leaseActive: false,
        activeCommands: 0,
        safety: normalizeSafety({}, { conservative: true }),
        lastUsedAt: Number(nowFactory()),
        lastTerminal: null,
        lastSuspend: null,
        lastResume: null,
        prefetchReceipt: null,
      });
      return id;
    },
    acquire,
    resume: acquire,
    async use(lease, operation) {
      assertLive();
      if (typeof operation !== "function") throw new TypeError("use requires an operation function");
      const record = get(lease?.machineId);
      validateLease(record, lease, { active: true });
      if (record.state !== "hot") throw error("WEB_MACHINE_FLEET_STATE", `${record.machineId}: cannot use while ${record.state}`);
      record.activeCommands += 1;
      try { return await operation(record.computer, lease); }
      finally { record.activeCommands -= 1; }
    },
    release(lease, safety) {
      assertLive();
      const record = get(lease?.machineId);
      validateLease(record, lease, { active: true });
      if (record.activeCommands !== 0) {
        throw error("WEB_MACHINE_FLEET_BUSY", `${record.machineId}: commands are still active`);
      }
      record.leaseActive = false;
      record.safety = normalizeSafety(safety, { conservative: safety === undefined });
      record.lastUsedAt = Number(nowFactory());
      return Object.freeze({ machineId: record.machineId, state: record.state, safety: record.safety });
    },
    suspend(machineId, { lease, control } = {}) {
      return mutate(async () => {
        assertLive();
        const record = get(machineId);
        validateLease(record, lease, { active: false });
        return suspendRecord(record, { control });
      });
    },
    retryCleanup(machineId, control) {
      return mutate(async () => {
        assertLive();
        const record = get(machineId);
        if (record.state !== "cleanupIncomplete" || record.leaseActive || !record.computer) {
          throw error("WEB_MACHINE_FLEET_STATE", `${record.machineId}: no incomplete cleanup can be retried`);
        }
        const receipt = await record.computer.retrySuspendCleanup(control);
        record.generationId = receipt.generationId;
        record.computer = null;
        record.state = "cold";
        record.lastTerminal = "suspended";
        record.lastSuspend = receipt;
        record.safety = normalizeSafety({});
        return Object.freeze({ machineId: record.machineId, state: "cold", ...receipt });
      });
    },
    setHotLimit(limit, control) {
      return mutate(async () => {
        assertLive();
        if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("hot limit must be an integer >= 1");
        while (hotRecords().length > limit) {
          const candidate = selectCandidate(null);
          if (!candidate) {
            throw error("WEB_MACHINE_FLEET_CAPACITY", `cannot lower hot limit to ${limit} without unsafe termination`);
          }
          await suspendRecord(candidate, { automatic: true, control });
        }
        hotLimit = limit;
        return hotLimit;
      });
    },
    async prefetch(machineId, control) {
      assertLive();
      const record = get(machineId);
      if (!record.prefetch) throw error("WEB_MACHINE_FLEET_PREFETCH_UNAVAILABLE", `${record.machineId}: no prefetch operation`);
      const receipt = await record.prefetch({ machineId: record.machineId, environmentFingerprint: record.environmentFingerprint, control });
      record.prefetchReceipt = Object.freeze({
        environmentFingerprint: record.environmentFingerprint,
        byteLength: Number(receipt?.byteLength || 0),
        completedAt: Number(nowFactory()),
      });
      return record.prefetchReceipt;
    },
    inspect() {
      const machines = Object.freeze(Object.fromEntries([...records].map(([machineId, record]) => {
        const computerLifecycle = record.computer?.inspect().lifecycleState;
        const state = ["waking", "draining", "committing", "stopping", "cleanupIncomplete", "failed"]
          .includes(computerLifecycle) ? computerLifecycle : record.state;
        return [machineId, Object.freeze({
        state,
        generationId: record.generationId,
        environmentFingerprint: record.environmentFingerprint,
        leaseEpoch: record.leaseEpoch,
        leaseActive: record.leaseActive,
        activeCommands: record.activeCommands,
        safety: record.safety,
        lastTerminal: record.lastTerminal,
        lastSuspend: record.lastSuspend,
        lastResume: record.lastResume,
        prefetched: record.prefetchReceipt,
        resources: resourcesOf(record.computer),
      })];
      })));
      const states = Object.values(machines).reduce((counts, machine) => {
        counts[machine.state] = (counts[machine.state] || 0) + 1;
        return counts;
      }, {});
      return Object.freeze({
        hotLimit,
        hot: hotRecords().length,
        cold: states.cold || 0,
        states: Object.freeze(states),
        machines,
      });
    },
    dispose(control) {
      return mutate(async () => {
        if (disposed) return;
        const unsafe = hotRecords().filter((record) => record.state !== "hot"
          || record.leaseActive || !isSafeTerminal(record) || record.pinned);
        if (unsafe.length) {
          throw error("WEB_MACHINE_FLEET_UNSAFE", "fleet dispose would terminate unsafe Machines", {
            machineIds: unsafe.map((record) => record.machineId),
          });
        }
        for (const record of hotRecords()) await suspendRecord(record, { control });
        disposed = true;
      });
    },
  });
}
