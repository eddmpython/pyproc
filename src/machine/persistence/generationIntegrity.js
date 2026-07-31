// generationIntegrity.js - Layer 5/platform: blob과 generation manifest의 무결성 경계(machine측 호출부).
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
  throw new WebMachineError("WEB_MACHINE_GENERATION_INVALID", `${label}: bytes are required`);
}

// 직렬화 규약은 커널 조각으로 온다(composition이 배달). machine이 자기 사본을 갖고 있으면
// 공개 지문과 manifest 다이제스트가 두 판본에 걸린다.
export function machineCanonicalJson(cryptoProvider, value) {
  const encode = cryptoProvider?.state?.canonicalJson;
  if (typeof encode !== "function") {
    throw new TypeError("cryptoProvider.state.canonicalJson is required (wrap with createMachineCryptoProvider)");
  }
  return encode(value);
}

function requireDigestProvider(cryptoProvider) {
  if (typeof cryptoProvider?.digestBytes !== "function") {
    throw new TypeError("cryptoProvider.digestBytes is required (wrap with createMachineCryptoProvider)");
  }
  return cryptoProvider;
}

export async function digestGenerationBytes(cryptoProvider, value) {
  return requireDigestProvider(cryptoProvider).digestBytes(copyGenerationBytes(value));
}

export async function digestGenerationManifest(cryptoProvider, manifest) {
  return digestGenerationBytes(cryptoProvider, encoder.encode(machineCanonicalJson(cryptoProvider, manifest)));
}

