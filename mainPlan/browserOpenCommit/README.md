# Browser open commit boundary

상태: 검증

실제 Local 학습 제품에서 발견한 `browserOpen`의 load 대기를 제어권 확립 계약으로 바꾼다. 공개 루트
export나 새 subpath는 만들지 않고 설치된 `pyproc-mcp`의 기존 browser tool 안에서 완성한다.

## 측정 기준

- 기본 `browserOpen`은 navigation commit 뒤 제한 시간 안에 target을 반환해야 한다.
- 호출자가 원하면 `waitUntil`로 `domcontentloaded` 또는 `load`를 명시할 수 있어야 한다.
- 반환 시점의 최종 URL은 기존 exact-origin permission으로 다시 승인해야 한다.
- load가 끝나지 않는 페이지도 반환된 target에 attach하고 관찰할 수 있어야 한다.
- 실제 Local 학습에서 코드 입력, 실행, strong 검증, screenshot 저장을 끝내야 한다.
- 계약, Edge와 Chrome live gate, 설치 MCP gate, 전체 `npm test`가 모두 통과해야 한다.

## 순서

1. 완료: 실제 Local 제품에서 같은 240초 `browserOpen` 타임아웃을 두 번 측정했다.
2. 완료: commit 기본값과 명시적 wait option의 의도적 RED를 추가했다.
3. 완료: broker, MCP schema, 문서를 최소 계약으로 갱신했다.
4. 완료: 실제 Local 학습을 다시 완료하고 PNG와 SHA-256 증거를 남겼다.
5. 진행: 정식 gate를 통과시키고 열린 contract-reality 행과 이 폴더를 삭제한다.

## 영향 파일

- `scripts/browserControl/browserControlBroker.mjs`
- `scripts/browserControl/mcpBrowserControl.js`
- `tests/contracts/browserAutomation.mjs`
- `tests/browser/browserControl.mjs`
- `docs/usage/browserAutomation.md`
- `tests/attempts/agentBrowserUse/`
- `docs/operations/contractReality.md`

## 롤백

문제가 있으면 `waitUntil` 선택과 commit 기본값만 이전 load 기본값으로 되돌린다. target permission,
viewport, startup trace, attach 계약은 그대로 유지한다.
