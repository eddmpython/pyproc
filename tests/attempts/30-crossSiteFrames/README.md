# 교차 site iframe - 본문과 control을 같은 브라우저 과업에서 다룰 수 있는가

## 가설

최상위 문서의 접근성 트리는 iframe 본문을 포함하지 않는다. 같은 process frame은 `frameId`를 지정한
접근성 트리 읽기로 복구할 수 있고, 별도 process frame은 과업 탭에 속한 자식 CDP session을 붙여야 한다.
프레임의 출처와 문서 세대는 본문을 반환하거나 행동하기 전에 검증해야 한다.

## 졸업 게이트

1. Edge와 Chrome에서 같은 site iframe과 `127.0.0.1` 부모, `localhost` 자식의 실제 iframe 본문이
   legacy snapshot과 APX에 나오며 허용된 control을 누른다.
2. 허용 밖 frame의 본문과 DOMSnapshot entity는 반환하지 않고 행동은 전송 전에 거절한다.
3. 자식 frame 이동과 탈착 뒤 옛 locator는 거절되고 과업 밖 탭이나 frame에는 접근하지 못한다.
4. 격리 브라우저와 사용자의 브라우저에서 같은 공개 계약을 확인한다.

## 실행

`node tests/attempts/30-crossSiteFrames/frameAxProbe.mjs`

## 결론 표

| 날짜 | probe | 환경 | 핵심 관찰 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-09-27 | frameAxProbe | Windows Edge, loopback 합성 페이지 | root AX는 같은 frame 본문 0, `frameId` AX는 본문 1. 교차 site 본문 GET 1, 별도 iframe target 1, 부모 frame tree에서는 자식 0. 부모 session의 iframe 한정 `Target.setAutoAttach`로 자식 session을 받아 AX 본문 1 | 같은 process는 frame별 AX, 교차 site는 과업 탭 아래 flat 자식 session으로 복구 가능 | 기존 transport와 snapshot에 권한 및 생명주기 결합 |
| 2026-09-27 | browserControl, requestGuardProduct | 격리 Chromium, 허용/거부 loopback frame | legacy에 같은 process 및 OOPIF 본문이 나오고 OOPIF locator의 trusted click 1회. frame 이동 뒤 옛 locator 거절. 읽기 전용 OOPIF는 허용 본문만 관찰하고 POST는 거절 | 격리 브라우저의 legacy 읽기와 직접 자식 frame 행동 가능 | APX의 frame별 AX와 좌표 결합 |
| 2026-09-27 | userBrowserProduct, apxProduct | 설치된 Edge와 Chrome, 합성 frame | 양쪽 사용자 브라우저에서 과업 탭 OOPIF 본문과 trusted click. APX는 같은 process와 OOPIF의 미수집 AX를 `partial`로 표시하고 증거 재사용을 막으며 허용 밖 DOM 문서를 숨김 | 사용자 브라우저 통로의 가능성 확인, APX는 완전성 과장 없이 부분 관찰 | APX 본문과 행동 수용, 실제 사이트 실사용 |

## 설계

기존 `browserAutomation` snapshot, locator와 `webCdpSensor`가 프레임 권한을 검사한다. transport의 자식
session은 현재 과업 탭의 iframe만 허용한다. 새 공개 action이나 병렬 adapter는 만들지 않는다.

## 판정

진행 중. legacy의 직접 자식 frame 읽기와 행동은 로컬 후보에서 통과했다. 중첩 OOPIF 행동과 APX frame
본문 및 행동은 졸업 게이트에 남아 있다. 배포와 버전 변경 없이 로컬 후보에서 검증한다.
