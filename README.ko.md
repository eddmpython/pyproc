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

## Package와 terminal

`machine.createPackageEnvironment()`는 표준 Simple API metadata에서 pure Python wheel을 선택하고 hash,
tag, `Requires-Python`, marker, yanked policy를 검사한다. 선별된 native module은 정확한 engine profile에
묶인다. 지원하지 않는 binary wheel은 설치 전에 `PYPROC_PACKAGE_ABI_UNSUPPORTED`로 실패한다.

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
```

Installed package gate는 실제 tarball을 pack하고 설치한 뒤 Chrome과 Edge에서 포함된 engine을 부팅한다.
Package 설치, checkpoint restore, offline image reopen, process clone, terminal 동작과 clean boot의 미선언
외부 engine request 0을 검증한다.

[API reference](skills/reference-pyproc-api/references/api.md), [platform requirements](skills/use-pyproc-runtime/references/platform-requirements.md),
[KernelFactory 계약](skills/use-pyproc-runtime/references/kernel-contracts.md)을 함께 본다.

## 유지되는 지식

[PyProc skill router](skills/start-pyproc/SKILL.md)에서 시작한다. 전체 지식 tree를 읽지 않고 관련 skill과
필수 검증 gate를 선택한다. npm package에는 read-only MCP 도구 `skills.search`, `skills.read`와 같은
digest-bound skill catalog가 포함된다.

## License

[Mozilla Public License 2.0](LICENSE). Copyright 2026 eddmpython.
