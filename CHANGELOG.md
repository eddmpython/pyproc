# Changelog

All notable changes to the public surface are documented here. Exact version pins are the
install contract, so a breaking change only lands where a pin is deliberately moved. Releases
happen only on an explicit maintainer decision; the Unreleased section accumulates until then.

한국어 요약은 각 절 하단에 둔다.

## Unreleased

Nothing yet.

## 0.0.10 - 2026-07-19

### Breaking

- **Root surface reshaped to a porcelain machine handle (37 exports -> 6).** The root now
  exports exactly `boot`, `open`, `createWebComputer`, `checkEnvironment`, `PyProcError`,
  and `PYPROC_ERROR_CODES`. `boot` resolves to a `PyprocMachine` handle whose namespaces
  are the model's vocabulary: `run` / `runAsync` (execute), `fs` (files), `term`
  (terminal), `proc` (worker process pool), `history` (checkpoint/restore volatile,
  commit/recover/export durable), plus the `runtime` escape hatch for capability detail
  (`enableSyscallBridge`, `enableAsgiServer`, `enableDeviceFs`, ...). Root class exports
  are gone; the classes remain as typed contracts reached through the handle.
- **`open` is the one revival verb.** Its trust contract follows the source instead of
  flattening semantics: `open(bundleBlob, trustOpts)` verifies envelope integrity and
  signature before touching the heap (replaces `openMachine`), `open({ dir, name })`
  revives an OPFS session save by manifest replay plus delta (replaces
  `bootSession().load(...)`), and `open({ persistent })` opens the multi-tab persistent
  machine and returns a `KernelElection` handle (replaces `openPersistentMachine`).
- **Deterministic boot is an explicit opt-in.** `boot({ deterministic: true, ...manifest })`
  replaces `bootSession(manifest)`. `PYTHONHASHSEED=0` and the entropy stub change
  guest-visible semantics, so they are never the default; the choice is recorded in the
  environment fingerprint of every durable commit, and `history.export` / `history.save`
  exist only in this mode (a non-deterministic state has no replay guarantee).
- **Subpaths reshaped.** New: `pyproc/history`, the state kernel's contract surface
  (sha256 address law, object model, `StateStore` contract, `commitState` / `openState`
  protocol, signed tags, `PYBUNDLE1` bundle codec, `PAGE_SIZE`). Removed:
  `pyproc/runtime`, `pyproc/reactive`, `pyproc/syscall-bridge`, `pyproc/process-os`
  (their capabilities moved onto the handle, see the migration map). Remaining:
  `pyproc/machine`, `pyproc/worker`, `pyproc/assets`, and the demoted `pyproc/gpu` /
  `pyproc/socket` / `pyproc/wasi`.
- **One bundle format (`PYBUNDLE1`).** `machine.history.export()` writes a single signed,
  content-addressed envelope; `open` reads it. The layout is authoritative in
  `docs/reference/bundleFormat.md`. The legacy `.pymachine` envelopes (meta v2/v3) are
  still readable through a format-detecting reader, and that legacy reader sunsets at the
  next breaking release: re-export machines you intend to keep.
- **State kernel (`src/state`) refounds the journal.** Durable commits are now
  content-addressed objects with HEAD/PREV generations, verify-on-read
  (`PYPROC_STATE_CORRUPT`, with PREV fallback) and owner fencing
  (`PYPROC_STATE_FENCE_STALE` protects HEAD from a superseded writer). Existing journals
  are migrated automatically on first recover; no consumer action is needed.
- **Machine crypto injection.** `pyproc/machine` persistence and image constructors now
  require a provider from `createMachineCryptoProvider(crypto?)` instead of a bare
  `Crypto` object, so digest/signature law lives in one place (the state kernel).

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

### Migration map (old import -> new path)

| Before | After |
|---|---|
| `boot()` -> `Runtime` | `boot()` -> `PyprocMachine`; the runtime is `machine.runtime` |
| `bootSession(manifest)` | `boot({ deterministic: true, ...manifest })` |
| `openMachine(blob, trustOpts)` | `open(blob, trustOpts)` |
| `session.exportImage(opts)` | `machine.history.export(opts)` |
| `session.save(dir, name)` / `session.load(dir, name)` | `machine.history.save(dir, name)` / `open({ dir, name })` |
| `openPersistentMachine(opts)` | `open({ persistent: opts })` |
| `rt.enableReactive()` checkpoint/restore | `machine.history.checkpoint()` / `restore()` / `tree()` / `prune()` (raw controller stays at `machine.runtime.enableReactive()`) |
| `rt.enableJournal(cfg)` commit/recover/pack | `machine.history.commit` / `recover` / `watch` / `pack` with `{ dir, ... }` |
| `new PyProc(opts)` + `pool.boot(n)` | `await machine.proc({ lanes: n, ...opts })` |
| `rt.enableTerminal(cfg)` | `machine.term(cfg)` |
| `createMachineKeyPair` / `exportMachinePublicKey` / `fingerprintMachinePublicKey` | `createStateKeyPair` / `exportStatePublicKey` / `fingerprintStatePublicKey` from `pyproc/history` |
| `bootEnv(manifest, dirs)` / `runScript(rt, src)` | `boot` manifest options (`packages`, `env`, `setup`, `wheelDir`) |
| `import { Runtime } from "pyproc/runtime"` | root `boot()` + `machine.runtime` (types via `index.d.ts`) |
| bare `Crypto` into machine persistence/image constructors | `createMachineCryptoProvider(crypto)` from `pyproc/machine` |

### Added

- **`PyProc.forkMany(srcPid, dstPids)`**: the speculative-exploration primitive. A parent's
  delta is one value, so a fan-out harvests it **once** and broadcasts over a
  SharedArrayBuffer instead of re-harvesting per lane: `O(heap + N x delta)` rather than
  `O(N x heap)`. Lanes stay isolated and candidate results are byte-identical to a serial
  run. `fork` is now a 1:1
  delegation (name and return shape unchanged). An agent loop is three calls: fan out,
  run candidates, `fork(winner, main)` to adopt.
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
- `PyProc.bootInfo`: the last `boot()` result (`{ workers, avgBootMs, forked }`) is kept on
  the pool, so paths that do not consume the return value directly (such as
  `machine.proc()`) still have an observation point.
- Asset provenance policy v2: the engine boot set (`pyodide.js` / `pyodide.mjs` /
  `pyodide.asm.mjs` / `pyodide.asm.wasm` / `python_stdlib.zip` / `pyodide-lock.json`,
  bytes cross-verified between the GitHub release and the jsdelivr CDN) is now described
  in the single asset catalog with a second distribution vocabulary,
  `upstream-cdn-runtime-reference` (referencing upstream's own distribution point at
  runtime is not redistribution). Both Web Computer guests now carry the same described
  provenance in signed envelopes; the "undescribed guest" marker is retired.

### 한국어 요약

- **루트 37개 -> 6개(porcelain 머신 핸들)**: `boot`/`open`/`createWebComputer`/
  `checkEnvironment`/`PyProcError`/`PYPROC_ERROR_CODES`만 남는다. `boot`가 돌려주는
  머신 핸들의 어휘(`run`/`fs`/`term`/`proc`/`history`)가 표면이고, 능력 상세는
  `machine.runtime` 탈출구로 연다.
- **open 통합**: 외부 bundle(무결성+서명 선검증), `{ dir, name }` 세션 저장(리플레이+델타),
  `{ persistent }` 멀티탭(`KernelElection` 반환, 구 `openPersistentMachine`)을 부활 동사
  하나로 통합. 결정적 부팅은 `boot({ deterministic: true })` opt-in이고
  `history.export`/`save`는 그 모드 전용.
- **subpath 재편**: `pyproc/history` 신설(상태 커널 계약: 주소 법, 오브젝트 모델, store,
  서명 tag, bundle 코덱). `pyproc/runtime`/`reactive`/`syscall-bridge`/`process-os` 소멸
  (핸들 동사로 이동, 위 마이그레이션 표 참조).
- **단일 bundle 포맷 `PYBUNDLE1`**: 구 `.pymachine` v2/v3 reader는 다음 브레이킹
  릴리즈에 일몰 예고(보관할 머신은 재내보내기).
- **상태 커널(`src/state`) 신설과 저널 재기초**: content-addressed HEAD/PREV 세대,
  verify-on-read(`PYPROC_STATE_CORRUPT`), fence(`PYPROC_STATE_FENCE_STALE`). 구 저널은
  첫 recover에서 자동 이관.
- **machine 암호 주입**: persistence/image 생성자는 맨 `Crypto`가 아니라
  `createMachineCryptoProvider`가 만든 provider를 요구한다.
- **forkMany**: 부모 델타를 한 번만 수확해 N 레인에 방송(4.05배). 그 위 4-후보 병렬
  탐색이 직렬 재시도 대비 5.2배. fork는 1:1 위임으로 이름과 반환 계약 불변.
- SharedKernel 삭제(정본은 openPersistentMachine), GPU/Socket/WASI는 subpath로 강등,
  별칭 3종(timeTravel/interrupt/mapSerial) 절삭.
- PyProcError 단일 오류 계약(코드/재시도 가능성/파이썬 예외 타입이 워커 경계를 건너온다).
- 체크포인트 핸들(cp.restore() 한 호출), collectDelta/markDirty/pruneTo/dispose,
  복원의 경계 기록, 컨트롤러 memoize, 저널 onStatus/pruneAfterCommit,
  respawn/killHard, map 부분 실패 정직화, 컨테이너 중첩 라우팅과 사망 즉시 거부.
- `PyProc.bootInfo`: 마지막 boot() 결과를 풀에 보관(반환을 직접 받지 않는
  `machine.proc()` 경로의 관측 지점).
- 자산 provenance 정책 v2: 엔진 부팅 집합 6파일을 단일 catalog가 기술(두 유통 경로
  바이트 교차 검증), 배포 어휘 `upstream-cdn-runtime-reference` 신설(상류 배포 지점
  런타임 참조는 재배포가 아니다). 두 guest가 같은 기술된 출처를 봉투에 나르고
  미기술 게스트 표식은 은퇴.
