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
3. 릴리즈 v0.0.10 -> publish 관찰 -> npm 확인 -> 소비 3사 재핀.
4. 완결 이관.
