// durableWebComputer.js - Layer 5/composition: 컴퓨터의 보편 내구 수명주기.
//
// 제품은 store/group/lock, signer 승인, guest 자산을 정한다. 이 파일은 제품마다 같아야 하는
// 순서만 소유한다: owner claim -> restore-or-boot, pause -> flush/snapshot -> fenced commit ->
// resume 또는 verify -> shutdown -> owner release, signed export, 검증된 candidate import와
// 원자적 active-context 교체, dispose.
import { WebMachineError } from "../contracts/webMachineError.js";
import { MachineEnvelopeCoordinator } from "../image/machineEnvelopeCoordinator.js";
import { MachineCommitCoordinator } from "../persistence/machineCommitCoordinator.js";
import { WebLockOwnerCoordinator } from "../persistence/webLockOwnerCoordinator.js";
import { createMachineCryptoProvider } from "./machineCryptoProvider.js";

function blockDevices(computer) {
  return Object.freeze(Object.fromEntries(
    Object.entries(computer.devices || {}).filter(([, device]) => device?.kind === "block"),
  ));
}

function requireDurability(config) {
  if (!config) {
    throw new WebMachineError(
      "WEB_MACHINE_DURABILITY_UNAVAILABLE",
      "This computer has no durability configuration. Pass createWebComputer({ durability: { groupId, store, lockManager } }).",
    );
  }
  return config;
}

async function resolveSigningKeyPair(config, supplied) {
  if (supplied) return supplied;
  if (typeof config.getSigningKeyPair === "function") return config.getSigningKeyPair();
  throw new WebMachineError(
    "WEB_MACHINE_SIGNER_REQUIRED",
    "A signing key pair is required. Pass exportImage({ signingKeyPair }) or configure getSigningKeyPair.",
  );
}

async function withPaused(computer, control, operation) {
  const runningIds = computer.runningMachineIds();
  try {
    await computer.pauseRunning(control);
  } catch (error) {
    await computer.resumeMachineIds(runningIds).catch(() => undefined);
    throw error;
  }
  let result;
  let failure = null;
  try { result = await operation(); }
  catch (error) { failure = error; }
  try { await computer.resumeMachineIds(runningIds); }
  catch (resumeError) {
    if (failure) throw new AggregateError([failure, resumeError], "Web Computer operation and resume both failed");
    throw resumeError;
  }
  if (failure) throw failure;
  return result;
}

function inspectComputer(computer) {
  return Object.freeze({
    machines: Object.freeze(Object.fromEntries(
      [...computer.machines].map(([machineId, machine]) => [machineId, machine.inspectNow()]),
    )),
    devices: Object.freeze(Object.fromEntries(
      Object.entries(computer.devices).map(([name, device]) => [
        name,
        typeof device?.inspect === "function" ? device.inspect() : Object.freeze({ kind: device?.kind || null }),
      ]),
    )),
  });
}

function normalizeSuspendSafety(value) {
  if (!value || typeof value !== "object") {
    throw new WebMachineError(
      "WEB_MACHINE_SUSPEND_UNSAFE",
      "suspend requires an explicit safety terminal",
    );
  }
  const safety = Object.freeze({
    activeCommands: Number(value.activeCommands || 0),
    pendingApprovals: Number(value.pendingApprovals || 0),
    unresolvedEffects: Number(value.unresolvedEffects || 0),
    outcomeUnknown: value.outcomeUnknown === true,
    unsaved: value.unsaved === true,
  });
  if (!Number.isSafeInteger(safety.activeCommands) || safety.activeCommands < 0
    || !Number.isSafeInteger(safety.pendingApprovals) || safety.pendingApprovals < 0
    || !Number.isSafeInteger(safety.unresolvedEffects) || safety.unresolvedEffects < 0) {
    throw new TypeError("suspend safety counters must be non-negative safe integers");
  }
  if (safety.activeCommands || safety.pendingApprovals || safety.unresolvedEffects
    || safety.outcomeUnknown || safety.unsaved) {
    throw new WebMachineError(
      "WEB_MACHINE_SUSPEND_UNSAFE",
      "the Web Computer is not at a safe suspend terminal",
      { safety },
    );
  }
  return safety;
}

export function createDurableWebComputerFacade({
  getActive,
  setActive,
  createCandidate,
  durability = null,
  cryptoProvider,
}) {
  if (typeof getActive !== "function" || typeof setActive !== "function" || typeof createCandidate !== "function") {
    throw new TypeError("durable Web Computer context accessors are required");
  }
  let ownerCoordinator = null;
  let ownerToken = null;
  let initialized = false;
  let disposed = false;
  let startupMode = "none";
  let durabilityState = "unconfigured";
  let durabilityError = null;
  let cleanupPending = false;
  let lastPrune = null;
  let cleanupError = null;
  let commitCoordinator = null;
  let envelopeCoordinator = null;
  let lifecycleState = durability ? "registered" : "unconfigured";
  let lastSuspend = null;
  let lastResume = null;
  let resolvedLockManager = null;
  let resolvedOwnerId = null;

  if (durability) {
    if (!durability.store) throw new TypeError("durability.store is required");
    if (!durability.groupId || typeof durability.groupId !== "string") throw new TypeError("durability.groupId is required");
    resolvedLockManager = durability.lockManager ?? globalThis.navigator?.locks;
    if (!resolvedLockManager || typeof resolvedLockManager.request !== "function") throw new TypeError("durability.lockManager is required");
    const machineCrypto = createMachineCryptoProvider(cryptoProvider);
    const nowFactory = durability.nowFactory ?? (() => Date.now());
    commitCoordinator = new MachineCommitCoordinator({
      store: durability.store,
      cryptoProvider: machineCrypto,
      nowFactory,
    });
    envelopeCoordinator = new MachineEnvelopeCoordinator({ cryptoProvider: machineCrypto, nowFactory });
    resolvedOwnerId = durability.ownerId ?? cryptoProvider?.randomUUID?.();
    if (!resolvedOwnerId) throw new TypeError("durability.ownerId is required when cryptoProvider.randomUUID is unavailable");
    durabilityState = "clean";
  }

  const createOwnerCoordinator = () => new WebLockOwnerCoordinator({
    lockManager: resolvedLockManager,
    ownerStore: durability.store,
    groupId: durability.groupId,
    ownerId: resolvedOwnerId,
    onAcquired: (token) => {
      ownerToken = token;
      getActive().adoptOwnership(token);
      durability.onOwnerChanged?.(Object.freeze({ state: "acquired", token }));
    },
    onLost: (_token, reason) => {
      getActive().invalidateOwnership(reason);
      ownerToken = null;
      durability.onOwnerChanged?.(Object.freeze({ state: "lost", reason }));
    },
  });

  const assertLive = () => {
    if (disposed) throw new WebMachineError("WEB_MACHINE_COMPUTER_DISPOSED", "The Web Computer is disposed");
  };
  const assertOwned = () => {
    const config = requireDurability(durability);
    if (!initialized || !ownerToken) {
      throw new WebMachineError("WEB_MACHINE_OWNER_STATE", `${config.groupId}: initialize() must acquire ownership first`);
    }
    return config;
  };
  const assertHot = () => {
    const config = assertOwned();
    if (lifecycleState !== "hot") {
      throw new WebMachineError("WEB_MACHINE_SUSPEND_STATE", `${config.groupId}: operation requires hot state, got ${lifecycleState}`);
    }
    return config;
  };

  const prune = async (config, control) => {
    try {
      lastPrune = await commitCoordinator.pruneRecoveryWindow({
        groupId: config.groupId,
        ownerToken,
        control,
      });
      cleanupPending = false;
    } catch (error) {
      cleanupPending = true;
      lastPrune = Object.freeze({ error: error?.code || String(error) });
    }
    return lastPrune;
  };

  const commitPausedComputer = async (computer, config, control) => {
    const expectedHead = (await commitCoordinator.readHead(config.groupId))?.head || null;
    return commitCoordinator.commitPaused({
      groupId: config.groupId,
      machines: computer.machines.values(),
      devices: blockDevices(computer),
      expectedHead,
      ownerToken,
      environmentFingerprint: config.environmentFingerprint ?? null,
      control,
    });
  };

  const save = async (control) => {
    assertLive();
    const config = assertHot();
    const computer = getActive();
    try {
      const committed = await withPaused(computer, control, () => commitPausedComputer(computer, config, control));
      await prune(config, control);
      durabilityState = "clean";
      durabilityError = null;
      return Object.freeze({ ...committed, retention: lastPrune, cleanupPending });
    } catch (error) {
      durabilityState = "unsaved";
      durabilityError = error;
      throw error;
    }
  };

  const inspect = () => {
    const computer = inspectComputer(getActive());
    return Object.freeze({
      ...computer,
      owner: ownerCoordinator?.inspect() || null,
      startupMode,
      lifecycleState,
      persistence: Object.freeze({
        configured: !!durability,
        environmentFingerprint: durability?.environmentFingerprint ?? null,
        durabilityState,
        durabilityError: durabilityError ? durabilityError?.code || String(durabilityError) : null,
        cleanupPending,
        lastPrune,
        cleanupError: cleanupError ? cleanupError?.code || String(cleanupError) : null,
        lastSuspend,
        lastResume,
      }),
    });
  };

  const initialize = async ({
    deferBoot = false,
    control,
    ownerControl = control,
    restoreControl = control,
    resumeControl = control,
    pruneControl = control,
  } = {}) => {
    assertLive();
    const config = requireDurability(durability);
    if (initialized) throw new WebMachineError("WEB_MACHINE_OWNER_STATE", `${config.groupId}: computer is already initialized`);
    if (lifecycleState === "cleanupIncomplete") {
      throw new WebMachineError("WEB_MACHINE_SUSPEND_CLEANUP_INCOMPLETE", `${config.groupId}: cleanup must be resolved before resume`);
    }
    lifecycleState = "waking";
    ownerCoordinator = createOwnerCoordinator();
    try {
      await ownerCoordinator.start(ownerControl);
      initialized = true;
      if (deferBoot) {
        startupMode = "deferred";
        lifecycleState = "hot";
        return inspect();
      }
      const head = await commitCoordinator.readHead(config.groupId);
      if (head?.head) {
        const computer = getActive();
        const restored = await commitCoordinator.restoreLatest({
          groupId: config.groupId,
          machines: computer.machines,
          devices: blockDevices(computer),
          expectedEnvironmentFingerprint: config.environmentFingerprint ?? null,
          control: restoreControl,
        });
        await computer.resumeAll(resumeControl);
        startupMode = "restored";
        lastResume = Object.freeze({
          generationId: restored.generationId,
          recoveredFrom: restored.recoveredFrom,
          environmentFingerprint: config.environmentFingerprint ?? null,
        });
        await prune(config, pruneControl);
      } else {
        await getActive().bootAll(restoreControl);
        startupMode = "booted";
        lastResume = Object.freeze({
          generationId: null,
          recoveredFrom: null,
          environmentFingerprint: config.environmentFingerprint ?? null,
        });
      }
      lifecycleState = "hot";
      return inspect();
    } catch (error) {
      initialized = false;
      ownerToken = null;
      lifecycleState = "failed";
      await ownerCoordinator?.stop("initialization failed").catch(() => undefined);
      throw error;
    }
  };

  const suspend = async ({ safety, control, pruneControl = control, shutdownControl = control } = {}) => {
    assertLive();
    const config = assertHot();
    normalizeSuspendSafety(safety);
    const computer = getActive();
    const runningIds = computer.runningMachineIds();
    lifecycleState = "draining";
    try {
      await computer.pauseRunning(control);
    } catch (error) {
      lifecycleState = "hot";
      throw error;
    }
    let committed;
    try {
      lifecycleState = "committing";
      committed = await commitPausedComputer(computer, config, control);
      const durableHead = await commitCoordinator.readHead(config.groupId);
      if (durableHead?.head !== committed.commitAddress) {
        throw new WebMachineError(
          "WEB_MACHINE_SUSPEND_COMMIT_UNVERIFIED",
          `${config.groupId}: committed generation is not the durable HEAD`,
          { committed: committed.commitAddress, head: durableHead?.head || null },
        );
      }
      const actualFingerprint = committed.commit.env?.h0 ?? null;
      const expectedFingerprint = config.environmentFingerprint ?? null;
      if (actualFingerprint !== expectedFingerprint) {
        throw new WebMachineError(
          "WEB_MACHINE_ENVIRONMENT_MISMATCH",
          `${config.groupId}: committed environment fingerprint does not match`,
          { expectedFingerprint, actualFingerprint },
        );
      }
    } catch (error) {
      durabilityState = "unsaved";
      durabilityError = error;
      lifecycleState = "hot";
      try { await computer.resumeMachineIds(runningIds, control); }
      catch (resumeError) {
        lifecycleState = "failed";
        throw new AggregateError([error, resumeError], "Web Computer suspend commit and rollback both failed");
      }
      throw error;
    }
    await prune(config, pruneControl);
    lifecycleState = "stopping";
    try {
      await computer.shutdownAll(shutdownControl);
      await ownerCoordinator.stop("computer suspended");
    } catch (error) {
      cleanupPending = true;
      cleanupError = error;
      lifecycleState = "cleanupIncomplete";
      lastSuspend = Object.freeze({
        terminal: "cleanupIncomplete",
        generationId: committed.commitAddress,
        environmentFingerprint: config.environmentFingerprint ?? null,
        error: error?.code || String(error),
      });
      throw new WebMachineError(
        "WEB_MACHINE_SUSPEND_CLEANUP_INCOMPLETE",
        `${config.groupId}: generation is durable but runtime cleanup is incomplete`,
        { generationId: committed.commitAddress, cause: error?.code || String(error) },
      );
    }
    ownerToken = null;
    initialized = false;
    lifecycleState = "cold";
    startupMode = "cold";
    durabilityState = "clean";
    durabilityError = null;
    cleanupError = null;
    lastSuspend = Object.freeze({
      terminal: "suspended",
      generationId: committed.commitAddress,
      environmentFingerprint: config.environmentFingerprint ?? null,
    });
    return Object.freeze({ ...lastSuspend, retention: lastPrune, cleanupPending });
  };

  const retrySuspendCleanup = async (control) => {
    assertLive();
    const config = requireDurability(durability);
    if (lifecycleState !== "cleanupIncomplete" || !lastSuspend?.generationId) {
      throw new WebMachineError(
        "WEB_MACHINE_SUSPEND_STATE",
        `${config.groupId}: there is no incomplete suspend cleanup to retry`,
      );
    }
    try {
      await getActive().shutdownAll(control);
      await ownerCoordinator?.stop("suspend cleanup retried");
    } catch (error) {
      cleanupPending = true;
      cleanupError = error;
      lastSuspend = Object.freeze({ ...lastSuspend, error: error?.code || String(error) });
      throw new WebMachineError(
        "WEB_MACHINE_SUSPEND_CLEANUP_INCOMPLETE",
        `${config.groupId}: runtime cleanup is still incomplete`,
        { generationId: lastSuspend.generationId, cause: error?.code || String(error) },
      );
    }
    ownerToken = null;
    initialized = false;
    lifecycleState = "cold";
    startupMode = "cold";
    cleanupPending = false;
    cleanupError = null;
    durabilityState = "clean";
    durabilityError = null;
    lastSuspend = Object.freeze({
      terminal: "suspended",
      generationId: lastSuspend.generationId,
      environmentFingerprint: config.environmentFingerprint ?? null,
    });
    return lastSuspend;
  };

  return Object.freeze({
    initialize,
    resume: initialize,
    save,
    suspend,
    retrySuspendCleanup,
    async exportImage({ signingKeyPair, requiredCapabilities, control } = {}) {
      assertLive();
      const config = assertHot();
      const computer = getActive();
      const pair = await resolveSigningKeyPair(config, signingKeyPair);
      return withPaused(computer, control, () => envelopeCoordinator.exportPaused({
        groupId: config.groupId,
        machines: computer.machines.values(),
        devices: blockDevices(computer),
        requiredCapabilities: requiredCapabilities ?? config.requiredCapabilities ?? {},
        signingKeyPair: pair,
        control,
      }));
    },
    async importImage(file, {
      trustedPublicKeys,
      approvedPermissions,
      availableCapabilities,
      control,
    } = {}) {
      assertLive();
      const config = assertHot();
      if (!approvedPermissions) throw new TypeError("importImage: approvedPermissions is required");
      const archive = await envelopeCoordinator.read({ file, trustedPublicKeys, control });
      const current = getActive();
      const runningIds = current.runningMachineIds();
      await current.pauseRunning(control);
      let candidate = null;
      let swapped = false;
      try {
        candidate = createCandidate();
        const imported = await envelopeCoordinator.importVerified({
          archive,
          host: candidate.host,
          devices: blockDevices(candidate),
          approvedPermissions,
          availableCapabilities: availableCapabilities ?? config.availableCapabilities ?? [],
          ownerToken,
          control,
        });
        candidate.adoptMachines(imported.machines);
        // Candidate가 실제로 실행 가능한지 active 교체 전에 확인한다. 이어지는 pause/commit이
        // 실패하면 current를 다시 실행하고 pointer와 HEAD를 모두 그대로 둔다.
        await candidate.resumeAll(control);
        const committed = await withPaused(candidate, control,
          () => commitPausedComputer(candidate, config, control));
        setActive(candidate);
        swapped = true;
        startupMode = "imported";
        durabilityState = "clean";
        durabilityError = null;
        cleanupError = null;
        try { await current.shutdownAll(control); }
        catch (error) { cleanupError = error; }
        await prune(config, control);
        return Object.freeze({ archive, machines: imported.machines, committed, cleanupError });
      } catch (error) {
        if (!swapped) {
          if (candidate) await candidate.shutdownAll().catch(() => undefined);
          try { await current.resumeMachineIds(runningIds); }
          catch (resumeError) {
            throw new AggregateError([error, resumeError], "Web Computer import and rollback both failed");
          }
        }
        throw error;
      }
    },
    inspect,
    async dispose(control) {
      if (disposed) return;
      disposed = true;
      let failure = null;
      try { await getActive().shutdownAll(control); }
      catch (error) { failure = error; }
      try { await ownerCoordinator?.stop("computer disposed"); }
      catch (error) { failure ||= error; }
      ownerToken = null;
      initialized = false;
      lifecycleState = "disposed";
      if (failure) throw failure;
    },
  });
}
