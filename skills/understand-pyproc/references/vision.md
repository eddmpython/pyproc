# Product vision

pyproc turns a browser tab into a computer that owns its Python kernel. The interpreter runs in a dedicated
worker, state crosses a versioned protocol, and browser effects pass through explicit capabilities. Consumers do
not receive raw heap views, live Python proxies, or an engine loader.

## Product model

The product is built from five boundaries:

1. A signed-description engine manifest binds the source-built CPython WASI artifact, stdlib, build recipe,
   environment, hashes, and byte lengths.
2. `KernelRuntimeContract` version 2 owns execution, values, errors, cancellation, checkpoints, package mutation,
   inspection, and shutdown.
3. `_pyprocHost` and Hostcall ABI version 1 connect synchronous Python calls to authorized browser capabilities.
4. `KernelFactory` composes verified assets, checkpoints, sessions, processes, and portable Machine images.
5. `createWebComputer` hosts the Python guest and optional externally supplied guest systems under one Machine
   lifecycle.

## What is shipped

- Source-built CPython 3.14.6 targeting `wasm32-wasip1`, with a pinned WASI SDK and reproducible build receipt.
- Promise-first execution, typed values, Unicode and large byte artifacts.
- Content-addressed full and delta checkpoints with exact engine and environment fencing.
- Independent worker processes cloned from prepared state.
- Standard package metadata resolution, hashed pure Python wheel installation, and curated static native profiles.
- Explicit HTTP, socket relay, GPU, clipboard, framebuffer, process, terminal, and ASGI host capability adapters.
- Portable Kernel Machine images and the higher Web Machine host contract.

## Honest boundaries

- Chromium and Edge are supported. The shared command channel requires cross-origin isolation.
- Browser Python is not native POSIX. Raw sockets, native signals, and operating-system process semantics are not
  claimed.
- Arbitrary native wheels are not dynamically installed. Unsupported artifacts fail before mutation.
- GPU integration is experimental, and a headless runner without a real adapter can verify shader bytes but not a
  hardware result.
- Machine images carry engine identity and checkpoint objects, not the engine binary itself.

## Direction

New capabilities must first prove their browser behavior in `tests/attempts/`, then graduate into a versioned
contract and an installed-package gate. The executable status ledger is
[`tests/northStar.mjs`](../../../tests/northStar.mjs), and current mismatches live in
[`skills/evolve-pyproc/references/contract-reality.md`](../../evolve-pyproc/references/contract-reality.md).
