# pyproc

pyproc is a browser computer built around an owned, worker-hosted CPython 3.14 WASI kernel. The npm
package includes the verified engine and standard library, so the default runtime does not require a
separate engine download or a remote execution service.

## Install

```sh
npm install pyproc
```

Serve the installed package from the same origin as your application.

## Setup

The supported production browser boundary is current Chromium and Edge with `SharedArrayBuffer` and
cross-origin isolation enabled.

Serve every page that boots pyproc with these headers:

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

Confirm the installed package and headers on this machine:

```sh
npx pyproc-playground
```

`checkEnvironment()` reports the same Setup requirements when the page is missing a header or JSPI.

## Run Python

```js
import { boot } from "pyproc";

const machine = await boot();
const receipt = await machine.run.python("print(sum(range(100)))");

console.log(receipt.output); // 4950
await machine.close();
```

Every execution returns a structured receipt. Python exceptions produce a stable `PyProcError` with
`code === "PYPROC_KERNEL_EXECUTION_ERROR"`.

## Next

### Keep work after close

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

A Machine image carries a verified engine reference and content-addressed checkpoint objects. It does
not duplicate the engine binary.

### Rewind history

[Checkpoint, restore, and export](skills/reference-pyproc-api/references/api.md) live on `machine.history`.

### Packages

Install with the same commands a Python session already uses:

```js
await machine.run.python(`
%pip install pyproc-native-host==1.0.0
import pyproc_native_host
print(pyproc_native_host.ABI_VERSION)
`);
```

`python -m pip install ...` is the same door. `import` is ordinary CPython import. `subprocess` pip and
arbitrary native wheels are outside this engine: there is no OS process, and WASI cannot load those ABIs.
The [package environment](skills/use-pyproc-runtime/references/package-environment.md) is the host contract
behind those Python commands.

### Native Linux Python

Default `boot()` stays the owned WASI kernel. When `createWebComputer({ linux })` has a `linuxOs`
guest, the same computer also exposes native Linux CPython over that guest's serial console:

```js
import { createWebComputer } from "pyproc";

const computer = createWebComputer({ linux: { V86, manifest } });
await computer.bootAll();
if (computer.linuxPython.available) {
  await computer.linuxPython.run("print(40 + 2)");
  await computer.linuxPython.pip(["install", "demo==1.0.0"]);
}
```

This door does not replace `boot()`. The consumer supplies V86 and a Linux image that actually
contains `python3`. The slim Buildroot linux image stays without CPython. The separate
`buildroot-pyproc-python-i686.bin` profile is the image that carries CPython 3.12.13 and pip:

```sh
npm run assets:buildroot-python
```

### Control

[Machine Entrance](skills/use-pyproc-machine/references/machine-entrance.md) starts the installed
`pyproc-control` and MCP path. The [API reference](skills/reference-pyproc-api/references/api.md)
and [platform requirements](skills/use-pyproc-runtime/references/platform-requirements.md) cover the
remaining doors.

## License

[Mozilla Public License 2.0](LICENSE). Copyright 2026 eddmpython.
