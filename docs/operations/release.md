# 릴리즈 - 버전, 태그, 소비 반영

## 버전 정책

- 버전은 `0.0.x` 라인. **버전 올림과 태그는 같은 것(릴리즈)이다.** 항상 같은 값으로 함께 움직인다: `package.json` 끝자리 +1 = `git tag v0.0.x`.
- **릴리즈는 소유자의 명시 지시가 있을 때만 한다.** 지시 없이 버전을 올리거나 태그를 만들지 않는다(남발 금지). 일상 커밋은 버전을 건드리지 않으며, 소비자는 SHA 핀이라 릴리즈 없이도 최신 커밋을 정확히 가져갈 수 있다.
- 브레이킹(공개 표면·subpath export·타입 시그니처 변경)은 릴리즈 노트(커밋 메시지 본문)에 명시한다. codaro가 컴파일 의존하는 시그니처는 [소비 계약](../consuming/contract.md) 참조.

## 릴리즈 절차 (소유자 지시가 있을 때만)

1. `npm test` green + 브라우저 게이트 green([testing.md](testing.md)).
2. 문서 정합: README·mainPlan 진행 원장이 릴리즈 범위를 반영했는가.
3. `package.json` 버전 끝자리 +1 + 커밋(한국어, 변경 범주 + 내용. 도구 흔적 금지).
4. `git tag v0.0.x` (package.json과 동일 값).
5. `main -> origin/main` 푸시 + `git push origin v0.0.x`.

## 소비 반영 (SHA 핀)

- 소비 제품은 태그가 아니라 **커밋 SHA**를 핀한다: `"pyproc": "github:eddmpython/pyproc#<sha>"`. 릴리즈 태그는 사람용 이정표이고, 설치 재현성은 SHA가 보장한다.
- 소비자가 새 버전으로 올라올 때: 릴리즈 커밋의 SHA로 되핀 + 소비자 쪽 빌드 3단계 확인(npm 해석, tsc 타입, 번들러 워커 emit).
- pyproc은 어떤 변경으로도 소비자를 즉시 깨지 않는다(핀이므로). 문제가 나면 소비자는 이전 SHA로 되핀하면 된다.

## Pyodide 버전 정합

- 기본 Pyodide는 `v314.0.2`(CPython 3.14). 스냅샷-fork가 Pyodide 밑줄(실험) API에 의존하므로 **Pyodide 버전 변경은 그 자체로 릴리즈 사유**이고, 세 소비 제품과 동시 이동해야 한다(xlpod 이관 전제).
- 버전을 올릴 때 최우선 재검증: `_makeSnapshot`/`makeMemorySnapshot`/`_loadSnapshot` 동작, JSPI, `setInterruptBuffer`/`setStdout`/`globals.get`/`PyProxy` 표면.
