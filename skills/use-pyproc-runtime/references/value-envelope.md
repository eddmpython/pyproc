# ValueEnvelope v1 and application references

ValueEnvelope v1 is the closed value boundary for KernelRuntimeContract v2. It moves durable values
without a Python object proxy or engine heap access. The JavaScript implementation and types are
exported from the existing Experimental `pyproc/wasi` subpath.

## Closed union

Every envelope has `protocol: "pyproc.value-envelope"` and `version: 1`. The supported kinds are:

- `null`, `bool`, finite `number`, `bigint`, and `string`
- inline `bytes` with base64, byte length, and SHA-256
- recursive `list` and string-keyed `map`
- content-addressed `artifact` for bytes above the inline threshold
- generation-bound `ephemeralRef`

Maps are ordered by canonical UTF-8 key bytes before hashing. Big integers use a canonical decimal
string. Negative zero is normalized to zero. NaN, infinity, undefined, functions, symbols, non-plain
objects, non-string map keys, cycles, and shared object identity are rejected.

The default limits are depth 32, 10,000 nodes, 1MiB total inline bytes, 1MiB per string, and a 64KiB
artifact threshold. An artifact store receives exact bytes plus their digest. Decode verifies byte
length and SHA-256 before returning bytes. A missing or corrupt artifact never becomes a value.

Stable negative fixture categories are exposed in `PyProcError.context.kernelCode`:

- `KERNEL_VALUE_INVALID` for an unsupported or malformed value
- `KERNEL_VALUE_LIMIT` for depth, node, string, inline byte, or missing spill capacity
- `KERNEL_VALUE_ARTIFACT_MISSING` when referenced content is unavailable

## Python bridge

The owned CPython WASI session uses the same tagged union for `getValue`, `setValue`, and application
arguments and results. Python integers outside the JavaScript safe integer range become `bigint`.
Python bytes remain bytes. Unicode strings, lists, tuples, and string-keyed dictionaries preserve
their value meaning. Unsupported Python objects fail instead of falling back to `repr`.

`getValue` returns both the envelope and its canonical digest. `setValue` accepts an envelope and
returns the applied value digest. The JavaScript implementation temporarily accepts raw values for
source compatibility, but the public TypeScript contract requires the envelope boundary.

## Application references

An application reference has protocol `pyproc.application-ref`, version 1, kernel identity,
generation, opaque ref, type, Python global name, and allowed operations. Registration checks that
the named Python global is callable. Invocation transfers only ValueEnvelope arguments and results.
No live Python callable is retained on the host.

Restore increments the kernel generation and clears the reference table. A cloned reference from the
old generation then fails with `KERNEL_APPLICATION_REF_STALE`. A reference from another kernel fails
with `KERNEL_APPLICATION_REF_FOREIGN`. Operation and type mismatches fail input validation.

The v2 ASGI path installs one Python dispatch helper, registers its global as an `asgi` application,
and invokes `dispatch` through this reference. The host-owned IPC reference registry applies the same
law to pipe, shared-memory, lock, and semaphore endpoints while keeping SAB objects off the Python
value boundary. The compatibility engine keeps its older bridge until process migration is complete.

The current WASI application runner supports coroutines whose awaits complete immediately, which is
enough for the bounded ASGI receive and send adapter. Awaitables that require an event loop fail with
`KERNEL_APPLICATION_AWAIT_UNSUPPORTED`; full asynchronous host capability waits arrive with the
versioned hostcall ABI milestone.

## Verification

The source contract covers the complete type matrix, canonical digest, cycles, shared identity,
limits, artifact integrity, cloned references, stale generation, IPC references, and an ASGI v2 path
that never calls `getGlobal`. The Edge probe repeats the matrix against the owned CPython 3.14.6
worker, mutates bigint and bytes in Python, spills 70KiB, dispatches an async ASGI app through a ref,
restores a checkpoint, and proves the old ref is stale.
