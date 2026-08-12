# 릴리즈 - 버전과 태그

## 버전 정책 (2026-07-11 확정)

- **릴리즈 = `package.json` 버전 +1 + 버전 태그 `v0.0.x`, 같은 커밋에 함께.** 두 값은 항상 동일하다. 태그는 버전 이력을 GitHub에서 사람이 확인하고(버전 간 diff·소스 열람), 이후 npm 퍼블리시·GitHub Releases·Dependabot류 감지의 전제가 된다.
- **명시 지시가 있을 때만** 릴리즈한다(남발 금지). 일상 커밋은 버전·태그를 건드리지 않는다.
- **릴리즈 커밋 메시지**는 커밋 정책을 따른다: 한국어, 변경 성격 + 실제 변경 내용, 주체 중립(1인칭 금지), 도구·생성 흔적 금지.
- **공개 릴리즈 노트**(GitHub Release 본문·npm 페이지)는 공개 개발자 대면 표면이라 **영문 우선, 한국어는 아래에** 둔다(README 영문 우선 원칙과 정합. 대상 개발자 다수가 외국인). 노트는 릴리즈 커밋의 변경 요지를 사람이 읽기 좋게 옮긴 것이고, 영/한 둘 다 변경 성격 + 실측 수치 + 브레이킹 여부를 담는다. 커밋 메시지(한국어)와 공개 노트(영문 우선)는 별개 산출물이다.
- 브레이킹(공개 표면·subpath export·타입 시그니처 변경)은 릴리즈 노트(커밋 메시지 본문)에 명시한다. 공개 시그니처는 [패키지 계약](../usage/contract.md) 참조.

## 릴리즈 절차 (명시 지시가 있을 때만)

1. **릴리즈의 게이트 집합은 로컬 실행이 아니라 `publish.yml`이 도는 것이다**(`ci.yml`의 job 전부: structure, browser, edge-release, web-computer, web-machine-x86). 로컬 `npm test`와 `npm run test:browser`는 그 부분집합이고, `test:web-machine:v86`과 Edge `test:installed`는 로컬 기본 실행에 없다. 부분집합을 돌고 "게이트 green"이라 쓰지 않는다.
1-1. **태그를 붙이기 전에 그 커밋의 `ci` 실행이 success인지 확인한다**(`gh run list --commit <sha> --workflow=ci.yml`). 태그는 푸시 뒤 옮길 수 없고(force push 금지) 붉은 커밋의 태그는 버전 번호를 태운다. 0.0.12가 그렇게 탔다: 로컬은 초록이었지만 x86 레인이 하루 넘게 붉었고 게시 관문이 막았다. `.githooks/pre-push`가 이 확인을 기계로 집행한다(gh 부재 시 fail-closed).
2. 문서 정합: README, CHANGELOG, `docs/`, `tests/northStar.mjs`가 릴리즈 범위와 현재 공개 계약을 함께 반영했는가.
3. `package.json` 버전 끝자리 +1 + 릴리즈 커밋(릴리즈 노트 = 커밋 메시지, 위 정책).
4. `git tag v0.0.x` (릴리즈 커밋에, package.json과 동일 값).
5. `main -> origin/main` 푸시 + `git push origin v0.0.x`.
6. **GitHub Release 발행**: `gh release create v0.0.x --title "v0.0.x - <한 줄 영문>" --notes-file <노트>`. 제목·노트 **영문 우선, 한국어는 노트 하단에**(위 정책). 태그만 있고 Release가 비면 배선 누락이다.
6-1. **Python distribution 첨부**: 릴리즈 커밋에서 `python -m build pythonSdk --outdir <임시 경로>`로 wheel과 source distribution을 만들고 같은 GitHub Release에 첨부한다. 새 가상 환경이 exact wheel HTTPS URL을 설치하고 `importlib.metadata.version("pyproc-control")`로 같은 버전을 돌려주는지 확인한다. PyPI trusted publisher가 등록되기 전까지 이 Release 자산이 공식 Python 배포 경로다. 공개 문서에 bare `pip install pyproc-control==...`을 쓰지 않는다.
7. **npm 퍼블리시**: 자동이다. 5번의 태그 푸시가 [`publish.yml`](../../.github/workflows/publish.yml)을 깨우고, 워크플로가 태그와 `package.json` 버전 일치를 검증한 뒤 구조·브라우저 게이트를 돌리고 `npm publish`한다. 게시 확인은 `npm view pyproc version`.

## npm 퍼블리시 배선 (2026-07-12 확정)

- **손으로 `npm publish`하지 않는다.** 게시 경로는 워크플로 하나뿐이다. 로컬 게시는 게이트를 우회하고 provenance가 붙지 않으며, 로컬 npm 로그인은 조용히 만료된다(만료 시 `npm publish`가 권한 오류가 아니라 `404 PUT`으로 떨어져 원인 오독을 부른다. 실제로 겪었다). 게시 자격은 러너에만 있으면 된다.
- **인증은 npm Trusted Publishing(OIDC)**이다. 장수 토큰(`NPM_TOKEN` 시크릿)을 두지 않는다. 러너가 GitHub OIDC로 신원을 증명하면 npm이 단기 자격을 발급하므로 유출될 비밀이 없고 provenance(SLSA 출처 증명)가 자동으로 붙는다. 설정은 npmjs.com > pyproc > Settings > Trusted Publisher > GitHub Actions(repository `eddmpython/pyproc`, workflow `publish.yml`, Environment 없음, Allowed actions = `npm publish`). 패키지당 1회이고 **등록 완료 상태다**.
- **게시 전 관문 3개**(퍼블리시는 되돌릴 수 없다. 버전 번호는 재사용 불가): 태그와 `package.json` 버전 일치, 구조 게이트, 브라우저 게이트. 하나라도 적색이면 게시하지 않는다.
- **재시도·백필은 수동 실행**(`gh workflow run publish.yml --ref <ref>`). 게시 버전은 언제나 체크아웃한 ref의 `package.json`이다. 태그-버전 일치 검증은 태그 ref일 때만 돈다. 태그가 워크플로보다 먼저 나간 경우 태그 push로는 발동하지 않으므로(그 태그가 가리키는 커밋에 워크플로 파일이 없다) 이 경로로 게시한다.
- npm CLI는 워크플로가 검증한 exact `npm@11.19.0`으로 올린다. trusted publishing은 npm 11.5.1+에서만 동작하는데 node 22 번들은 10.x다. `latest`를 쓰지 않아 같은 태그가 시간에 따라 다른 게시 도구를 받지 않는다.
- GitHub Actions도 major tag가 아니라 감사한 40자리 commit SHA에 고정한다. `tests/run.mjs`의 승인 표와 workflow를 같은 변경에서 갱신하며, floating tag가 돌아오면 음성 fixture가 구조 gate를 RED로 만든다.
- 타입 컴파일러는 devDependency `typescript: 5.9.3`과 lockfile로 고정한다. 배포 package의 런타임 의존성 0 계약은 유지하면서 `npx`가 실행 시점의 다른 compiler를 받는 경로를 없앤다.

## 설치 재현성

- 공식 설치 예제는 **npm 정확 버전**을 사용한다: `"pyproc": "0.0.21"`(+ 락파일). 플로팅(`^`/`~`/`latest`)은 재현 가능한 제품 입구가 아니므로 문서에 두지 않는다.
- Python SDK는 같은 버전 GitHub Release의 exact wheel URL을 사용한다. wheel과 source distribution을 Release에 함께 첨부하고 clean venv에서 wheel 설치를 확인한다.
- 새 버전은 pyproc tarball 자체에서 npm 해석, 타입 검사, 워커 emit, 브라우저 부팅을 모두 통과해야 한다.
- 버전이나 태그는 북극성 점수의 증거가 아니다. 제품 능력은 저장소의 실행 계약과 실패 게이트로만 판정한다.

## Pyodide 버전 정합

- 기본 Pyodide는 `v314.0.2`(CPython 3.14). 스냅샷-fork가 Pyodide 밑줄(실험) API에 의존하므로 버전을 바꾸면 패키지 계약과 브라우저 gate를 함께 재검증해야 한다. 릴리즈 여부는 별도의 명시 지시로만 결정한다.
- 버전을 올릴 때 최우선 재검증: `_makeSnapshot`/`makeMemorySnapshot`/`_loadSnapshot` 동작, JSPI, `setInterruptBuffer`/`setStdout`/`globals.get`/`PyProxy` 표면.
