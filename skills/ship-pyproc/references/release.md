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

## Engine identity changes

CPython source commit, WASI SDK, sysroot, compiler, flags, static module profile, engine bytes, stdlib bytes 또는
build manifest digest가 바뀌면 engine ID와 package release를 함께 검토한다. 두 격리 build의 declared
artifact가 byte-identical하고 installed browser gate가 exact 새 identity로 부팅해야 한다.

## Notes

GitHub Release와 npm notes는 영어 우선, 한국어를 아래에 둔다. 공개 숫자 자랑은 하지 않고 기능과 계약을
설명한다. 실측 숫자는 test artifact에만 남긴다.
