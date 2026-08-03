# Changelog

All notable changes to the public surface are documented here. Exact version pins are the
install contract, so a breaking change only lands where a pin is deliberately moved. Releases
happen only on an explicit maintainer decision; the Unreleased section accumulates until then.

한국어 요약은 각 절 하단에 둔다.

## Unreleased

<!-- unreleased-subpaths: -->
소비자가 핀한 버전에 아직 없는 subpath 목록이다(위 주석이 기계 판독 정본). 출하 문서가 이 이름을
예시로 쓰면 미출하 표식이 함께 있어야 하고, tests/contracts/publicSurface.mjs가 그것을 문다.

## 0.0.13 - 2026-08-03

Supersedes 0.0.12, which was tagged but never reached npm: the pre-publish gate refused it. The
x86 CI lane did not fetch the self-hosted engine, so the probes that boot Python beside the Linux
guest failed on a missing `/vendor/pyodide/`. That lane is fixed here, and a gate now asserts that
any CI job which starts a browser provisions the engine in the same job, derived from the package
scripts rather than a hand-written list.

**The package contents are identical to what 0.0.12 would have shipped.** Everything in the 0.0.12
section below is what this release delivers, including the breaking replay-boundary change and its
migration. Pin `0.0.13`.

한국어 요약: 0.0.12는 태그까지 나갔지만 게시 전 관문에서 막혀 npm에 도달하지 못했다. x86 CI
레인이 자체 호스팅 엔진을 안 받아 Python guest를 올리는 probe가 죽었고, 그 배관을 고치면서
"브라우저를 띄우는 job은 같은 job에서 엔진을 마련한다"를 게이트로 세웠다. **패키지 내용은
0.0.12가 냈을 것과 같다.** 아래 0.0.12 절의 브레이킹과 이관 안내가 이 릴리즈의 내용이다.
## 0.0.12 - 2026-08-03

### Breaking

- **The page-hash mixer splits each lane into two accumulator chains, so the replay boundary
  fingerprint (`h0`) changes.** Every word still goes through the identical non-linear step; only the
  dependency chain is shorter, which lets the multiply latencies overlap. The digest values differ, so a
  journal or `.pymachine` image written by an earlier version is refused with
  `PYPROC_REPLAY_MISMATCH` rather than applied to a heap whose page identity is computed differently.

  **Migration:** export what you want to keep with the version that wrote it (`history.export()`),
  upgrade, then `open()` the exported bundle - the bundle carries its own boundary and is re-anchored
  on load. A journal that was only ever a crash-recovery cache can be dropped with
  `history.forget()`. There is no in-place conversion: the fingerprint is the identity of the boundary,
  not a field beside it.

  Cheaper mixers were measured and rejected. Prefix-sum families (Fletcher/Adler) do less work per
  word but are linear over Z_2^32, and flipping the top bit of two words carries
  nothing, so the delta is `2^31*(L_i+L_j)` and vanishes whenever those weights have the same parity.
  The FNV lane cancels on the same pairs. The right shift in the second lane is the only thing that
  breaks that propagation, so per-word non-linearity is not negotiable. `[해시 soundness]`
  now asserts exactly that pair, and a linear mixer fails it.

### Changed

- **`/home` is committed as one content-addressed blob per file.** It used to be concatenated into a
  single pack, so one changed byte in one file changed the pack's address and the whole tree was
  re-read, re-hashed, and re-written on every commit. Now an unchanged file is already in the store
  and costs no write at all: a commit that changed nothing under `/home` writes zero home blobs, and
  a commit that changed one file writes one. `journal.commit()` reports that as `home.wrote`, which
  is now a count rather than a boolean.

  Older generations keep working - the v1 pack layout is still read, so upgrading does not lose a
  journal or an image. The **new** layout is not readable by older pyproc versions, so a
  `.pymachine` file exported after this change must be opened with this version or later; an older
  reader refuses it with `PYPROC_MACHINE_FORMAT_INVALID` rather than restoring a partial tree.

- **The Web Machine IndexedDB schema is now version 3, with a blob size index.** Asking how much a
  store holds - `inspectStorage()`, and every recovery-window plan - used to require deserializing
  every blob value just to read its length, so the question cost a full read of the database. Sizes
  now live in their own small store and neither call reads a blob value at all. Opening an older
  database migrates it in the version-change transaction; that one pass replaces the full read that
  every later call was paying. A database already upgraded to v3 is refused by an older pyproc with
  `WEB_MACHINE_SCHEMA_UPGRADE_BLOCKED` rather than opened with a store it does not know.

- **A checkpoint node now stores hashes only for the pages it changed.** The boundary keeps the full
  array, because it is what the replay fingerprint is computed from; every node above it keeps
  `[page, a, b]` triples and `ReactiveController.hashesAt(j)` folds the root-to-j chain when a
  consumer needs the whole array. Node cost stops tracking heap size and starts tracking churn, so
  `stats().hashBytes` on a long session reports a much smaller number than before - recalibrate any
  budget derived from it. `hashesAt` is new on the public surface; the `hashes` array itself was
  never part of it.

### Added

- **`setRetentionPolicy({ rebaseLinear: true })` reclaims memory on a linear history.** Pruning only
  frees nodes off the root-to-live path, so a session that checkpoints per statement (the dominant
  shape) got zero bytes back no matter what limit was set: the policy observed the overrun and the
  memory stayed. Rebase folds the path itself into the base, so the same limit now holds.

  **This moves the replay boundary, and that is breaking for anything written against the old one.**
  `hashes[0]` becomes the rebased state, so a journal or image committed before the rebase is refused
  with `PYPROC_REPLAY_MISMATCH`, and time travel to any checkpoint before the new boundary is refused
  with `PYPROC_CHECKPOINT_PRUNED`. Both refusals are explicit, neither is silent. The flag is off by
  default for exactly this reason; turn it on when a long-lived session matters more than its past.
  `ReactiveController.boundaryEpoch` counts boundary moves so a consumer caching the fingerprint (the
  journal does) can drop its cache.

### Fixed

- **The asset manifest now lists `workerHostedGuestWorker`** (`src/machine/composition/workerHostedGuestWorker.js`).
  `createWebComputer()` has always spawned that module worker, but it was missing from
  `getPyProcAssetManifest()`, so a deployment that copied exactly the listed files left it out of
  the same-origin set and out of the `assetIntegrity` preflight. Deployment pipelines pick up one
  additional file; the manifest format is unchanged and `PYPROC_ASSET_MANIFEST_VERSION` stays `1`.
- **`WheelCache` honours the `patchScope` it is given.** `bootSession({ wheelDir, packages })`
  deadlocked because the constructor dropped the re-entrant scope and the wheel fetch swap queued
  behind the boot window that was waiting for it.
- **Disposing a machine now reclaims journal watchers.** `machine.dispose()` stops the idle watcher
  started by `history.watch()`, so the interval no longer holds the runtime and the reactive
  controller for the life of the tab.

한국어 요약: 리플레이 경계 지문(h0)이 바뀌는 브레이킹 릴리즈다. 페이지 해시 믹서가 레인마다 사슬 둘로 갈라지고, 체크포인트 노드는 바뀐 페이지의 해시만 담고, `/home`은 파일마다 내용주소 blob 하나로 커밋되고, Web Machine IndexedDB는 스키마 v3에 blob 크기 색인을 갖는다. 옛 저널과 이미지는 `PYPROC_REPLAY_MISMATCH`로 명시 거부되므로, 지키려는 상태는 이전 버전에서 `history.export()`로 내보낸 뒤 업그레이드하고 `open()`한다. 크래시 복구 캐시일 뿐인 저널은 `history.forget()`으로 버린다. `setRetentionPolicy({ rebaseLinear: true })`는 선형 역사에서 메모리 한계가 실제로 걸리게 하는 새 옵션이고, 경계를 옮기는 대가 때문에 기본값은 꺼짐이다.

## 0.0.11 - 2026-08-02

### Breaking

- **The 0.0.9-era `PYMACHINE2` reader is retired.** `open()` accepts the `PYBUNDLE1` format written
  by 0.0.10 and later. Open an older `PYMACHINE2` file with the version that wrote it and export it
  again before upgrading. The error is `PYPROC_MACHINE_FORMAT_INVALID`.
- **`history.save()` and `history.export()` refuse heaps that hold JS handles** with
  `PYPROC_IMAGE_PROXY_SURFACE`. Export before enabling a blocking host surface when possible.
  `{ allowHostProxies: true }` explicitly accepts that the revived kernel keeps plain Python state
  but cannot use those surfaces again. Packet networking and the permission jail use value
  boundaries and remain portable.
- **`MachineCommitCoordinator` no longer takes `idFactory`** (`pyproc/machine`). Generation identity
  is the content address produced by the commit itself; remove the unused constructor argument.
- **`boot()` now rejects unknown option keys immediately.** Existing callers that mixed custom keys
  into boot options must move those values outside the boot option object.

Users upgrading directly from 0.0.9 must also apply the 0.0.10 migration from root
`boot() -> Runtime` to root `boot() -> PyprocMachine`; the 0.0.10 section below is the migration map.

### Added

- **A durable Web Computer lifecycle on the existing `createWebComputer()` handle.** Opt into it
  with `durability`, then use `initialize`, `save`, `exportImage`, `importImage`, `inspect`, and
  `dispose`. Owner fencing, restore-or-boot, pause/snapshot/commit/resume, signed export, candidate
  preflight, and conflict-safe active-context replacement are one public composition contract.
  Additional guest factories can be installed through `adapters` without adding a root export.
- **Explicit journal deletion and eviction detection.** `machine.history.delete()` leaves a deletion
  tombstone, while a committed marker with missing generations fails closed as
  `PYPROC_JOURNAL_EVICTED`. A fully origin-wide browser eviction remains indistinguishable from a
  first visit, so important state still needs an external signed export.
- **A project-built Linux guest.** The reproducible i686 Buildroot image, exact source archive,
  complete legal material, CycloneDX inventory, build manifest, config, and independent-build
  receipt are published together in the `buildroot-pyproc-i686-v2` asset release. The catalog pins
  the guest image by hash and the Web Computer can place it on the same packet switch as Python.
- **`pyproc/runtime` returns as a stable plumbing subpath** with `Runtime`, `bootRuntime`,
  `MemoryCapability`, `FileSystem`, `checkEnvironment`, and engine/runtime contract assertions.
  The separate `bootRuntime` name keeps its return type distinct from the root machine `boot`.
- The typed API subpaths `pyproc/runtime`, `pyproc/history`, `pyproc/machine`, and `pyproc/assets`
  now declare their type entry explicitly.
- `machine.dispose()` terminates the process pool and releases reactive retention.
  `machine.proc()` is memoized per machine so a remount reuses the existing pool.

### Changed

- Durable RPC now has one normative retry boundary. A direct durable controller may resend the same
  request id once only when it can prove a proxy-free session. A normal follower, a live timeout,
  a vanished caller, or an unportable heap returns non-retryable `PYPROC_RPC_OUTCOME_UNKNOWN`
  instead of guessing and replaying a possibly completed command.
- Agent and MCP sandbox examples install both the cooperative `net: false` jail and a browser CSP
  wall after trusted engine/package preparation. Local execution alone is no longer described as a
  no-exfiltration guarantee.
- Consumer-facing diagnostics and capability preflight errors use English on the public surface.
  IPC and WASI paths report their cross-origin-isolation requirement before allocating shared
  memory.
- GitHub Actions, TypeScript, and the publishing npm CLI are exact-version pinned. Chrome and Edge
  run independent release lanes, and npm Trusted Publishing grants OIDC only to the publish job.
- The internal `mainPlan` archive was removed. Persistent product, contract, and operating policy
  remains under `docs/`; implementation evidence remains in automated tests and git history.

### Fixed

- Consumer docs now name the shipped porcelain machine verbs and current signature helpers.
- Durable image import preserves the running machine set and HEAD when trust validation or commit
  conflicts fail.
- A serial timeout includes the Linux console tail, making a failed guest boot actionable.
- The project Buildroot guest mounts the v86 `host9p` volume at `/mnt/web` and starts both serial
  and VGA shells, so Linux disk, display, and keyboard state cross save and cold-restore boundaries.

한국어 요약: 기존 root 6-export를 유지하면서 Web Computer의 내구 저장·복원·서명 이동 수명주기를
공개 핸들에 완성했다. OPFS 삭제와 축출을 분리하고 Python과 재현 가능한 Buildroot Linux를 실제
packet network와 cold restore로 묶었다. `pyproc/runtime`은 안정 subpath로 출하한다. 0.0.9 시대
`PYMACHINE2`, JS handle을 가진 heap 저장, `MachineCommitCoordinator.idFactory`, 알 수 없는 boot
option에는 위 Breaking 절의 이관이 필요하다.

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
- **forkMany**: 부모 델타를 한 번만 수확해 N 레인에 방송하므로 팬아웃 비용이
  `O(heap + N x delta)`다(`O(N x heap)` 아님). fork는 1:1 위임으로 이름과 반환 계약 불변.
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
