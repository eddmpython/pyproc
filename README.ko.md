# pyproc

pyproc은 브라우저 안에서 동작하는 컴퓨터다. 저장소가 소유하고 worker에서 실행하는 CPython 3.14
WASI kernel을 사용한다. npm package에 검증된 engine과 표준 라이브러리가 포함되므로 별도 engine
다운로드나 원격 실행 서비스가 필요하지 않다.

## 설치

```sh
npm install pyproc
```

설치된 package를 애플리케이션과 같은 origin에서 제공한다. 지원 제품 경계는 최신 Chromium과 Edge,
`SharedArrayBuffer`, cross-origin isolation이다.

## Python 실행

```js
import { boot } from "pyproc";

const machine = await boot();
const receipt = await machine.run.python("print(sum(range(100)))");
console.log(receipt.output); // 4950
await machine.close();
```

모든 실행은 구조화된 receipt를 반환한다. Python 예외는
`code === "PYPROC_KERNEL_EXECUTION_ERROR"`인 안정된 `PyProcError`가 된다. 값은 version이 있는
value envelope를 통해 worker 경계를 건넌다.

```js
await machine.run.set("settings", { locale: "ko-KR", retries: 3 });
const settings = await machine.run.get("settings");
```

## Checkpoint와 Machine image

```js
import { boot, open } from "pyproc";

const machine = await boot({ deterministic: true });
await machine.run.python("counter = 41");
const checkpoint = await machine.history.checkpoint();

await machine.run.python("counter = 99");
await machine.history.restore(checkpoint);

const image = await machine.history.export();
await machine.close();

const restored = await open(image);
console.log(await restored.run.get("counter")); // 41
await restored.close();
```

Machine image는 검증된 engine reference와 내용 주소 checkpoint object를 담는다. engine binary를
중복해서 싣지 않는다. engine identity, checkpoint chain, object digest가 맞지 않으면 새 worker가
활성화되기 전에 실패한다.

## Process

```js
const parent = await boot();
await parent.run.python("value = 21");
const { process } = await parent.proc.clone();
const result = await process.execute("print(value * 2)");
console.log(result.output); // 42
await process.close();
await parent.close();
```

각 process는 별도 worker와 kernel을 소유한다. clone은 live heap view가 아니라 검증된 checkpoint에서
시작한다.

## 상주 WASM 도구

Machine에는 source-pinned ripgrep 15.1.0과 libgit2 1.9.7 기반 Git 명령이 실제 WASI 프로그램으로 들어
있다. 둘 다 shell 문자열이 아닌 인자 배열을 받고 파일, byte, 출력, 시간 상한을 둔 새 worker에서
실행한다. ripgrep은 bounded snapshot을 읽는다. Git은 입력 root가 그대로일 때만 연결된 `KernelVfs`에
bounded local repository transaction을 반영한다.

```js
const result = await machine.tools.run("rg", ["-n", "TODO", "/home"], {
  files: {
    "/home/notes.txt": "done\nTODO 브라우저 gate 확인\n",
  },
});

console.log(result.exitCode, result.stdout, result.input.sha256);
```

boot에 `KernelVfs`를 연결하면 같은 receipt 계약으로 로컬 Git 저장소 초기화, config 읽기와 쓰기, 정확한
경로 add, commit, status와 log 확인, local ref 읽기를 수행할 수 있다.

```js
await machine.tools.run("git", ["init", "/home/project"]);
const status = await machine.tools.run("git", ["--git-dir=/home/project/.git", "status"]);
```

Machine이 소유한 main과 clone Python kernel에서도 운영체제 process 지원인 척하지 않고 같은 catalog를
사용한다.

```js
const python = await machine.run.python(`
import pyprocTools
receipt = pyprocTools.run("git", ["--version"])
print(receipt["stdout"])
`);
```

명령의 0이 아닌 exit는 정상 receipt다. 미지원 명령, 취소, 상한 초과, 자산 불일치는 구조화된
`PyProcError`로 닫힌다. shell grammar, pipe, remote Git transport, 임의 Git CLI 전체와 Python 표준
라이브러리 `subprocess`는 계약 밖이다.

## Package와 terminal

`machine.createPackageEnvironment()`는 표준 Simple API metadata에서 pure Python wheel을 선택하고 hash,
tag, `Requires-Python`, marker, yanked policy를 검사한다. 선별된 native module은 정확한 engine profile에
묶인다. 지원하지 않는 binary wheel은 설치 전에 `PYPROC_PACKAGE_ABI_UNSUPPORTED`로 실패한다.

기본 source-built host module은 package에 포함된 network-free catalog로 설치한다.

```js
import { createOwnedPackageResolver } from "pyproc/wasi";

const resolver = await createOwnedPackageResolver();
const packages = machine.createPackageEnvironment({ resolver });
await packages.install({ requirements: ["pyproc-native-host==1.0.0"] });
await machine.run("import pyproc_native_host; print(pyproc_native_host.ABI_VERSION)");
```

별도 data profile은 명시적으로 선택하며 기본 core engine과 격리된다.

```js
import { boot } from "pyproc";
import { createOwnedPackageResolver, getDataKernelEngineManifest } from "pyproc/wasi";

const dataMachine = await boot({ engineManifest: await getDataKernelEngineManifest() });
const dataResolver = await createOwnedPackageResolver({ profile: "data" });
const dataPackages = dataMachine.createPackageEnvironment({ resolver: dataResolver });
await dataPackages.install({ requirements: [
  "pyproc-native-data==1.0.0",
  "numpy==2.5.1",
] });
await dataMachine.run(`
import numpy as np
import pyproc_native_data
print(pyproc_native_data.inspect())
print(np.linalg.solve(np.array([[3., 1.], [1., 2.]]), np.array([9., 8.])))
`);
```

이 facade는 `pyproc.data/2`를 보고하며 float64 buffer 덧셈과 내적을 `wasm-simd128`로 실행한다.
같은 catalog는 NumPy 2.5.1 Python layer를 포함하고 정확한 data engine은 13개 native module을 built-in으로
가진다. 두 wheel은 실행 중 network 요청 없이 package byte에서 설치된다. SciPy, pandas, Polars와 임의
native wheel은 계속 지원 범위 밖이다.

NumPy build는 source-pinned sdist와 정확한 Cython, Ninja, WASI SDK, CPython 입력을 쓴다. 현재 WASI C++
runtime에는 exception 구현이 없으므로 memory 할당 실패나 pocketfft 내부 invariant 위반은 process를
중단할 수 있다. 빈 FFT 같은 일반 입력 오류는 Python exception으로 유지된다.

catalog는 두 wheel, scientific source와 build receipt, native source digest, ABI, engine ID, profile을 함께
봉인한다. 하나라도 다르면
install 명령이 kernel에 도달하기 전에 실패한다. 검증된 package layer는 process clone과 Machine image에도
따라가며, 새 worker가 보기 전에 image import가 포함 wheel의 digest를 다시 검사한다.

`machine.terminal()`은 version 2 terminal 계약이다. `%pip install`도 같은 package environment를 거쳐
정책을 우회하지 않는다.

## Host capability

`pyproc/wasi` subpath는 `HostCapabilityBroker`와 `ProductHostCapabilityPort`를 제공한다. HTTP, socket
relay, ASGI, process, GPU, clipboard, framebuffer, artifact effect는 명시적 authority를 요구하고 version이
있는 hostcall ABI를 지난다. Browser object와 live Python object는 durable state에 저장되지 않는다.

hardware WebGPU도 같은 request-scoped 경계 뒤에 둔다. `pyproc/gpu`는 등록된 operation만 제공하고 guest에
device를 노출하는 대신 versioned 결과 영수증을 반환한다.

```js
import { createWebGpuHostAdapter, runHardwareVisualOracle } from "pyproc/gpu";

const gpu = await createWebGpuHostAdapter({ requireHardware: true });
try {
  const receipt = await runHardwareVisualOracle(gpu);
  console.log(receipt.state, receipt.adapter.class);
} finally {
  gpu.close();
}
```

## WebComputer

`createWebComputer()`는 소유 kernel guest와 WebMachine device, signed image, ownership, 선택적 durable
storage를 조립한다. 기본 Python guest는 root `boot()`와 `open()`이 쓰는 것과 같은 `KernelMachine`과
Machine image 계약을 사용한다.

선택적 Linux와 Node guest는 V86 constructor와 guest manifest를 주입하면 같은 lifecycle에 합류한다.
Node manifest는 정확한 runtime version, source revision, source URL, source SHA-256을 밝히고, boot image의
byte length와 SHA-256을 기술해야 한다. pyproc은 emulator를 만들기 전에 그 byte를 가져와 검증하고 `inspect()`에 검증 영수증을
남긴다. 변조된 image는 가져온 Machine이 active computer를 교체하기 전에
`WEB_MACHINE_ASSET_INTEGRITY`로 거절한다. Linux와 Node manifest는 BIOS, kernel image, VGA BIOS를 모두
같은 검증 descriptor 경로로 선언할 수 있다.
guest마다 독립 block device를 받고, signed `.webmachine`
봉투는 설정된 guest 전체를 함께 나른다. V86, firmware, 선택적 guest image는 npm package에 포함하지
않는다. `bootAll()`은 전체 수렴 계약이다. 설정된 guest 하나라도 실패하면 모든 boot 시도의 결론을
기다린 뒤 부분 부팅된 guest를 전부 종료하고 거절한다.

버전이 붙은 외부 자산 정본은 [`scripts/assetCatalog.json`](scripts/assetCatalog.json)이다. exact packed
기준 여정은 [Node guest 제품 gate](https://github.com/eddmpython/pyproc/blob/main/tests/browser/nodeGuestProduct.mjs)에 있고, 전체 manifest,
source identity, permission, inspect 계약은 [API reference](skills/reference-pyproc-api/references/api.md)의
`createWebComputer` 절에 있다.

## Package subpath

| Subpath | 계약 |
|---|---|
| `pyproc/runtime` | Kernel runtime, session, process, package, Machine composition |
| `pyproc/history` | 내용 주소 state object, store, bundle, signed tag |
| `pyproc/machine` | WebMachine host, device, image, fleet, kernel guest |
| `pyproc/assets` | same-origin worker asset manifest와 integrity 검증 |
| `pyproc/wasi` | 저수준 session, kernel, hostcall, package, factory 계약 |
| `pyproc/gpu` | 닫힌 WebGPU host adapter와 versioned hardware 결과 oracle |
| `pyproc/socket` | Socket relay host adapter |
| `pyproc/control` | Local control protocol client와 registry |

## 제어와 브라우저 자동화

지원 JavaScript client는 `pyproc/control`의 `PyProcControlClient`를 사용하고, 언어 중립 NDJSON 연결은
설치된 `pyproc-control` 명령을 사용한다. 두 경로는 같은 strict manifest, operation catalog, 취소 규칙,
검증된 attachment framing을 사용한다.
Effect-free doctor는 `machine.run`을 정본 의미로 고정하고 shell, JavaScript, Python, MCP에 매핑한 하나의
구조화된 첫 결과 행동도 반환한다.

proof-carrying browser action은 provider-neutral `pyproc.actionConvergence` version 1 영수증을 반환한다.
Native CDP와 FrameSpace는 후보 최대 2개, 재관찰 최대 1회, effect retry 0회, 첫 effect 전 30000 ms를
같이 지킨다. 같은 문서 stale target과 교체된 문서는 유일한 동일 권한 대상에만 수렴하고, ambiguous와
지속 가림은 effect 0회인 같은 영수증으로 거절한다. 성공은 action terminal, 안전 거절은 error details에
영수증을 싣는다.

[Machine Entrance](skills/use-pyproc-machine/references/machine-entrance.md)에서 시작한 뒤
[JavaScript Control SDK](skills/control-pyproc/references/javascript-control.md),
[Python SDK](skills/control-pyproc/references/python-sdk.md), 또는 완전한
[Control Protocol](skills/control-pyproc/references/control-protocol.md)을 사용한다. 이 파일은 npm 패키지에
포함되며 package gate가 packed install에서 모든 상대 README 링크를 검증한다.

## 검증

```sh
npm test
npm run test:types
npm run test:package
npm run test:installed
npm run test:wasm-tools
```

Installed 제품 gate들은 실제 tarball을 pack하고 설치한 뒤 Chrome과 Edge에서 포함된 engine을 부팅한다.
Package 설치, checkpoint restore, offline image reopen, process clone, terminal, 상주 WASI 검색, 로컬 Git
transaction, Python 도구 bridge와 clean boot의 미선언 외부 engine request 0을 검증한다.

[API reference](skills/reference-pyproc-api/references/api.md), [platform requirements](skills/use-pyproc-runtime/references/platform-requirements.md),
[KernelFactory 계약](skills/use-pyproc-runtime/references/kernel-contracts.md)을 함께 본다.

## 유지되는 지식

[PyProc skill router](skills/start-pyproc/SKILL.md)에서 시작한다. 전체 지식 tree를 읽지 않고 관련 skill과
필수 검증 gate를 선택한다. npm package에는 read-only MCP 도구 `skills.search`, `skills.read`와 같은
digest-bound skill catalog가 포함된다.

## License

[Mozilla Public License 2.0](LICENSE). Copyright 2026 eddmpython.
