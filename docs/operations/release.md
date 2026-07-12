# 릴리즈 - 버전과 태그, 소비 반영

## 버전 정책 (dartlab 정책 준용, 2026-07-11 확정)

- **릴리즈 = `package.json` 버전 +1 + 버전 태그 `v0.0.x`, 같은 커밋에 함께.** 두 값은 항상 동일하다. 태그는 버전 이력을 GitHub에서 사람이 확인하고(버전 간 diff·소스 열람), 이후 npm 퍼블리시·GitHub Releases·Dependabot류 감지의 전제가 된다.
- **명시 지시가 있을 때만** 릴리즈한다(남발 금지). 일상 커밋은 버전·태그를 건드리지 않으며, 소비자는 릴리즈 없이도 SHA 핀으로 최신 커밋을 정확히 가져갈 수 있다.
- **릴리즈 노트 = 릴리즈 커밋 메시지.** dartlab 커밋 메시지 정책을 그대로 따른다: 한국어, 변경 성격 + 실제 변경 내용, 주체 중립(1인칭 금지), 도구·생성 흔적 금지.
- 브레이킹(공개 표면·subpath export·타입 시그니처 변경)은 릴리즈 노트(커밋 메시지 본문)에 명시한다. codaro가 컴파일 의존하는 시그니처는 [소비 계약](../consuming/contract.md) 참조.

## 릴리즈 절차 (명시 지시가 있을 때만)

1. `npm test` green + 브라우저 게이트 green([testing.md](testing.md)).
2. 문서 정합: README·mainPlan 진행 원장이 릴리즈 범위를 반영했는가.
3. `package.json` 버전 끝자리 +1 + 릴리즈 커밋(릴리즈 노트 = 커밋 메시지, 위 정책).
4. `git tag v0.0.x` (릴리즈 커밋에, package.json과 동일 값).
5. `main -> origin/main` 푸시 + `git push origin v0.0.x`.
6. **GitHub Release 발행**: `gh release create v0.0.x --title "v0.0.x - <한 줄>" --notes-file <노트>`. 노트는 릴리즈 커밋 메시지 내용을 사람이 읽기 좋게 옮긴 것(한국어, 변경 성격 + 실제 변경 + 실측 수치, 브레이킹 여부 명시). 태그만 있고 Release가 비면 배선 누락이다.
7. **npm 퍼블리시**: 릴리즈 커밋(= 태그 커밋)에서 `npm publish`, 이어서 `npm view pyproc version`으로 게시 확인. 머신 인증이 없으면 `npm login`(브라우저 인증, 대화형이라 터미널에서 직접) 선행. 릴리즈 후 커밋이 이미 쌓였다면 `git checkout v0.0.x`에서 퍼블리시하고 main으로 복귀한다.

## 소비 반영 (SHA 핀)

- 소비 제품은 **커밋 SHA**를 핀한다: `"pyproc": "github:eddmpython/pyproc#<sha>"`. 설치 재현성은 SHA가 보장하고, 버전 필드는 사람용 이정표다.
- 소비자가 새 버전으로 올라올 때: 릴리즈 커밋의 SHA로 되핀 + 소비자 쪽 빌드 3단계 확인(npm 해석, tsc 타입, 번들러 워커 emit).
- pyproc은 어떤 변경으로도 소비자를 즉시 깨지 않는다(핀이므로). 문제가 나면 소비자는 이전 SHA로 되핀하면 된다.

## Pyodide 버전 정합

- 기본 Pyodide는 `v314.0.2`(CPython 3.14). 스냅샷-fork가 Pyodide 밑줄(실험) API에 의존하므로 **Pyodide 버전 변경은 그 자체로 릴리즈 사유**이고, 세 소비 제품과 동시 이동해야 한다(xlpod 이관 전제).
- 버전을 올릴 때 최우선 재검증: `_makeSnapshot`/`makeMemorySnapshot`/`_loadSnapshot` 동작, JSPI, `setInterruptBuffer`/`setStdout`/`globals.get`/`PyProxy` 표면.
