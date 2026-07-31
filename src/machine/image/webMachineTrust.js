// webMachineTrust.js - Layer 5/platform: 이미지 서명 검증과 외부 trusted key 경계(machine측 호출부).
// ECDSA P-256 연산(키 생성·서명·검증)의 정본은 상태 커널의 signedTag 코어이고, composition이
// createMachineCryptoProvider로 함수 조각(signDigest/verifyDigest/generateSigningKeyPair/
// exportPublicJwk)을 주입한다. 여기 남는 것은 machine 도메인의 형식 법이다: signature v1
// 스키마(hex 표기), JWK 정규화, 지문 직렬화 규약(canonical 정렬 - 소비자가 박아둔 공개 값이라
// 규약 변경 = 신뢰 목록 무효화), 그리고 신뢰 판정 순서(임베디드 검증 -> 지문 대조 -> 재검증).
import { WebMachineError } from "../contracts/webMachineError.js";
import { digestGenerationBytes, machineCanonicalJson } from "../persistence/generationIntegrity.js";
import { bytesFromHex, hexFromBytes } from "../contracts/byteCodec.js";

const encoder = new TextEncoder();

function requireProvider(cryptoProvider) {
  for (const method of ["signDigest", "verifyDigest", "generateSigningKeyPair", "exportPublicJwk"]) {
    if (typeof cryptoProvider?.[method] !== "function") {
      throw new TypeError(`cryptoProvider.${method} is required (wrap with createMachineCryptoProvider)`);
    }
  }
  return cryptoProvider;
}

function normalizePublicJwk(value) {
  if (!value || value.kty !== "EC" || value.crv !== "P-256" || typeof value.x !== "string" || typeof value.y !== "string") {
    throw new WebMachineError("WEB_MACHINE_IMAGE_SIGNATURE_INVALID", "the P-256 public key has the wrong shape");
  }
  return Object.freeze({ kty: "EC", crv: "P-256", x: value.x, y: value.y });
}

async function publicJwk(cryptoProvider, value) {
  requireProvider(cryptoProvider);
  if (value?.kty) return normalizePublicJwk(value);
  try {
    return normalizePublicJwk(await cryptoProvider.exportPublicJwk(value));
  } catch (cause) {
    throw new WebMachineError("WEB_MACHINE_IMAGE_SIGNATURE_INVALID", "exporting the public key failed", { cause: String(cause) });
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
  return digestGenerationBytes(cryptoProvider, encoder.encode(machineCanonicalJson(cryptoProvider, jwk)));
}

export async function verifyWebMachineTrust(cryptoProvider, contentDigest, signature, trustedPublicKeys) {
  requireProvider(cryptoProvider);
  if (!signature) throw new WebMachineError("WEB_MACHINE_IMAGE_UNTRUSTED", "refusing to run an unsigned image");
  const signatureBytes = bytesFromHex(signature.value);
  const embeddedJwk = normalizePublicJwk(signature.publicKey);
  const signatureValid = await cryptoProvider.verifyDigest(embeddedJwk, contentDigest, signatureBytes);
  if (!signatureValid) throw new WebMachineError("WEB_MACHINE_IMAGE_SIGNATURE_INVALID", "the image signature does not verify");

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
  throw new WebMachineError("WEB_MACHINE_IMAGE_UNTRUSTED", `signer is not in the trusted keys: ${signerFingerprint}`);
}
