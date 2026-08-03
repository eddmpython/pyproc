// machineSignature.js - Layer 4: .pymachine 출처 인증의 세션측 호출부.
//
// 암호 연산(ECDSA P-256, 정규화 JWK, 지문)의 정본은 상태 커널의 signedTag 코어다.
// 이 파일에 남는 것은 구 .pymachine signature v1 "포맷"의 reader뿐이다: 신 봉투(bundle)는
// signedTag의 tag를 그대로 싣고, 구 봉투는 v1 형식(base64url, envelope 필드)을 읽어야
// 하므로 형식 코덱만 여기 산다. writer는 단일화됐다(exportImage가 bundle만 쓴다).
// 무결성과 출처는 다른 질문이다: 봉투해시는 "바이트가 온전한가", 서명은 "누가 만들었나".
import { PyProcError } from "../runtime/errors.js";
import {
  createStateKeyPair,
  exportStatePublicKey,
  fingerprintStatePublicKey,
  verifyStateDigest,
} from "../state/signedTag.js";

function isCryptoKey(k) {
  return typeof CryptoKey !== "undefined" && k instanceof CryptoKey;
}

export async function createMachineKeyPair() {
  return createStateKeyPair(globalThis.crypto);
}

export async function exportMachinePublicKey(key) {
  const publicKey = key && key.publicKey ? key.publicKey : key;
  if (publicKey && typeof publicKey === "object" && publicKey.kty) return publicKey;
  if (!isCryptoKey(publicKey)) throw new PyProcError("PYPROC_INPUT_INVALID", "machine: publicKey must be a CryptoKey");
  return exportStatePublicKey(globalThis.crypto, publicKey);
}

// 지문 = 정규화 JWK의 내용주소(signedTag 코어와 같은 규약이라 신구 봉투의 지문이 같다).
export async function fingerprintMachinePublicKey(key) {
  return fingerprintStatePublicKey(globalThis.crypto, await exportMachinePublicKey(key));
}

// 서명자 자료: 세션 서명 옵션(signingKey: CryptoKeyPair 또는 privateKey + publicKey 별도)을
// 커널 tag 서명이 쓸 수 있는 형태로 정규화한다. exportImage가 소비한다.
export async function machineSigningMaterial(opts) {
  const signingKey = opts.signingKey || null;
  if (!signingKey) return null;
  const privateKey = signingKey.privateKey || signingKey;
  const publicKey = opts.publicKey || signingKey.publicKey;
  if (!isCryptoKey(privateKey)) throw new PyProcError("PYPROC_INPUT_INVALID", "history.export: signingKey must be a private CryptoKey");
  if (!publicKey) throw new PyProcError("PYPROC_INPUT_INVALID", "history.export: publicKey or a CryptoKeyPair is required");
  return { privateKey, publicKey: await exportMachinePublicKey(publicKey) };
}
