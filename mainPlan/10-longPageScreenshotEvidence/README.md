# 긴 페이지 screenshot 경계 오류 정규화

## 접수 판정

- 관찰한 호출 제품과 목적: eddmpython의 전체 블로그 시각 검수에서 긴 글의 처음부터 푸터까지 증거를
  남기려 했다
- pyproc 소유라고 판정한 근거: 정확히 고정한 `pyproc@0.0.21`의 공개 JavaScript Control SDK에서
  `screenshot` action을 호출했고, 문서가 약속한 `BROWSER_AUTOMATION_SCREENSHOT_BOUNDS` 대신
  Chromium 원문 오류가 노출됐다
- 검색한 중복 후보와 차이: `mainPlan`, `skills`, `tests/attempts`, Git 이력에서 screenshot과 bounds를
  검색했다. 크기 제한과 오류 코드는 문서에 있지만 실제 content bounds 초과를 재현한 이니셔티브는 없다
- 현재 직렬 대기열 위치: 9번 종료 뒤 착수한 현재 이니셔티브다

## 정확한 환경

- 관찰 시각과 시간대: 2026-08-16 00:16부터 00:32, Asia/Seoul
- 소비 저장소 revision: `f3a9012fa7b184d7fcbe48e2cf56b63ca27ba958`, 작업 중인 블로그 변경 포함
- 해석된 pyproc 버전, 패키지 무결성 또는 소스 SHA: npm `pyproc@0.0.21`, integrity
  `sha512-Sv+1mlGW+VJ/utmSutBycjP/U0jodl/cZdwW31R/ECq4HyMIBHtIOjFiKVMscueV6q56yZgFSWyGEs+g7HnZJg==`
- 운영체제, 브라우저 이름과 정확한 버전, 런타임 버전: Windows 11 Home 10.0.26200,
  Microsoft Edge 151.0.4129.86, Node.js는 소비 저장소의 현재 실행 환경
- 사용한 공개 명령 또는 공개 API: `PyProcControlClient.start`, `openTarget`, `attachSession`,
  `client.act([{ kind: "screenshot", fullPage: true }])`, `Runtime.evaluate`, `deleteArtifact`
- 권한 manifest와 관련 설정의 비밀 제거 요약: `nativeCdp`, 로컬 합성 페이지 origin 하나,
  screenshot과 `Runtime.evaluate`, viewport 1440 x 1000 및 390 x 844, 외부 효과 승인

## 목적과 시작 상태

- 사용자가 달성하려던 결과: 독립형 긴 글의 데스크톱과 모바일 전체 화면을 실제 픽셀로 검수한다
- 대상 URL 범위, viewport, 페이지 상태, 사전 조건: 로컬 프로덕션 빌드의 합성 블로그 글 한 개,
  document height 37,894 CSS px와 41,605 CSS px, 폰트와 이미지 로딩 완료 상태
- 읽기, 외부 효과, 비가역 작업의 승인 경계: 로컬 페이지 탐색과 lazy hydration만 외부 효과로 승인했다.
  screenshot은 읽기이며 artifact는 소비 즉시 삭제했다

## 실행 기록

| 순서 | 목적 | 실행한 공개 명령 또는 API | 입력 경계 | 관찰 결과 | 증거 |
|---|---|---|---|---|---|
| 1 | 긴 페이지 전체 증거 | `screenshot` action | `fullPage: true`, 두 viewport | 두 경우 모두 raw CSS bounds 오류 | report SHA-256 `56D7DC83774E5CD41E17A17476D7BC796E6F036CBF9BC7E46BEBB37AFFE4194B` |
| 2 | 절대 clip 우회 확인 | `screenshot` action | 12,000px 높이 clip을 y축으로 이동 | y축 상단이 한계를 넘자 raw clip 오류 | report SHA-256 `88D271F73E031AACCCA358493A05EE64D9C42D2055A7A8CBD357398D175B35FA` |
| 3 | viewport scroll 우회 확인 | `Runtime.evaluate`, `screenshot` action | viewport 단위 scroll 뒤 일반 screenshot | 데스크톱 38장, 모바일 50장으로 통과 | report SHA-256 `40F29E05D19F1FC30F3828CF41724E325AF9D8FDA45964C477483B98F5DF2E7D` |

## 첫 불일치

- 처음 기대와 달라진 단계: 첫 `fullPage: true` screenshot action
- 기대 결과: content height가 문서의 32,768 CSS px 제한을 넘으면
  `BROWSER_AUTOMATION_SCREENSHOT_BOUNDS`로 측정값과 제한을 반환한다
- 실제 결과: `browser screenshot content height is outside the supported CSS bounds`라는 provider 원문이
  action 오류로 노출됐다
- 반환 코드, 오류 계약, 완료된 효과의 범위: 문서화한 오류 코드와 측정 metadata가 없었다.
  screenshot artifact는 생성되지 않았고 앞선 상단 screenshot만 완료됐다

## 재현성

- 최소 합성 재현 fixture 또는 절차: 높이 33,000 CSS px를 넘는 정적 문서를 열고
  `client.act`로 `fullPage: true` screenshot을 호출한다
- 반복 횟수와 성공, 실패 횟수: fullPage는 두 viewport에서 0회 성공, 2회 실패했다.
  절대 clip 우회도 두 viewport에서 0회 성공, 2회 실패했다
- 브라우저 재시작, 새 profile, viewport 등 바꿔 본 조건: viewport마다 Control client와 profile을 새로
  시작했고 1440 x 1000 및 390 x 844에서 같은 종류의 실패를 확인했다
- 재현하지 못한 조건과 남은 불확실성: content height가 32,768 CSS px 이하인 페이지는 같은 설치본에서
  통과했다. 정확한 Chromium 내부 최대값과 device scale별 차이는 별도 probe가 필요하다

## 증거

- 비식별화한 로그 또는 artifact 경로와 digest: 소비 저장소 밖 `visual/<run-id>/visual-report.json` 세 개의
  SHA-256을 실행 기록에 남겼다. 원본 페이지와 screenshot은 반입하지 않았다
- 스크린샷의 대상 상태, viewport, 촬영 단계와 digest: 실패 실행은 상단 화면 뒤 전체 화면 단계에서
  중단됐다. 성공 우회는 1440 x 1000과 390 x 844 viewport의 순서 있는 화면 조각을 남겼다
- DOM, 네트워크, console, 실행 receipt 가운데 판정에 사용한 것: document scrollHeight, viewport,
  action 오류 문자열, 생성된 screenshot 수, report digest를 사용했다
- 증거가 입증하는 범위와 입증하지 못하는 범위: 공개 action이 긴 content bounds에서 문서화한 오류로
  정규화되지 않는다는 점을 입증한다. Chromium 버전 전체의 물리 상한은 입증하지 않는다

## 시도한 대응

- 시도한 진단과 변경: 12,000px 절대 clip으로 나눈 뒤, 실제 viewport를 scroll하고 일반 screenshot을
  찍는 방식으로 바꿨다
- 각 시도의 결과: 절대 clip은 y축 좌표가 CSS bounds를 넘어 실패했고 viewport scroll은 두 viewport에서
  마지막 푸터까지 통과했다
- 소비 저장소 우회가 근본 해결이 아닌 이유: 호출자가 브라우저별 물리 상한을 추측해야 하고 raw provider
  오류에서 재시도 가능성과 권장 분할 크기를 복원해야 한다

## 영향과 안전 경계

- 영향을 받는 제품 흐름과 빈도: 긴 문서, 보고서, 무한 목록을 전체 screenshot으로 검수하는 모든
  Native CDP 소비 흐름에서 content height가 상한을 넘을 때 발생한다
- 심각도와 사용자가 보게 되는 실패: 시각 증거가 중간에서 빠지고 문서화되지 않은 문자열에 의존하게 되는
  중간 심각도의 검수 실패다
- 데이터, 권한, 외부 효과, 재시도 위험: screenshot 자체는 읽기다. scroll 기반 대응은 lazy loader와
  observer를 실행할 수 있으므로 별도 외부 효과 승인이 필요하다
- 기존 호환성 또는 공개 표면에 미치는 영향: 기존 action 입력은 유지할 수 있고 실패 오류의 정규화만으로
  최소 호환 개선이 가능하다

## 제안하는 pyproc 계약

- pyproc이 소유해야 할 동작: `fullPage`의 실제 content bounds를 CDP capture 전에 측정하고 제한을 넘으면
  `BROWSER_AUTOMATION_SCREENSHOT_BOUNDS`에 측정 width, height, 최대 dimension, 최대 area를 담는다.
  provider 원문은 공개 오류 message의 정본이 되지 않는다
- 공개 표면 변경 여부와 비목표: 새 root export 없이 기존 action 오류 detail을 보강한다.
  자동 scroll과 여러 artifact 반환은 한 action이 한 screenshot을 반환하는 계약을 바꾸므로 이번 최소 수정의
  비목표다
- 가장 작은 수용 테스트와 음성 시험: 32,768 CSS px 이하 fixture는 한 artifact로 GREEN,
  32,769 CSS px fixture는 정확한 code와 측정 detail로 RED가 되어야 한다. raw provider 오류가 노출되면
  음성 시험이 실패해야 한다
- 브라우저 실측 시나리오: Windows Edge와 CI Chromium에서 짧은 문서, dimension 초과 문서,
  area 초과 문서, absolute clip의 x와 y 초과를 각각 public Control 설치본으로 실행한다
- 완료 조건, 지속 문서 승격 위치, 계획과 attempt 삭제 조건: contract test와 installed browser gate가
  통과하고 browser automation troubleshooting에 detail schema와 scroll 대응 경계를 반영한다.
  완료와 같은 사이클에 이 계획과 대응 attempt를 삭제한다

## 다음 행동

- 선행 조건: 완료했다
- 첫 probe: 32,767px부터 32,769px까지 합성 문서와 scale 및 area 조합을 설치본에서 측정한다
- 예상 수정 소유 영역: Native CDP screenshot bounds 정규화, action error detail, contract 및 installed
  browser gate, browser automation reference
