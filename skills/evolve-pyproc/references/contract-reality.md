# Contract reality

현재 구현과 목표가 다른 지점만 기록한다. 완료된 migration 설명은 유지하지 않고 Git history에 맡긴다.

| Current boundary | Shipped contract | Remaining work |
| --- | --- | --- |
| Chromium and Edge only | owned kernel boot requires cross-origin isolation and SharedArrayBuffer | 다른 browser가 동등한 worker shared-memory 계약을 제공할 때 재검증한다 |
| Dynamic native wheels unsupported | pure Python wheel과 curated static native profile만 install 전에 검증한다 | profile 확대는 source build, oracle, reproducibility와 size gate가 있어야 한다 |
| GPU headless evidence ceiling | exact registered WGSL bytes와 capability authorization을 검증한다 | hardware adapter가 있는 runner에서 result oracle을 추가한다 |
| Web Machine x86 guest assets external | host contract와 digest-pinned asset preparation을 분리한다 | emulator와 firmware의 독립 재현 범위를 계속 넓힌다 |
| Kernel Machine image integrity, not signature | digest가 engine identity와 checkpoint objects를 봉인한다 | 제품이 외부 발행자를 신뢰해야 할 때 signing policy를 별도 version으로 추가한다 |
| Web Machine protocol standard readiness | 표준 WebAssembly, Worker, cross-origin isolation, bucket file system 위에서 pyproc 제품 계약이 동작한다 | vendor-neutral 명세, WPT형 conformance, 독립 구현과 공개 incubation 전에는 웹 표준이라고 주장하지 않는다 |

완료된 owned-kernel 계약은 `skills/use-pyproc-runtime/references/kernel-contracts.md`, `skills/use-pyproc-runtime/references/consumer-contract.md`,
`tests/contracts/`와 installed browser gate가 정본이다.
