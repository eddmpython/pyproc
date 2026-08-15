# Asset provenance

pyproc은 실행 자산을 URL 관습이 아니라 manifest, digest, build receipt로 식별한다. 설치 패키지의 정본은
`scripts/assetCatalog.json`이고 `npm run assets:provenance`가 catalog, SBOM, WebComputer 파생 파일의 일치를
검사한다.

## Owned CPython WASI engine

`src/runtime/engines/wasi/owned/core/`에는 다음 자산이 함께 배포된다.

| Asset | Contract |
| --- | --- |
| `python.wasm` | CPython source commit, WASI SDK, compiler와 build flags가 build manifest에 고정된다 |
| `python314-stdlib.zip` | exact bytes, stdlib inventory와 SHA-256이 engine manifest에 고정된다 |
| `engine-build-manifest.json` | source, toolchain, recipe, static modules와 output digest를 기록한다 |
| `engine.cyclonedx.json` | 배포 engine의 CycloneDX component와 provenance를 기록한다 |
| `reproducibility-manifest.json` | 두 격리 build의 declared output 비교를 기록한다 |
| `stdlib-inventory.json` | stdlib 파일 목록과 digest를 기록한다 |

`KernelFactory`는 manifest의 byte length와 SHA-256을 검증한 뒤에만 worker를 만든다. 저수준 WASI session은
검증된 `wasmBytes`와 `stdlibBytes`만 받으며 remote fallback이나 loader 선택을 소유하지 않는다.

## Browser worker graph

`pyproc-assets`는 `wasiWorker` 진입점의 상대 import graph를 계산하고 각 파일에 SHA-256 SRI를 붙인다. 현재
설치 graph는 7파일이며 same-origin 배포와 상대 import 구조 보존이 계약이다. `npm run test:package`와
`npm run test:installed`가 packed tarball에서 같은 graph를 다시 검증한다.

## Externally supplied guests

V86 engine, firmware와 guest image는 npm package에 포함하지 않는다. Web Machine 소비자가 exact digest와
provenance를 가진 자산을 주입하며 pyproc은 자신이 build하지 않은 자산의 출처를 주장하지 않는다.
