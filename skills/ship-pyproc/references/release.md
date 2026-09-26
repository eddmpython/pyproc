# Release

릴리즈는 명시 지시가 있을 때만 수행한다. 버전 증가, 같은 버전 tag와 릴리즈 commit은 한 단위다.

## Required evidence

1. `npm test`
2. `npm run test:types`
3. `npm run test:contracts`
4. `npm run test:package`
5. `npm run test:engine-independence`
6. Chrome과 Edge의 `npm run test:browser`
7. Chrome과 Edge의 `npm run test:installed`
8. 변경 범위에 해당하는 product와 Web Machine gates
9. Python 배포 입력(`pythonSdk/`, `scripts/pythonSdkBuilder/`, canonical npm package recipe)이 바뀐 릴리즈는
   `python-distribution-reproducibility`의 Ubuntu와 Windows platform wheel byte 동일 receipt

`publish.yml`이 실행하는 전체 job 집합이 릴리즈 판정의 정본이다. 로컬 부분집합을 전체 green으로 표현하지
않는다.

## Python distributions

`publish.yml`의 `python` job이 npm 게시 뒤 같은 commit에서 `npm run package:python`으로 sdist, 순수 wheel,
platform wheel 두 개(`win_amd64`, `manylinux_2_28_x86_64`)와 `python-distributions-manifest.json`을 만든다.
platform wheel이 싣는 npm package의 integrity가 방금 게시한 `pyproc@<version>`과 다르면 멈추고, 같으면 build
provenance를 서명한 뒤 tag의 GitHub Release에 첨부한다. Release가 아직 없으면 notes가 빈 draft를 만든다. 같은
이름의 자산이 이미 있으면 덮어쓰지 않고 실패한다.

번들 Node는 `scripts/pythonSdkBuilder/pythonDistributionLock.json`이 nodejs.org 공식 archive의 SHA-256으로
고정한다. Node 22 보안 릴리스가 나오면 lock의 version, archive 이름, SHA-256(공식 `SHASUMS256.txt`)을 함께
올리고 `test:python-sdk`와 `python-distribution-reproducibility`를 다시 통과시킨다.

Windows native host(사용자 브라우저 host `userBrowserHost`, 브라우저 데스크톱 도우미 `browserDesktop`)도 같은 lock의
`nativeHosts`가 고정한다. Rust toolchain은 `nativeHosts.toolchain` 하나이고, host마다 `nativeHosts.components.<이름>`이
`sourceTree`, `archive`, `url`, `sha256`을 둔다. host 원본(`scripts/nativeHostBuilder/buildNativeHost.mjs`의
`NATIVE_HOSTS`가 이름마다 원본 폴더를 정한다)이나 toolchain이 바뀌면 `native-hosts` workflow가 host마다 같은 runner
image에서 두 번 따로 빌드해 byte가 같은지 보고 build provenance를 붙인 검증 자산(원본 Git tree id의 앞 12자리를 이름에
담은 zip 하나: 실행 파일, 제3자 고지, `<이름>.json` 식별)을 남긴다. 식별에는 빌드한 commit이 들어가므로 lock은 그
commit이 아니라 다음 commit에서 고친다. 순서는 원본 commit push, `native-hosts` 검증 자산 내려받기, 그 zip을 zip 이름에서
`.zip`을 뺀 태그(`pyproc-<host 이름>-<tree 12자리>`)의 프로젝트 release 자산으로 올리기, lock 고정 commit이다. platform
wheel 빌드는 commit의 host 원본 tree id가 lock과 다르면 멈추므로 고정하지 않은 host가 wheel에 실리지 않고,
`tests/contracts/pythonDistributions.mjs`는 `NATIVE_HOSTS`의 모든 host가 그 순서대로 고정되어 있는지 본다.

## Breaking disclosure

공개 타입 표면은 `package.json` exports의 각 `types` 대상이 내보내는 이름 전체다(값과 타입). 이름을 지우거나
바꾸는 변경은 같은 커밋에서 CHANGELOG `## Unreleased`의 `### Breaking` 표에 한 행씩 공시한다.

| Removed | Replacement |
|---|---|
| `pyproc/runtime: OldName` | `pyproc/runtime: NewName`, 또는 대체가 없으면 `none`과 이유 |

`tests/contracts/publicTypeSurface.mjs`가 마지막 릴리즈의 표면(`tests/contracts/publicTypeSurface.json`)과
현재 표면을 대조해 공시 없는 제거와 사라지지 않은 이름의 공시를 모두 거절한다. 릴리즈 커밋은 Unreleased
내용을 새 버전 절로 옮기고 `node tests/contracts/publicTypeSurface.mjs --write`로 기준선을 그 버전으로 갱신한다.
GitHub Release와 npm 노트는 Breaking 표를 그대로 싣는다. 이름을 더하기만 한 릴리즈와 표면이 같은 내부 이동은
표가 필요 없다.

배포 문서의 manifest 예제와 필드 표는 doctor와 같은 validator를 통과해야 한다. `tests/contracts/machineEntrance.mjs`가
문서의 JSON 예제를 validator에 넣고, 필드 표가 validator에 없는 필드를 설명하면 거절한다.

## Engine identity changes

CPython source commit, WASI SDK, sysroot, compiler, flags, static module profile, engine bytes, stdlib bytes 또는
build manifest digest가 바뀌면 engine ID와 package release를 함께 검토한다. 두 격리 build의 declared
artifact가 byte-identical하고 installed browser gate가 exact 새 identity로 부팅해야 한다.

## Notes

GitHub Release와 npm notes는 영어 우선, 한국어를 아래에 둔다. 공개 숫자 자랑은 하지 않고 기능과 계약을
설명한다. 실측 숫자는 test artifact에만 남긴다.
