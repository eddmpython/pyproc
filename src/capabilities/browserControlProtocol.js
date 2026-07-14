// browserControlProtocol.js - offscreen(능력) <-> service worker(호스트) 메시지 계약.
// 두 절반이 서로 다른 SHA로 vendored되면 조용히 깨지므로, 양쪽이 이 모듈을 함께 import하고
// 부팅 시 버전 핸드셰이크로 불일치를 loud fail한다. 전송 타입 분기(type:"cdp"/"contentScript") 대신
// {proto, op, sessionId, mode, args} 균일 스키마 = 표면 확장에 forward-compat(op만 늘린다).
export const PROTOCOL_VERSION = 2;

// op 상수(문자열 리터럴 산재 방지). 파이썬 표면의 메서드와 1:1. 새 능력은 폴더가 아니라 여기 op로 늘린다.
export const OP = {
  handshake: "handshake",
  openSession: "openSession",
  closeSession: "closeSession",
  // 항법(load 대기 = mode별 메커니즘)
  navigate: "navigate",
  reload: "reload",
  back: "back",
  forward: "forward",
  // 실행
  evaluate: "evaluate",
  // 입력(pointer/keyboard = mode별. debugger는 신뢰 입력, script는 합성 이벤트)
  click: "click",
  doubleClick: "doubleClick",
  rightClick: "rightClick",
  hover: "hover",
  type: "type",
  fill: "fill",
  press: "press",
  select: "select",
  // 조회/추출(evaluate 합성 = mode 무관 단일 구현)
  text: "text",
  html: "html",
  attr: "attr",
  value: "value",
  exists: "exists",
  count: "count",
  texts: "texts",
  boundingBox: "boundingBox",
  title: "title",
  url: "url",
  content: "content",
  // 대기(evaluate 폴 = mode 무관)
  waitFor: "waitFor",
  waitForFunction: "waitForFunction",
  // 페이지 캡처/에뮬레이션(CDP 전용 = debugger mode. script mode는 정직하게 미지원 실패)
  screenshot: "screenshot",
  pdf: "pdf",
  setViewport: "setViewport",
  setUserAgent: "setUserAgent",
  setHeaders: "setHeaders",
  cookies: "cookies",
  setCookie: "setCookie",
  clearCookies: "clearCookies",
  deleteCookie: "deleteCookie",
  scrollIntoView: "scrollIntoView",
  upload: "upload",
  // 다이얼로그 자동 처리(alert/confirm/prompt) + 네트워크 가로채기/관측(CDP Fetch/Network = debugger 전용)
  setDialogHandler: "setDialogHandler",
  lastDialog: "lastDialog",
  route: "route",
  unroute: "unroute",
  waitForResponse: "waitForResponse",
  requests: "requests",
  // 콜백형 held routing(요청을 붙잡아 동적 결정) + 응답 바디 캡처
  pendingRequests: "pendingRequests",
  continueRequest: "continueRequest",
  fulfillRequest: "fulfillRequest",
  abortRequest: "abortRequest",
  responseBody: "responseBody",
  // 프레임 traversal(iframe 내부 조작 = isolated world). frames는 프레임 목록, frameOp는 프레임 문맥 op.
  frames: "frames",
  frameOp: "frameOp",
  // 에뮬레이션 심화(다크모드/타임존/오프라인 = CDP Emulation/Network). debugger 전용.
  emulateMedia: "emulateMedia",
  setTimezone: "setTimezone",
  setOffline: "setOffline",
};

// mode = 조작 전략. 생성 시 1회 선택(per-verb 플래그 금지).
// script: chrome.scripting(CDP 없음, 스텔스 = navigator.webdriver 미점화). isTrusted=false. 캡처/에뮬 미지원.
// debugger: chrome.debugger CDP Input.*(신뢰 입력, isTrusted=true) + 캡처/에뮬 전 표면. webdriver는 선제 개입으로 덮음.
export const MODE = { script: "script", debugger: "debugger" };

// 메시지 팩토리(offscreen 측). 항상 proto 버전을 실어 호스트가 검증한다.
export function makeMessage(op, fields = {}) {
  return { proto: PROTOCOL_VERSION, op, ...fields };
}
