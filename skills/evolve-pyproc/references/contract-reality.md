# Contract reality

현재 구현과 목표가 다른 지점만 기록한다. 완료된 migration 설명은 유지하지 않고 Git history에 맡긴다.

| Current boundary | Shipped contract | Remaining work |
| --- | --- | --- |
| Chromium and Edge only | owned kernel boot requires cross-origin isolation and SharedArrayBuffer | 다른 browser가 동등한 worker shared-memory 계약을 제공할 때 재검증한다 |
| Dynamic native wheels unsupported | pure Python wheel과 source-pinned package-owned facade 및 NumPy를 exact engine과 curated static native profile에 묶어 install 전에 검증한다 | profile 확대는 source build, oracle, reproducibility와 size gate가 있어야 하며 임의 binary wheel은 dynamic linking 전까지 받지 않는다 |
| Scientific package reach incomplete | 별도 `data-3` engine과 multi-wheel catalog가 실제 `wasm-simd128` float64 oracle과 source-built NumPy 2.5.1의 array, dot, FFT, linalg, seeded random을 실행한다. package clone과 Machine image도 같은 layer를 복원한다 | SciPy, pandas, Polars는 명시적 미포함이다. C++ exception 비활성과 allocation 또는 PocketFFT invariant 위반 abort 경계를 유지한 채 source-pinned profile을 하나씩 넓힌다 |
| Python shared-memory thread unavailable | exact core와 data engine manifest가 `pyproc.thread-capability/1`의 `worker-processes` mode를 선언한다. build가 `pthread-stubs`, 비공유 WASM memory, thread spawn import 부재를 직접 검증하고 `machine.inspect()`가 `RuntimeError: can't start new thread` 경계를 그대로 보고한다 | [WASI SDK](https://github.com/WebAssembly/wasi-sdk)의 experimental thread target과 CPython pthread build만으로 browser host가 완성되지는 않는다. shared memory, spawn import, 실제 Python thread join, checkpoint quiescence가 같은 제품 gate를 통과할 때만 `shared-memory` mode로 바꾼다 |
| Browser bucket total eviction cannot self-recover | `pyproc.storage-durability/1`이 best-effort와 persistent mode, rough estimate, 안정 quota failure를 밝힌다. origin 밖 witness가 있으면 OPFS 전체 삭제를 첫 부팅으로 위장하지 않고 명시적 eviction으로 판정한다 | [WHATWG Storage Standard](https://storage.spec.whatwg.org/)처럼 best-effort bucket은 storage pressure에서 통째로 제거될 수 있다. 지워진 bucket 스스로는 데이터를 복구할 수 없으므로 witness에 결속된 외부 Machine 사본의 restore 계약이 남았다 |
| Git and Python subprocess unavailable | source-pinned ripgrep 15.1.0이 `pyproc.wasm-tool-layer/1`의 isolated Worker와 읽기 전용 VFS snapshot에서 exact argv로 실행된다. exit와 출력, 시간, 입력 digest, 상한, 취소와 binary 무결성을 receipt로 반환한다 | 현재 catalog는 `rg` 하나다. Gitoxide 0.54.0은 WASI에 없는 POSIX signal API로 compile되지 않았다. 실제 WASI Git 구현과 같은 argv-only receipt의 Python bridge를 추가하되 표준 라이브러리 `subprocess` 호환으로 위장하지 않는다 |
| Web Machine x86 guest assets external | host contract와 digest-pinned asset preparation을 분리한다 | emulator와 firmware의 독립 재현 범위를 계속 넓힌다 |
| Kernel Machine image integrity, not signature | digest가 engine identity와 checkpoint objects를 봉인한다 | 제품이 외부 발행자를 신뢰해야 할 때 signing policy를 별도 version으로 추가한다 |
| Web Machine protocol standard readiness | 표준 WebAssembly, Worker, cross-origin isolation, bucket file system 위에서 pyproc 제품 계약이 동작한다 | [legacy WASI threads proposal](https://github.com/WebAssembly/wasi-threads)은 Phase 1이고 후속은 [shared-everything threads](https://github.com/WebAssembly/shared-everything-threads)에서 진행 중이다. vendor-neutral 명세, WPT형 conformance, 독립 구현과 공개 incubation 전에는 웹 표준이라고 주장하지 않는다 |

완료된 owned-kernel 계약은 `skills/use-pyproc-runtime/references/kernel-contracts.md`, `skills/use-pyproc-runtime/references/consumer-contract.md`,
`tests/contracts/`와 installed browser gate가 정본이다.
