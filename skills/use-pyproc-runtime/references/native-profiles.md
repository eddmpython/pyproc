# Native profile contract

Status: version 1, locally proven on 2026-08-14

PyProc native profiles are source-built static CPython engine images. They are not runtime binary package
installations. A profile fixes its engine identity, CPython and WASI SDK inputs, C sources, Setup file, compiler
flags, functional oracle, declared outputs, and size budgets in `scripts/engineBuilder/engineBuildLock.json`.

## Build input

`nativeProfileCompiler.mjs` validates the locked files and emits canonical
`native-profile-build-input.json`. The build manifest includes that artifact digest and the verifier recomputes
the compiler output from repository sources. The two isolated builds must produce byte-identical engine,
stdlib, inventory, profile input, manifest, and SBOM files.

Profiles never inherit changes from another profile at runtime. Adding, removing, or changing a static module
requires a new engine ID and a new build input digest. Checkpoints remain bound to their exact engine ID and
cannot move between `core`, `data`, or a later product profile.

## Version 1 profiles

| Profile | Static PyProc modules | Product purpose |
|---|---|---|
| `core` | `_pyprocHost` | Kernel and hostcall foundation |
| `data` | `_pyprocHost`, `_pyprocData` | Minimal source-built numerical C extension proof |

`_pyprocData` exposes `profile`, `vector_add`, and `dot`. Inputs must be same-length finite numeric sequences.
Length mismatch, non-numeric values, non-finite values, and non-finite accumulation fail as Python exceptions.

## Support boundary

Only modules declared in a verified static profile are supported as native extensions. The pure wheel resolver
continues to reject native wheel contents with `PYPROC_PACKAGE_ABI_UNSUPPORTED`. PyProc does not claim that an
arbitrary PyPI binary wheel can be installed into a running WASI kernel.

## Acceptance gate

The profile is accepted only when source and Setup hashes match, isolated builds are byte-identical, SBOM and
manifest provenance agree, static import has built-in origin, the profile oracle passes in the browser, the core
profile rejects the data-only import, checkpoint restore is exact, and artifact sizes remain inside the lock.
