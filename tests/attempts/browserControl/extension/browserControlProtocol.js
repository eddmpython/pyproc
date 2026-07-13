// browserControlProtocol.js - offscreen(능력) <-> service worker(호스트) 메시지 계약.
// 두 절반이 서로 다른 SHA로 vendored되면 조용히 깨지므로, 양쪽이 이 모듈을 함께 import하고
// 부팅 시 버전 핸드셰이크로 불일치를 loud fail한다. 전송 타입 분기(type:"cdp"/"contentScript") 대신
// {proto, op, sessionId, mode, args} 균일 스키마 = Phase 2 target 확장에 forward-compat.
export const PROTOCOL_VERSION = 1;

// op 상수(문자열 리터럴 산재 방지). 파이썬 표면의 메서드와 1:1.
export const OP = {
  handshake: "handshake",
  openSession: "openSession",
  navigate: "navigate",
  evaluate: "evaluate",
  click: "click",
  type: "type",
  closeSession: "closeSession",
};

// mode = 조작 전략. 생성 시 1회 선택(per-verb 플래그 금지).
// script: chrome.scripting(CDP 없음, 스텔스 = navigator.webdriver 미점화). isTrusted=false.
// debugger: chrome.debugger CDP Input.*(신뢰 입력, isTrusted=true). webdriver 노출(선제 개입으로 덮음).
export const MODE = { script: "script", debugger: "debugger" };

// 메시지 팩토리(offscreen 측). 항상 proto 버전을 실어 호스트가 검증한다.
export function makeMessage(op, fields = {}) {
  return { proto: PROTOCOL_VERSION, op, ...fields };
}
