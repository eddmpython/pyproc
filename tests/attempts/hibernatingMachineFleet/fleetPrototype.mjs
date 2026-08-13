import { WebMachineError } from "../../../src/machine/index.js";

const SAFE_TERMINAL = Object.freeze({
  activeCommands: 0,
  pendingApprovals: 0,
  unresolvedEffects: 0,
  outcomeUnknown: false,
  unsaved: false,
});

function normalizedSafety(value = {}) {
  return Object.freeze({
    activeCommands: Number(value.activeCommands || 0),
    pendingApprovals: Number(value.pendingApprovals || 0),
    unresolvedEffects: Number(value.unresolvedEffects || 0),
    outcomeUnknown: value.outcomeUnknown === true,
    unsaved: value.unsaved === true,
  });
}

function isSafeTerminal(value) {
  return value.activeCommands === 0
    && value.pendingApprovals === 0
    && value.unresolvedEffects === 0
    && value.outcomeUnknown === false
    && value.unsaved === false;
}

function fleetError(code, message, details) {
  return new WebMachineError(code, message, details);
}

// Initiative 3의 최소 반증 커널이다. runtime driver는 durable Web Computer가 제공할 경계를
// 흉내 내고, 이 파일은 fleet이 소유해야 하는 상태, lease, hot admission만 고정한다.
export function createFleetPrototype({ hotLimit = 1, idFactory = crypto.randomUUID.bind(crypto) } = {}) {
  if (!Number.isSafeInteger(hotLimit) || hotLimit < 1) throw new TypeError("hotLimit must be an integer >= 1");
  const records = new Map();
  let clock = 0;

  const get = (machineId) => {
    const record = records.get(String(machineId || ""));
    if (!record) throw fleetError("WEB_MACHINE_FLEET_UNAVAILABLE", `unknown fleet Machine: ${machineId}`);
    return record;
  };
  const hot = () => [...records.values()].filter((record) => record.state !== "registered" && record.state !== "cold");
  const validateLease = (record, lease) => {
    if (!lease || lease.machineId !== record.machineId || lease.epoch !== record.leaseEpoch
      || lease.leaseId !== record.leaseId) {
      throw fleetError("WEB_MACHINE_FLEET_LEASE_STALE", `${record.machineId}: stale fleet lease`);
    }
  };
  const coldCandidate = (excluded) => [...records.values()]
    .filter((record) => record.machineId !== excluded && record.state === "hot" && !record.leaseActive
      && isSafeTerminal(record.safety))
    .sort((left, right) => left.lastUsed - right.lastUsed)[0] || null;

  const suspendRecord = async (record, { automatic = false } = {}) => {
    if (record.state !== "hot") {
      throw fleetError("WEB_MACHINE_FLEET_STATE", `${record.machineId}: cannot suspend while ${record.state}`);
    }
    if (record.leaseActive || !isSafeTerminal(record.safety)) {
      throw fleetError("WEB_MACHINE_FLEET_UNSAFE", `${record.machineId}: Machine is not at a safe terminal`, {
        automatic,
        safety: record.safety,
      });
    }
    record.state = "draining";
    try {
      await record.driver.drain();
      record.state = "committing";
      const committed = await record.driver.commit();
      const verified = await record.driver.verify(committed, record.environmentFingerprint);
      if (!verified || verified.generationId !== committed.generationId) {
        throw fleetError("WEB_MACHINE_FLEET_COMMIT_UNVERIFIED", `${record.machineId}: durable HEAD was not verified`);
      }
      record.state = "stopping";
      try {
        await record.driver.stop();
      } catch (error) {
        record.cleanupError = error;
        record.lastTerminal = "cleanupIncomplete";
        throw fleetError("WEB_MACHINE_FLEET_CLEANUP_INCOMPLETE", `${record.machineId}: runtime cleanup is incomplete`, {
          generationId: committed.generationId,
          cause: String(error?.message || error),
        });
      }
      record.generationId = committed.generationId;
      record.driver = null;
      record.state = "cold";
      record.lastTerminal = "suspended";
      record.safety = SAFE_TERMINAL;
      return Object.freeze({ machineId: record.machineId, state: "cold", generationId: record.generationId });
    } catch (error) {
      if (record.state === "committing") {
        record.state = "hot";
        record.safety = normalizedSafety({ ...record.safety, unsaved: true });
        record.lastTerminal = "commitFailed";
      }
      throw error;
    }
  };

  const ensureSlot = async (targetId) => {
    while (hot().length >= hotLimit) {
      const candidate = coldCandidate(targetId);
      if (!candidate) {
        throw fleetError("WEB_MACHINE_FLEET_CAPACITY", `hot limit ${hotLimit} has no safe suspend candidate`);
      }
      await suspendRecord(candidate, { automatic: true });
    }
  };

  return Object.freeze({
    register({ machineId, environmentFingerprint, createDriver }) {
      const id = String(machineId || "");
      if (!id || typeof createDriver !== "function") throw new TypeError("machineId and createDriver are required");
      if (records.has(id)) throw fleetError("WEB_MACHINE_FLEET_DUPLICATE", `${id}: duplicate fleet Machine`);
      records.set(id, {
        machineId: id,
        environmentFingerprint: String(environmentFingerprint || ""),
        createDriver,
        driver: null,
        state: "registered",
        generationId: null,
        leaseEpoch: 0,
        leaseId: null,
        leaseActive: false,
        lastUsed: ++clock,
        safety: SAFE_TERMINAL,
        cleanupError: null,
        lastTerminal: null,
      });
      return id;
    },
    async acquire(machineId, purpose = "work") {
      const record = get(machineId);
      if (record.leaseActive) throw fleetError("WEB_MACHINE_FLEET_BUSY", `${record.machineId}: lease is active`);
      if (record.state === "registered" || record.state === "cold") {
        await ensureSlot(record.machineId);
        record.state = "waking";
        const driver = await record.createDriver();
        try {
          const resumed = await driver.wake({
            generationId: record.generationId,
            environmentFingerprint: record.environmentFingerprint,
          });
          if (resumed.environmentFingerprint !== record.environmentFingerprint) {
            throw fleetError("WEB_MACHINE_ENVIRONMENT_MISMATCH", `${record.machineId}: environment mismatch`);
          }
          record.driver = driver;
          record.state = "hot";
          record.lastTerminal = record.generationId ? "resumed" : "booted";
        } catch (error) {
          await driver.stop?.().catch(() => undefined);
          record.driver = null;
          record.state = record.generationId ? "cold" : "registered";
          throw error;
        }
      }
      if (record.state !== "hot") throw fleetError("WEB_MACHINE_FLEET_STATE", `${record.machineId}: cannot acquire while ${record.state}`);
      record.leaseEpoch += 1;
      record.leaseId = idFactory();
      record.leaseActive = true;
      record.lastUsed = ++clock;
      const ownerEpoch = Number(record.driver.inspect().ownerEpoch || 0);
      return Object.freeze({
        machineId: record.machineId,
        leaseId: record.leaseId,
        epoch: record.leaseEpoch,
        ownerEpoch,
        purpose: String(purpose),
      });
    },
    async use(lease, operation) {
      const record = get(lease?.machineId);
      validateLease(record, lease);
      if (!record.leaseActive || record.state !== "hot") {
        throw fleetError("WEB_MACHINE_FLEET_LEASE_STALE", `${record.machineId}: lease is not active`);
      }
      return operation(record.driver);
    },
    release(lease, safety = SAFE_TERMINAL) {
      const record = get(lease?.machineId);
      validateLease(record, lease);
      if (!record.leaseActive) throw fleetError("WEB_MACHINE_FLEET_LEASE_STALE", `${record.machineId}: lease was released`);
      record.leaseActive = false;
      record.safety = normalizedSafety(safety);
      record.lastUsed = ++clock;
      return Object.freeze({ machineId: record.machineId, state: record.state, safety: record.safety });
    },
    async suspend(machineId, { lease } = {}) {
      const record = get(machineId);
      validateLease(record, lease);
      return suspendRecord(record);
    },
    resume(machineId, purpose) {
      return this.acquire(machineId, purpose);
    },
    setHotLimit(limit) {
      if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("hot limit must be an integer >= 1");
      hotLimit = limit;
      return hotLimit;
    },
    inspect() {
      const machines = Object.fromEntries([...records].map(([machineId, record]) => [machineId, Object.freeze({
        state: record.state,
        generationId: record.generationId,
        environmentFingerprint: record.environmentFingerprint,
        leaseEpoch: record.leaseEpoch,
        leaseActive: record.leaseActive,
        lastTerminal: record.lastTerminal,
        safety: record.safety,
        resources: record.driver?.inspect().resources || Object.freeze({ workers: 0, runtimes: 0, deviceLeases: 0, timers: 0 }),
      })]));
      return Object.freeze({ hotLimit, hot: hot().length, machines: Object.freeze(machines) });
    },
  });
}
