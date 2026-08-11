# Agent browser loop

상태: 진행

실제 Web 학습 여정에서 발견한 관찰과 편집의 단절을 제품 계약으로 닫는다. 공개 루트 export나 새
subpath는 만들지 않고 설치된 `pyproc-mcp`의 기존 browser tool 안에서 완성한다.

## 측정 기준

- 같은 페이지에서 기본 snapshot은 현재 동작과 호환돼야 한다.
- `mode: "interactive"` snapshot은 전체 AX tree에서 상호작용 control을 먼저 고른 뒤 `maxNodes`를
  적용해야 한다.
- interactive snapshot의 각 control은 기존 opaque `locatorRef`를 유지해야 한다.
- contenteditable 편집기의 `fill`은 DOM 표시뿐 아니라 편집기 change state를 갱신해야 한다.
- Web 학습의 코드 입력, 실행, strong 검증, screenshot 저장을 raw browser command 없이 끝내야 한다.
- Chrome과 Edge live gate, 설치 MCP gate, 전체 `npm test`가 모두 통과해야 한다.

## 순서

1. 완료: 실제품 Web과 Local을 설치 MCP 표면으로 측정하고 실패 증거를 attempt에 고정한다.
2. 진행: interactive snapshot과 trusted contenteditable fill의 의도적 RED를 추가한다.
3. 대기: catalog, MCP schema, automation 구현과 사용 문서를 갱신한다.
4. 대기: 실제품 Web 학습을 다시 완료하고 Local의 외부 차단을 분리 기록한다.
5. 대기: 정식 gate를 모두 통과시키고 열린 contract-reality 행과 이 폴더를 삭제한다.

## 영향 파일

- `scripts/browserControl/browserAutomation.js`
- `scripts/browserControl/browserAutomationCatalog.js`
- `scripts/browserControl/mcpBrowserControl.js`
- `tests/contracts/browserAutomation.mjs`
- `tests/browser/browserControl.mjs`
- `docs/usage/browserAutomation.md`
- `tests/attempts/agentBrowserUse/`
- `docs/operations/contractReality.md`

## 롤백

interactive mode는 opt-in이므로 mode schema와 선택 로직만 제거하면 기본 snapshot 호환 경로가 남는다.
trusted fill에 문제가 있으면 contenteditable 분기만 이전 DOM event 방식으로 되돌리고 input과 textarea
경로는 유지한다.
