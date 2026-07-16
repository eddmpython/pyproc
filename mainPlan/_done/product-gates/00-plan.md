# 00. 관문별 구현 계획

## 관문 1 - push + CI 확인

영향 파일: `.github/workflows/ci.yml`, `.github/workflows/publish.yml`,
`scripts/fetchWasiAssets.mjs`.

- push(f331908..6ff9f80) 뒤 첫 CI에서 발견된 실패 2건을 forward patch한다:
  (1) 러너에 workspaces 링크가 없어 구조 게이트의 `@web-machine/*` import가 죽는다 ->
  구조/publish job에 `npm ci`(의존성 0, workspace 심볼릭 링크만 생성).
  (2) 리눅스 tar는 GNU tar라 zip을 못 다룬다(bsdtar는 Windows 내장) ->
  fetchWasiAssets에 추출(tar -> unzip)과 생성(tar -a -> zip) 폴백.
- web-computer job은 첫 CI에서 이미 GREEN(자산 다운로드 + 3-process E2E 러너 통과).
- 게이트: 수리 push 뒤 ci.yml 전 job GREEN.
- 롤백: 워크플로/스크립트 한정, 커밋 revert.

## 관문 2 - 릴리즈 v0.0.10 (명시 지시 이벤트, 이 이니셔티브의 완료 조건 아님)

- 절차 정본은 docs/operations/release.md. 실행: 전 게이트 green 재확인 -> package.json
  0.0.10 + 릴리즈 커밋(한국어) -> `git tag v0.0.10` 같은 커밋 -> main과 태그 push ->
  `gh release create`(영문 우선 노트, 하단 한국어) -> publish.yml(OIDC) 관찰 ->
  `npm view pyproc version` 확인.
- 노트 내용은 CHANGELOG Unreleased를 0.0.10 절로 승격한 것과 동일 요지: 브레이킹
  (SharedKernel 삭제, GPU/Socket/WASI subpath 강등, 별칭 3종 절삭) + 추가(PyProcError,
  체크포인트 핸들, soundness 수리, 문서 인프라).
- 게이트: `npm view pyproc version` == 0.0.10 + GitHub Release 발행 확인.
- 롤백: 게시는 되돌릴 수 없다(버전 번호 재사용 불가). 문제는 다음 버전의 forward patch다.

## 관문 3 - Stable 승격 체계

영향 파일: `docs/consuming/capabilityMatrix.md`, `tests/run.mjs`.

- capabilityMatrix에 "상태 라벨 승격 기준" 절을 신설한다:
  Stable = (a) CI 런타임 게이트가 실동작을 커버하고, (b) 마지막 브레이킹 이후 릴리즈
  1개 이상이 지났고(표면 동결 증거), (c) 30일 soak(게이트 연속 GREEN), (d) 경계 문서화. Beta = (a) + 경계 문서화. Experimental = 실행 표면과 검증
  명령 존재. Research preview = 실증 장치.
- 간판 레인의 승격 시계를 기록한다: reactive/session/journal은 0.0.10 릴리즈가
  "마지막 브레이킹" 기준점이며, 다음 릴리즈에서 (b)가 충족된다.
- 게이트: 기준 절 존재 + Stable 라벨 행 수가 기준 절의 승격 원장과 일치(라벨을 문서
  근거 없이 올리는 드리프트 차단).
- 롤백: 문서/게이트 한정.

## 관문 4a - 영문 비교 페이지

영향 파일: `docs/reference/comparison.md` 신규, `README.md`/`README.ko.md`(링크),
`tests/run.mjs`(앵커 게이트).

- 내용: canonical scenario(S0/S0C/S1/S1L/S2/S3/S4/S5) 설명, 후보(WebVM/JupyterLite/
  marimo) 대비 표. 수치가 아니라 **artifact 링크**가 셀 값이다(벤치 계약 준수).
  S2/S3/S4/S5의 경쟁 N/A와 사유를 전면에. 재현 명령 전부 수록. 정직한 캐비앗:
  S0/S2-S5 artifact는 운영자 기록형(bench:artifact)이고 자동 측정은 S1뿐이라는 것,
  측정일과 환경은 artifact 안에 있다는 것.
- 게이트: comparison.md가 존재하고 표의 모든 artifact 링크가 tracked 파일을 가리키며,
  README 양 언어가 링크한다.

## 관문 4b - 에이전트 통합 레시피 (MCP)

영향 파일: `scripts/mcpSandboxServer.mjs` 신규, `examples/mcpSandbox.html` 신규,
`tests/browser/mcpSandbox.mjs` 신규, `package.json`(scripts), `.github/workflows/ci.yml`
(게이트 배선), `README.md`/`README.ko.md`(사용 절), `docs/reference/api.md`(언급).

- 구조: MCP stdio 서버(newline-delimited JSON-RPC 2.0)가 COOP/COEP 정적 서버
  (examples/serve.mjs 재사용)와 headless Chromium(tests/browser/harness.mjs의
  findBrowser/headlessArgs 재사용)을 띄우고, 페이지(examples/mcpSandbox.html)가
  bootSession + enableReactive로 지속 파이썬 머신을 연다. 서버<->페이지 채널은
  게이트와 같은 훅 패턴: 페이지가 GET /mcpCommand를 long-poll하고 결과를
  POST /mcpResult로 돌려준다.
- 도구 4종: `pythonRun(code)`(실행 + 값/stdout 반환), `checkpointSave()`(핸들 인덱스),
  `checkpointRestore(index?)`(생략 시 마지막), `sandboxReset()`(cp0로 복귀).
  오류는 PyProcError code를 MCP 오류 응답에 실어 나른다.
- MCP 계약: initialize(protocolVersion 에코, capabilities.tools) ->
  notifications/initialized -> tools/list -> tools/call. content는 text 항목.
- 게이트(tests/browser/mcpSandbox.mjs): 서버를 자식 프로세스로 spawn해 stdio로
  initialize/tools/list 왕복, pythonRun("1 + 1") == 2, checkpointSave -> 오염 실행 ->
  checkpointRestore -> 상태 검증, sandboxReset 후 재실행. CI browser job에 스텝 추가.
- zero-dep 유지: 프로토콜은 손 구현(newline JSON-RPC), 브라우저 구동은 기존 하네스.
- npm scripts: `mcp:sandbox` = `node scripts/mcpSandboxServer.mjs`,
  `test:mcp` = `node tests/browser/mcpSandbox.mjs`.
- 공개 문서: README "Plug pyproc into an AI agent (MCP)" 절 - MCP 클라이언트(claude CLI) 등록 예시
  (`claude mcp add pyproc-sandbox -- node scripts/mcpSandboxServer.mjs`) 포함.

## 완료 절차

1. 전 게이트 GREEN(구조/브라우저/예제/패키지/설치 tarball/웹컴퓨터/MCP) + CI GREEN.
2. 원장 최종 기록 -> 폴더째 `_done/product-adoption/` 이관 + 인덱스 갱신.
