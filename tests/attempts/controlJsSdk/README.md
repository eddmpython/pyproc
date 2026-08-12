# controlJsSdk - 내부 Control client를 안정 JavaScript 제품으로 승격할 수 있는가

## 가설

설치 패키지에 이미 포함된 strict Control Protocol client는 MCP나 Python과 별도 의미론을 만들지 않고
Node JavaScript용 제품 facade를 제공할 수 있다. packed install이 실제 브라우저에서 machine, APX,
verified attachment, cancellation을 통과하면 새 driver가 아니라 기존 제품 host의 안정 소비 표면이다.

## 졸업 게이트

1. 현재 internal deep path client가 packed install에서 Control operation 전체와 APX, PNG attachment,
   cancellation을 실제 Chromium 또는 Edge에서 통과한다.
2. 공개 `pyproc/control` import가 같은 여정을 통과하고 deep path import가 제품 게이트에서 사라진다.
3. 공개 Markdown import 실행 대조, `.d.ts` typecheck, package export 검사가 green이다.
4. timeout과 transport failure가 `outcomeUnknown`, `retryable: false`보다 좁게 오판되지 않는다.
5. 패키지 런타임 의존성 0과 root export 6개가 유지된다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-13 | `jsClientProbe.mjs` | Windows, packed install, Edge | 제품 여정 10/10 | 공개 승격 바닥 통과 | 지원 API, 타입, 독립 설치 게이트 구현 |

## 모듈화 설계

wire codec과 request ledger는 `controlClient.js`, 설치 프로세스 수명주기와 제품 동사는
`controlApi.js`, APX facade는 `controlApi.js`의 provider-neutral `automation.observe`와
`automation.act` 위에 둔다. 공개 subpath는 두 모듈의 지원 class만 내보낸다. root와 browser runtime
레이어에는 Node stream 또는 child process가 들어가지 않는다.

## 공개 표면, 실패 경계, rollback

- 추가 표면: 안정 `pyproc/control` subpath
- 실패 경계: `ControlRemoteError`의 `code`, `outcome`, `retryable`, `details`; verified attachment만 노출
- rollback: 릴리즈 전 gate 실패 시 subpath, 타입, 사용 문서를 함께 제거한다. wire operation은 바뀌지 않는다.

## 판정

내부 제품 바닥 졸업. 공개 `pyproc/control` 설치 여정과 타입 게이트를 완성한 뒤 본진으로 승격한다.
