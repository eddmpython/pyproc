# Owned CPython WASI engine builder

This directory is the source of truth for owned CPython WASI engine provenance.

The lock pins CPython 3.14.6 commit `c63aec69bd59c55314c06c23f4c22c03de76fe45`, WASI SDK 24,
Wasmtime 47.0.3, every archive digest, the deterministic epoch, configure flags, and the static
`_pyprocHost` ABI. The builder rejects an existing workspace and verifies every downloaded archive before
extraction.

## Production Linux build

Use a new path outside the repository:

```bash
node scripts/engineBuilder/buildOwnedEngine.mjs \
  --workspace "$RUNNER_TEMP/pyproc-owned-engine" \
  --out "$RUNNER_TEMP/pyproc-owned-engine/dist" \
  --profile core
```

The locked profiles are `core` and `data`. `core` contains `_pyprocHost`. `data` adds the source-built static
`_pyprocData` module, requires `simd128` for that module, and receives a distinct engine identity. Its float64
buffer addition and dot product execute WASM SIMD instructions while the scalar sequence API remains compatible.
`nativeProfileCompiler.mjs` validates every source
and Setup digest, then emits `native-profile-build-input.json`. That file is a declared reproducible build
artifact and records the compiler inputs, Linux and Windows builder digests, packager digest, outputs,
functional oracle, and size budgets.

The packaged stdlib includes the target-generated `_sysconfigdata_*.py`, `_sysconfig_vars_*.json`, and
`build-details.json` at its root. The target runtime generates build details. The packager replaces the local
workspace prefix with `/build/pyproc`, normalizes LF, validates the WASI platform and extension suffix, and then
requires the full stdlib ZIP to be byte-identical across isolated builds.

`.github/workflows/owned-engine.yml` runs every profile in two isolated Ubuntu 24.04 jobs, compares the WASM,
stdlib ZIP, inventory, profile input, manifest, and SBOM byte for byte, then boots the verified bytes in the
matching browser probe. All actions use immutable commit SHAs.

## Windows local reproduction

The Windows probe uses portable, hash-pinned host Python and GNU make inputs with the official Windows WASI
SDK. It does not install WSL or system packages. Supply a fresh root and a content cache:

```powershell
node scripts/engineBuilder/reproduceOwnedEngineWindowsProbe.mjs `
  --root C:\fresh-pyproc-engine-repro `
  --input-cache C:\pyproc-engine-inputs `
  --profile data
```

The verifier writes a reproduction receipt only after both complete artifact sets are byte-identical. Put the
verified core artifact set under `.cache/owned-engine/core/a/`, then run:

```powershell
node tests/browser/run.mjs tests/browser/ownedEngineCoreProduct.html
```

For the `data` profile, retain the verified core artifact under `.cache/owned-engine/core/a/`, put the data
artifact under `.cache/owned-engine/data/a/`, then run `tests/browser/ownedEngineDataProduct.html`. The browser
gate proves that `_pyprocData` is built-in only in the data engine, its numerical oracle is stable, checkpoints
retain its state, and the WASM growth stays inside the locked profile budget. Arbitrary binary wheel
installation remains unsupported.

Independently verified `core` and `data` sets are promoted to their matching
`src/runtime/engines/wasi/owned/<profile>/` directories for package delivery. The package-owned resolver keeps
their facade catalogs exactly engine and profile fenced.
