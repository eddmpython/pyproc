---
name: use-pyproc-runtime
description: Install and use the owned CPython WASI PyProc runtime, platform requirements, kernel protocols, packages, hostcalls, native profiles, checkpoints, and value transfer. Use for clean install, first Python run, runtime API, WASI, 패키지 환경, or compatibility.
---

# Use PyProc Runtime

## Outcome

Boot and operate the owned runtime through public APIs within the supported Chromium boundary.

## Read first

Read consumer contract and platform requirements first. Open protocol references only for the exact subsystem involved.

## Procedure

1. Pin the package version and serve with required isolation headers.
2. Import only public package entrances.
3. Boot the default owned kernel and execute through `run`.
4. Use value, package, checkpoint, and hostcall contracts instead of engine internals.
5. Close machines and preserve explicit effect boundaries.

## Verification

Run base browser, installed package, type, and subsystem contract gates.

## Failure modes

Stop on unsupported browsers, missing isolation, direct heap access, floating engine URLs, native extension assumptions, or stale images.

## References

- [Consumer contract](references/consumer-contract.md)
- [Platform requirements](references/platform-requirements.md)
- [Hostcall ABI](references/hostcall-abi.md)
- [Kernel contracts](references/kernel-contracts.md)
- [Native profiles](references/native-profiles.md)
- [Package environment](references/package-environment.md)
- [Value envelope](references/value-envelope.md)
