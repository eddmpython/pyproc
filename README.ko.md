# pyproc

pyproc은 브라우저 안에서 동작하는 컴퓨터다. 저장소가 소유하고 worker에서 실행하는 CPython 3.14
WASI kernel을 사용한다. npm package에 검증된 engine과 표준 라이브러리가 포함되므로 별도 engine
다운로드나 원격 실행 서비스가 필요하지 않다.

## 설치

```sh
npm install pyproc
```

설치된 package를 애플리케이션과 같은 origin에서 제공한다.

## Setup

지원 제품 경계는 최신 Chromium과 Edge, `SharedArrayBuffer`, cross-origin isolation이다.

pyproc을 부팅하는 모든 페이지에 아래 헤더를 붙인다.

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Vite (`vite.config.js`):

```js
export default {
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
};
```

Next.js (`next.config.js`):

```js
module.exports = {
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
      ],
    }];
  },
};
```

이 기계에서 설치 package와 헤더를 확인한다.

```sh
npx pyproc-playground
```

페이지에 헤더나 JSPI가 없으면 `checkEnvironment()`가 같은 Setup 요구를 보고한다.

## Python 실행

```js
import { boot } from "pyproc";

const machine = await boot();
const receipt = await machine.run.python("print(sum(range(100)))");

console.log(receipt.output); // 4950
await machine.close();
```

모든 실행은 구조화된 receipt를 반환한다. Python 예외는
`code === "PYPROC_KERNEL_EXECUTION_ERROR"`인 안정된 `PyProcError`가 된다.

### 패키지

파이썬 세션이 이미 쓰는 명령으로 설치한다.

```js
await machine.run.python(`
%pip install pyproc-native-host==1.0.0
import pyproc_native_host
print(pyproc_native_host.ABI_VERSION)
`);
```

`python -m pip install ...`도 같은 문이다. `import`는 보통의 CPython import다. `subprocess` pip와
임의 native wheel은 이 엔진 밖이다. OS process가 없고 WASI가 그 ABI를 로드하지 못한다.
호스트 계약은 [package environment](skills/use-pyproc-runtime/references/package-environment.md)다.

## 다음

### 닫은 뒤에도 남기기

```js
import { boot, open } from "pyproc";

const machine = await boot({ deterministic: true });
await machine.run.python("counter = 41");
const image = await machine.history.export();
await machine.close();

const restored = await open(image);
console.log(await restored.run.get("counter")); // 41
await restored.close();
```

Machine image는 검증된 engine reference와 내용 주소 checkpoint object를 담는다. engine binary를
중복해서 싣지 않는다.

### 역사 되돌리기

[checkpoint, restore, export](skills/reference-pyproc-api/references/api.md)는 `machine.history`에 있다.

### 네이티브 Linux Python

기본 `boot()`는 소유 WASI 커널(CPython 3.14.6)이다. `createWebComputer({ linux })`에 `linuxOs`
guest가 있으면 같은 컴퓨터가 그 guest의 serial로 네이티브 Linux CPython도 연다.

```js
import { createWebComputer } from "pyproc";

const computer = createWebComputer({ linux: { V86, manifest } });
await computer.bootAll();
if (computer.linuxPython.available) {
  await computer.linuxPython.run("print(40 + 2)");
  await computer.linuxPython.pip(["install", "demo==1.0.0"]);
}
```

이 문은 `boot()`를 대체하지 않는다. guest 인터프리터는 CPython 3.12.13이고 WASI 3.14.6이 아니다.
slim Buildroot linux image에는 CPython이 없다. catalog 자산
`buildroot-pyproc-python-i686.bin`이 `python3`와 pip 25.2를 싣는다.

`linuxPython.pip`는 serial로 `python3 -m pip`를 보낸다. receipt `stdout`은 그 serial 원문이다.
네트워크 index와 임의 wheel은 시험된 문 밖이다. WASI `%pip`는 소유 카탈로그의 다른 경로다.

### 제어

[Machine Entrance](skills/use-pyproc-machine/references/machine-entrance.md)가 설치된
`pyproc-control`과 MCP 경로를 연다. 나머지 문은 [API reference](skills/reference-pyproc-api/references/api.md)와
[platform requirements](skills/use-pyproc-runtime/references/platform-requirements.md)에 있다.

## License

[Mozilla Public License 2.0](LICENSE). Copyright 2026 eddmpython.
