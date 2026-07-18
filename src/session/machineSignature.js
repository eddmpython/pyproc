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
import { unsignedEnvelope } from "./machineImage.js";

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
  return createStateKeyPair(globalThis.crypto);
}

export async function exportMachinePublicKey(key) {
  const publicKey = key && key.publicKey ? key.publicKey : key;
  if (publicKey && typeof publicKey === "object" && publicKey.kty) return publicKey;
  if (!isCryptoKey(publicKey)) throw new PyProcError("PYPROC_INPUT_INVALID", "machine: publicKey CryptoKey가 필요하다");
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
  if (!isCryptoKey(privateKey)) throw new PyProcError("PYPROC_INPUT_INVALID", "session.exportImage: signingKey private CryptoKey가 필요하다");
  if (!publicKey) throw new PyProcError("PYPROC_INPUT_INVALID", "session.exportImage: publicKey 또는 CryptoKeyPair가 필요하다");
  return { privateKey, publicKey: await exportMachinePublicKey(publicKey) };
}

// ---- 구 .pymachine signature v1 reader (읽기 전용, 다음 브레이킹 릴리즈에 일몰) ----

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
  const validEmbedded = await verifyStateDigest(globalThis.crypto, sig.publicKey, sig.envelope, signature);
  if (!validEmbedded) throw new PyProcError("PYPROC_MACHINE_INTEGRITY", "openMachine: signature 검증 실패");
  const trusted = [];
  if (opts.trustedPublicKey) trusted.push(opts.trustedPublicKey);
  if (Array.isArray(opts.trustedPublicKeys)) trusted.push(...opts.trustedPublicKeys);
  for (const key of trusted) {
    if (await verifyStateDigest(globalThis.crypto, key, sig.envelope, signature)) return { present: true, trusted: true };
  }
  return { present: true, trusted: false };
}
