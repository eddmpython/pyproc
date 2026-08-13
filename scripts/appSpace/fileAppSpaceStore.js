// fileAppSpaceStore.js - immutable paired candidate, completion marker, active app HEAD의 durable store.
import { isAbsolute, resolve } from "node:path";
import { FileExecutionMemoryStore } from "../executionMemory/fileExecutionMemoryStore.js";
import { appSpaceDigest, appSpaceError, pairedGenerationBytes, validatePairedGeneration }
  from "./appSpaceCanonical.js";

export class FileAppSpaceStore {
  static async open(rootInput) {
    if (typeof rootInput !== "string" || !isAbsolute(rootInput)) throw new TypeError("AppSpace root must be absolute");
    return new FileAppSpaceStore(await FileExecutionMemoryStore.open(resolve(rootInput, "appSpace")));
  }

  constructor(store) {
    this.store = store;
    this.root = store.root;
  }

  async publishCandidate(pair, expectedMarker = null) {
    validatePairedGeneration(pair);
    await this.store.writeObject(pair.contentSha256, pairedGenerationBytes(pair));
    try { await this.store.compareAndSwapHead(`pairMarker:${pair.pairId}`, expectedMarker, pair.contentSha256); }
    catch (error) { throw this._translate(error, pair.pairId); }
    return pair;
  }

  async readPair(pairId) {
    const digest = await this.store.readHead(`pairMarker:${pairId}`);
    if (!digest) return null;
    return this.readDigest(digest);
  }

  async readDigest(digest) {
    const bytes = await this.store.readObject(digest);
    if (!bytes || appSpaceDigest(JSON.parse(bytes.toString("utf8"))) !== digest) {
      throw appSpaceError("APP_SPACE_OBJECT_MISSING", `paired generation is unavailable: ${digest}`);
    }
    return validatePairedGeneration({ ...JSON.parse(bytes.toString("utf8")), contentSha256: digest });
  }

  async activeDigest(appId) {
    return this.store.readHead(`appHead:${appId}`);
  }

  async adopt(appId, expectedDigest, nextDigest) {
    return this.moveActive(appId, expectedDigest, nextDigest);
  }

  async moveActive(appId, expectedDigest, nextDigest) {
    let pair = null;
    if (nextDigest !== null) {
      pair = await this.readDigest(nextDigest);
      if (pair.app.identity.appId !== appId) {
        throw appSpaceError("APP_SPACE_IDENTITY_MISMATCH", "pair belongs to another app");
      }
    }
    try { await this.store.compareAndSwapHead(`appHead:${appId}`, expectedDigest, nextDigest); }
    catch (error) { throw this._translate(error, appId); }
    return pair;
  }

  async active(appId) {
    const digest = await this.activeDigest(appId);
    return digest ? this.readDigest(digest) : null;
  }

  async listPairs() {
    const ids = (await this.store.listSessionIds()).filter((entry) => entry.startsWith("pairMarker:pair:"));
    const pairs = [];
    for (const id of ids) pairs.push(await this.readPair(id.slice("pairMarker:".length)));
    return Object.freeze(pairs.sort((left, right) => left.pairId < right.pairId ? -1 : left.pairId > right.pairId ? 1 : 0));
  }

  _translate(error, subject) {
    if (error?.code === "EXECUTION_MEMORY_HEAD_CONFLICT") {
      return appSpaceError("APP_SPACE_HEAD_CONFLICT", `AppSpace HEAD changed: ${subject}`, error.details);
    }
    if (error?.code === "EXECUTION_MEMORY_BUSY") return appSpaceError("APP_SPACE_BUSY", `AppSpace writer is active: ${subject}`);
    return error;
  }
}
