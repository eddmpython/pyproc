// appSpaceCoordinator.js - app fence, Machine checkpoint, paired marker, restore와 effect outbox를 조립한다.
import { randomBytes } from "node:crypto";
import { canonicalExecutionMemoryJson } from "../executionMemory/executionMemoryCanonical.js";
import { appSpaceError, validateAppIdentity } from "./appSpaceCanonical.js";

function sameIdentity(left, right) {
  return canonicalExecutionMemoryJson(left) === canonicalExecutionMemoryJson(right);
}

function machineLink(checkpoint, captured) {
  return Object.freeze({ checkpointIndex: checkpoint.index, imageSha256: captured.imageSha256,
    generation: captured.generation, environment: captured.environment });
}

export class AppSpaceCoordinator {
  constructor({ registry, memoryProduct, effectProduct, automationRouter, pageBridge, allowedApps = [] } = {}) {
    if (!registry || !memoryProduct?.registry || !pageBridge?.dispatch || automationRouter?.providerKind !== "frame") {
      throw new TypeError("AppSpace requires registry, Execution Memory, FrameSpace, and Machine bridge");
    }
    this.registry = registry;
    this.memory = memoryProduct;
    this.effects = effectProduct || null;
    this.automation = automationRouter;
    this.pageBridge = pageBridge;
    this.allowedApps = new Map(allowedApps.map((identity) => [identity.appId, validateAppIdentity(identity)]));
    this.attachments = new Map();
    this.restoreProofs = new Map();
  }

  async attach(input, context = {}) {
    const described = await this._dispatch("app.describe", { sessionRef: input.sessionRef }, context, "attach");
    const allowed = this.allowedApps.get(described.identity?.appId);
    if (!allowed || !sameIdentity(allowed, described.identity)) {
      throw appSpaceError("APP_SPACE_IDENTITY_MISMATCH", "cooperative app identity is not configured");
    }
    const targets = await this.automation.invoke("automation.target.list", {}, context);
    const target = targets.find((entry) => entry.targetRef === input.sessionRef.targetRef);
    if (!target || new URL(target.url).origin !== allowed.origin) {
      throw appSpaceError("APP_SPACE_IDENTITY_MISMATCH", "live FrameSpace target origin differs from app identity");
    }
    const appRef = this.registry.createAppRef();
    this.attachments.set(appRef, Object.freeze({ appRef, sessionRef: structuredClone(input.sessionRef), identity: allowed }));
    return Object.freeze({ appRef, identity: allowed, revision: described.revision,
      capabilities: Object.freeze([...described.capabilities]), isolation: "credentialless-opaque-frame" });
  }

  async checkpoint(input, context = {}) {
    return this._capture(input, context, { activate: true, source: "control.app.checkpoint" });
  }

  async branch(input, context = {}) {
    const parent = await this.registry.openPair(input.parentPairId);
    return this._capture(input, context, { activate: false, parentPairSha256: parent.contentSha256,
      source: "control.app.branch" });
  }

  async restore(input, context = {}) {
    const pair = await this.registry.openPair(input.pairId);
    const restored = await this._restorePair(this._attachment(input.appRef), pair, context);
    const restoreProof = this._issueRestoreProof(input.appRef, pair, restored.result);
    return Object.freeze({ pair, restored: restored.result, restoreProof, activeChanged: false });
  }

  consumeRestoreProof(restoreRef, pairSha256) {
    const proof = this.restoreProofs.get(restoreRef);
    this.restoreProofs.delete(restoreRef);
    if (!proof || proof.pairSha256 !== pairSha256) {
      throw appSpaceError("APP_SPACE_RESTORE_PROOF_INVALID", "restore proof is missing, stale, or belongs to another pair");
    }
    return proof;
  }

  async adopt(input, context = {}) {
    const pair = await this.registry.openPair(input.pairId);
    const entry = this._attachment(input.appRef);
    const restored = await this._restorePair(entry, pair, context, { deferResume: true });
    let headMoved = false;
    try {
      const adopted = await this.registry.adopt(pair.pairId, input.expectedActivePairSha256);
      headMoved = true;
      await restored.finish();
      return Object.freeze({ pair: adopted, restored: restored.result, activeChanged: true });
    } catch (error) {
      try {
        await restored.rollback();
        if (headMoved) {
          await this.registry.store.moveActive(entry.identity.appId, pair.contentSha256,
            input.expectedActivePairSha256);
        }
      } catch (rollbackError) {
        throw appSpaceError("APP_SPACE_ROLLBACK_FAILED", "adopt failed and paired rollback did not complete", {
          operationCode: error?.code || null, rollbackCode: rollbackError?.code || null,
        }, "outcomeUnknown");
      }
      throw error;
    }
  }

  async inspect(input, context = {}) {
    const entry = this._attachment(input.appRef);
    const described = await this._dispatch("app.describe", { sessionRef: entry.sessionRef }, context, "inspect");
    return Object.freeze({ appRef: entry.appRef, identity: entry.identity, live: described,
      active: await this.registry.active(entry.identity.appId) });
  }

  list() { return this.registry.list(); }

  async stageEffect(input, context = {}) {
    if (!this.effects?.registry) throw appSpaceError("APP_SPACE_EFFECT_UNAVAILABLE", "Rehearse-Commit is not enabled");
    const entry = this._attachment(input.appRef);
    const transaction = await this.effects.registry.openTransaction(input.transactionId);
    if (transaction.contentSha256 !== input.expectedTransactionRevisionSha256
      || !["prepared", "rehearsed", "approved"].includes(transaction.state)) {
      throw appSpaceError("APP_SPACE_EFFECT_INVALID", "effect transaction is stale or cannot be staged");
    }
    const result = await this._dispatch("app.stageEffect", { sessionRef: entry.sessionRef, effect: {
      transactionId: transaction.transactionId, intentSha256: transaction.intent.contentSha256,
      destination: transaction.intent.destination, risk: transaction.intent.risk,
    } }, context, "effect-stage");
    return Object.freeze({ transactionId: transaction.transactionId,
      intentSha256: transaction.intent.contentSha256, appRevision: result.revision, sent: false });
  }

  async finalizeEffect(input, context = {}) {
    if (!this.effects?.registry) throw appSpaceError("APP_SPACE_EFFECT_UNAVAILABLE", "Rehearse-Commit is not enabled");
    const entry = this._attachment(input.appRef);
    const transaction = await this.effects.registry.openTransaction(input.transactionId);
    if (transaction.contentSha256 !== input.expectedTransactionRevisionSha256
      || !["terminal", "sealed"].includes(transaction.state)) {
      throw appSpaceError("APP_SPACE_EFFECT_INVALID", "only an exact terminal effect can finalize the outbox");
    }
    const result = await this._dispatch("app.finalizeEffect", { sessionRef: entry.sessionRef, effect: {
      transactionId: transaction.transactionId, intentSha256: transaction.intent.contentSha256,
      terminal: transaction.effectResult.terminal,
      effectReceiptSha256: transaction.receipt?.contentSha256 || null,
    } }, context, "effect-finalize");
    return Object.freeze({ transactionId: transaction.transactionId, terminal: transaction.effectResult.terminal,
      effectReceiptSha256: transaction.receipt?.contentSha256 || null, appRevision: result.revision });
  }

  async _capture(input, context, { activate, parentPairSha256 = undefined, source }) {
    const entry = this._attachment(input.appRef);
    const session = await this.memory.registry.openSession(input.executionSessionId);
    if (session.contentSha256 !== input.expectedSessionRevisionSha256 || session.work.outcomeUnknown
      || !["active", "waitingApproval"].includes(session.work.state)) {
      throw appSpaceError("APP_SPACE_SESSION_CONFLICT", "Execution Session is stale or unsafe");
    }
    const currentActive = await this.registry.active(entry.identity.appId);
    const expectedActive = input.expectedActivePairSha256 ?? null;
    if ((currentActive?.contentSha256 || null) !== expectedActive) {
      throw appSpaceError("APP_SPACE_HEAD_CONFLICT", "active paired generation changed");
    }
    const parent = parentPairSha256 === undefined ? expectedActive : parentPairSha256;
    if (!activate && parent !== expectedActive) {
      throw appSpaceError("APP_SPACE_HEAD_CONFLICT", "branch parent must be the current active pair");
    }
    const captured = await this._captureApp(entry, context);
    let operationError = null;
    try {
      const checkpoint = await this._dispatch("machine.checkpoint.save", {}, context, "machine-checkpoint");
      const machine = await this.memory.captureMachine(session.machine.machineId, context.signal,
        `${context.requestId || input.pairId}:app-pair`);
      const pair = await this.registry.createCandidate({ pairId: input.pairId, parentPairSha256: parent,
        snapshot: captured.snapshot, machine: machineLink(checkpoint, machine),
        session: { executionSessionId: session.executionSessionId, revisionSha256: session.contentSha256 }, source });
      if (activate) await this.registry.store.adopt(entry.identity.appId, expectedActive, pair.contentSha256);
      return Object.freeze({ pair, active: activate });
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      try { await captured.resume(); }
      catch (resumeError) {
        throw appSpaceError("APP_SPACE_RESUME_FAILED", "app capture completed but the quiesce fence did not resume", {
          operationCode: operationError?.code || null, resumeCode: resumeError?.code || null,
        }, operationError ? "outcomeUnknown" : "notSent");
      }
    }
  }

  async _captureApp(entry, context) {
    const described = await this._dispatch("app.describe", { sessionRef: entry.sessionRef }, context, "describe");
    if (!sameIdentity(entry.identity, described.identity) || described.quiesced) {
      throw appSpaceError("APP_SPACE_STATE_INVALID", "app identity changed or app is already quiesced");
    }
    const fence = await this._dispatch("app.quiesce", { sessionRef: entry.sessionRef,
      expectedRevision: described.revision }, context, "quiesce");
    let resumed = false;
    const resume = async () => {
      if (resumed) return;
      resumed = true;
      await this._dispatch("app.resume", { sessionRef: entry.sessionRef, fence: fence.fence }, context, "resume");
    };
    try {
      const raw = await this._dispatch("app.export", { sessionRef: entry.sessionRef, fence: fence.fence,
        expectedRevision: fence.revision }, context, "export");
      const after = await this._dispatch("app.describe", { sessionRef: entry.sessionRef }, context, "recheck");
      if (after.revision !== raw.revision || !after.quiesced || !sameIdentity(entry.identity, raw.identity)) {
        throw appSpaceError("APP_SPACE_REVISION_CONFLICT", "app changed across the export fence");
      }
      return Object.freeze({ snapshot: this.registry.snapshot(raw), fence: fence.fence, resume });
    } catch (error) {
      try { await resume(); }
      catch (resumeError) {
        throw appSpaceError("APP_SPACE_RESUME_FAILED", "app export failed and the quiesce fence did not resume", {
          operationCode: error?.code || null, resumeCode: resumeError?.code || null,
        }, "outcomeUnknown");
      }
      throw error;
    }
  }

  async _restorePair(entry, pair, context, { deferResume = false } = {}) {
    if (!sameIdentity(entry.identity, pair.app.identity)) throw appSpaceError("APP_SPACE_IDENTITY_MISMATCH", "pair identity differs from attached app");
    const rollbackApp = await this._captureApp(entry, context);
    const rollbackMachine = await this._dispatch("machine.checkpoint.save", {}, context, "rollback-checkpoint");
    let completed = false;
    const restoreSnapshot = async (snapshot, checkpointIndex, label) => {
      const imported = await this._dispatch("app.import", { sessionRef: entry.sessionRef,
        fence: rollbackApp.fence, snapshot }, context, `${label}-app`);
      const raw = await this._dispatch("app.export", { sessionRef: entry.sessionRef,
        fence: rollbackApp.fence, expectedRevision: imported.revision }, context, `${label}-verify`);
      const verified = this.registry.snapshot(raw);
      if (verified.stateSha256 !== snapshot.stateSha256
        || canonicalExecutionMemoryJson(verified.outbox) !== canonicalExecutionMemoryJson(snapshot.outbox)) {
        throw appSpaceError("APP_SPACE_RESTORE_MISMATCH", "restored app state differs from the paired snapshot");
      }
      await this._dispatch("machine.checkpoint.restore", { index: checkpointIndex }, context, `${label}-machine`);
      return Object.freeze({ appRevision: imported.revision, stateSha256: verified.stateSha256,
        machineCheckpointIndex: checkpointIndex });
    };
    const rollback = async () => {
      if (completed) return;
      try { await restoreSnapshot(rollbackApp.snapshot, rollbackMachine.index, "rollback"); }
      finally {
        await rollbackApp.resume();
        completed = true;
      }
    };
    const finish = async () => {
      if (completed) return;
      await rollbackApp.resume();
      completed = true;
    };
    try {
      const result = await restoreSnapshot(pair.app, pair.machine.checkpointIndex, "restore");
      if (!deferResume) await finish();
      return Object.freeze({ result, rollback, finish });
    } catch (error) {
      try { await rollback(); }
      catch (rollbackError) {
        throw appSpaceError("APP_SPACE_ROLLBACK_FAILED", "restore failed and paired rollback did not complete", {
          operationCode: error?.code || null, rollbackCode: rollbackError?.code || null,
        }, "outcomeUnknown");
      }
      throw error;
    }
  }

  _attachment(appRef) {
    const entry = this.attachments.get(appRef);
    if (!entry) throw appSpaceError("APP_SPACE_ATTACHMENT_INVALID", `app attachment is unavailable: ${appRef}`);
    return entry;
  }

  _issueRestoreProof(appRef, pair, restored) {
    const restoreRef = `restore:${randomBytes(16).toString("hex")}`;
    const proof = Object.freeze({ restoreRef, appRef, pairId: pair.pairId, pairSha256: pair.contentSha256,
      stateSha256: restored.stateSha256, machineCheckpointIndex: restored.machineCheckpointIndex });
    this.restoreProofs.set(restoreRef, proof);
    return proof;
  }

  _dispatch(operation, input, context, suffix) {
    return this.pageBridge.dispatch(operation, input, { signal: context.signal,
      requestId: `${context.requestId || "app"}:${suffix}` });
  }
}
