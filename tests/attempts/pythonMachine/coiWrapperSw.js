// coiWrapperSw.js - probe 전용 래퍼: 배포에서 pyprocSw.js를 스코프 루트에 사본으로 두는
// 패턴을 로컬에서 재현한다(SW는 스코프 상위 파일을 직접 등록할 수 없고, 헤더 없는 호스팅은
// Service-Worker-Allowed도 못 단다). 쿼리는 래퍼 URL(self.location)의 것이 그대로 읽힌다.
importScripts("../../../src/capabilities/pyprocSw.js");
