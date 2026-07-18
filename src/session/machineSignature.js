// machineSignature.js - Layer 3: .pymachine의 출처 인증(WebCrypto ECDSA P-256).
//
// 무결성과 출처는 다른 질문이다: 봉투해시는 "바이트가 온전한가"를 답하고(machineImage),
// 서명은 "누가 만들었나"를 답한다. 서명 대상은 signature를 뺀 봉투 해시(unsignedEnvelope)라
// outer envelope가 signature까지 포함한 최종 body를 다시 해시해도 순환하지 않는다.
//
// 왜 session.js에서 나왔나: 키 생성/내보내기/지문/서명/검증 10함수가 결정적 부팅과 한 파일에
// 있었다. 서명은 신뢰 경계의 코드라 독립적으로 읽히고 감사받아야 한다.
import { PyProcError } from "../runtime/errors.js";
import { sha256Address } from "../runtime/contentDigest.js";
import { unsignedEnvelope } from "./machineImage.js";

const MACHINE_SIGN_ALG = { name: "ECDSA", namedCurve: "P-256" };
const MACHINE_SIGN_PARAMS = { name: "ECDSA", hash: "SHA-256" };

function bytesToBase64Url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]+$/.test(s)) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: signature base64url 형식 위반");
  const padded = s.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isCryptoKey(k) {
  return typeof CryptoKey !== "undefined" && k instanceof CryptoKey;
}

export async function createMachineKeyPair() {
  return crypto.subtle.generateKey(MACHINE_SIGN_ALG, true, ["sign", "verify"]);
}

export async function exportMachinePublicKey(key) {
  const publicKey = key && key.publicKey ? key.publicKey : key;
  if (publicKey && typeof publicKey === "object" && publicKey.kty) return publicKey;
  if (!isCryptoKey(publicKey)) throw new PyProcError("PYPROC_INPUT_INVALID", "machine: publicKey CryptoKey가 필요하다");
  return crypto.subtle.exportKey("jwk", publicKey);
}

// 지문은 정규화된 JWK의 해시다: 키 순서나 부가 필드가 달라도 같은 키면 같은 지문이 나와야 한다.
function canonicalMachinePublicKey(jwk) {
  if (typeof jwk !== "object" || jwk === null) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: publicKey JWK 형식 위반");
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string") {
    throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: P-256 공개키 JWK가 필요하다");
  }
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

export async function fingerprintMachinePublicKey(key) {
  const jwk = canonicalMachinePublicKey(await exportMachinePublicKey(key));
  const bytes = new TextEncoder().encode(JSON.stringify(jwk));
  return sha256Address(bytes);
}

async function importMachinePublicKey(key) {
  if (isCryptoKey(key)) return key;
  if (typeof key !== "object" || key === null) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: publicKey 형식 위반");
  return crypto.subtle.importKey("jwk", key, MACHINE_SIGN_ALG, true, ["verify"]);
}

async function signingMaterial(opts) {
  const signingKey = opts.signingKey || null;
  if (!signingKey) return null;
  const privateKey = signingKey.privateKey || signingKey;
  const publicKey = opts.publicKey || signingKey.publicKey;
  if (!isCryptoKey(privateKey)) throw new PyProcError("PYPROC_INPUT_INVALID", "session.exportImage: signingKey private CryptoKey가 필요하다");
  if (!publicKey) throw new PyProcError("PYPROC_INPUT_INVALID", "session.exportImage: publicKey 또는 CryptoKeyPair가 필요하다");
  return { privateKey, publicKey: await exportMachinePublicKey(publicKey) };
}

// signingKey가 없으면 meta를 그대로 돌려준다(서명은 선택이다).
export async function signMachineMeta(meta, bin, homeBin, opts) {
  const keys = await signingMaterial(opts);
  if (!keys) return meta;
  const envelope = await unsignedEnvelope(meta, bin, homeBin);
  const signature = new Uint8Array(await crypto.subtle.sign(MACHINE_SIGN_PARAMS, keys.privateKey, new TextEncoder().encode(envelope)));
  meta.signature = {
    version: 1,
    algorithm: "ECDSA-P256-SHA256",
    envelope,
    publicKey: keys.publicKey,
    signature: bytesToBase64Url(signature),
  };
  return meta;
}

function readMachineSignature(meta) {
  const sig = meta.signature;
  if (sig == null) return null;
  if (typeof sig !== "object" || sig.version !== 1) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "openMachine: signature 형식 위반");
  if (sig.algorithm !== "ECDSA-P256-SHA256") throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `openMachine: 지원하지 않는 signature 알고리즘(${sig.algorithm})`);
  if (typeof sig.envelope !== "string" || !/^[0-9a-f]{64}$/.test(sig.envelope)) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "openMachine: signature envelope 형식 위반");
  if (typeof sig.publicKey !== "object" || sig.publicKey === null) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "openMachine: signature publicKey 형식 위반");
  return sig;
}

// 반환 { present, trusted }. 서명이 있는데 깨졌으면 던진다(조용한 통과 금지).
// trusted는 opts의 신뢰 목록과 맞을 때만 참이다: 파일에 박힌 공개키로 검증되는 것은
// "자기가 자기를 보증"하는 것이라 출처 인증이 아니다.
export async function verifyMachineSignature(meta, bin, homeBin, opts) {
  const sig = readMachineSignature(meta);
  if (!sig) return { present: false, trusted: false };
  const actual = await unsignedEnvelope(meta, bin, homeBin);
  if (actual !== sig.envelope) throw new PyProcError("PYPROC_MACHINE_INTEGRITY", "openMachine: 서명 대상 불일치(파일 내용과 signature envelope가 맞지 않는다)");
  const signature = base64UrlToBytes(sig.signature);
  const data = new TextEncoder().encode(sig.envelope);
  const embeddedKey = await importMachinePublicKey(sig.publicKey);
  const validEmbedded = await crypto.subtle.verify(MACHINE_SIGN_PARAMS, embeddedKey, signature, data);
  if (!validEmbedded) throw new PyProcError("PYPROC_MACHINE_INTEGRITY", "openMachine: signature 검증 실패");
  const trusted = [];
  if (opts.trustedPublicKey) trusted.push(opts.trustedPublicKey);
  if (Array.isArray(opts.trustedPublicKeys)) trusted.push(...opts.trustedPublicKeys);
  for (const key of trusted) {
    const publicKey = await importMachinePublicKey(key);
    if (await crypto.subtle.verify(MACHINE_SIGN_PARAMS, publicKey, signature, data)) return { present: true, trusted: true };
  }
  return { present: true, trusted: false };
}
