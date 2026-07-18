import { MachineCommitCoordinator, MachineEnvelopeCoordinator, createMachineCryptoProvider } from "/src/machine/index.js";
import { getOrCreateSigningIdentity } from "./identityStore.js";

async function withPausedContext(context, control, operation) {
  const runningIds = await context.pauseRunning(control);
  let result;
  let failure = null;
  try {
    result = await operation();
  } catch (error) {
    failure = error;
  }
  try {
    await context.resumeMachineIds(runningIds);
  } catch (resumeError) {
    if (failure) {
      throw new AggregateError([failure, resumeError], "Web Computer operation과 실행 상태 복구가 함께 실패");
    }
    throw resumeError;
  }
  if (failure) throw failure;
  return result;
}

export class WebComputerPersistence {
  constructor({ store, cryptoProvider, idFactory, nowFactory }) {
    this.store = store;
    const machineCrypto = createMachineCryptoProvider(cryptoProvider);
    this.commitCoordinator = new MachineCommitCoordinator({ store, cryptoProvider: machineCrypto, idFactory, nowFactory });
    this.envelopeCoordinator = new MachineEnvelopeCoordinator({ cryptoProvider: machineCrypto, nowFactory });
    this.cleanupPending = false;
    this.lastPrune = null;
  }

  readHead(groupId) {
    return this.commitCoordinator.readHead(groupId);
  }

  restoreLatest({ groupId, context, control }) {
    return this.commitCoordinator.restoreLatest({
      groupId,
      machines: context.machines,
      devices: context.blockDevices,
      control,
    });
  }

  async save({ groupId, context, ownerToken, control }) {
    return withPausedContext(context, control, async () => {
      const expectedHead = (await this.commitCoordinator.readHead(groupId))?.head || null;
      const committed = await this.commitCoordinator.commitPaused({
        groupId,
        machines: context.machines.values(),
        devices: context.blockDevices,
        expectedHead,
        ownerToken,
        control,
      });
      await this.pruneRecoveryWindow({ groupId, ownerToken, control });
      return Object.freeze({ ...committed, retention: this.lastPrune, cleanupPending: this.cleanupPending });
    });
  }

  async pruneRecoveryWindow({ groupId, ownerToken, control }) {
    try {
      this.lastPrune = await this.commitCoordinator.pruneRecoveryWindow({ groupId, ownerToken, control });
      this.cleanupPending = false;
    } catch (error) {
      this.cleanupPending = true;
      this.lastPrune = Object.freeze({ error: error?.code || String(error) });
    }
    return this.lastPrune;
  }

  async exportImage({ groupId, context, control }) {
    return withPausedContext(context, control, async () => {
      const signingKeyPair = await getOrCreateSigningIdentity();
      return this.envelopeCoordinator.exportPaused({
        groupId,
        machines: context.machines.values(),
        devices: context.blockDevices,
        requiredCapabilities: {
          pythonOs: ["pyproc"],
          linuxOs: ["x86-linux"],
        },
        signingKeyPair,
        control,
      });
    });
  }

  readImage({ file, trustedPublicKey, control }) {
    return this.envelopeCoordinator.read({ file, trustedPublicKeys: [trustedPublicKey], control });
  }

  preflightImport(options) {
    return this.envelopeCoordinator.preflightImport(options);
  }

  importVerified(options) {
    return this.envelopeCoordinator.importVerified(options);
  }

  inspectStorage() {
    return this.commitCoordinator.inspectStorage();
  }
}
