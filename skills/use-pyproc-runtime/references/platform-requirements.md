# Platform requirements

## Supported browsers

The supported production boundary is current Chromium and Microsoft Edge. Required features are:

- WebAssembly and module workers
- `SharedArrayBuffer`
- cross-origin isolation
- JSPI for synchronous hostcall suspension
- Web Crypto SHA-256
- `structuredClone`

Serve the application with:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Firefox and Safari are not currently supported product targets.

## Engine assets

The npm package includes the owned CPython 3.14.6 WASI core and standard library. Keep the installed relative
module graph intact and serve it from the application origin. Default boot verifies exact byte lengths and
SHA-256 digests. No remote engine origin is required.

## Optional browser storage

Memory-only use needs no persistent storage. Durable VFS and WebComputer flows use OPFS, IndexedDB, and Web
Locks where documented. Persistent state is scoped to the current origin bucket and starts as best-effort
unless the browser grants an explicit persistence request.

`navigator.storage.estimate()` is a rough observation, not a reservation. A write can still fail with
`PYPROC_STORAGE_QUOTA_EXCEEDED`; callers must not pre-authorize a write solely from the reported remaining
value. A cold start can distinguish total local eviction from a first boot only when the application retains
a pyproc witness outside the origin. Restoring deleted bytes additionally requires an external Machine bundle
copy. The runtime does not depend on browser debugging protocols; quota override and storage clearing are test
controls only.

## Optional host capabilities

Network relay, GPU, clipboard, framebuffer, and process adapters require the matching browser API or injected
provider. Their absence does not weaken authority checks and does not turn a denied operation into success.
