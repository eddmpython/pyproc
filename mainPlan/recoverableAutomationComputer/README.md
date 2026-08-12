# 복구 가능한 자동화 컴퓨터

## 북극성

pyproc을 브라우저 탭 안의 Python 실행기에서, 여러 guest와 자동화 공간을 한 컴퓨터처럼 다루는
복구 가능한 제품으로 확장한다. JavaScript와 Python 소비자는 같은 언어 중립 명령 계약을 사용하고,
화면 관찰, 입력, 파일, 네트워크 증거, 실패 분류, 재현 가능한 실행 기록을 제품 표면으로 받는다.

복구 경계는 정직하게 나눈다. Python heap, 파일, process와 명령 기록은 checkpoint와 replay의
대상이다. 이미 외부 브라우저와 사이트에 발생한 효과는 되감았다고 주장하지 않는다. 대신 효과 전후의
증거와 완료 접두사, 결과 불명 상태를 보존해 재시도 여부를 기계적으로 판정한다.

## 고정 범위

이 이니셔티브가 끝날 때 다음이 모두 실제 설치물과 정식 게이트로 성립해야 한다.

1. state journal의 간헐 commit 유실이 결정적으로 재현되고 제거된다.
2. 전송과 언어에 독립적인 Control Protocol이 명령, 결과, 오류, 취소, 이벤트, 첨부물 계약을 소유한다.
3. 기존 JavaScript와 MCP 진입점이 같은 프로토콜을 사용하며 중복 의미론을 갖지 않는다.
4. 공식 Python SDK가 별도 JavaScript 작성 없이 로컬 stdio 제품을 시작하고 제어한다.
5. `AutomationSpace` 내부 계약이 공간의 생명주기, 권한, 화면, 입력, artifact, replay 경계를 고정한다.
6. 현재 CDP 제품은 `NativeCdpSpace` provider가 되고 스크린샷, DOM, network, tab, storage,
   runtime을 제품 수준 오류와 증거로 제공한다.
7. pyproc 페이지 안의 격리된 자동화 표면은 `FrameSpace`로 동작하고 허용 origin과 sandbox 경계를
   정식 브라우저 게이트로 증명한다.
8. `ReplaySpace`가 기록된 관찰과 동작을 외부 효과 없이 재생하며 Python checkpoint 이후 같은
   미완료 명령을 안전하게 이어 간다.
9. 브라우저 안에서 브라우저 guest를 다시 올리는 후보는 v86 probe로 메모리, 부팅, 렌더링, 입력,
   네트워크 가능성을 실측하고 제품 경계 또는 기각 근거를 확정한다.
10. 설치 패키지에서 JavaScript와 Python 양쪽의 실제 사용자 여정, 자동화 스크린샷, 실패 복구,
    권한 거부가 모두 통과한다.

실험 표면 동결을 유지한다. 새 npm root 값 export나 새 subpath export는 만들지 않는다. 새 제품 표면은
기존 설치 명령, 내부 프로토콜, 별도 Python 배포물과 provider 등록 지점 안에서 흡수한다.

## 순차 실행

한 단계의 RED 증거, 구현, 정식 회귀 게이트, 계약 문서가 끝나기 전에는 다음 단계의 제품 코드를
작성하지 않는다. 독립 조사만 병렬로 수행할 수 있다.

| 단계 | 작업 | 필수 증거 | 종료 조건 |
|---|---|---|---|
| 0 | 저널 유실 수리 | `tests/attempts/stateKernel` 결정적 RED, 복수 journal과 pack/prune/recover 스트레스 | 원인 불변식이 코드에 고정되고 Edge 반복 게이트가 전부 GREEN |
| 1 | Control Protocol | 새 attempts 캠페인의 wire fixture, 잘못된 version/순서/첨부물 음성 시험 | JavaScript와 MCP가 한 codec과 오류 체계를 공유 |
| 2 | Python SDK | 깨끗한 Python 환경에서 설치, stdio 기동, 명령, 취소, artifact 수신 | wheel과 source distribution을 빌드하고 실제 설치 통합 시험 통과 |
| 3 | AutomationSpace | 가짜 provider로 lifecycle, permission, effect, artifact, unknown outcome 시험 | provider 교체가 소비자 명령 의미론을 바꾸지 않음 |
| 4 | NativeCdpSpace | Chrome과 Edge의 screenshot, DOM, network, tab, storage, runtime 여정 | 기존 브라우저 제어 게이트가 provider 경유로 동등 이상 통과 |
| 5 | FrameSpace | same-origin, cross-origin, sandbox, navigation, screenshot 실측 | 허용된 frame만 조작되고 권한 이탈은 명시 오류 |
| 6 | ReplaySpace | 기록 변조, 누락 artifact, effect 재실행 방지, checkpoint 연계 음성 시험 | 외부 브라우저 없이 결정적 replay와 안전한 resume 통과 |
| 7 | v86 browser probe | cold/warm boot, heap, 첫 화면, 입력, network, screenshot 수치 | 제품 최소선 충족 시 provider 후보 계약, 미달 시 명시적 경계 문서 |
| 8 | 제품 졸업 | 설치물 양쪽 언어 여정, 전체 Node/브라우저/type 게이트, 계약 현실표 정리 | attempts 제거, 현재 문서 갱신, 이 이니셔티브 폴더 삭제 |

## 현재 실행 위치

- 단계 0 완료: 결정적 RED를 거쳐 Runtime+directory coordination domain, 주소 hint 존재 대조,
  storage epoch 공유를 구현했다. 정식 Edge 게이트 137/137과 Node 게이트 3595/3595가 통과했다.
- 단계 1 완료: strict NDJSON codec, 단일 ControlHost, page epoch와 queued cancel, ordered binary
  attachment를 구현했다. 기존 MCP 12/12, 설치 MCP 10/10, native 설치 제품 6/6, browser control
  71/71과 48-action stress가 같은 host에서 통과했다.
- 단계 2 완료: runtime dependency 0 `pyproc-control` Python SDK를 wheel과 source distribution으로
  빌드하고 서로 다른 clean venv에 설치했다. PATH 기반 제품 시작, Python과 checkpoint, 전달 뒤
  cancel, permission 사전 거부, Native CDP와 FrameSpace PNG attachment 여정이 Edge에서 5/5 통과했다.
- 단계 3 완료: `AutomationSpaceRouter`가 10개 canonical operation, authorize-before-execute,
  pre-cancel, lifecycle, artifact, restore와 replay 경계를 소유한다. fake provider 11/11과 정식
  contract suite가 통과했고 설치 MCP, native, Python 경로가 같은 router를 사용한다.
- 단계 4 완료: 제품 composition이 `NativeCdpSpace`를 직접 조립하고 `dom`, `network`, `target`,
  `storage`, `runtime`, `screenshot`, `artifact` 능력을 선언한다. provider probe 4/4, native 설치
  제품 7/7, 실제 Edge browser-control 71/71이 기존 오류와 effect 경계를 유지했다.
- 단계 5 완료: `FrameSpace`가 CDP port 없이 credentialless sandbox와 private `MessageChannel`을
  사용한다. control-token 공격 거부, same-origin과 허용 cross-origin, 부모와 storage 격리, partial
  outcome, 첫 effect unknown outcome과 PNG 음성 검증을 설치 Control과 MCP 제품 18/18 및 Python
  SDK로 검증했다. 임의 페이지와 trusted input은 지원한다고 주장하지 않는다.
- 단계 6 완료: `RecordingSpace`가 live provider terminal과 screenshot을 canonical SHA-256 chain과
  content-addressed sidecar로 저장하고 `ReplaySpace`가 provider 호출 없이 정확한 input 순서만 소비한다.
  설치 제품 14/14에서 Control/MCP preflight, unrecomputed mutation, missing sidecar, non-file target 거부,
  inline/non-inline
  byte-identical PNG, target 요청 0, identity/final/cursor/prefix resume을 고정했다. 기록 시작 전 0600
  초기 commit과 단일 writer lock, generation 원자 교체, symlink confinement, post-effect 실패 보수화,
  fatal latch, FIFO, shutdown drain도 계약화했다.
- 단계 7 진행: v86 Linux guest 안의 browser 후보를 cold/warm boot, heap, display, input, network,
  screenshot 수치로 승격 또는 기각한다.

## 제품 최소선

- 첫 명령부터 오류까지 request ID와 space ID로 추적 가능하다.
- 스크린샷은 PNG bytes, 크기, 시각, 대상, 원인 명령을 가진 artifact다.
- effect 명령은 권한과 목적 확인 뒤 한 번만 전송되고 결과 불명은 자동 재실행하지 않는다.
- 읽기 전용 관찰은 명시된 정책 아래 재시도할 수 있다.
- provider 종료, 브라우저 crash, protocol mismatch, timeout, 취소가 서로 다른 안정된 오류 코드다.
- 비밀과 원문 입력값은 기본 audit에 남지 않는다.
- 패키지 바깥 저장소 경로나 개발 checkout에 기대지 않는 설치 통합 시험이 있다.

## 외부 제품 검증

기존 외부 제품 점검 기록은 provider 구현의 사용자 여정 입력으로 사용한다. pyproc에서 고쳐야 하는
결함은 이 이니셔티브에서 구현하고, 각 제품이 소유한 GUI와 학습 흐름 개선은 해당 저장소의 계획
문서에만 남긴다. 다른 저장소를 pyproc 구현의 우회 경로로 수정하지 않는다.
