# 릴리즈 - 버전과 태그, 소비 반영

## 버전 정책 (dartlab 정책 준용, 2026-07-11 확정)

- **릴리즈 = `package.json` 버전 +1 + 버전 태그 `v0.0.x`, 같은 커밋에 함께.** 두 값은 항상 동일하다. 태그는 버전 이력을 GitHub에서 사람이 확인하고(버전 간 diff·소스 열람), 이후 npm 퍼블리시·GitHub Releases·Dependabot류 감지의 전제가 된다.
- **명시 지시가 있을 때만** 릴리즈한다(남발 금지). 일상 커밋은 버전·태그를 건드리지 않으며, 소비자는 릴리즈 없이도 SHA 핀으로 최신 커밋을 정확히 가져갈 수 있다.
- **릴리즈 커밋 메시지**는 커밋 정책을 따른다: 한국어, 변경 성격 + 실제 변경 내용, 주체 중립(1인칭 금지), 도구·생성 흔적 금지.
- **공개 릴리즈 노트**(GitHub Release 본문·npm 페이지)는 공개 개발자 대면 표면이라 **영문 우선, 한국어는 아래에** 둔다(README 영문 우선 원칙과 정합. 대상 개발자 다수가 외국인). 노트는 릴리즈 커밋의 변경 요지를 사람이 읽기 좋게 옮긴 것이고, 영/한 둘 다 변경 성격 + 실측 수치 + 브레이킹 여부를 담는다. 커밋 메시지(한국어)와 공개 노트(영문 우선)는 별개 산출물이다.
- 브레이킹(공개 표면·subpath export·타입 시그니처 변경)은 릴리즈 노트(커밋 메시지 본문)에 명시한다. codaro가 컴파일 의존하는 시그니처는 [소비 계약](../consuming/contract.md) 참조.

## 릴리즈 절차 (명시 지시가 있을 때만)

1. `npm test` green + 브라우저 게이트 green([testing.md](testing.md)).
2. 문서 정합: README·mainPlan 진행 원장이 릴리즈 범위를 반영했는가.
3. `package.json` 버전 끝자리 +1 + 릴리즈 커밋(릴리즈 노트 = 커밋 메시지, 위 정책).
4. `git tag v0.0.x` (릴리즈 커밋에, package.json과 동일 값).
5. `main -> origin/main` 푸시 + `git push origin v0.0.x`.
6. **GitHub Release 발행**: `gh release create v0.0.x --title "v0.0.x - <한 줄 영문>" --notes-file <노트>`. 제목·노트 **영문 우선, 한국어는 노트 하단에**(위 정책). 태그만 있고 Release가 비면 배선 누락이다.
7. **npm 퍼블리시**: 자동이다. 5번의 태그 푸시가 [`publish.yml`](../../.github/workflows/publish.yml)을 깨우고, 워크플로가 태그와 `package.json` 버전 일치를 검증한 뒤 구조·브라우저 게이트를 돌리고 `npm publish`한다. 게시 확인은 `npm view pyproc version`.

## npm 퍼블리시 배선 (2026-07-12 확정)

- **손으로 `npm publish`하지 않는다.** 게시 경로는 워크플로 하나뿐이다. 로컬 게시는 게이트를 우회하고 provenance가 붙지 않으며, 로컬 npm 로그인은 조용히 만료된다(만료 시 `npm publish`가 권한 오류가 아니라 `404 PUT`으로 떨어져 원인 오독을 부른다. 실제로 겪었다). 게시 자격은 러너에만 있으면 된다.
- **인증은 npm Trusted Publishing(OIDC)**이다. 장수 토큰(`NPM_TOKEN` 시크릿)을 두지 않는다. 러너가 GitHub OIDC로 신원을 증명하면 npm이 단기 자격을 발급하므로 유출될 비밀이 없고 provenance(SLSA 출처 증명)가 자동으로 붙는다. 설정은 npmjs.com > pyproc > Settings > Trusted Publisher > GitHub Actions(repository `eddmpython/pyproc`, workflow `publish.yml`, Environment 없음, Allowed actions = `npm publish`). 패키지당 1회이고 **등록 완료 상태다**.
- **게시 전 관문 3개**(퍼블리시는 되돌릴 수 없다. 버전 번호는 재사용 불가): 태그와 `package.json` 버전 일치, 구조 게이트, 브라우저 게이트. 하나라도 적색이면 게시하지 않는다.
- **재시도·백필은 수동 실행**(`gh workflow run publish.yml --ref <ref>`). 게시 버전은 언제나 체크아웃한 ref의 `package.json`이다. 태그-버전 일치 검증은 태그 ref일 때만 돈다. 태그가 워크플로보다 먼저 나간 경우 태그 push로는 발동하지 않으므로(그 태그가 가리키는 커밋에 워크플로 파일이 없다) 이 경로로 게시한다.
- npm CLI는 워크플로가 `npm@latest`로 올린다. trusted publishing은 npm 11.5.1+에서만 동작하는데 node 22 번들은 10.x다.

## 소비 반영 (npm 버전 핀)

- 소비 제품은 **npm 정확 버전**을 핀한다: `"pyproc": "0.0.9"`(+ 락파일). 플로팅(`^`/`~`/`latest`) 금지. 재현성은 정확 버전 + 락파일이 보장하고, 릴리즈 없이 최신 커밋이 급하면 SHA 핀(`github:eddmpython/pyproc#<sha>`)이 대안이다.
- 소비자가 새 버전으로 올라올 때: 새 릴리즈 버전으로 되핀 + 소비자 쪽 빌드 3단계 확인(npm 해석, tsc 타입, 번들러 워커 emit).
- pyproc은 어떤 변경으로도 소비자를 즉시 깨지 않는다(핀이므로). 문제가 나면 소비자는 이전 버전으로 되핀하면 된다.

## Pyodide 버전 정합

- 기본 Pyodide는 `v314.0.2`(CPython 3.14). 스냅샷-fork가 Pyodide 밑줄(실험) API에 의존하므로 **Pyodide 버전 변경은 그 자체로 릴리즈 사유**이고, 세 소비 제품과 동시 이동해야 한다(xlpod 이관 전제).
- 버전을 올릴 때 최우선 재검증: `_makeSnapshot`/`makeMemorySnapshot`/`_loadSnapshot` 동작, JSPI, `setInterruptBuffer`/`setStdout`/`globals.get`/`PyProxy` 표면.
