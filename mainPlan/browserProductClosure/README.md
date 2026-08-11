# Browser Product Closure

## 북극성

설치된 `pyproc-mcp` 하나로 실제 웹 제품을 재현 가능한 화면 규격에서 열고, 첫 요청부터 관찰하고,
사용자가 보는 준비 상태를 기다리고, lazy asset을 명시적으로 적재하고, screenshot을 즉시 볼 수 있어야 한다.

제품 문장:

> Open deterministically, wait semantically, hydrate explicitly, and return a viewable screenshot.

## 실사용 점검에서 확인한 결손

- 자동화 profile의 기본 viewport가 764x485였고 manifest는 `browser.viewport`를 거부했다.
- opacity 0인 boot overlay가 DOM과 접근성 tree에는 남아 있어 attached 대기로는 준비 완료를 판정하지 못했다.
- full-page capture만으로 offscreen lazy image가 적재되지 않았고 명시 scroll 뒤에만 결과가 완성됐다.
- `browserOpen`이 URL을 먼저 연 뒤 attach하므로 첫 document의 console과 network 사건을 안정적으로 받지 못했다.
- screenshot artifact는 생성됐지만 MCP가 text JSON만 반환해 소비자가 chunk read, base64 decode, 파일 저장을 직접 했다.

## 제품 계약

### 결정적 시작

- manifest의 `browser.viewport`는 width, height, deviceScaleFactor, mobile, touch를 엄격히 검증한다.
- `browserOpen`은 허용 URL을 먼저 검증한 뒤 about:blank target에 내부 attach한다.
- Runtime과 Network를 navigation 전에 활성화하고 viewport를 적용한 뒤 URL로 이동한다.
- 첫 navigation이 load 또는 명시 timeout에 도달하면 redacted console과 network startup trace를 반환한다.
- 최종 URL origin은 다시 승인하며 redirect가 권한 밖이면 target을 닫고 `applied` 실패로 보고한다.
- 기존 `browserOpen -> browserAttach` 소비 순서는 유지한다.

### 의미 기반 준비 대기

- `waitFor`는 selector, opaque locatorRef, semantic locator 중 정확히 하나를 받는다.
- state는 attached, detached, visible, hidden, enabled, disabled, editable, stable을 지원한다.
- hidden은 target 부재 또는 사용자에게 보이지 않는 상태를 뜻한다.
- stable은 연속 관측에서 bounding rect가 허용 오차 안에 머문 상태를 뜻한다.
- strict locator와 stale locator는 성공으로 낮추지 않고 기존 오류 계약을 유지한다.

### 명시적 lazy hydration

- `hydrateLazy`는 externalEffect로 고정한다. scroll, observer callback, asset request가 외부 효과를 만들 수 있기 때문이다.
- viewport 비율 기반 step, 최대 scroll 수, settle 시간, 전체 timeout을 상한 안에서 검증한다.
- 문서 위에서 아래까지 sweep한 뒤 원래 scroll 위치로 돌아간다.
- 결과는 scroll 수, 시작과 종료 scrollHeight, lazy image의 pending 전후 수, 원위치 복원 여부를 반환한다.
- screenshot은 hydration을 암묵 수행하지 않는다. 호출자가 pipeline에 명시해 위험도를 볼 수 있어야 한다.

### native screenshot 전달

- screenshot은 기존 opaque artifact, digest, TTL, quota, chunk read 계약을 유지한다.
- inline 상한 안의 image artifact는 MCP `content`에 text descriptor 다음 native image block으로 붙는다.
- text descriptor에서는 중복 `dataBase64`를 제거한다.
- inline 상한을 넘는 image는 descriptor와 chunk read 경로만 유지하며 결과를 실패시키지 않는다.
- 한 pipeline의 screenshot 여러 장은 action 순서대로 image block을 돌려준다.

## 목표 구조

```text
pyproc-mcp manifest
  browser.viewport
        |
        v
browserOpen
  validate URL -> create blank target -> attach internally
  -> enable Runtime/Network -> apply viewport -> navigate
  -> verify final origin -> return targetRef + startup trace
        |
        v
browserAttach -> waitFor / hydrateLazy / screenshot
                                  |
                                  v
                         artifact descriptor
                         + MCP image content
```

## 실행 단계와 종료 증거

### 1. 실측과 계약

- `tests/attempts/browserProductClosure/`에서 viewport 적용, hidden 구분, bounded hydration,
  navigation 전 trace, screenshot image bytes를 실제 Chromium으로 입증한다.
- 실패와 성공 수치를 README 결론 표에 남긴다.
- contract reality에 다섯 gap을 먼저 등록한다.

종료: probe가 Chrome 또는 Edge에서 전 항목 GREEN이고 승격 레이어가 확정된다.

### 2. 시작과 viewport

- manifest schema와 환경 투영에 viewport를 추가한다.
- broker가 blank target을 내부 session으로 준비하고 계측, emulation, navigation 순서를 소유한다.
- startup trace는 event 수와 잘린 URL만 반환하며 header, query, body, cookie를 반환하지 않는다.
- attach된 session에도 같은 viewport를 적용해 기존 target 소비를 결정적으로 만든다.

종료: 첫 request와 초기 console이 trace에 있고 `innerWidth`, `innerHeight`, DPR이 manifest와 일치한다.

### 3. 준비 대기와 hydration

- locator resolver와 actionability 판정을 재사용해 `waitFor` state를 확장한다.
- `hydrateLazy`를 별도 externalEffect action과 schema로 추가한다.
- hidden overlay, 동적 enabled, 움직이는 target, offscreen lazy asset을 browser gate에 넣는다.

종료: raw script 없이 제품 action만으로 준비 판정과 lazy full-page capture 전처리가 끝난다.

### 4. native image MCP 결과

- MCP result composer가 payload 안의 bounded inline image artifact를 순서대로 수집한다.
- text JSON은 descriptor를 유지하되 inline bytes를 제거한다.
- error, Python tool, artifact chunk의 기존 text-only 계약은 바꾸지 않는다.

종료: 설치 패키지 E2E에서 screenshot 응답이 text 1개와 image 1개를 가지며 digest가 artifact와 같다.

### 5. 정식 게이트와 문서

- config contract, browser control, installed product gate를 확장한다.
- 신설 gate에 고의 위반을 넣어 RED 메시지가 실제 결손을 잡는지 확인한다.
- README와 browser automation usage 문서에 schema, 순서, risk, quota fallback을 적는다.
- Chrome과 Edge의 가능한 실행 경로를 모두 돌리고 `npm test`를 통과시킨다.

종료: 설치 문서만으로 viewport 지정부터 native screenshot 확인까지 재현된다.

## 완료 행렬

| 요구 | 직접 증거 | 완료 조건 |
|---|---|---|
| viewport | config contract와 browser E2E | width, height, DPR 일치, 잘못된 범위 fail-closed |
| first trace | browser E2E | 첫 document request와 초기 console 보존, query와 secret 미노출 |
| readiness | browser E2E | 8개 state와 semantic locator, timeout과 stale 오류 |
| hydration | browser E2E | offscreen asset 0에서 1 요청, bounded sweep와 원위치 복원 |
| native image | installed E2E | text와 image content, signature와 digest 일치 |
| 호환성 | 기존 contracts와 browser gates | 기존 open, attach, artifact chunk 흐름 유지 |
| 운영 | README와 usage 문서 | 위험도, 상한, fallback, 종료가 명시됨 |

## 종료 절차

완료 행렬을 코드와 현재 실행 결과로 역추적한다. 다섯 contract reality 행을 제거하고 attempts campaign을
삭제해 정식 tests와 docs로 증거를 승격한다. 같은 사이클에 이 폴더를 삭제하고 `mainPlan/README.md`를
활성 이니셔티브 없음으로 되돌린다.
