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
| `native-profile-build-input.json` | profile source, builder, packager와 예산의 canonical 입력 digest를 기록한다 |
| `reproducibility-manifest.json` | 두 격리 build의 declared output 비교를 기록한다 |
| `stdlib-inventory.json` | stdlib 파일 목록과 digest를 기록한다 |

`KernelFactory`는 manifest의 byte length와 SHA-256을 검증한 뒤에만 worker를 만든다. 저수준 WASI session은
검증된 `wasmBytes`와 `stdlibBytes`만 받으며 remote fallback이나 loader 선택을 소유하지 않는다.
stdlib ZIP 루트의 `_sysconfigdata_*.py`, `_sysconfig_vars_*.json`, `build-details.json`은 target WASI가
생성한 ABI와 platform 정보를 담는다. build workspace 경로는 `/build/pyproc`으로 canonicalize되고 두
격리 build에서 ZIP 전체가 byte-identical이어야 한다.

## Browser worker graph

`pyproc-assets`는 `wasiWorker` 진입점의 상대 import graph를 계산하고 각 파일에 SHA-256 SRI를 붙인다. 현재
설치 graph는 10파일과 4개 entrypoint이며 same-origin 배포와 상대 import 구조 보존이 계약이다. `npm run test:package`와
`npm run test:installed`가 packed tarball에서 같은 graph를 다시 검증한다.

## Externally supplied guests

V86 engine, firmware와 guest image는 npm package에 포함하지 않는다. Web Machine 소비자가 exact digest와
provenance를 가진 자산을 주입한다. project가 재현 build한 Linux와 Node guest는 source, config, legal-info,
SBOM, 독립 build 영수증을 함께 게시한 별도 release만 catalog가 참조한다. V86 0.5.424와 SeaBIOS
rel-1.16.2도 exact Git revision과 tree, Ubuntu snapshot, compiler와 build tool version을 고정해 두 격리
build로 재현한다. 네 runtime output은 A/B 일치뿐 아니라 catalog 승격 digest와도 같아야 build가 성공한다.
별도 `pyproc-v86-assets-v2` release는 source archive, legal material, CycloneDX SBOM, build manifest와
재현 영수증을 runtime byte와 함께 공개하고 `releaseAssetsV2.json`이 그 공개 manifest를 봉인한다. Node
image descriptor는 emulator 생성 전에 byte length와 SHA-256을 검증하며 기본 loader는 redirect 없는
same-origin URL만 허용한다.

실행 경계는 다음처럼 구분한다.

| 경계 | 제공자 | pyproc의 무결성 책임 |
| --- | --- | --- |
| WebAssembly, Worker, IndexedDB, OPFS, WebCrypto, WebGPU | 브라우저 또는 OS | feature와 권한을 preflight하고 실패를 구조화한다 |
| CPython WASI, stdlib, data engine, 상주 도구 | npm package | exact source build와 package 내부 digest를 검증한다 |
| V86, SeaBIOS, VGA BIOS, Linux와 Node image | 별도 project release | source, legal material, SBOM, A/B 재현과 runtime digest를 catalog에 봉인한다 |
| GPU driver와 hardware | 브라우저 또는 OS | 닫힌 compute와 pixel oracle로 결과를 검증하고 fallback을 거부한다 |

Python 기본 부팅, optional x86 guest와 GPU 제품 gate는 필요한 자산을 same-origin으로 준비한 뒤 제3자
요청 0을 각각 확인한다. 이 판정은 브라우저와 OS가 제공하는 표준 substrate까지 pyproc이 배송한다는 뜻이
아니다.

catalog의 `consumers`가 download 범위의 정본이다. `v86Probe`는 기본 x86 probe, `webComputer`는 기본
Python과 Linux 제품, `nodeGuest`는 Python, Linux, Node 공동 제품 gate를 뜻한다. Node image는
`nodeGuest`에만 속하므로 기본 probe와 기본 Web Computer 준비 과정이 선택 자산을 묵시적으로 받지 않는다.

`npm run assets:buildroot-release`는 검증 artifact, complete legal-info, exact source와 config input을
`.cache` 아래 release directory에 조립한다. legal manifest가 요구하는 source archive와 license file이
하나라도 없거나 허용하지 않은 warning이 있으면 실패하고, `releaseAssets.json`이 원본 자산 전부의 크기와
SHA-256을 봉인한다.
