// contentDigest.js - Layer 0: 내용 주소 계산의 단일 정본(순수 함수, 의존은 errors.js뿐).
// 자산 SRI(assets/runtime), 저널 blob 키(machineJournal), 머신 봉투 해시(session),
// 커널 이름(kernelElection), 스냅샷 캐시 키(envManager)가 전부 같은 계산을 한다.
//
// 왜 한 곳인가: 흩어져 있던 다섯 벌은 이미 갈라져 있었다. base64 인코더 하나는 청크 처리와
// Buffer 폴백과 subtle 가드를 갖췄고 다른 하나는 셋 다 없어서, 같은 입력에 Node에서
// ReferenceError와 PyProcError로 다르게 실패했다. 내용 주소는 값이 한 비트만 달라도 계약이
// 깨지는 자리라 구현이 갈라지는 것 자체가 결함이다.
//
// pyprocSw.js는 이 파일을 쓰지 않는다: import 0인 자기충족 Service Worker 자산이라
// 의존을 들이면 SW 등록 계약(단일 파일 fetch)이 깨진다. 그 중복은 의도된 것이고
// 자산 매니페스트 graph가 그 사실을 게시한다.
import { PyProcError } from "./errors.js";

function asBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === "string") return new TextEncoder().encode(data);
  throw new PyProcError("PYPROC_ENV_UNSUPPORTED", "contentDigest: bytes/ArrayBuffer/string만 받는다");
}

function subtleOrThrow() {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new PyProcError("PYPROC_ENV_UNSUPPORTED", "contentDigest: crypto.subtle이 필요하다");
  return subtle;
}

// 청크로 끊어 넣는다: 큰 배열을 String.fromCharCode에 한 번에 펼치면 인자 수 한계로 터진다.
export function base64FromBytes(data) {
  const bytes = asBytes(data);
  if (typeof btoa === "function") {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  throw new PyProcError("PYPROC_ENV_UNSUPPORTED", "contentDigest: base64 인코더가 없다");
}

export async function sha256Bytes(data) {
  return new Uint8Array(await subtleOrThrow().digest("SHA-256", asBytes(data)));
}

// 16진 다이제스트. bytes를 그대로 받고, 문자열이면 UTF-8로 인코딩한다.
export async function sha256Hex(data) {
  return [...await sha256Bytes(data)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 앞 n바이트만 쓰는 짧은 키(캐시 파일명 등). 내용 주소가 아니라 이름이라 충돌 비용이 낮다.
export async function sha256HexShort(data, bytes = 8) {
  return [...await sha256Bytes(data)].slice(0, bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// SRI 문자열("sha256-<base64>"). 자산 무결성 계약의 표기법.
export async function sha256Sri(data) {
  return "sha256-" + base64FromBytes(await sha256Bytes(data));
}

// SRI 속성은 공백으로 여러 값을 담을 수 있다. sha256만 받는다(다른 알고리즘은 계약 밖).
export function parseSri(value) {
  return String(value || "").trim().split(/\s+/).filter((v) => v.startsWith("sha256-"));
}

// 기대 SRI 중 하나와 맞는지 확인하고 실제 값을 돌려준다. label은 오류 문장의 주어다.
export async function verifySri(data, expected, label) {
  const entries = parseSri(expected);
  if (!entries.length) throw new PyProcError("PYPROC_ASSET_INTEGRITY", `integrity: ${label}의 sha256 SRI 값이 없다`);
  const actual = await sha256Sri(data);
  if (!entries.includes(actual)) {
    throw new PyProcError("PYPROC_ASSET_INTEGRITY", `integrity: ${label} 해시 불일치(expected ${entries[0].slice(0, 19)}..., actual ${actual.slice(0, 19)}...)`);
  }
  return actual;
}
