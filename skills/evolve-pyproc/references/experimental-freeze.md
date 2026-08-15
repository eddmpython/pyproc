# Experimental 표면 동결

기존 Beta/Experimental 계약을 안정화하는 동안 새 Experimental capability와 새 Experimental
package subpath를 추가하지 않는다. 내부 리팩터링, soundness 수정, 문서·타입·설치 패키지 게이트
강화와 아래 졸업 조건을 모두 통과한 안정 plumbing 승격은 허용한다.

동결된 Experimental subpath는 다음 셋이다.

- `pyproc/gpu`
- `pyproc/socket`
- `pyproc/wasi`

root value export는 `boot`, `open`, `createWebComputer`, `checkEnvironment`, `PyProcError`,
`PYPROC_ERROR_CODES` 여섯 개로 고정한다. 안정 plumbing은 `pyproc/runtime`, `pyproc/history`,
`pyproc/machine`, `pyproc/assets`, `pyproc/control`이고 `pyproc/worker`는 실행 자산 entrypoint다.

`pyproc/control`은 2026-08-13에 기존 설치 제품 host의 JavaScript facade로 졸업했다. 새 browser
driver나 wire operation을 추가하지 않고 packed install의 기존 Control client를 지원 import로
승격한 사례다. 공개 예제 실행 대조, 독립 타입과 계약 gate, 실제 Chrome과 Edge installed browser
gate, capability와 오류 경계, attempts의 rollback 기록을 같은 변경에서 갖췄다.

`pyproc/gpu`는 2026-08-15에 새 subpath나 root export 없이 닫힌 WebGPU operation과 versioned hardware
결과 oracle을 기존 표면에 더했다. packed install의 bare specifier, hostcall 경계, 실제 hardware compute와
pixel readback, software fallback 거절, 타입과 결과 불일치 음성 gate를 함께 둔 안정화 사례다.

동결 해제 조건은 전부 충족해야 한다.

1. 공개 Markdown import 예제가 설치 package에 대해 실행 대조된다.
2. `index.d.ts`와 모든 subpath type gate가 green이다.
3. 추가하려는 표면에 독립 browser 또는 설치 패키지 게이트가 있다.
4. capability matrix의 경계와 실패 code가 확정됐다.
5. 해당 `tests/attempts/` campaign과 패키지 계약 변경이 추가 surface, 실패 경계, rollback을 명시한다.

`tests/contracts/publicSurface.mjs`가 root/subpath allowlist와 이 문서의 Experimental 목록을
기계 검사한다.
