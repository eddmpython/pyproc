# 01. 진행 원장

## 2026-07-16 - 개설과 관문 1 착수

확인한 현재 상태:

1. core-surface-hardening 완결 직후. 로컬 main 14커밋을 origin/main에 push했다
   (f331908..6ff9f80).
2. 첫 CI 결과: web-computer job GREEN(러너에서 자산 다운로드 + 3-process E2E 통과.
   신설 job이 첫 실행에 성립), 어제 실패했던 examples(speedLab 1.98x)도 이번엔 통과.
   실패 2건: (a) 구조 게이트가 `@web-machine/core` 해석 실패 = 러너에 workspaces
   링크 없음(`npm ci` 누락), (b) fetchWasiAssets가 GNU tar로 zip 추출 시도(bsdtar는
   Windows 내장이라는 가정이 리눅스에서 깨짐).

결정:

1. CI 수리는 forward patch: 구조/publish job에 `npm ci`(의존성 0 불변, workspace
   링크만), zip 도구는 추출 tar->unzip, 생성 tar->zip 폴백.
2. 릴리즈는 v0.0.10(현재 0.0.9). CHANGELOG Unreleased를 0.0.10 절로 승격하고 공개
   노트는 영문 우선.
3. Stable 승격 기준의 (b) "마지막 브레이킹 이후 릴리즈 1개"의 기준점은 0.0.10이다:
   이번 릴리즈가 브레이킹 묶음이므로 간판 레인의 승격은 다음 릴리즈에서 판정된다.
   지금 라벨을 올리지 않는 것이 정직이다(체계 구축이 이 이니셔티브의 산출물).
4. MCP 레시피는 zero-dep 손 구현(newline JSON-RPC + 기존 serve/harness 재사용).
   npm 패키지 표면이 아니라 레포 레시피로 배포한다(files 불변).

NEXT:

1. CI 수리 push -> 전 job GREEN 확인.
2. 관문 3/4 구현(승격 체계, comparison.md, MCP 레시피 + 게이트).
3. 릴리즈 v0.0.10 -> publish 관찰 -> npm 확인.
4. 완결 이관.

## 2026-07-16 - 관문 3/4 구현 완료, 릴리즈는 명시 지시 대기

구현 완료:

1. 관문 3: capabilityMatrix에 승격 기준(Stable/Beta/Experimental/Research preview 조건)과
   승격 원장을 명문화. 구조 게이트가 원장 밖 Stable 라벨을 차단한다. 간판 레인의 (b)
   기준점은 v0.0.10.
2. 관문 4a: docs/reference/comparison.md(영문) 신설. 셀 값 = artifact 링크, N/A = 사유
   동반, 재현 명령 + 정직한 캐비앗. 시나리오 8종/후보 3종/README 링크를 게이트로 고정.
3. 관문 4b: MCP 레시피(서버/머신 페이지/게이트) 구현. 로컬 test:mcp 7/7 GREEN(부팅 포함
   첫 호출 4.5s, 복원이 오염 소거, 도구 실패는 isError). CI browser job에 배선.
   README 양 언어에 에이전트 장착 절.

CI 실검증이 잡아낸 회귀 2건(수리 완료):

1. wasiGate/wasiGuestAdapter가 강등된 루트 export(bootWasi)를 import한 채 남아 무보고
   타임아웃 - 소스 경로 import로 수리, wasiGate 10/10(부팅 746ms). 이전 전수 grep이
   tests의 html을 빼먹은 것이 원인이라 재검 범위를 넓혀 잔존 0 확인.
2. speedLab 완주 게이트가 공유 러너(4 vCPU)의 물리 한계(1.90-1.98x < 2.0)에 걸림 -
   완주 게이트 문턱만 ?minSpeedup= 파라미터화(CI 1.3), 속도 인증 기준(S1 2.0)은 불변.

릴리즈 차단 기록:

- v0.0.10 릴리즈 절차(버전+태그+노트) 착수가 권한 계층에서 거부됐다: CLAUDE.md의
  "0.0.x 라인에서 명시 지시가 있을 때만 릴리즈" 규칙상 "끝까지 구현하자"는 릴리즈
  명시 지시로 인정되지 않는다는 판정. 우회하지 않는다. 릴리즈는 사용자의 명시
  지시("v0.0.10 릴리즈해라" 등) 이후 재개한다.
- 릴리즈 준비물은 전부 완료 상태다: CHANGELOG Unreleased(브레이킹 전수 + 마이그레이션),
  release.md 절차, publish.yml(OIDC) 게이트, 로컬 전 게이트 GREEN.

## 2026-07-17 - 완결

정리 결정: v0.0.10 릴리즈를 이 이니셔티브의 완료 조건에서 분리한다. 릴리즈는 코드나
문서로 구현하는 항목이 아니라 "명시 지시가 있을 때만" 발생하는 이벤트다(CLAUDE.md
절대 게이트). 구현으로 닫을 수 없는 것을 완료 조건에 넣은 것이 개설 시 설계 실수였다.
지우는 것이 아니라 재개 지점으로 남긴다.

최종 게이트(전부 GREEN):

1. `npm test` 구조 게이트 1002/0(승격 원장 정합, 비교 페이지 앵커, 문서 인프라 포함).
2. CI 3 job(structure/browser/web-computer) GREEN. wasiGate 실자산 10/10(부팅 746ms).
3. `npm run test:mcp` 7/7(부팅 포함 첫 호출 4.5s, 복원이 오염 소거, 도구 실패는 isError).
4. 로컬 브라우저/예제/패키지/설치 tarball/Web Computer 3-process E2E GREEN.

재개 지점(이 이니셔티브 밖):

1. **v0.0.10 릴리즈는 명시 지시 대기.** 지시가 오면: 버전 +1 + 태그 같은 커밋 ->
   push -> `gh release create`(영문 우선 노트) -> publish.yml(OIDC) 관찰 ->
   `npm view pyproc version` 확인. 노트 정본은 CHANGELOG Unreleased 절이다.
2. 간판 레인(reactive/session/journal)의 Stable 승격은 다음 릴리즈 시점에 승격 기준
   (a)(c)(d)로 재판정한다. (b)의 기준점이 v0.0.10이다.

현재 구현 상태: 완료. 폴더를 mainPlan/_done/product-gates/로 이관한다.
