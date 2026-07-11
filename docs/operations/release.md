# 릴리즈 - 버전 하나로 표식, 소비 반영

## 버전 정책

- **릴리즈 표식은 `package.json` 버전 하나뿐이다. git 태그는 만들지 않는다.** 소비가 전부 커밋 SHA 핀이라 태그가 맡을 역할이 없고, 표식이 두 개면 정합만 관리하게 된다(기존 원격 태그 v0.0.1~2는 이력으로만 남긴다).
- 버전은 `0.0.x` 라인. **소유자의 명시 지시가 있을 때만** 끝자리를 +1한다(남발 금지). 일상 커밋은 버전을 건드리지 않으며, 소비자는 릴리즈 없이도 최신 커밋을 정확히 가져갈 수 있다.
- **장기(외부 배포 개시 조건부)**: npm 퍼블리시를 시작하면 태그를 재도입한다. 근거: npm 버전과 git 이력을 잇는 다리(소스 확인·버전 간 diff), GitHub Releases, Dependabot류 갱신 감지가 전부 태그를 전제한다. 단 수동 이중 관리가 아니라 **릴리즈 절차 하나가 "버전 +1 커밋 -> npm publish -> 같은 커밋에 태그"를 함께 산출**한다(표식은 개념상 여전히 하나).
- 브레이킹(공개 표면·subpath export·타입 시그니처 변경)은 릴리즈 노트(커밋 메시지 본문)에 명시한다. codaro가 컴파일 의존하는 시그니처는 [소비 계약](../consuming/contract.md) 참조.

## 릴리즈 절차 (소유자 지시가 있을 때만)

1. `npm test` green + 브라우저 게이트 green([testing.md](testing.md)).
2. 문서 정합: README·mainPlan 진행 원장이 릴리즈 범위를 반영했는가.
3. `package.json` 버전 끝자리 +1 + 커밋(한국어, 변경 범주 + 내용. 도구 흔적 금지).
4. `main -> origin/main` 푸시. 태그는 만들지 않는다.

## 소비 반영 (SHA 핀)

- 소비 제품은 **커밋 SHA**를 핀한다: `"pyproc": "github:eddmpython/pyproc#<sha>"`. 설치 재현성은 SHA가 보장하고, 버전 필드는 사람용 이정표다.
- 소비자가 새 버전으로 올라올 때: 릴리즈 커밋의 SHA로 되핀 + 소비자 쪽 빌드 3단계 확인(npm 해석, tsc 타입, 번들러 워커 emit).
- pyproc은 어떤 변경으로도 소비자를 즉시 깨지 않는다(핀이므로). 문제가 나면 소비자는 이전 SHA로 되핀하면 된다.

## Pyodide 버전 정합

- 기본 Pyodide는 `v314.0.2`(CPython 3.14). 스냅샷-fork가 Pyodide 밑줄(실험) API에 의존하므로 **Pyodide 버전 변경은 그 자체로 릴리즈 사유**이고, 세 소비 제품과 동시 이동해야 한다(xlpod 이관 전제).
- 버전을 올릴 때 최우선 재검증: `_makeSnapshot`/`makeMemorySnapshot`/`_loadSnapshot` 동작, JSPI, `setInterruptBuffer`/`setStdout`/`globals.get`/`PyProxy` 표면.
