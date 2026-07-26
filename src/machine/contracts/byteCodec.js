// byteCodec.js - machine 층의 순수 바이트 코덱. 의존 0, browser 전역 접근은 폴백 감지뿐.
//
// 왜 machine 안에 또 있는가: machine의 바깥 import는 composition 한 점만이라는 구조 계약이
// 있어서(순수 집합은 guest/engine/browser를 모른다) runtime/contentDigest를 직접 쓸 수 없다.
// 그래서 이 층의 코덱은 이 층 안에 한 벌 둔다. 의도된 중복이고, 중복의 대가는 두 곳뿐이라는
// 사실 자체다: 예전에는 같은 변환이 machine 안에서만 hex 3벌 + base64 1벌 + 비교 2벌이었다.
//
// 오류 어휘: 이 층은 WebMachineError(code)로 말한다. 코드는 호출자가 주입한다(형식 위반이
// 서명 문제인지 이미지 문제인지는 machine 도메인 맥락이 정한다).
import { WebMachineError } from "./webMachineError.js";
// 정렬 비교는 순수 계약이 소유한다(guest도 직접 소비해야 하므로 platform에 둘 수 없다).
export { compareNames } from "./deterministicOrder.js";

export function hexFromBytes(value) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function bytesFromHex(value, code = "WEB_MACHINE_IMAGE_SIGNATURE_INVALID") {
  if (typeof value !== "string" || !value.length || value.length % 2 !== 0 || /[^0-9a-f]/.test(value)) {
    throw new WebMachineError(code, "hex 바이트 형식 불일치");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

// base64 디코더는 브라우저(atob)와 Node(Buffer)를 함께 받는다. 한쪽만 갖춘 사본이
// "같은 입력에 다르게 실패"를 만든 전례가 있어(contentDigest 헤더의 사고 기록) 폴백을 필수로 둔다.
export function bytesFromBase64(value, code = "WEB_MACHINE_IMAGE_SIGNATURE_INVALID") {
  if (typeof atob === "function") {
    const raw = atob(value);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
    return bytes;
  }
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64"));
  throw new WebMachineError(code, "base64 디코더가 없다");
}

export function sameBytes(left, right) {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}
