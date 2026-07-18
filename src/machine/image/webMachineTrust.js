// webMachineTrust.js - 이미지 서명 검증과 외부 trusted key 경계(machine측 호출부).
// ECDSA P-256 연산(키 생성·서명·검증)의 정본은 상태 커널의 signedTag 코어이고, composition이
// createMachineCryptoProvider로 함수 조각(signDigest/verifyDigest/generateSigningKeyPair/
// exportPublicJwk)을 주입한다. 여기 남는 것은 machine 도메인의 형식 법이다: signature v1
// 스키마(hex 표기), JWK 정규화, 지문 직렬화 규약(canonical 정렬 - 소비자가 박아둔 공개 값이라
// 규약 변경 = 신뢰 목록 무효화), 그리고 신뢰 판정 순서(임베디드 검증 -> 지문 대조 -> 재검증).
import { WebMachineError } from "../contracts/webMachineError.js";
import { canonicalJson, digestGenerationBytes } from "../persistence/generationIntegrity.js";

const encoder = new TextEncoder();

function requireProvider(cryptoProvider) {
  for (const method of ["signDigest", "verifyDigest", "generateSigningKeyPair", "exportPublicJwk"]) {
    if (typeof cryptoProvider?.[method] !== "function") {
      throw new TypeError(`cryptoProvider.${method}가 필요하다(createMachineCryptoProvider로 감싸라)`);
    }
  }
  return cryptoProvider;
}

function bytesToHex(value) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value) {
  if (typeof value !== "string" || !value.length || value.length % 2 !== 0 || /[^0-9a-f]/.test(value)) {
    throw new WebMachineError("WEB_MACHINE_IMAGE_SIGNATURE_INVALID", "signature bytes 형식 불일치");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function normalizePublicJwk(value) {
  if (!value || value.kty !== "EC" || value.crv !== "P-256" || typeof value.x !== "string" || typeof value.y !== "string") {
    throw new WebMachineError("WEB_MACHINE_IMAGE_SIGNATURE_INVALID", "P-256 public key 형식 불일치");
  }
  return Object.freeze({ kty: "EC", crv: "P-256", x: value.x, y: value.y });
}

async function publicJwk(cryptoProvider, value) {
  requireProvider(cryptoProvider);
  if (value?.kty) return normalizePublicJwk(value);
  try {
    return normalizePublicJwk(await cryptoProvider.exportPublicJwk(value));
  } catch (cause) {
    throw new WebMachineError("WEB_MACHINE_IMAGE_SIGNATURE_INVALID", "public key export 실패", { cause: String(cause) });
  }
}

export async function createWebMachineKeyPair(cryptoProvider) {
  return requireProvider(cryptoProvider).generateSigningKeyPair();
}

export async function exportWebMachinePublicKey(cryptoProvider, publicKey) {
  return publicJwk(cryptoProvider, publicKey);
}

export async function fingerprintWebMachinePublicKey(cryptoProvider, publicKey) {
  const jwk = await publicJwk(cryptoProvider, publicKey);
  return digestGenerationBytes(cryptoProvider, encoder.encode(canonicalJson(jwk)));
}

export async function signWebMachineContent(cryptoProvider, contentDigest, signingKeyPair) {
  requireProvider(cryptoProvider);
  if (!signingKeyPair?.privateKey || !signingKeyPair?.publicKey) throw new TypeError("signingKeyPair가 필요하다");
  const publicKey = await publicJwk(cryptoProvider, signingKeyPair.publicKey);
  let value;
  try {
    value = await cryptoProvider.signDigest(signingKeyPair.privateKey, contentDigest);
  } catch (cause) {
    throw new WebMachineError("WEB_MACHINE_IMAGE_SIGNATURE_INVALID", "image 서명 실패", { cause: String(cause) });
  }
  return Object.freeze({
    version: 1,
    algorithm: "ECDSA-P256-SHA256",
    publicKey,
    value: bytesToHex(value),
  });
}

export async function verifyWebMachineTrust(cryptoProvider, contentDigest, signature, trustedPublicKeys) {
  requireProvider(cryptoProvider);
  if (!signature) throw new WebMachineError("WEB_MACHINE_IMAGE_UNTRUSTED", "서명 없는 image 실행 거부");
  const signatureBytes = hexToBytes(signature.value);
  const embeddedJwk = normalizePublicJwk(signature.publicKey);
  const signatureValid = await cryptoProvider.verifyDigest(embeddedJwk, contentDigest, signatureBytes);
  if (!signatureValid) throw new WebMachineError("WEB_MACHINE_IMAGE_SIGNATURE_INVALID", "image 서명 불일치");

  const signerFingerprint = await fingerprintWebMachinePublicKey(cryptoProvider, signature.publicKey);
  for (const trustedKey of trustedPublicKeys || []) {
    let trustedFingerprint;
    try {
      trustedFingerprint = await fingerprintWebMachinePublicKey(cryptoProvider, trustedKey);
    } catch (error) {
      if (error?.code === "WEB_MACHINE_IMAGE_SIGNATURE_INVALID") continue;
      throw error;
    }
    if (trustedFingerprint !== signerFingerprint) continue;
    const trustedVerifier = trustedKey?.kty ? normalizePublicJwk(trustedKey) : trustedKey;
    const trustedValid = await cryptoProvider.verifyDigest(trustedVerifier, contentDigest, signatureBytes);
    if (trustedValid) return Object.freeze({ signerFingerprint });
  }
  throw new WebMachineError("WEB_MACHINE_IMAGE_UNTRUSTED", `trusted key에 없는 signer: ${signerFingerprint}`);
}
