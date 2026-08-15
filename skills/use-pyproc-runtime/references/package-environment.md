# Package environment contract v2

Status: supported public contract on `pyproc/wasi`.

The package environment owns dependency resolution and immutable pure Python wheel layers. It does not call a
Python package manager inside the guest and it does not execute build hooks.

## Resolution

`SimpleApiPackageResolver` accepts an ordered list of `{ url, trustRef }` indexes. For each normalized project it
uses the PyPA Simple API JSON media type and stops at the first index that owns the project. Candidate lists from
multiple indexes are never merged.

Every remote wheel needs a SHA-256 digest, byte length, PEP 658 metadata digest, compatible
`Requires-Python`, and an allowed pure Python tag. The canonical lock records the exact artifact URL, source
index, provenance URL, dependency strings, yanked state, marker environment, Python version, engine ID, native profile,
and resolver policy. Its digest changes when any of those values changes.

`materialize(lock, { contentStore, offline: true })` reads only the lock, hash-addressed content store, and any
digest-verified artifact shipped with the package. A miss across all of those sources is terminal and does not
contact an index.

`createOwnedPackageResolver()` loads the installed package's source-pinned catalog. Its wheel, metadata, wrapper
source, native source, ABI, exact engine ID, and native profile are sealed. Package-owned bytes are reported as
source `package`, then become ordinary verified content-store hits.

The default profile is `core`. Select `{ profile: "data" }` only with `getDataKernelEngineManifest()`. That
catalog provides the source-built `pyproc.data/2` SIMD facade and rejects use with the core engine before install.

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
environment. A process clone replays the same verified wheel layers after importing the checkpoint. A Machine
image carries those layers as digest-checked bytes and rejects mutation even when its outer digest is recomputed.
Installing a different package environment starts a new full checkpoint lineage, so deltas never cross an
environment identity change.

## Public preview

```js
import {
  MemoryPackageContentStore,
  PackageEnvironment,
  SimpleApiPackageResolver,
  KernelFactory,
  createOwnedPackageResolver,
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

const ownedResolver = await createOwnedPackageResolver();
const ownedPackages = new PackageEnvironment({ kernel, resolver: ownedResolver });
await ownedPackages.install({ requirements: ["pyproc-native-host==1.0.0"] });
```

`KernelTerminal` routes `%pip install ...` through `PackageEnvironment`. `KernelEnvironmentManager` uses the same
contract for explicit requirements, locks, and PEP 723 script metadata. Neither surface invokes guest-side pip or
an engine-specific package helper.
