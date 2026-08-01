# inTabTls - terminate TLS inside the tab

One campaign, one question.

## Question

**Can a tab terminate TLS itself, so the WS-to-TCP relay carries ciphertext it cannot read?**

Today `pyproc/socket` reaches the network through a relay that dials the real TCP endpoint. For
`https://` the relay terminates TLS (`src/capabilities/socketBridge.js` bootstrap: `ssl.wrap_socket`
is a pass-through because the relay already did the crypto). That is honest and documented, and it
has one consequence that shapes everything above it: **the relay must be trusted.** It sees plaintext.

That requirement is what rung 1 of the ceiling ladder exists to remove
([product direction](../../../docs/product/vision.md#where-the-ceiling-moves-next)). If TLS terminates
inside the tab, the relay becomes untrusted infrastructure and the requirement drops from "a relay you
trust" to "any relay at all". Every later rung inherits that trust model, which is why it is first.

## Hypothesis

Python's `ssl` module can drive a TLS handshake over a socket that is only a byte pipe, and the relay
can be reduced to exactly that pipe. Two candidate paths, and the campaign has to measure both rather
than assume one:

1. **CPython's own `ssl`** on the Pyodide build. The blocker to measure first is whether the Pyodide
   distribution ships a usable `_ssl` at all, and if so whether its OpenSSL can complete a handshake
   with sockets that are JSPI-suspended rather than real file descriptors.
2. **WebCrypto-backed TLS in JS**, with Python seeing a plain socket. This trades a large surface
   (a TLS 1.3 record layer over `crypto.subtle`) for not depending on the engine's OpenSSL.

If both fail, the failure is specific and worth recording: it names which layer cannot terminate TLS
without a real file descriptor, and that is the finding.

## Probes

| Probe | What it measures | Status |
|---|---|---|
| `sslSurfaceProbe.html` | Whether the engine's `ssl` can drive a real handshake: module presence, `SSLContext`, `wrap_socket`, and trust roots | measured, and it kills path 1 |

The order was deliberate: measure the engine's `ssl` before writing any relay code. It paid on the
first probe.

### Measured (2026-08-01, Edge headless)

```
ssl module        found
SSLContext        ok: OPENSSL_VERSION = "OpenSSL (stub)"
capabilities      wrap, verify, nocerts
```

**Path 1 is dead.** Pyodide ships an `ssl` module whose OpenSSL is a stub, and
`create_default_context().get_ca_certs()` is empty - there are no trust roots in the distribution.
`wrap_socket` exists and `verify_mode` defaults to `CERT_REQUIRED`, which is exactly the trap: the
surface looks complete enough that a naive attempt would appear to work right up until a handshake,
and would then either fail obscurely or - worse, if someone "fixed" it by setting `CERT_NONE` - do
unverified TLS while reporting success. Graduation gate 2 exists to catch precisely that shape.

So the campaign's remaining question is path 2 only, and it now carries a second requirement the
original framing missed: **where do the trust roots come from?** A TLS 1.3 record layer over
`crypto.subtle` still needs a certificate chain to validate against, and the browser will not lend
its own root store to page script. The honest candidates are a vendored root bundle shipped as an
asset with its own provenance entry (the `assetCatalog.json` discipline already covers this shape),
or pinning per consumer. Neither is free, and the next probe has to measure the cost before any
record-layer code is written - the same order that just paid.

## 졸업 게이트

Move to `src/` only when all of these hold, measured in a real browser:

1. **The relay never sees plaintext.** A relay instrumented to log everything it forwards records only
   ciphertext for an `https://` request that Python completes successfully.
2. **The certificate is actually verified.** A handshake against a host whose certificate does not
   validate fails, and it fails with a Python-level error a consumer can catch - not a hang, and not a
   silent downgrade to plaintext.
3. **`urllib` is unmodified.** The same consumer code that works today keeps working: the surface is
   `socket`, not a new API.
4. **The cost is stated.** Handshake latency and per-request overhead against the current
   relay-terminated path, measured on the same page, recorded here.
5. **The hermetic lane still holds.** `npm run test:socket` (relay plus a local origin, no traffic
   leaves the machine) covers the new path too, so the surface does not lose its CI gate to gain TLS.

Closing the campaign deletes this folder; the record lives in the ledger and in git history.
