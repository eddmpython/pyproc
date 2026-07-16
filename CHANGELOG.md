# Changelog

All notable changes to the public surface are documented here. pyproc consumers pin exact
versions, so breaking changes only reach a consumer when it deliberately re-pins. Releases
happen only on an explicit maintainer decision; the Unreleased section accumulates until then.

한국어 요약은 각 절 하단에 둔다.

## Unreleased

### Breaking

- Removed `SharedKernel` (and its SharedWorker host asset). It was documented as a
  non-canonical auxiliary path; `KernelElection` / `openPersistentMachine` is the canonical
  multi-tab lane and keeps document-level `crossOriginIsolated` (SharedWorker cannot).
  Migration: replace `new SharedKernel(...)` with `openPersistentMachine({ name, manifest })`.
- Moved GPU surface (`GpuCompute`, `GpuArray`, `GpuBridge`) from the root export to the
  `pyproc/gpu` subpath, and removed `Runtime.enableGpu()`. GPU needs a real adapter and a
  windowed session, so it cannot be covered by the headless CI gate that guards the root
  surface. Migration: `import { GpuCompute } from "pyproc/gpu"` and construct directly.
- Moved `SocketBridge` from the root export to the `pyproc/socket` subpath, and removed
  `Runtime.enableSocketBridge()`. It requires an external WS to TCP relay that pyproc does
  not ship. Migration: `import { SocketBridge } from "pyproc/socket"; new SocketBridge(rt, cfg)`.
- Moved `bootWasi` / `WasiSession` from the root export to the `pyproc/wasi` subpath.
  The WASI lane is a research preview that proves the engine-independent core; the
  production Python surface is the Pyodide lane. Migration: import from `pyproc/wasi`.
- Removed alias methods that duplicated one behavior under two names:
  `ReactiveController.timeTravel(...)` (use `restoreLive(...)` or `cp.restore()`),
  `PyProc.interrupt(pid)` (use `signal(pid, SIGNAL.INT)`),
  `PyProc.mapSerial(fnSrc, args)` (a benchmark baseline, not a product surface; run tasks
  through `exec(pid, ...)` sequentially if you need a serial reference).

### Added

- `PyProcError` and `PYPROC_ERROR_CODES`: one error contract for the whole surface.
  Every error thrown by pyproc now carries `code` (programmatic branching axis),
  `retryable`, and optional `context` (worker Python exceptions arrive with
  `context.pyExcType`, e.g. `"KeyboardInterrupt"`). Worker boundaries preserve codes.
- Checkpoint handles: `reactive.checkpoint()` now returns `{ ..., sp, restore() }`, so a
  restore is one call (`cp.restore()`) instead of carrying `stackSave` plus an index.
  `restore`/`restoreLive` accept omitted `savedSP` (the node-stored value is used).
- `ReactiveController.collectDelta(fromIdx?, toIdx?, opts?)`: the shared primitive behind
  session save, journal commit, and machine image export.
- `ReactiveController.markDirty()`: report heap mutations that bypass `execSeq`
  (live PyProxy calls) so the next `restoreLive` upgrades to the rehash path.
- `ReactiveController.pruneTo(j)` / `dispose()`: memory valves for the checkpoint tree.
- `Runtime.noteStateMutation()` and boundary-recording restores: a restore now counts as a
  state mutation, so observers such as the journal idle watcher commit restored state.
- `Runtime.enableReactive()` is memoized (one controller per runtime): two controllers
  could silently corrupt each other's live-diff restores.
- `MachineJournal` `cfg.onStatus` (observe idle-commit success/failure; failures carry
  `PYPROC_JOURNAL_IO`) and `cfg.pruneAfterCommit` (tree pruning after each commit).
- `PyProc.respawn(pid)` and `JobControl.killHard(jobId)`: forced lane recovery that keeps
  fork symmetry (replay reboot).
- `PyProc.map` no longer leaves silent `undefined` holes when every lane dies; unrun tasks
  resolve to `{ error: "pool exhausted: ..." }`.
- Nested machine containers now route `run`/`heapLen`/`kill`/`spawn` through an explicit
  path router at any depth, and a dead container rejects immediately instead of hanging.

### 한국어 요약

- SharedKernel 삭제(정본은 openPersistentMachine), GPU/Socket/WASI는 subpath로 강등,
  별칭 3종(timeTravel/interrupt/mapSerial) 절삭.
- PyProcError 단일 오류 계약(코드/재시도 가능성/파이썬 예외 타입이 워커 경계를 건너온다).
- 체크포인트 핸들(cp.restore() 한 호출), collectDelta/markDirty/pruneTo/dispose,
  복원의 경계 기록, 컨트롤러 memoize, 저널 onStatus/pruneAfterCommit,
  respawn/killHard, map 부분 실패 정직화, 컨테이너 중첩 라우팅과 사망 즉시 거부.
