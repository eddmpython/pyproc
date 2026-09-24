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

`publish.yml`이 실행하는 전체 job 집합이 릴리즈 판정의 정본이다. 로컬 부분집합을 전체 green으로 표현하지
않는다.

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
