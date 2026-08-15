# Package environment contract v1

Status: supported public contract on `pyproc/wasi`.

The package environment owns dependency resolution and immutable pure Python wheel layers. It does not call a
Python package manager inside the guest and it does not execute build hooks.

## Resolution

`SimpleApiPackageResolver` accepts an ordered list of `{ url, trustRef }` indexes. For each normalized project it
uses the PyPA Simple API JSON media type and stops at the first index that owns the project. Candidate lists from
multiple indexes are never merged.

Every remote wheel needs a SHA-256 digest, byte length, PEP 658 metadata digest, compatible
`Requires-Python`, and an allowed pure Python tag. The canonical lock records the exact artifact URL, source
index, provenance URL, dependency strings, yanked state, marker environment, Python version, native profile,
and resolver policy. Its digest changes when any of those values changes.

`materialize(lock, { contentStore, offline: true })` reads only the lock and hash-addressed content store. A cache
miss is terminal and does not contact an index.

## Wheel transaction

`inspectPurePythonWheel` validates the ZIP central directory before extraction. It rejects traversal, absolute
paths, links, duplicate and case-colliding paths, reserved device names, executable scripts, archive bombs, and
native `.so`, `.pyd`, `.dll`, `.dylib`, or `.wasm` content. `WHEEL`, `METADATA`, and `RECORD` must agree with the
lock and every installed file.

The session writes verified files to digest-addressed layers. It performs an import smoke test with a disposable
module generation, then changes `sys.path` and the kernel `environmentId` in one queued command. A failed
validation, write, or smoke test leaves the active paths, modules, and environment identity unchanged.

## Identity

The environment identity is the SHA-256 digest of the engine identity, resolver version, canonical lock, ordered
wheel tree digests, and install policy digest. Checkpoints retain that identity and reject restore into a different
environment.

## Public preview

```js
import {
  MemoryPackageContentStore,
  PackageEnvironment,
  SimpleApiPackageResolver,
  KernelFactory,
  getDefaultKernelEngineManifest,
} from "pyproc/wasi";

const manifest = await getDefaultKernelEngineManifest();
const kernel = await new KernelFactory().open(manifest);
const resolver = new SimpleApiPackageResolver({
  indexes: [{ url: "https://packages.example/simple/", trustRef: "trust:packages-example" }],
  pythonVersion: "3.14.6",
  allowedTags: ["py3-none-any"],
});
const packages = new PackageEnvironment({
  kernel,
  resolver,
  contentStore: new MemoryPackageContentStore(),
});

const installed = await packages.install({ requirements: ["example==1.2.3"] });
const restored = await packages.install({ lock: installed.lock, offline: true });
```

`KernelTerminal` routes `%pip install ...` through `PackageEnvironment`. `KernelEnvironmentManager` uses the same
contract for explicit requirements, locks, and PEP 723 script metadata. Neither surface invokes guest-side pip or
an engine-specific package helper.
