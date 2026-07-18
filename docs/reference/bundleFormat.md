# State bundle format (`PYBUNDLE1`)

The portable machine image format written by `Session.exportImage()` and read by
`openMachine()`. One writer, one parser: the legacy `.pymachine` envelopes
(`PYMACHINE2`, meta v2/v3) are still readable through a format-detecting reader,
and that legacy reader sunsets at the next breaking release.

A bundle is a signed, content-addressed object pack: every heap page, file
payload, tree, and commit travels as a sha256-addressed object, and the reader
re-verifies every object against its address before any byte reaches the
runtime. Integrity (envelope digest) and provenance (signed tag) are separate
questions, answered by separate fields.

## Byte layout (version 1)

| Offset | Size | Content |
|---|---|---|
| 0 | 10 | ASCII magic `PYBUNDLE1\n` |
| 10 | 64 | ASCII hex of `sha256(body)` (the envelope digest) |
| 74 | 4 | `u32` big-endian header length `H` |
| 78 | `H` | header JSON (UTF-8), at most 1 MiB |
| 78 + `H` | rest | object bytes, concatenated in header index order |

Header JSON fields:

```json
{
  "version": 1,
  "commit": "sha256:<hex>",
  "meta": { "manifest": "<consumer-owned JSON string>" },
  "objects": [["sha256:<hex>", byteLength], ...],
  "tag": {
    "alg": "ECDSA-P256-SHA256",
    "target": "<unsigned envelope digest hex>",
    "publicKey": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." },
    "signature": "<base64>"
  }
}
```

- `objects` is an index: array order equals byte placement order, offsets are
  derived cumulatively. Every address is re-hashed on read; a mismatch rejects
  the whole file before any state is applied.
- `commit` must be present in `objects`. The commit object carries the parent
  addresses, the tree address, and the environment fingerprint (`h0`, engine
  asset digest, deterministic-boot flag) that `openMachine` compares against
  the freshly replayed kernel. A fingerprint mismatch is an explicit error,
  never a silent apply.
- `tag` may be `null` (unsigned bundle). The signing target is the *header
  digest*: `sha256:<hex>` of the canonical header JSON re-serialized with
  `tag: null`. Because the header pins every object's content address and
  length, signing the header seals the whole bundle (a git-tag-shaped design):
  swapped object bytes fail per-object verify-on-read, and a forged index
  breaks the signature target. This also makes the trust decision a
  prefix-only read - `readStateBundleHeader` parses magic, envelope digest,
  and header without touching a single payload byte, so an untrusted bundle
  is rejected before any object is read. A bundle whose bytes verify but
  whose signer is not in the caller's trust list is valid-but-untrusted;
  opening it still requires `{ trust: true }`.

The implementation of record is `src/state/bundleFormat.js`; the browser gate
re-parses an exported bundle byte-by-byte against this table.
