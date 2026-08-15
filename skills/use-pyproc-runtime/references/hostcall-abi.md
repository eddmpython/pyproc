# hostcall-abi

## Contents

- Hostcall ABI v1
- Static Python surface
- Shared record
- Broker and receipts
- Product capability port
- Cancellation and uncertain effects
- Verification

# Hostcall ABI v1

Hostcall ABI v1 is the synchronous Python to asynchronous host boundary for the worker-owned CPython
WASI kernel. The static `_pyprocHost` module writes a little-endian request frame to the preopened
`/hostcall` file. The worker copies that request into a dedicated SharedArrayBuffer record, posts only
metadata to the host thread, and blocks on `Atomics.wait`. The host capability broker performs an
authorized operation, writes one terminal response, and wakes the worker.

The ABI carries bytes, stable numeric state, and stable numeric error only. It never carries a Python
pointer, JavaScript handle, browser object, or WebAssembly memory view. Provider policy remains on the
host thread. The worker transport contains no URL, socket, process, GPU, or clipboard implementation.

## Static Python surface

The owned CPython image statically registers `_pyprocHost`. It exposes:

- `abiVersion()` returning `pyproc.hostcall/1`
- `noop()` as a local static-module build oracle
- `call(opcode, payload=b"", flags=0, deadline_ms=30000, response_capacity=65536)`
- typed `HostcallError` subclasses for timeout, cancellation, broker loss, unknown outcome, authority
  denial, and response overflow

`call` opens `/hostcall`, writes one 36-byte request header followed by payload bytes, and reads one
20-byte terminal response header followed by response bytes. A request and its declared response
capacity together cannot exceed the 1MiB data region.

## Shared record

The control region is exactly 16 signed 32-bit atomic words. Values are interpreted as unsigned where
the field is unsigned.

| word | byte | field | writer |
|---:|---:|---|---|
| 0 | 0 | magic `0x50595048` | worker |
| 1 | 4 | ABI version `1` | worker |
| 2 | 8 | lifecycle state | both by declared transition |
| 3 | 12 | opcode | worker |
| 4 | 16 | flags | worker |
| 5 | 20 | request ID low | worker |
| 6 | 24 | request ID high | worker |
| 7 | 28 | request offset | worker |
| 8 | 32 | request length | worker |
| 9 | 36 | response offset | worker |
| 10 | 40 | response capacity | worker |
| 11 | 44 | response length | host |
| 12 | 48 | stable error code | host |
| 13 | 52 | relative deadline in milliseconds | worker |
| 14 | 56 | reserved, must remain zero | none |
| 15 | 60 | reserved, must remain zero | none |

State is `idle`, `request`, `processing`, `response`, `error`, `cancelled`, `timeout`, `brokerLost`, or
`outcomeUnknown`. The worker publishes payload and metadata before `request`. The host claims exactly
one request with compare-and-exchange from `request` to `processing`, copies request bytes out of the
shared region, writes response bytes and metadata, then publishes a terminal state and notifies. The
worker resets the record to `idle` only after the response frame has been consumed or its file is
closed.

The worker has a deadline plus one-second deadlock watchdog. Normal deadline is owned by the broker.
The extra worker watchdog terminates an otherwise stranded synchronous wait if the host event loop or
broker disappears before publishing any terminal state.

## Broker and receipts

`HostCapabilityBroker` owns the opcode registry, authority callback, response quota, active operation
set, and receipt map. Receipt identity binds request key, opcode, flags, and payload digest. Repeating
the same identity returns the same promise and sealed result. Reusing the key with different input is
a conflict and never sends a provider operation.

An authority-bearing provider is checked before `sent` becomes true. Core v1 providers are no-op,
clock, entropy, and optional terminal write. Terminal authority is separate from access to the Python
module or `/hostcall` file.

Provider results may be bytes, text, JSON-compatible values, or an async iterable when the stream flag
is present. M6 drains async iterable chunks in order into the declared bounded response and exposes an
internal chunk callback for provider tests. Capacity is checked while chunks arrive, so an unbounded
stream cannot allocate past the response limit. Product body and device stream opcodes are added with
their capability ports in M7 and do not create a live Python or JavaScript handle.

## Product capability port

`ProductHostCapabilityPort` installs the append-only product ranges without moving browser policy into
the worker. HTTP uses request, body-read, and cancel opcodes in `0x0100` through `0x0102`. Each body read
spends an explicit credit of at most 64 KiB, so a large response never creates an unbounded host result.
Socket relay uses connect, send, receive, and close in `0x0200` through `0x0203`, including write half-close.
Process uses spawn, wait, signal, and pipe in `0x0300` through `0x0303`. GPU dispatch is `0x0600`.
Clipboard read and write plus framebuffer publish occupy `0x0500` through `0x0502`. ASGI exchange is
`0x0700`.

Every adapter is injected. The supplied browser factories bind Fetch, WebSocket relay, Clipboard,
framebuffer publication, the installed `createWebGpuHostAdapter`, `AsgiServer`, and a future `KernelFactory`
without exposing those objects to Python. The WebGPU adapter accepts only `vectorAdd` and `solidRgba8`, and
`runHardwareVisualOracle` seals adapter identity plus compute and pixel digests in a version 1 receipt.
Authority is checked before the adapter is called. Effect providers use an explicit
send marker immediately before the adapter call, so invalid input and denial remain known not sent while
cancellation after the call starts remains `outcomeUnknown`. Receipt identity still prevents duplicate
external sends.

The authority callback receives an isolated payload copy, its digest, response quota, deadline, kernel,
command, and effect class, allowing product policy to revalidate destinations instead of trusting a URL or
process description supplied by Python. An ASGI adapter names its target kernel and rejects a hostcall from
that same kernel before the send boundary, preventing a Python to host to same-Python reentrancy cycle.

Open HTTP bodies, sockets, and processes are reported as forbidden checkpoint resources. HTTP bodies
disappear after exact drain or cancel, sockets after full close, and processes after terminal wait. A
write-half-closed socket remains open and blocks checkpoint. GPU dispatch, clipboard operations,
framebuffer publication, and ASGI exchange are request scoped and leave no live handle in the checkpoint.
WebGPU buffers, textures, readback mappings, and the device are owned by the injected adapter and are closed
without crossing the hostcall byte boundary.

## Cancellation and uncertain effects

Cancellation before provider send is `cancelled`. Cancellation or broker loss after sending an
external-effect provider is `outcomeUnknown`, because the host cannot truthfully claim whether the
remote effect committed. The sealed receipt prevents an automatic retry from sending the same effect
again. Broker loss during a non-effect operation is `brokerLost`. Timeout, overflow, denial, provider
failure, conflict, and invalid protocol have separate stable error codes.

Active hostcalls are checkpoint resources. `WasiSession.inspectCheckpointBoundary()` reports its
accepted operations, and the kernel merges that boundary with VFS and optional external coordinators.
Any accepted hostcall blocks checkpoint.

## Verification

The source contract covers the fixed SAB layout, 10,000 broker operations, core providers, bounded
stream order, overflow, timeout, cancellation before and after send, broker loss, uncertain external
effects, receipt deduplication, input conflict, authority denial for HTTP, socket, process, GPU, and
clipboard, active checkpoint reporting, worker policy separation, and the static C frame surface.

The browser probe uses the owned CPython image and static module for 10,000 complete Python to worker
to host round trips. It also exercises core providers, bounded stream response, typed overflow and
timeout exceptions, five authority denials with zero provider sends, duplicate external-effect
receipt reuse, after-send cancellation, checkpoint-busy reporting, and broker loss during a real
worker hostcall under an explicit watchdog. It also hard-interrupts Python while an external-effect
hostcall is waiting and verifies one provider send, terminated kernel truth, and an `outcomeUnknown`
broker receipt.
