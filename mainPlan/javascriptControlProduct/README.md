# JavaScript Control 제품화

## 목표

패키지 내부에만 있던 Control Protocol client와 PyProc Eyes APX 사용 경로를 설치 소비자가
`pyproc/control`에서 직접 가져다 쓰는 안정 JavaScript 제품 표면으로 승격하고 릴리즈한다.

## 구조

- `scripts/controlProtocol/controlClient.js`: protocol 대화, 취소, 오류, attachment 검증의 SSOT
- `scripts/controlProtocol/controlApi.js`: 설치된 `pyproc-control` 수명주기와 제품 동사
- `scripts/controlProtocol/controlApi.d.ts`: Node JavaScript 사용 계약
- `pyproc/control`: 위 API를 내보내는 안정 package subpath
- `tests/contracts/controlJsSdk.mjs`: 타입 밖의 동사, 오류, request 수명주기 계약
- `tests/browser/controlJsProduct.mjs`: packed install과 실제 브라우저 제품 여정
- `docs/usage/javascriptControl.md`: 설치, APX, screenshot, 종료 계약

## 종료 조건

1. 정확 버전으로 설치한 패키지에서만 `pyproc/control`을 import한다.
2. JavaScript가 preflight, Python 실행, checkpoint, browser lifecycle, APX query, verified action,
   screenshot attachment, artifact 삭제, 종료를 지원한다.
3. request ID 단회성, cancel, timeout, connection loss, attachment digest를 기존 Control Protocol과
   다르게 재해석하지 않는다.
4. Native CDP와 FrameSpace에서 공개 APX facade를 실제 브라우저로 검증한다.
5. 공개 Markdown import 예제, 타입, package, browser, Chrome과 Edge 릴리즈 게이트가 모두 통과한다.
6. README 영문과 한글판의 hero, 기능 지도, quick start, 제품 입구에 실제 출하 표면을 반영한다.
7. exact SHA의 CI 성공 뒤 버전, 태그, npm, GitHub Release, Python 배포 자산을 같은 버전으로 낸다.
8. 완료 뒤 이 카테고리와 `tests/attempts/controlJsSdk`만 삭제한다.

## 위험과 rollback

- 새 facade가 low-level client와 다른 outcome을 만들면 자동 재시도가 외부 effect를 중복할 수 있다.
  facade는 기존 client의 request terminal만 전달하고 별도 effect 재전송을 하지 않는다.
- child process 종료가 덜 닫히면 설치 앱이 남는다. owned process drain과 강제 종료 상한을 제품 게이트로
  고정한다.
- 공개 표면은 additive지만 한번 출하하면 유지 대상이다. 독립 제품 게이트가 깨질 경우 릴리즈 전에
  subpath와 문서, 타입을 함께 제거하는 것이 rollback이다.

## 진행

- [x] 내부 client의 packed install 실측과 공개 승격 판정: Edge 10/10
- [x] 안정 JavaScript API와 타입: `pyproc/control`
- [x] 계약 및 실제 브라우저 제품 게이트: contracts 17, Control product 14/14, Python SDK 5/5
- [x] README와 지속 문서 통합
- [ ] 릴리즈와 배포 확인
- [ ] 임시 카테고리 정리
