// webMachineTrust.js - 이미지 서명 검증과 외부 trusted key 경계.
import { WebMachineError } from "../../host/webMachineError.js";
import { canonicalJson, digestGenerationBytes } from "../persistence/generationIntegrity.js";

const encoder = new TextEncoder();
const keyAlgorithm = Object.freeze({ name: "ECDSA", namedCurve: "P-256" });
const signatureAlgorithm = Object.freeze({ name: "ECDSA", hash: "SHA-256" });

function requireProvider(cryptoProvider) {
  if (!cryptoProvider?.subtle) throw new TypeError("cryptoProvider.subtle이 필요하다");
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
    return normalizePublicJwk(await cryptoProvider.subtle.exportKey("jwk", value));
  } catch (cause) {
    throw new WebMachineError("WEB_MACHINE_IMAGE_SIGNATURE_INVALID", "public key export 실패", { cause: String(cause) });
  }
}

async function importPublicKey(cryptoProvider, value) {
  try {
    return await cryptoProvider.subtle.importKey("jwk", normalizePublicJwk(value), keyAlgorithm, true, ["verify"]);
  } catch (cause) {
    throw new WebMachineError("WEB_MACHINE_IMAGE_SIGNATURE_INVALID", "public key import 실패", { cause: String(cause) });
  }
}

export async function createWebMachineKeyPair(cryptoProvider) {
  requireProvider(cryptoProvider);
  return cryptoProvider.subtle.generateKey(keyAlgorithm, true, ["sign", "verify"]);
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
    value = new Uint8Array(await cryptoProvider.subtle.sign(signatureAlgorithm, signingKeyPair.privateKey, encoder.encode(contentDigest)));
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
  const embeddedKey = await importPublicKey(cryptoProvider, signature.publicKey);
  let signatureValid = false;
  try {
    signatureValid = await cryptoProvider.subtle.verify(signatureAlgorithm, embeddedKey, signatureBytes, encoder.encode(contentDigest));
  } catch (cause) {
    throw new WebMachineError("WEB_MACHINE_IMAGE_SIGNATURE_INVALID", "image 서명 검증 실패", { cause: String(cause) });
  }
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
    const verifier = trustedKey?.kty ? await importPublicKey(cryptoProvider, trustedKey) : trustedKey;
    const trustedValid = await cryptoProvider.subtle.verify(signatureAlgorithm, verifier, signatureBytes, encoder.encode(contentDigest));
    if (trustedValid) return Object.freeze({ signerFingerprint });
  }
  throw new WebMachineError("WEB_MACHINE_IMAGE_UNTRUSTED", `trusted key에 없는 signer: ${signerFingerprint}`);
}
