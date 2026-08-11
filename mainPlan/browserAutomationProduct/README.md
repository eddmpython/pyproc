# Browser Automation Product

## 북극성

`npm install pyproc` 뒤 설치 패키지의 `pyproc-mcp` 명령만으로 지속 Python Machine과 격리된
Chromium 자동화를 시작할 수 있어야 한다. screenshot과 download는 MCP 응답에 우연히 붙는 큰
문자열이 아니라 quota, 수명, digest, chunk 전송, 명시 삭제를 가진 제품 artifact여야 한다.

제품 문장:

> Install one package, start one scoped computer, automate Chromium, and retrieve bounded artifacts.

## 제품 완료의 의미

- repository checkout, `tests/`, deep import 없이 설치 패키지만으로 서버가 시작된다.
- 실행 진입점은 stable npm bin `pyproc-mcp`다. root value와 package subpath는 늘리지 않는다.
- 설정은 versioned JSON manifest와 기존 환경 변수 모두 지원하며 시작 전에 fail-closed 검증한다.
- browser executable, engine root 또는 pinned index URL, origin, action, raw method, file root, risk,
  외부 효과 승인, artifact quota가 하나의 시작 진단에 포함된다.
- `screenshot`은 순서형 action이라 navigate, fill, click 뒤 같은 pipeline의 정확한 위치에서 실행된다.
- PNG, JPEG, WebP, viewport, full-page, clip, quality가 정식 schema와 실브라우저 게이트를 가진다.
- screenshot과 download는 broker-owned artifact store에 들어가고 opaque `artifactRef`로만 노출된다.
- artifact는 byte, count, total, inline, chunk, TTL 상한을 갖고 read/delete 도구로 회수한다.
- CLI 종료, 명시 삭제, TTL 만료가 파일과 메타데이터를 함께 정리한다.
- package tarball, 설치 경로, 기본 Python-only MCP, Chrome, Edge, CI가 같은 계약을 증명한다.

## 착수 전 감사

### 이미 있는 것

- `scripts/browserControl/browserObservation.js`가 viewport PNG를 bounded base64로 반환한다.
- `browserAutomationCatalog.js`가 action schema, fixed risk, method와 event를 파생한다.
- `McpBrowserControl`이 opaque target/session과 8개 browser 도구를 조합한다.
- `mcpSandboxServer.mjs`가 Python Machine과 browser broker를 한 stdio MCP에 연결한다.
- Chrome과 Edge의 semantic action, popup, frame, download, cancellation 게이트가 있다.

### 제품화를 막는 현재 결손

- npm package가 broker와 MCP server를 의도적으로 제외하고 실행 가능한 CLI를 제공하지 않는다.
- `mcpSandboxServer.mjs`가 `tests/browser/harness.mjs`를 import해서 설치본에서 시작할 수 없다.
- screenshot은 snapshot 부가물인 PNG 한 종류이고 ordered pipeline action이 아니다.
- artifact가 응답 base64에만 살아 chunk read, TTL, quota 원장, 명시 삭제가 없다.
- download도 in-memory base64를 반환한 뒤 staging 파일을 지워 큰 파일 전송과 재회수가 어렵다.
- 설치 패키지 browser automation E2E가 없고 package gate는 broker 포함을 실패로 판정한다.

### 바꿀 심볼과 소비처

- launcher: `tests/browser/harness.mjs`, 모든 browser runner, `mcpSandboxServer.mjs`
- action catalog: MCP schema, policy method derivation, inspect, automation dispatch, docs
- observation/download artifact: contract tests, browser E2E, MCP payload, inspect counters
- package files/bin: package gate, installed package gate, CI, README 설치 명령
- tool 목록: default MCP 4도구 불변 게이트와 browser opt-in 도구 개수 게이트

### 깨질 수 있는 것

- 큰 screenshot이 MCP stdio를 막거나 profile disk를 무제한 점유할 수 있다.
- full-page capture가 비정상적으로 큰 document에서 메모리를 고갈시킬 수 있다.
- artifact ref가 broker 재시작 뒤 재사용되거나 path를 노출할 수 있다.
- chunk offset 검사가 약하면 파일 범위를 벗어나거나 다른 artifact를 읽을 수 있다.
- package에 broker를 넣으면서 npm JS import 표면까지 우연히 열릴 수 있다.
- product launcher가 사용자 기본 profile을 재사용하거나 종료 시 사용자 browser를 죽일 수 있다.
- JSON config와 환경 변수의 의미가 갈리면 같은 권한이 다른 방식으로 열릴 수 있다.

## 목표 구조

```text
package bin
  pyproc-mcp -> scripts/pyprocMcp.mjs
                    |
                    +-- versioned config validation
                    +-- scripts/mcpSandboxServer.mjs
                            |
                            +-- persistent Python Machine page
                            +-- product browser launcher
                            +-- McpBrowserControl
                                    |
                                    +-- BrowserAutomation
                                    +-- BrowserScreenshot
                                    +-- BrowserArtifactStore
                                    +-- BrowserDownload
```

```text
scripts/browserControl/
  browserLauncher.mjs       browser discovery, isolated profile, process-tree lifecycle
  browserArtifactStore.js   opaque ref, quota, TTL, chunk read, delete, cleanup
  browserScreenshot.js      capture options, layout and pixel guard, format validation
  browserAutomation*.js     ordered screenshot action and existing semantic effects
  mcpBrowserControl.js      tools, config, dispatch, inspect
```

## 실행 단계와 종료 증거

### 1. 실측과 계약

- `tests/attempts/browserAutomationProduct/`에서 viewport, full-page, clip, PNG, JPEG, WebP CDP
  primitive를 Chrome과 Edge에서 실측한다.
- document content size와 capture clip이 일치하고 각 format signature가 유효한지 확인한다.
- npm package와 현재 server 의존 그래프를 대조해 설치본에 필요한 파일만 확정한다.

종료: probe 결론 표가 두 브라우저 결과와 승격 구조를 기록한다.

### 2. 설치형 실행 표면

- browser discovery, args, profile, process-tree 종료를 product launcher로 옮긴다.
- test harness는 launcher를 재수출하고 리포트 판정만 소유한다.
- `pyproc-mcp --config <json>`과 `--check`를 제공한다.
- manifest schema version, 알 수 없는 key, 상대 경로, 빈 권한, 위험도 승인 누락을 시작 전에 거부한다.
- 설치본은 test 파일이나 repository example을 읽지 않는다.

종료: 임시 npm install 디렉터리에서 bin shim만으로 initialize와 Python 실행이 통과한다.

### 3. 제품 artifact와 screenshot

- artifact store는 per-artifact, total bytes, count, inline bytes, chunk bytes, TTL을 강제한다.
- artifact descriptor는 opaque ref, kind, MIME, byteLength, SHA-256, 생성과 만료 시각만 노출한다.
- `browserArtifactRead`는 bounded chunk와 다음 offset을 반환하고 `browserArtifactDelete`는 즉시 회수한다.
- `screenshot` action은 format, quality, fullPage, clip, optimizeForSpeed, inline을 검증한다.
- capture 전 CSS pixel area를 제한하고 반환 format signature와 byte quota를 검증한다.
- snapshot screenshot과 download도 같은 store를 사용한다.

종료: pipeline screenshot, chunk 재조립, digest, delete 뒤 stale ref, quota, TTL, close cleanup이 통과한다.

### 4. 패키지와 호환성

- npm bin과 필요한 Node/browser page 파일을 package allowlist에 싣는다.
- broker JS module은 package subpath로 export하지 않고 deep import도 계약으로 인정하지 않는다.
- package gate는 CLI 포함과 비공개 JS 표면을 동시에 검사한다.
- installed MCP product gate를 Chrome Linux와 Edge Windows CI에 배선한다.
- 기본 MCP 실행은 browser authority 없이 Python 4도구만 유지한다.

종료: packed install에서 CLI, Python, browser screenshot, artifact read/delete가 완주한다.

### 5. 운영과 문서

- README에 install, engine provision, config manifest, client 등록, 최소 screenshot workflow를 싣는다.
- usage 문서에 schema, artifact 수명, quota, 보안, 관측, 종료, 오류 복구를 싣는다.
- capability matrix와 package contract가 recipe가 아니라 shipped CLI로 같은 사실을 말하게 한다.
- 운영 문서에 Chrome/Edge matrix, artifact soak, config 음성 게이트를 기록한다.

종료: checkout 내부 경로를 모르는 소비자가 설치 문서만으로 시작할 수 있다.

### 6. 출시 품질 감사

- 신설 config, artifact, package, installed CLI gate에 고의 위반을 주입해 RED를 확인한다.
- contracts, types, package, default MCP, product MCP, browser control, stress, Chrome, Edge를 실행한다.
- catalog action, MCP schema, policy methods, docs, CI를 역방향 대조한다.
- npm 공개 root/subpath 불변, no dependency, no listener, broker-owned profile과 clean worktree를 확인한다.

종료: 완료 행렬의 모든 행이 현재 worktree의 직접 증거를 가진다.

## 완료 행렬

| 요구 | 직접 증거 | 완료 조건 |
|---|---|---|
| 설치 실행 | packed bin E2E | repository와 test import 없이 initialize |
| config | contract와 `--check` | version, key, path, permission fail-closed |
| screenshot | Chrome/Edge E2E | format, viewport/full-page/clip, ordered action |
| artifact | unit와 installed E2E | quota, TTL, chunk, digest, delete, close cleanup |
| download | browser E2E | screenshot과 같은 artifact read 계약 |
| 권한 | policy negative tests | origin, action, risk, path 전송 전 거부 |
| 공개 표면 | package/public-surface gate | bin 포함, root/subpath와 dependency 불변 |
| 기존 제품 | default MCP와 core browser | Python 4도구, runtime, checkpoint 회귀 없음 |
| 운영 | docs와 CI | 설치, 설정, 보안, 종료, 양 브라우저 지속 검증 |

## 종료 절차

각 행을 요구에서 코드와 실측으로 역추적한다. 직접 증거가 모두 확인되면 졸업한 attempts campaign을
삭제하고 정식 tests와 docs가 계약을 소유하는지 확인한다. 같은 사이클에 이 폴더를 삭제하고
`mainPlan/README.md`를 활성 이니셔티브 없음으로 되돌린다.
