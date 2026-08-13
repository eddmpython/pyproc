// appSpaceRegistry.js - paired candidate marker와 active app HEAD 전이를 소유한다.
import { randomBytes } from "node:crypto";
import { createAppStateSnapshot, createPairedGeneration, appSpaceError, validateAppIdentity,
  validateAppStateSnapshot }
  from "./appSpaceCanonical.js";
import { FileAppSpaceStore } from "./fileAppSpaceStore.js";

function nowIso(now) { return new Date(now()).toISOString(); }

export class AppSpaceRegistry {
  static async open(options = {}) {
    return new AppSpaceRegistry({ store: await FileAppSpaceStore.open(options.root),
      now: options.now, secretValues: options.secretValues, maxStateBytes: options.maxStateBytes });
  }

  constructor({ store, now = () => Date.now(), secretValues = [], maxStateBytes = 1024 * 1024 } = {}) {
    if (!(store instanceof FileAppSpaceStore)) throw new TypeError("AppSpaceRegistry requires its file store");
    this.store = store;
    this.now = now;
    this.secretValues = Object.freeze([...secretValues]);
    this.maxStateBytes = maxStateBytes;
  }

  snapshot(value) {
    return createAppStateSnapshot(value, { secretValues: this.secretValues, maxStateBytes: this.maxStateBytes });
  }

  async createCandidate({ pairId, parentPairSha256, snapshot, machine, session, source = "control" }) {
    if (await this.store.readPair(pairId)) throw appSpaceError("APP_SPACE_PAIR_EXISTS", `pair already exists: ${pairId}`);
    if (parentPairSha256 !== null) {
      const parent = await this.store.readDigest(parentPairSha256);
      if (parent.app.identity.appId !== snapshot.identity.appId) {
        throw appSpaceError("APP_SPACE_IDENTITY_MISMATCH", "pair parent belongs to another app");
      }
    }
    const pair = createPairedGeneration({ pairId, parentPairSha256, app: snapshot, machine, session,
      createdAt: nowIso(this.now), source });
    return this.store.publishCandidate(pair);
  }

  async adopt(pairId, expectedActivePairSha256) {
    const pair = await this.openPair(pairId);
    return this.store.adopt(pair.app.identity.appId, expectedActivePairSha256, pair.contentSha256);
  }

  async openPair(pairId) {
    const pair = await this.store.readPair(pairId);
    if (!pair) throw appSpaceError("APP_SPACE_PAIR_NOT_FOUND", `pair is unavailable: ${pairId}`);
    return this._validatePair(pair);
  }

  async active(appId) {
    const pair = await this.store.active(appId);
    return pair ? this._validatePair(pair) : null;
  }

  async list() {
    const rows = [];
    for (const stored of await this.store.listPairs()) {
      const pair = this._validatePair(stored);
      rows.push(Object.freeze({ pairId: pair.pairId, contentSha256: pair.contentSha256,
        parentPairSha256: pair.parentPairSha256, appId: pair.app.identity.appId,
        appRevision: pair.app.revision, stateSha256: pair.app.stateSha256,
        machineGeneration: pair.machine.generation, outbox: pair.app.outbox.length,
        active: await this.store.activeDigest(pair.app.identity.appId) === pair.contentSha256 }));
    }
    return Object.freeze(rows);
  }

  createAppRef() { return `app:${randomBytes(16).toString("hex")}`; }

  _validatePair(pair) {
    validateAppStateSnapshot(pair.app, { secretValues: this.secretValues,
      maxStateBytes: this.maxStateBytes });
    return pair;
  }
}

export async function createAppSpaceRegistry(options) { return AppSpaceRegistry.open(options); }
export { validateAppIdentity };
