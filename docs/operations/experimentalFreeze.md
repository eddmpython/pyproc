# Experimental 표면 동결

기존 Beta/Experimental 계약을 안정화하는 동안 새 공개 capability와 새 package subpath를 추가하지
않는다. 내부 리팩터링, soundness 수정, 문서·타입·consumer gate 강화는 허용한다.

동결된 Experimental subpath는 다음 셋이다.

- `pyproc/gpu`
- `pyproc/socket`
- `pyproc/wasi`

root value export는 `boot`, `open`, `createWebComputer`, `checkEnvironment`, `PyProcError`,
`PYPROC_ERROR_CODES` 여섯 개로 고정한다. 안정 plumbing은 `pyproc/runtime`, `pyproc/history`,
`pyproc/machine`, `pyproc/assets`이고 `pyproc/worker`는 실행 자산 entrypoint다.

동결 해제 조건은 전부 충족해야 한다.

1. 공개 Markdown import 예제가 설치 package에 대해 실행 대조된다.
2. `index.d.ts`와 모든 subpath type gate가 green이다.
3. 추가하려는 표면에 독립 browser 또는 consumer gate가 있다.
4. capability matrix의 경계와 실패 code가 확정됐다.
5. 활성 mainPlan 이니셔티브가 추가 surface와 rollback을 명시한다.

`tests/contracts/publicSurface.mjs`가 root/subpath allowlist와 이 문서의 Experimental 목록을
기계 검사한다.
