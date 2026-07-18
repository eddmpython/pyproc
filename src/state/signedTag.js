// signedTag.js - Layer 1(state): 서명 = 출처의 단일 코어(ECDSA P-256).
// 세션의 machineSignature(.pymachine)와 machine의 webMachineTrust(.webmachine)가 같은
// 알고리즘("ECDSA-P256-SHA256")을 독립 재구현해 왔다(적대 입력 파서 2벌 = 취약면 2배,
// v1 헤더 변조 적발 전과). 봉투·신뢰 통합 단계에서 두 호출부가 이 코어 한 벌을 부른다.
// 순수 규율: cryptoProvider 매개변수화, 브라우저 전역 접근 0.
//
// tag의 대상은 내용주소(또는 봉투 다이제스트) "문자열"이다: 서명은 바이트가 아니라 그 바이트의
// 주소에 얹힌다. 무결성(주소 재계산)과 출처(서명 검증)가 분리되는 지점이 정확히 여기다.
import { PyProcError } from "../runtime/errors.js";
import { base64FromBytes, sha256AddressWith } from "../runtime/contentDigest.js";

export const STATE_TAG_ALG = "ECDSA-P256-SHA256";
const KEY_ALG = { name: "ECDSA", namedCurve: "P-256" };
const SIGN_ALG = { name: "ECDSA", hash: "SHA-256" };
const textEncoder = new TextEncoder();

function requireProvider(cryptoProvider) {
  if (!cryptoProvider?.subtle) throw new PyProcError("PYPROC_ENV_UNSUPPORTED", "signedTag: cryptoProvider.subtle이 필요하다");
  return cryptoProvider.subtle;
}

function bytesFromBase64(value) {
  if (typeof atob === "function") {
    const s = atob(value);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"));
  throw new PyProcError("PYPROC_ENV_UNSUPPORTED", "signedTag: base64 디코더가 없다");
}

// 지문/서명은 정규화된 JWK에 대해서만 계산한다: 키 순서나 부가 필드가 달라도 같은 키면 같다.
// 필드 순서(kty, crv, x, y)는 기존 .pymachine 지문 규약과 동일해야 한다: 지문은 소비자가
// 신뢰 목록에 박아두는 공개 값이라 순서 변경 = 전 소비자의 지문 무효화다.
export function canonicalStateJwk(jwk) {
  if (typeof jwk !== "object" || jwk === null || jwk.kty !== "EC" || jwk.crv !== "P-256"
    || typeof jwk.x !== "string" || typeof jwk.y !== "string") {
    throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "signedTag: P-256 공개키 JWK가 필요하다");
  }
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

export async function createStateKeyPair(cryptoProvider) {
  return requireProvider(cryptoProvider).generateKey(KEY_ALG, true, ["sign", "verify"]);
}

export async function exportStatePublicKey(cryptoProvider, publicKey) {
  return canonicalStateJwk(await requireProvider(cryptoProvider).exportKey("jwk", publicKey));
}

export async function fingerprintStatePublicKey(cryptoProvider, publicKeyOrJwk) {
  const jwk = publicKeyOrJwk?.kty ? canonicalStateJwk(publicKeyOrJwk) : await exportStatePublicKey(cryptoProvider, publicKeyOrJwk);
  return sha256AddressWith(cryptoProvider, textEncoder.encode(JSON.stringify(jwk)));
}

// JWK 또는 CryptoKey를 검증용 공개키로 들인다(두 호출부의 공용 관용구).
export async function importStatePublicKey(cryptoProvider, key) {
  const subtle = requireProvider(cryptoProvider);
  if (key && typeof key === "object" && key.kty) return subtle.importKey("jwk", canonicalStateJwk(key), KEY_ALG, true, ["verify"]);
  if (typeof CryptoKey !== "undefined" && key instanceof CryptoKey) return key;
  throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "signedTag: publicKey 형식 위반");
}

// 저수준 서명/검증: target 다이제스트 문자열에 대한 ECDSA 원바이트. 상위 포맷(tag,
// 구 .pymachine signature v1)이 각자의 봉투에 싣더라도 암호 연산은 이 두 함수 한 벌이다.
export async function signStateDigest(cryptoProvider, privateKey, target) {
  const subtle = requireProvider(cryptoProvider);
  if (typeof target !== "string" || !target) throw new PyProcError("PYPROC_INPUT_INVALID", "signedTag: target 다이제스트 문자열이 필요하다");
  return new Uint8Array(await subtle.sign(SIGN_ALG, privateKey, textEncoder.encode(target)));
}

export async function verifyStateDigest(cryptoProvider, publicKeyOrJwk, target, signatureBytes) {
  const subtle = requireProvider(cryptoProvider);
  const publicKey = await importStatePublicKey(cryptoProvider, publicKeyOrJwk);
  try {
    return await subtle.verify(SIGN_ALG, publicKey, signatureBytes, textEncoder.encode(target));
  } catch (e) {
    return false; // 손상된 서명 바이트는 "검증 실패"다(예외 아님: 적대 입력의 정상 결말)
  }
}

// tag 조립: 개인키 + 공개키 JWK로 target에 서명한다. 개인키는 tag에 실리지 않는다.
export async function makeStateTag(cryptoProvider, privateKey, publicKeyJwk, target) {
  const signature = await signStateDigest(cryptoProvider, privateKey, target);
  return { alg: STATE_TAG_ALG, target, publicKey: canonicalStateJwk(publicKeyJwk), signature: base64FromBytes(signature) };
}

// target(내용주소/봉투 다이제스트 문자열)에 서명해 tag를 만든다(CryptoKeyPair 편의형).
export async function signStateTag(cryptoProvider, keyPair, target) {
  if (!keyPair?.privateKey || !keyPair?.publicKey) throw new PyProcError("PYPROC_INPUT_INVALID", "signedTag: keyPair가 필요하다");
  return makeStateTag(cryptoProvider, keyPair.privateKey, await exportStatePublicKey(cryptoProvider, keyPair.publicKey), target);
}

// tag 검증: { valid, trusted, signerFingerprint }.
// valid = tag에 실린 공개키로 서명이 맞는가(자기 서명 일관성).
// trusted = 그 공개키가 신뢰 목록(trustedPublicKeys: JWK 배열)의 지문과 일치하는가.
// 해시는 무결성이고 서명은 출처다: valid여도 trusted가 아니면 출처는 미승인이다.
export async function verifyStateTag(cryptoProvider, tag, expectedTarget, opts = {}) {
  const subtle = requireProvider(cryptoProvider);
  if (typeof tag !== "object" || tag === null || tag.alg !== STATE_TAG_ALG
    || typeof tag.target !== "string" || typeof tag.signature !== "string") {
    throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "signedTag: tag 형식 위반");
  }
  if (expectedTarget != null && tag.target !== expectedTarget) {
    return { valid: false, trusted: false, signerFingerprint: null };
  }
  const jwk = canonicalStateJwk(tag.publicKey);
  const valid = await verifyStateDigest(cryptoProvider, jwk, tag.target, bytesFromBase64(tag.signature));
  const signerFingerprint = await fingerprintStatePublicKey(cryptoProvider, jwk);
  if (!valid) return { valid: false, trusted: false, signerFingerprint };
  let trusted = false;
  for (const candidate of opts.trustedPublicKeys || []) {
    const fingerprint = typeof candidate === "string" ? candidate : await fingerprintStatePublicKey(cryptoProvider, candidate);
    if (fingerprint === signerFingerprint) { trusted = true; break; }
  }
  return { valid, trusted, signerFingerprint };
}
