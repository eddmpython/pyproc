# Control Protocol v1

`pyproc-control` is the language-neutral installed entrance for the persistent Python Machine and optional
browser automation. It uses the same product host as `pyproc-mcp`; only the stdio adapter differs. The npm
package has no runtime dependency.

The stable `pyproc/control` facade is unreleased until the next exact version after 0.0.20. Node.js
applications use it instead of implementing this framing directly.
See the [JavaScript Control SDK](javascriptControl.md). Other languages can implement the wire contract below;
the official Python client is documented in the [Python SDK guide](pythonSdk.md).

## Start and preflight

Use the same version 1 manifest documented in [browserAutomation.md](browserAutomation.md):

```sh
npx pyproc-control --config ./pyproc-mcp.json --check
npx pyproc-control --config ./pyproc-mcp.json
```

The command reserves stdout for UTF-8 NDJSON protocol frames and writes diagnostics to stderr. Do not mix
MCP JSON-RPC and Control Protocol frames on one process. Start `pyproc-mcp` for MCP, or `pyproc-control` for
the native protocol.

## Connection contract

Every frame contains:

```json
{"protocol":"pyproc-control","version":1,"type":"hello"}
```

The client sends exactly one `hello` first. The server replies with the same hello `requestId`, its limits,
and the enabled operation names. Version 1 advertises `events: false`; unsolicited event frames are rejected
until a later version provides an event source and consumer contract. A version mismatch, malformed frame,
wrong direction, or frame larger than 1 MiB closes the connection after one `fatal` error when a response can
still be written.

Request IDs are 1 to 128 ASCII characters from the documented identifier alphabet. An ID is single-use for
the lifetime of one connection, including after its terminal frame. A request has exactly one `response` or
request `error`. A late provider result after cancellation cannot create a second terminal.

The machine page starts through a single-use bootstrap URL. The server consumes its nonce once, injects the
separate bearer capability into a module closure, and removes the bootstrap script before guest code runs.
The capability never appears in the URL or guest-readable Web Storage, and the recorded bootstrap URL returns
410 after first use. A direct page reload therefore fails closed instead of silently reconnecting: already
delivered work settles as `outcomeUnknown`, queued follow-up work remains `notSent`, and the client must restart
the product process.

## Operations

The four machine operations are always present:

| Operation | Meaning | Success outcome |
|---|---|---|
| `machine.run` | Run Python in the persistent prepared machine | `applied` |
| `machine.checkpoint.save` | Save a restore handle | `applied` |
| `machine.checkpoint.restore` | Restore a saved Python state | `applied` |
| `machine.reset` | Restore the prepared boot state | `applied` |

When the manifest enables browser authority, ten more operations appear:

| Operation | Meaning |
|---|---|
| `automation.space.inspect` | Inspect provider, policy, actions, and limits |
| `automation.target.list` | List allowed targets |
| `automation.target.open` | Open an allowed URL |
| `automation.session.attach` | Create an opaque controlled session |
| `automation.observe` | Return a legacy semantic observation or opt-in APX graph |
| `automation.act` | Run an ordered high-level action pipeline |
| `automation.command` | Send one separately allowlisted low-level command |
| `automation.session.detach` | Drop session-owned state and detach |
| `artifact.read` | Read a bounded artifact chunk |
| `artifact.delete` | Delete an artifact explicitly |

The operation names, error outcomes, permission checks, action catalog, and artifacts are owned by the shared
host. The MCP adapter only maps tool names and native image content. This prevents the native and MCP paths
from assigning different meaning to the same action.

APX adds no operation. Pass `representation: "apx.graph"` to `automation.observe` for the provider-neutral
semantic, spatial, temporal, and visual-on-demand graph. Pixel probes use the existing verified attachment
framing. An action `verify` condition returns `ActionEvidence` inside the normal `automation.act` terminal.
The [APX 1.0 contract](../specs/apx/README.md) defines the envelope, provenance, budgets, and verification states.

The optional request `spaceId` is a fence, not an alternate router. Omit it to use the configured machine or
automation space. When supplied, `machine:primary` is required for machine operations and the exact `spaceId`
reported by `automation.space.inspect` is required for automation operations. A mismatch is rejected before
the provider is called.

## Cancellation and effects

A `cancel` frame is not a terminal. The original request still ends with a response or error.

- Cancellation before page delivery removes the queued command and returns `notSent`.
- Cancellation after delivery returns `outcomeUnknown` unless the provider proves a narrower boundary.
- `applied` and `outcomeUnknown` errors are never retryable.
- No effect command is replayed automatically.
- A pending connection loss or request write with unprovable delivery is non-retryable
  `CONTROL_CONNECTION_LOST` with `outcomeUnknown` in the supplied native clients.

Python checkpoint restore only rewinds the Python Machine. It does not roll back browser navigation, input,
storage, download, popup, network, or other external effects.

## Attachments

Binary output is sent as ordered base64 `attachment` frames before the owning terminal. Each stream has a
continuous decoded-byte offset and a final byte length plus lowercase SHA-256 digest. The terminal declares
the attachment ID, kind, MIME type, byte length, and digest. A client must withhold output until every
declared attachment is complete and verified.

The maximum JSON frame is 1 MiB, each decoded attachment chunk is at most 256 KiB, and one attachment is at
most 64 MiB. A client may advertise a smaller `maxChunkBytes` in its hello; the server sends chunks no larger
than that negotiated receive limit. Screenshot output removes inline base64 from the JSON result and preserves
the broker artifact reference for later chunk reads or deletion.

## Verification

`npm run test:control-product` packs and installs the npm package, runs `--check`, completes the handshake,
executes persistent Python, verifies post-send cancellation, opens a real allowed page, returns an APX graph,
captures a PNG, and checks its ordered attachment bytes and SHA-256. Chrome on Ubuntu and Edge on Windows run
the same gate.
