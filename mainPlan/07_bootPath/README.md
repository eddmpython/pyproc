# bootPath

부팅 경로의 계약을 하나로 만든다. 지금 기본 부팅은 탭 전역 체인에 들어가서 동시 부팅이 직렬화되고,
`boot()` 한 함수가 12개 옵션의 상호의존 분기와 인라인 fetch 캐시를 겸한다.

## Outcome brief

- 주 축: 속도, 클린코드
- 관측된 손실 지점: 머신 두 대를 동시에 띄우면 기본 설정에서 서로를 기다린다. 그 이유가 옵션 기본값에
  숨어 있어 소비자에게 보이지 않는다. 그리고 "loadPyodide를 주면 SRI 기본값을 끈다"는 규칙이 한 함수 안에
  두 곳에 각각 적혀 있고 인자 검증은 그 파생값을 계산한 뒤에 온다.
- 기대 변화: 동시 부팅이 실제로 동시에 되고, 부팅 옵션 규칙이 한 자리에서 읽힌다.
- 롤백 반경: 부팅은 모든 경로의 목이라 브라우저 게이트가 유일한 진짜 판정자다.

## 근거

- `src/runtime/runtime.js:102-104`: `opts.coreIntegrity === undefined && !opts.loadPyodide`면
  `DEFAULT_CORE_INTEGRITY`를 쓴다. 즉 **기본 부팅은 항상 coreIntegrity가 있다.**
- 같은 파일 `:107-109`: `opts.coreCacheDir || coreIntegrity`면 `cache`가 non-null이다. 기본값에서 항상 참이다.
- `:165-190`이 전역 `fetch`를 스왑하고 `Promise.race`로 무결성 실패를 먼저 깨며 `finally`로 복원한다. 그
  구간이 `opts.patchScope || runWithGlobalPatch`를 탄다(`:168-170`).
- `src/runtime/globalPatch.js:42-47`의 `patchChain.then(exec, exec)`는 전역 단일 체인이다. 따라서 **기본
  설정의 동시 `boot()` 두 개가 직렬화된다.**
- 같은 규칙의 두 번째 사본: `:157-159`가 `engineScriptIntegrity`에 대해 `:102-104`와 같은 판정을 반복한다.
  인자 검증(`:163` `if (opts.loadPyodide && opts.engineScriptIntegrity) throw`)은 그 뒤에 온다.
- `:110-147`의 38줄짜리 `cachedFetch` 클로저가 함수 본문 안에 인라인이다. `cache` 객체는 설정이자 통계
  누산기이자 `rejectIntegrity` 콜백 홀더로 세 역할을 겸한다(`:108`, `:172`, `:192`).
- `:129-132`가 예외를 **메시지 문자열**로 분류한다: `if (String(e).includes("integrity:")) throw e;`.
  그 `try`는 `getFileHandle` + `getFile` + `arrayBuffer` + `verifySri` 전부를 감싸므로 OPFS 권한 오류와
  프로그래밍 오류까지 "캐시 미스"로 흡수한다. `errors.js`가 code 계약을 세워 둔 자리에서 그것을 안 쓴다.
- 풀 memoize의 조건부 결함: `src/machine/composition/pyprocMachine.js:156`의 키는
  `describeOption`(`:31-37`)을 거치는데, 객체나 함수 값은 `WeakMap`으로 동일성 식별을 받는다. 따라서
  **객체 값 옵션(예: `jobs({ replay })`)을 매 호출 새 리터럴로 넘기면 키가 매번 달라져 호출마다 새 풀이
  붙는다.** 원시값만 넘기는 호출은 정상이다. `:148-153` 주석이 막겠다고 선언한 실패의 조건부 형태다.

## 입장 조건

- 01이 끝나 `WheelCache`의 `patchScope`가 배선돼 있다. 그러지 않으면 중첩 창 경로가 여전히 죽어 있어
  통합의 정당성을 검증할 수 없다.
- 동시 부팅 직렬화를 브라우저에서 먼저 실측한다. 두 머신 동시 `boot()`의 벽시계 시간이 순차 합에 가까운지
  확인하고 그 값을 이 문서에 적는다. 실측 없이 착수하지 않는다.

## 범위

포함

- 전역 패치 체인의 범위 축소(무결성 검증이 정말로 전역 스왑을 요구하는 구간만 남긴다)
- `resolveEngineTrust(opts)` 순수 함수로 옵션 규칙 단일화
- `coreAssetCache.js` 분리
- 캐시 미스 판정을 문자열에서 오류 code로 교체
- `proc()` memoize의 객체 옵션 키 계약 명시

제외

- `wheelCache.js`의 배선 자체는 01이다.
- 오류 코드 카탈로그 정적 게이트는 08이다.
- 스냅샷 부팅을 전용 워커로 옮기는 것은 09다.

## 구현 계약

1. **동시 부팅 직렬화를 푼다.** 전역 `fetch` 스왑이 필요한 이유는 Pyodide 내부 fetch를 가로채기 위함인데,
   그 창은 `loadPyodide` 호출 구간에 국한된다. 실측으로 최소 구간을 확인한 뒤, 전역 체인 대신 **부팅별
   격리**가 가능한지 판정한다. 불가능하면 그 사실을 `docs/operations/contractReality.md`에 계약 실태로
   기록하고, 최소한 대기 시간이 관측 가능하도록 `boot()`가 대기 구간을 보고하게 한다. 여기서 "불가능하니
   그대로 둔다"는 결론은 실측 근거와 함께여야 한다.
2. `src/runtime/coreAssetCache.js`를 신설하고 `createCoreAssetCache({ dir, integrity, indexURL })`이
   `{ fetchAsset(url), stats(), integrityFailure }`를 내게 한다. `normalizeCoreIntegrity`, `expectedCoreIntegrity`,
   `failIntegrity`, `CORE_MIME`, `cachedFetch`를 통째로 옮긴다.
3. `boot()` 상단에 `resolveEngineTrust(opts)` 순수 함수를 두고 `:102-104`, `:157-159`, `:163`의 세 규칙을 한
   자리에 모은다. **검증을 파생 전에** 놓는다.
4. `boot()` 본문을 "trust 해석 -> 캐시 생성 -> patch 창 안에서 로드 -> Runtime 조립" 네 단계로 줄인다.
5. `:129-132`를 `if (e?.code === "PYPROC_ASSET_INTEGRITY") throw e;`로 바꾸고, `try` 범위를 `getFileHandle`,
   `getFile`, `arrayBuffer`만 감싸도록 좁힌다. `verifySri`는 캐시 hit 확정 후 `try` 밖으로 뺀다. 그러면
   "캐시에 없다"와 "캐시 바이트가 변조됐다"가 구조로 갈린다.
6. `proc()`의 memoize 계약을 문서와 타입에 명시한다: 객체 값 옵션은 **동일 참조**여야 같은 풀이다. 그리고
   같은 형태의 옵션이 새 리터럴로 반복 전달되는 것을 게이트가 잡게 한다(같은 값의 옵션을 두 번 넘기면 풀이
   하나여야 한다는 단정. 참조 동일성 요구가 계약이라면 그 계약을 게이트로 굳히고, 아니라면 키 계산을
   구조 동등으로 바꾼다). 둘 중 어느 쪽인지 결정하고 그 결정을 이 문서에 적는다.

## 성능 계약

- 두 머신 동시 부팅의 벽시계가 순차 합보다 유의미하게 작아야 한다(1의 결론이 "격리 가능"일 때).
- `boot()` 자체의 시간 예산은 기존 `bootMs`를 그대로 쓴다. 이 캠페인은 부팅을 빠르게 하는 것이 아니라
  **동시성을 회복하는 것**이다.

## 영향 파일

기존: `src/runtime/runtime.js`, `src/runtime/globalPatch.js`, `src/machine/composition/pyprocMachine.js`,
`index.d.ts`, `tests/browser/gate.js`, `tests/browser/perfBudget.json`

신규: `src/runtime/coreAssetCache.js`

## 검증

- `npm run test:browser`가 유일한 진짜 판정자다(전역 fetch 스왑과 race는 브라우저에서만 성립한다)
- `npm test`, `npm run test:types`

음성 시험

- 무결성 거부: 잘못된 hash로 코어를 받게 하고 부팅이 거부되는지 본다. 5의 변경 뒤에도 거부 경로가 살아
  있어야 한다(지금은 문자열 매칭이 실패해도 race reject가 막고 있어 증상이 안 보인다. 그 이중 방어를
  분해하는 것이 이 항목의 위험이다).
- 캐시 미스와 변조 구분: 캐시에 파일이 없는 경우와 바이트가 변조된 경우가 서로 다른 경로로 가는지
  각각 단정한다. 5를 되돌리면 둘이 같은 경로로 합쳐져 RED가 되어야 한다.
- 동시 부팅: 두 부팅이 동시에 진행됨을 단정하는 게이트를 만들고, 전역 체인으로 되돌리면 RED가 되게 한다.
- `proc()` 풀: 같은 값의 옵션을 두 번 넘겨 풀이 하나인지 단정. 결정이 "참조 동일성이 계약"이면 반대로
  다른 참조가 다른 풀임을 단정한다. 어느 쪽이든 게이트가 그 결정을 못 박는다.

## 롤백

2, 3, 4는 순수 구조 변경이라 되돌리기 쉽다. 1과 5는 부팅 실패 모드를 건드리므로 각각 독립 커밋으로 내고,
브라우저 게이트가 RED면 그 커밋만 되돌린다.

## 커밋 분할

1. 동시 부팅 실측과 그 결과 기록(코드 변경 없음, 문서와 probe만)
2. `coreAssetCache.js` 분리
3. `resolveEngineTrust` 단일화 + 검증 순서 교정
4. 캐시 미스 판정을 code로 교체
5. 전역 체인 범위 축소(1의 결론에 따라) + 동시 부팅 게이트
6. `proc()` memoize 계약 확정 + 게이트
