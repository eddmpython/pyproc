// fileActuationStore.js - receipts, episodes, policy revisions를 immutable object와 CAS HEAD로 보존한다.
import { resolve } from "node:path";
import { FileExecutionMemoryStore } from "../executionMemory/fileExecutionMemoryStore.js";
import {
  ACTUATION_ERROR_CODES,
  actuationError,
  assertActuationEpisode,
  assertActuationReceipt,
  assertPolicyRevision,
  canonicalActuationJson,
} from "./actuationCanonical.js";

const POLICY_HEAD = "motor.policy";
const bytes = (value) => Buffer.from(`${canonicalActuationJson(value)}\n`);

function parse(raw, label) {
  try { return JSON.parse(raw.toString("utf8")); }
  catch (error) { throw actuationError(ACTUATION_ERROR_CODES.receiptInvalid,
    `${label} bytes are not canonical JSON`); }
}

export class FileActuationStore {
  static async open(root) {
    const store = await FileExecutionMemoryStore.open(resolve(root, "actuation"));
    return new FileActuationStore(store);
  }

  constructor(store) { this.store = store; }

  async initializePolicy(policy) {
    assertPolicyRevision(policy);
    await this._write(policy.policySha256, policy);
    const current = await this.store.readHead(POLICY_HEAD);
    if (!current) await this.store.compareAndSwapHead(POLICY_HEAD, null, policy.policySha256);
    return this.policy();
  }

  async policy() {
    const digest = await this.store.readHead(POLICY_HEAD);
    if (!digest) throw actuationError(ACTUATION_ERROR_CODES.policyStale, "Motor policy HEAD is unavailable");
    return assertPolicyRevision(parse(await this._read(digest, "Motor policy"), "Motor policy"));
  }

  async movePolicy(expectedSha256, next) {
    assertPolicyRevision(next);
    await this._write(next.policySha256, next);
    try { await this.store.compareAndSwapHead(POLICY_HEAD, expectedSha256, next.policySha256); }
    catch (error) { throw actuationError(ACTUATION_ERROR_CODES.policyStale,
      "Motor policy changed before promotion", error?.details || null); }
    return next;
  }

  async rollbackPolicy(expectedSha256, previousSha256) {
    const previous = assertPolicyRevision(parse(await this._read(previousSha256, "previous Motor policy"),
      "previous Motor policy"));
    try { await this.store.compareAndSwapHead(POLICY_HEAD, expectedSha256, previous.policySha256); }
    catch (error) { throw actuationError(ACTUATION_ERROR_CODES.policyStale,
      "Motor policy changed before rollback", error?.details || null); }
    return previous;
  }

  async record(receipt, episode) {
    assertActuationReceipt(receipt);
    assertActuationEpisode(episode);
    if (episode.receiptSha256 !== receipt.receiptSha256) {
      throw actuationError(ACTUATION_ERROR_CODES.episodeInvalid, "episode does not reference the exact receipt");
    }
    await this._write(receipt.receiptSha256, receipt);
    await this._write(episode.episodeSha256, episode);
    await this._publish(`motor.receipt:${receipt.actuationRef}`, receipt.receiptSha256);
    await this._publish(`motor.episode:${episode.episodeRef}`, episode.episodeSha256);
    return Object.freeze({ receipt, episode });
  }

  async receipt(receiptSha256) {
    return assertActuationReceipt(parse(await this._read(receiptSha256, "ActuationReceipt"), "ActuationReceipt"));
  }

  async episode(episodeSha256) {
    return assertActuationEpisode(parse(await this._read(episodeSha256, "ActuationEpisode"), "ActuationEpisode"));
  }

  async journey(receiptSha256) {
    const receipt = await this.receipt(receiptSha256);
    const episodeIds = (await this.store.listSessionIds()).filter((id) => id.startsWith("motor.episode:"));
    const matches = [];
    for (const id of episodeIds) {
      const episodeSha256 = await this.store.readHead(id);
      const episode = await this.episode(episodeSha256);
      if (episode.receiptSha256 === receipt.receiptSha256) matches.push(episode);
    }
    if (matches.length !== 1) throw actuationError(ACTUATION_ERROR_CODES.episodeInvalid,
      "Motor receipt must resolve to one exact episode");
    return Object.freeze({ receipt, episode: matches[0] });
  }

  async list() {
    const ids = (await this.store.listSessionIds()).filter((id) => id.startsWith("motor.receipt:"));
    const output = [];
    for (const id of ids) {
      const receiptSha256 = await this.store.readHead(id);
      const receipt = await this.receipt(receiptSha256);
      output.push(Object.freeze({ actuationRef: receipt.actuationRef, receiptSha256,
        terminal: receipt.terminal, intentSha256: receipt.intentSha256, selectedActuator: receipt.decision.selectedActuator }));
    }
    return Object.freeze(output.sort((left, right) => left.actuationRef < right.actuationRef ? -1
      : left.actuationRef > right.actuationRef ? 1 : 0));
  }

  async _write(digest, value) { await this.store.writeObject(digest, bytes(value)); }

  async _read(digest, label) {
    const raw = await this.store.readObject(digest);
    if (!raw) throw actuationError(ACTUATION_ERROR_CODES.receiptInvalid, `${label} is unavailable: ${digest}`);
    return raw;
  }

  async _publish(id, digest) {
    const current = await this.store.readHead(id);
    if (current === digest) return;
    if (current) throw actuationError(ACTUATION_ERROR_CODES.receiptInvalid, `${id} already names another object`);
    await this.store.compareAndSwapHead(id, null, digest);
  }
}
