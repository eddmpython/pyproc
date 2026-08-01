// durableWebComputer.js - Layer 5/composition: 컴퓨터의 보편 내구 수명주기.
//
// 제품은 store/group/lock, signer 승인, guest 자산을 정한다. 이 파일은 제품마다 같아야 하는
// 순서만 소유한다: owner claim -> restore-or-boot, pause -> flush/snapshot -> fenced commit ->
// resume, signed export, 검증된 candidate import와 원자적 active-context 교체, dispose.
import { WebMachineError } from "../contracts/webMachineError.js";
import { MachineEnvelopeCoordinator } from "../image/machineEnvelopeCoordinator.js";
import { MachineCommitCoordinator } from "../persistence/machineCommitCoordinator.js";
import { WebLockOwnerCoordinator } from "../coordination/webLockOwnerCoordinator.js";
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

  if (durability) {
    if (!durability.store) throw new TypeError("durability.store is required");
    if (!durability.groupId || typeof durability.groupId !== "string") throw new TypeError("durability.groupId is required");
    const lockManager = durability.lockManager ?? globalThis.navigator?.locks;
    if (!lockManager || typeof lockManager.request !== "function") throw new TypeError("durability.lockManager is required");
    const machineCrypto = createMachineCryptoProvider(cryptoProvider);
    const nowFactory = durability.nowFactory ?? (() => Date.now());
    commitCoordinator = new MachineCommitCoordinator({
      store: durability.store,
      cryptoProvider: machineCrypto,
      nowFactory,
    });
    envelopeCoordinator = new MachineEnvelopeCoordinator({ cryptoProvider: machineCrypto, nowFactory });
    const ownerId = durability.ownerId ?? cryptoProvider?.randomUUID?.();
    if (!ownerId) throw new TypeError("durability.ownerId is required when cryptoProvider.randomUUID is unavailable");
    ownerCoordinator = new WebLockOwnerCoordinator({
      lockManager,
      ownerStore: durability.store,
      groupId: durability.groupId,
      ownerId,
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
    durabilityState = "clean";
  }

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
      control,
    });
  };

  const save = async (control) => {
    assertLive();
    const config = assertOwned();
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
      persistence: Object.freeze({
        configured: !!durability,
        durabilityState,
        durabilityError: durabilityError ? durabilityError?.code || String(durabilityError) : null,
        cleanupPending,
        lastPrune,
        cleanupError: cleanupError ? cleanupError?.code || String(cleanupError) : null,
      }),
    });
  };

  return Object.freeze({
    async initialize({
      deferBoot = false,
      control,
      ownerControl = control,
      restoreControl = control,
      resumeControl = control,
      pruneControl = control,
    } = {}) {
      assertLive();
      const config = requireDurability(durability);
      if (initialized) throw new WebMachineError("WEB_MACHINE_OWNER_STATE", `${config.groupId}: computer is already initialized`);
      try {
        await ownerCoordinator.start(ownerControl);
        initialized = true;
        if (deferBoot) {
          startupMode = "deferred";
          return inspect();
        }
        const head = await commitCoordinator.readHead(config.groupId);
        if (head?.head) {
          const computer = getActive();
          await commitCoordinator.restoreLatest({
            groupId: config.groupId,
            machines: computer.machines,
            devices: blockDevices(computer),
            control: restoreControl,
          });
          await computer.resumeAll(resumeControl);
          startupMode = "restored";
          await prune(config, pruneControl);
        } else {
          await getActive().bootAll(restoreControl);
          startupMode = "booted";
        }
        return inspect();
      } catch (error) {
        initialized = false;
        ownerToken = null;
        await ownerCoordinator?.stop("initialization failed").catch(() => undefined);
        throw error;
      }
    },
    save,
    async exportImage({ signingKeyPair, requiredCapabilities, control } = {}) {
      assertLive();
      const config = assertOwned();
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
      const config = assertOwned();
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
      if (failure) throw failure;
    },
  });
}
