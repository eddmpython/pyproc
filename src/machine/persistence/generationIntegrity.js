// generationIntegrity.js - blob과 generation manifest의 무결성 경계(machine측 호출부).
// 암호 연산(sha256 내용주소)의 정본은 상태 커널이고, composition이
// createMachineCryptoProvider로 digestBytes 함수를 주입한다(machine은 커널을 모른다).
// 여기 남는 것은 machine 도메인의 형식 법이다: canonical manifest 직렬화와
// byteLength+digest 재대조 판정. tests/run.mjs [digest 법] 가드가 자체 구현 재발을 차단한다.
import { WebMachineError } from "../contracts/webMachineError.js";

const encoder = new TextEncoder();

export function copyGenerationBytes(value, label = "generation payload") {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  throw new WebMachineError("WEB_MACHINE_GENERATION_INVALID", `${label}: bytes 필요`);
}

export function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new WebMachineError("WEB_MACHINE_GENERATION_INVALID", "manifest number는 finite여야 한다");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new WebMachineError("WEB_MACHINE_GENERATION_INVALID", `manifest value 미지원: ${typeof value}`);
}

function requireDigestProvider(cryptoProvider) {
  if (typeof cryptoProvider?.digestBytes !== "function") {
    throw new TypeError("cryptoProvider.digestBytes가 필요하다(createMachineCryptoProvider로 감싸라)");
  }
  return cryptoProvider;
}

export async function digestGenerationBytes(cryptoProvider, value) {
  return requireDigestProvider(cryptoProvider).digestBytes(copyGenerationBytes(value));
}

export async function digestGenerationManifest(cryptoProvider, manifest) {
  return digestGenerationBytes(cryptoProvider, encoder.encode(canonicalJson(manifest)));
}

export async function verifyGenerationBlob(cryptoProvider, reference, value) {
  const bytes = copyGenerationBytes(value);
  if (!reference || reference.byteLength !== bytes.byteLength) {
    throw new WebMachineError("WEB_MACHINE_GENERATION_CORRUPT", "blob byteLength 불일치");
  }
  const actual = await digestGenerationBytes(cryptoProvider, bytes);
  if (actual !== reference.digest) {
    throw new WebMachineError("WEB_MACHINE_GENERATION_CORRUPT", `blob digest 불일치: ${reference.digest}`);
  }
  return bytes;
}
