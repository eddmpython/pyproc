# kernel-contracts

## Contents

- Kernel checkpoint v2
- Descriptor
- Worker ownership and compaction
- Safe boundary
- Restore verification
- Verification
- KernelFactory
- Input
- Boot
- Checkpoint and clone
- Machine image
- KernelRuntimeContract v2
- Ownership and surface
- Command identity and ordering
- Failure and lifecycle truth
- Value boundary
- Checkpoint boundary
- Host capability boundary
- Evidence
- KernelVfs v1
- Mounts
- Immutable root
- Commit order
- Recovery and ownership
- Typed devices
- Checkpoint pairing
- Verification

# Kernel checkpoint v2

Kernel checkpoint v2 is the engine-bound state image for KernelRuntimeContract v2. The CPython WASI
worker computes page changes at an idle command boundary. The host stores opaque full or delta image
artifacts and validates descriptors, but never reads allocator meaning or exposes engine memory to a
consumer.

## Descriptor

A descriptor has protocol `pyproc.kernel-checkpoint`, version 2, and binds all of these fields:

- exact engine and environment identities
- kernel protocol major 2 and hostcall ABI major 1
- initial and current memory pages plus the stack partition boundary
- content-addressed memory image artifact and SHA-256
- full or delta kind, delta depth, and changed page count
- VFS root when available, open resource dispositions, and execution cursor
- logical parent checkpoint, creation time, descriptor digest, and checkpoint ref

The checkpoint ref is derived from the descriptor digest. A memory image has a fixed binary header,
64KiB page records in ascending index order, and no trailing data. Full images cover every page of
the restorable region. Delta images contain only changed pages.

## Worker ownership and compaction

The worker captures the restorable region beginning at the linked stack boundary. It compares that
region with the active checkpoint materialized inside the worker. A first checkpoint and every memory
growth boundary are full. Other checkpoints are page deltas. Delta depth 50 forces a full image, which
bounds restore traversal while keeping logical ancestry.

`KernelReactiveController` stores only descriptors and calls `checkpoint` and `restore` on the v2
kernel. It never reads a heap view, stack pointer, WebAssembly memory, or engine object. Branching is a
change of logical parent ref. Restore remains a queued kernel command.

The committed filesystem side of the same boundary is defined by [KernelVfs v1](#).
An active VFS transaction blocks checkpoint, and a sealed descriptor carries one verified root digest.

## Safe boundary

Checkpoint is rejected with `KERNEL_CHECKPOINT_BUSY` when any accepted hostcall, active VFS
transaction, undrained output, or resource with `forbidden` disposition is present. The current M4
descriptor contract defined this boundary. M5 attaches KernelVfs transaction and device resources.
M6 attaches the live WASI session hostcall set. The kernel merges session, VFS, and optional external
coordinators instead of allowing one coordinator to hide another.

Open resources have one of four dispositions: `closed`, `reopenable`, `reconcile`, or `forbidden`.
Only the first three can appear in a sealed descriptor. A memory image does not recreate a network,
GPU, clipboard, browser, or lock resource by itself.

## Restore verification

Restore verifies descriptor identity and digest, exact engine and environment identity, protocol and
ABI majors, memory artifact digest, image layout, page table, delta depth, and parent availability
before asking the worker to change memory. A delta must match its parent's memory layout and depth.
Wrong engine, wrong environment, corrupt artifact, missing parent, parent mismatch, and descriptor
tampering leave the active generation unchanged.

After a successful worker restore, kernel generation increments and all application references from
the previous generation expire. Candidate-worker validation and cross-worker portable import are part
of the later composition migration. M4 proves same-worker exact restore and the complete validation
boundary without claiming those later capabilities.

## Verification

Source contracts cover deterministic image packing, full plus delta materialization, missing parent,
corrupt bytes, wrong engine, busy boundary, failed-restore generation stability, reactive branches,
and absence of direct memory access in the v2 reactive consumer.

The Edge probe uses the owned CPython 3.14.6 worker. It forces memory growth, checkpoints a mutation
that precedes a Python exception, creates 100 sequential checkpoints, observes depth-50 compaction,
restores four sampled states, and rejects wrong-engine, corrupt-delta, and wrong-parent candidates.
The 2026-08-14 run stored 447,799,904 artifact bytes for the 100-checkpoint stress. That measured write
amplification is an optimization target for the performance milestone, not hidden as a small-state
claim.

# KernelFactory

`KernelFactory` is the only composition boundary that turns engine artifacts into a live kernel.

## Input

A canonical `KernelEngineManifest` binds engine ID, environment ID, runtime kind, target, Python version, native
profile, stdlib directory, build-manifest digest, and exact WASM and stdlib artifact descriptors. Each descriptor
contains a URL, SHA-256, and byte length.

## Boot

The factory verifies the manifest, loads each artifact through its content-addressed store, checks byte length and
digest, and passes bytes to the worker session. It accepts the kernel only after protocol negotiation and a Python
version self-test prove the requested identity. There is no alternate loader or compatibility selector.

## Checkpoint and clone

Factory checkpoints are registered as a parent chain. Clone seals the active checkpoint, materializes it in a fresh
worker, and returns a new `KernelSession`. Capabilities such as the terminal receive the Factory checkpoint port so
their delta checkpoints cannot bypass parent registration.

## Machine image

Export includes the canonical engine manifest, checkpoint descriptors, and content-addressed checkpoint objects.
Engine binaries are not embedded. Open verifies the image digest, every checkpoint object, the parent chain, engine
identity, environment identity, and memory layout before starting a worker.

The executable evidence is in `tests/contracts/kernelFactory.mjs`, `tests/browser/gate.js`, and
`tests/browser/installedPackageGate.mjs`.

# KernelRuntimeContract v2

KernelRuntimeContract v2 is the Promise-first boundary for a worker-owned CPython WASI kernel. The low-level
constructor remains available from the Experimental `pyproc/wasi` subpath through `bootCpythonWasiKernel`.
The root `boot()` path composes the same contract through `KernelFactory` and `KernelMachine`.

## Ownership and surface

One dedicated worker owns the CPython instance and its linear memory. A consumer receives no heap
view, raw engine object, live Python object, or synchronous execution method. Every operation returns
a Promise:

```ts
interface KernelRuntimeContractV2 {
  readonly runtimeContractVersion: 2;
  readonly runtimeKind: "cpython-wasi";
  describe(): Promise<KernelDescriptor>;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  getValue(request: GetValueRequest): Promise<ValueResult>;
  setValue(request: SetValueRequest): Promise<MutationReceipt>;
  checkpoint(request?: CheckpointRequest): Promise<CheckpointReceipt>;
  restore(request: RestoreRequest): Promise<RestoreReceipt>;
  install(request: InstallRequest): Promise<EnvironmentReceipt>;
  inspect(request?: InspectRequest): Promise<InspectionResult>;
  interrupt(request?: InterruptRequest): Promise<InterruptReceipt>;
  close(): Promise<CloseReceipt>;
}
```

`runSync`, heap views, stack manipulation, and a raw engine getter are outside this contract.

## Command identity and ordering

Every operation is admitted to one serial queue as a `pyproc.kernel-command` version 1 envelope.
The envelope includes `commandId`, `kernelRef`, `generation`, `operation`, canonical input, and its
SHA-256 digest. Optional deadline, cancellation, authority, and expected state digest fields travel
with the same command.

Calls are admitted in invocation order even though digest calculation is asynchronous. Reusing a
command ID with the same operation and canonical input returns the same sealed receipt without
running the effect again. Reusing it with different input fails with `KERNEL_COMMAND_CONFLICT`.
A restored kernel increments its generation and rejects commands that name an older generation.

Events use `pyproc.kernel-event` version 1 and have a command-local sequence starting at 1. A normal
execution publishes `commandStarted`, zero or more ordered output events, and `commandCompleted`.
The final execution result repeats ordered output chunks for bounded request and response use.

## Failure and lifecycle truth

Python exceptions resolve to a failed `pyproc.execution-result` with a structured kernel error.
They do not look like a completed execution. A worker error, message decoding failure, unexpected
WASI exit, or hard interrupt rejects session work and terminates the worker. An active execution then
resolves as `terminated` with retry policy `newGeneration`. Queued work is rejected and is not moved
to a replacement worker implicitly.

Queued cancellation is terminal before execution. Interrupting running Python terminates the worker
because the current WASIp1 engine has no proven cooperative signal path. Recovery requires opening a
new kernel. `close()` is idempotent and rejects later commands through the terminal queue state.

## Value boundary

`getValue`, `setValue`, and application invocation use ValueEnvelope v1. The closed type union,
canonical digest, limits, artifact spill, Python codec, and generation-bound application reference
law are defined in the [ValueEnvelope specification](./value-envelope.md).

## Checkpoint boundary

`checkpoint` returns an engine-bound version 2 descriptor backed by worker-computed full or page-delta
artifacts. `restore` verifies compatibility and content before changing the worker generation. The
format, safe-boundary law, compaction, and reactive ownership rules are defined in the
[kernel checkpoint specification](#).

## Host capability boundary

An execution command passes its kernel, command, generation, and authority context to the worker
session. The static `_pyprocHost` module can synchronously issue a byte request while the host thread
continues an asynchronous provider operation. Provider authority, quotas, receipts, cancellation,
uncertain external effects, and checkpoint exclusion are defined by the
[Hostcall ABI specification](./hostcall-abi.md). The kernel surface does not expose the SAB,
raw opcode record, provider object, or Python pointer.

## Evidence

The source contract exercises ordering, deduplication, conflict rejection, queued cancellation,
structured failure, restore fencing, worker crash truth, and idempotent close. The Edge browser probe
uses the owned CPython 3.14.6 artifact and additionally executes 1,000 commands, hard-kills an infinite
Python loop, opens a replacement worker, and proves execution resumes there.
The Hostcall Edge probe additionally completes 10,000 static-module round trips, exercises stable
failure and uncertain-effect states, and rejects checkpoint while a hostcall is accepted.

# KernelVfs v1

KernelVfs v1 is the engine-neutral filesystem state boundary for the CPython WASI kernel. File bytes
are immutable content-addressed objects. A canonical root lists paths and object digests. Durable
commit uses a journal marker and compare-and-swap HEAD. No Emscripten filesystem object, browser file
handle, or raw device object crosses the public boundary.

## Mounts

The initial mount table is:

- `/` for the immutable engine root
- `/site` for the content-addressed package environment
- `/home` for the journaled persistent volume
- `/tmp` for generation-local memory
- `/dev` for typed live device providers

M5 implements durable `/home`, ephemeral `/tmp`, and typed `/dev` ownership. Package environment
mounting and the Python hostcall file adapter attach in later milestones.

## Immutable root

A root has protocol `pyproc.kernel-vfs-root`, version 1, and path-sorted file entries. Each entry binds
absolute normalized path, type, content SHA-256, byte length, and mode. Paths outside writable mounts,
backslashes, NUL, traversal, and missing sources are rejected. Symlinks are not part of v1.

Read verifies object length and digest. Reusing an immutable object or root key with different bytes
is corruption. A root is valid only when its own digest and every referenced object verify.

## Commit order

A transaction starts from one exact root and stages write, remove, and rename operations. Commit runs:

1. write and verify immutable file objects
2. write the canonical immutable root
3. write the transaction intent
4. write the durable commit marker
5. compare-and-swap HEAD from the base root
6. write the adoption record

A stale HEAD fails with `KERNEL_VFS_HEAD_CONFLICT`. The unadopted marker cannot become active during
recovery. An active transaction is reported to checkpoint coordination and blocks memory checkpoint.

## Recovery and ownership

Recovery first validates HEAD, its marker, the root, and all objects. If HEAD is corrupt, it scans
adoption records newest first and selects the newest candidate whose marker, root, and objects all
verify. Intent-only, marker-only, partial-object, stale-race, and corrupt candidates are discarded.
If no committed root is valid, recovery fails instead of silently creating an empty volume.

One logical owner lease binds owner ID, monotonically increasing owner epoch, and expiry. Another
owner receives `KERNEL_VFS_OWNER_BUSY` before expiry. After expiry it acquires a new epoch and runs
recovery. An old owner then fails with `KERNEL_VFS_OWNER_STALE`. OPFS commits use a Web Locks exclusive
section for HEAD CAS.

`MemoryKernelVfsStore` is the deterministic contract store. `OpfsKernelVfsStore` persists the same
protocol in the browser origin private filesystem. The store interface keeps filesystem logic apart
from browser storage mechanics.

## Typed devices

A device provider declares a closed operation list, one invocation function, and checkpoint
disposition. Every invocation passes a separate authority callback. A `/dev` path does not grant
authority. Disposition is exactly `closed`, `reopenable`, `reconcile`, or `forbidden`; an unknown value
is rejected. Live provider objects are not serialized into a root.

## Checkpoint pairing

`KernelVfs.inspectCheckpointBoundary()` returns active transaction count, device resource
dispositions, and the committed VFS root digest. Kernel checkpoint rejects an active transaction or
forbidden device and seals exactly one committed root with the memory descriptor. Uncommitted paths
cannot appear in that descriptor.

## Verification

The source contract covers immutable commits, read verification, rename, remove, traversal,
transaction close, stale HEAD races, all six injected commit steps, adoption recovery, owner leases,
typed devices, checkpoint coordination, and absence of engine-specific filesystem calls.

The Edge probe repeats the six-step crash matrix on real OPFS and Web Locks, reopens after owner crash,
proves a stale transaction cannot win, repairs a corrupt HEAD from a valid adoption, checks device
authority, and binds the committed VFS root to a real CPython memory checkpoint.
