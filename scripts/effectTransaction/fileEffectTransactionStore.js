// fileEffectTransactionStore.js - transaction revision, nonce, trust domain, binding key의 durable 저장소.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { FileExecutionMemoryStore } from "../executionMemory/fileExecutionMemoryStore.js";
import {
  effectTransactionBytes,
  effectTransactionDigest,
  effectTransactionError,
  validateEffectTransactionRevision,
} from "./effectTransactionCanonical.js";
import { approvalAuthority } from "./approvalGrant.js";

function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }

async function exclusiveValue(file, factory, { binary = false } = {}) {
  try { return await readFile(file, binary ? undefined : "utf8"); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  const value = factory();
  try { await writeFile(file, value, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  return readFile(file, binary ? undefined : "utf8");
}

function secretMap(input) {
  const map = new Map();
  for (const [name, value] of input instanceof Map ? input : Object.entries(input || {})) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(String(name)) || typeof value !== "string" || Buffer.byteLength(value) < 8) {
      throw new TypeError(`effect secret binding is invalid: ${String(name)}`);
    }
    map.set(name, value);
  }
  return map;
}

export class FileEffectTransactionStore {
  static async open(rootInput, { approvalAuthorities = [], secretBindings = {} } = {}) {
    if (typeof rootInput !== "string" || !isAbsolute(rootInput)) {
      throw new TypeError("effect transaction root must be an absolute path");
    }
    const root = resolve(rootInput, "effectTransactions");
    const store = await FileExecutionMemoryStore.open(root);
    const identityDir = join(root, "identity");
    await mkdir(identityDir, { recursive: true });
    const domainId = String(await exclusiveValue(join(identityDir, "domain-id"),
      () => `${randomBytes(32).toString("hex")}\n`)).trim();
    if (!/^[0-9a-f]{64}$/.test(domainId)) {
      throw effectTransactionError("EFFECT_TRUST_DOMAIN_CORRUPT", "effect trust domain identity is corrupt");
    }
    const bindingKey = new Uint8Array(await exclusiveValue(join(identityDir, "binding-key.bin"),
      () => randomBytes(32), { binary: true }));
    if (bindingKey.byteLength !== 32) {
      throw effectTransactionError("EFFECT_TRUST_DOMAIN_CORRUPT", "effect binding key is corrupt");
    }
    const authorities = new Map();
    for (const entry of approvalAuthorities) {
      const authority = approvalAuthority(entry);
      if (authorities.has(authority.authorityId)) throw new TypeError(`duplicate approval authority: ${authority.authorityId}`);
      authorities.set(authority.authorityId, authority);
    }
    if (!authorities.size) throw new TypeError("effect transactions require at least one approval authority");
    const authorityIdentity = [...authorities.values()].map(({ authorityId, publicKeySha256 }) =>
      ({ authorityId, publicKeySha256 })).sort((a, b) => compareText(a.authorityId, b.authorityId));
    const trustDomainSha256 = effectTransactionDigest({ domainId, approvalAuthorities: authorityIdentity });
    return new FileEffectTransactionStore({ store, domainId, bindingKey, authorities, trustDomainSha256,
      secretBindings: secretMap(secretBindings) });
  }

  constructor({ store, domainId, bindingKey, authorities, trustDomainSha256, secretBindings }) {
    this.store = store;
    this.root = store.root;
    this.domainId = domainId;
    this.bindingKey = bindingKey;
    this.authorities = authorities;
    this.trustDomainSha256 = trustDomainSha256;
    this.secretBindings = secretBindings;
    this.secretValues = Object.freeze([...secretBindings.values()]);
  }

  async read(transactionId) {
    const head = await this.store.readHead(transactionId);
    if (!head) return null;
    const bytes = await this.store.readObject(head);
    if (!bytes || effectTransactionDigest(JSON.parse(bytes.toString("utf8"))) !== head) {
      throw effectTransactionError("EFFECT_TRANSACTION_OBJECT_MISSING", `transaction object is unavailable: ${head}`);
    }
    return validateEffectTransactionRevision({ ...JSON.parse(bytes.toString("utf8")), contentSha256: head });
  }

  async publish(transactionId, expectedSha256, revision) {
    validateEffectTransactionRevision(revision);
    if (revision.transactionId !== transactionId) {
      throw effectTransactionError("EFFECT_TRANSACTION_INVALID", "transaction ID changed during publication");
    }
    await this.store.writeObject(revision.contentSha256, effectTransactionBytes(revision));
    try { await this.store.compareAndSwapHead(transactionId, expectedSha256, revision.contentSha256); }
    catch (error) {
      if (error?.code === "EXECUTION_MEMORY_HEAD_CONFLICT") {
        throw effectTransactionError("EFFECT_TRANSACTION_HEAD_CONFLICT", `transaction HEAD changed: ${transactionId}`,
          error.details);
      }
      if (error?.code === "EXECUTION_MEMORY_BUSY") {
        throw effectTransactionError("EFFECT_TRANSACTION_BUSY", `transaction writer is active: ${transactionId}`);
      }
      throw error;
    }
    return revision;
  }

  async listTransactionIds() {
    return (await this.store.listSessionIds()).filter((entry) => entry.startsWith("effect:")).sort();
  }

  async consumeApprovalNonce(grant) {
    const nonceId = `approvalNonce:${grant.authorityId}:${effectTransactionDigest(grant.nonce)}`;
    const current = await this.store.readHead(nonceId);
    if (current === grant.intentSha256) return;
    if (current !== null) throw effectTransactionError("EFFECT_APPROVAL_REPLAY", "approval nonce was used by another intent");
    try { await this.store.compareAndSwapHead(nonceId, null, grant.intentSha256); }
    catch (error) {
      if (error?.code !== "EXECUTION_MEMORY_HEAD_CONFLICT") throw error;
      const winner = await this.store.readHead(nonceId);
      if (winner !== grant.intentSha256) {
        throw effectTransactionError("EFFECT_APPROVAL_REPLAY", "approval nonce was used by another intent");
      }
    }
  }

  inspectTrustDomain() {
    return Object.freeze({ trustDomainSha256: this.trustDomainSha256,
      approvalAuthorities: Object.freeze([...this.authorities.values()].map(({ authorityId, publicKeySha256 }) =>
        Object.freeze({ authorityId, publicKeySha256 })).sort((a, b) => compareText(a.authorityId, b.authorityId))),
      secretEnv: Object.freeze([...this.secretBindings.keys()].sort()) });
  }
}
