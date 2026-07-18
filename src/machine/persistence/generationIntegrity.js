// generationIntegrity.js - blob과 generation manifest의 canonical SHA-256 경계.
// digest 법의 정본은 runtime/contentDigest.js다. machine은 경계상(밖으로의 import는
// composition 한 점) 그 파일을 import하지 못해 이 주입식 사본을 유지하며, coordinator가
// 커널에 저장을 위임하는 단계(mainPlan/state-kernel 02 문서 5단계)에서 이 파일은 소멸한다.
// tests/run.mjs [digest 법] 가드가 세 번째 사본의 출현을 차단한다.
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

export async function digestGenerationBytes(cryptoProvider, value) {
  if (!cryptoProvider?.subtle) throw new TypeError("cryptoProvider.subtle이 필요하다");
  const bytes = copyGenerationBytes(value);
  const digest = new Uint8Array(await cryptoProvider.subtle.digest("SHA-256", bytes));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
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
