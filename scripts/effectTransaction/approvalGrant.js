// approvalGrant.js - configured external authority의 signature를 exact intent와 trust domain에 결속한다.
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { canonicalExecutionMemoryJson } from "../executionMemory/executionMemoryCanonical.js";
import {
  effectTransactionDigest,
  effectTransactionError,
  validateApprovalGrant,
  validateEffectIntent,
} from "./effectTransactionCanonical.js";

const AUTHORITY = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;

function signingBytes(grant) {
  const { signature: _signature, ...signed } = grant;
  return Buffer.from(canonicalExecutionMemoryJson(signed));
}

export function approvalAuthority({ authorityId, publicKey }) {
  if (!AUTHORITY.test(String(authorityId || ""))) throw new TypeError("approval authorityId is invalid");
  let key;
  try { key = publicKey?.type === "public" ? publicKey : createPublicKey(publicKey); }
  catch (error) { throw new TypeError(`approval public key is invalid: ${authorityId}`); }
  if (key.asymmetricKeyType !== "ed25519") throw new TypeError("approval authority requires an Ed25519 public key");
  const pem = key.export({ type: "spki", format: "pem" });
  return Object.freeze({ authorityId, publicKey: pem, publicKeySha256: effectTransactionDigest(pem) });
}

export function createApprovalGrant({ intent, authorityId, trustDomainSha256, expiresAt, nonce, policyVersion }, privateKey) {
  validateEffectIntent(intent);
  let key;
  try { key = privateKey?.type === "private" ? privateKey : createPrivateKey(privateKey); }
  catch (error) { throw new TypeError("approval private key is invalid"); }
  if (key.asymmetricKeyType !== "ed25519") throw new TypeError("approval grant requires an Ed25519 private key");
  const content = {
    format: "pyproc.approvalGrant", version: 1, authorityId, trustDomainSha256,
    intentSha256: intent.contentSha256, destinationSha256: effectTransactionDigest(intent.destination),
    risk: intent.risk, sessionRevisionSha256: intent.sessionRevisionSha256,
    expiresAt, nonce, policyVersion,
  };
  const unsigned = Object.freeze({ ...content, contentSha256: effectTransactionDigest(content) });
  const grant = Object.freeze({ ...unsigned, signature: sign(null, Buffer.from(canonicalExecutionMemoryJson(unsigned)), key)
    .toString("base64") });
  return validateApprovalGrant(grant);
}

export function verifyApprovalGrant(grant, intent, { authorities, trustDomainSha256, now = () => Date.now() } = {}) {
  validateApprovalGrant(grant);
  validateEffectIntent(intent);
  const authority = authorities instanceof Map ? authorities.get(grant.authorityId) : null;
  if (!authority) throw effectTransactionError("EFFECT_APPROVAL_UNTRUSTED", "approval authority is not trusted");
  if (grant.trustDomainSha256 !== trustDomainSha256 || grant.intentSha256 !== intent.contentSha256
    || grant.destinationSha256 !== effectTransactionDigest(intent.destination) || grant.risk !== intent.risk
    || grant.sessionRevisionSha256 !== intent.sessionRevisionSha256) {
    throw effectTransactionError("EFFECT_APPROVAL_STALE", "approval does not bind the exact current intent");
  }
  const expires = Date.parse(grant.expiresAt);
  if (expires <= now()) throw effectTransactionError("EFFECT_APPROVAL_EXPIRED", "approval has expired");
  if (expires - now() > 24 * 60 * 60 * 1000) {
    throw effectTransactionError("EFFECT_APPROVAL_INVALID", "approval lifetime exceeds 24 hours");
  }
  let signature;
  try { signature = Buffer.from(grant.signature, "base64"); }
  catch (error) { throw effectTransactionError("EFFECT_APPROVAL_INVALID", "approval signature encoding is invalid"); }
  if (signature.toString("base64") !== grant.signature
    || !verify(null, signingBytes(grant), authority.publicKey, signature)) {
    throw effectTransactionError("EFFECT_APPROVAL_SIGNATURE", "approval signature is invalid");
  }
  return grant;
}
