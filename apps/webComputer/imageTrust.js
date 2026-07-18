import { createMachineCryptoProvider, fingerprintWebMachinePublicKey } from "/src/machine/index.js";

// 신뢰 화면(import 전 사용자에게 보여주는 것)은 .webmachine의 헤더만 읽는다: 통합 bundle
// 포맷(PYBUNDLE1)의 접두 판독기가 payload를 한 조각도 만지지 않으므로, 검증 전 대용량
// guest 스냅샷을 읽는 일이 없다(조기 거부 계약). 헤더 서명이 meta(권한/장치/키)까지 봉인한다.
export async function inspectUntrustedWebMachine(file) {
  if (!file || typeof file.slice !== "function") throw new TypeError("A .webmachine file is required");
  const provider = createMachineCryptoProvider(crypto);
  let header;
  try {
    header = await provider.state.readBundleHeader(file);
  } catch (error) {
    throw new TypeError("This is not a Web Computer image");
  }
  const meta = header.meta || {};
  const publicKey = header.tag?.publicKey;
  if (!publicKey) throw new TypeError("This machine image is unsigned");
  const fingerprint = await fingerprintWebMachinePublicKey(provider, publicKey);
  return Object.freeze({
    publicKey,
    fingerprint,
    groupId: String(meta.groupId || ""),
    machines: Object.freeze((meta.machines || []).map((entry) => String(entry.machineId || ""))),
    devices: Object.freeze((meta.devices || []).map((entry) => String(entry.name || ""))),
    permissions: Object.freeze(Object.fromEntries((meta.machines || []).map((entry) => [entry.machineId, { devices: [...(entry.permissions?.devices || [])] }]))),
    byteLength: file.size,
  });
}

export function shortFingerprint(value) {
  const text = String(value || "").replace(/^sha256:/, "");
  return `${text.slice(0, 12)}…${text.slice(-12)}`;
}
