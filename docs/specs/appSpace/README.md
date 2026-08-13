# Transactional AppSpace 1.0

Transactional AppSpace is the protocol for pairing a cooperative application's declared logical state with an
in-process Python Machine checkpoint. It lets a caller create immutable candidates, restore both sides, and
adopt one candidate with compare-and-swap protection. External effects remain owned by Rehearse-Commit.

This specification is intentionally narrower than browser snapshotting. It does not capture a renderer heap,
DOM nodes, event listeners, cookies, arbitrary IndexedDB databases, cross-origin frames, canvas pixels, service
workers, or remote service state.

## Activation and authority

AppSpace is disabled by default. A profile may enable it only when all of these conditions hold:

- `executionMemory.enabled` is true;
- `effectTransactions.enabled` is true;
- `browser.provider` is `frame`;
- the browser profile acknowledges `externalEffect` authority;
- at least one exact app identity is configured;
- every configured app origin is also an exact `browser.allowedOrigins` entry.

The cooperative page runs in the existing FrameSpace iframe with `sandbox="allow-scripts allow-forms"`, the
`credentialless` attribute, and `referrerPolicy="no-referrer"`. AppSpace does not add `allow-same-origin`, parent
DOM access, popup authority, top navigation, downloads, or a raw method channel. The page's self-description is
data, not permission. The host compares it with the configured identity and the live FrameSpace target origin.

## App identity

An identity has exactly four fields:

```json
{
  "appId": "com.example.workspace",
  "origin": "https://workspace.example.test",
  "adapterVersion": "1.0.0",
  "stateSchema": "workspace/3"
}
```

`appId`, exact URL origin, adapter version, and state schema must all match. AppSpace performs no implicit schema
migration and does not substitute an adapter from another origin. The `appRef` returned by `app.attach` is an
opaque attachment to one live FrameSpace session. It is not durable authority.

## Cooperative target protocol

The target loads `appSpaceTarget.js` before `frameSpaceTarget.js` and registers one adapter through
`globalThis.pyprocAppSpace.register(adapter)`. Registration is single-use. The adapter provides:

```text
identity
scope
revision()
quiesce()
exportState()
importState(state, outbox)
resume()
describeEffects()       optional
stageEffect(effect)     optional
finalizeEffect(effect)  optional
```

The transport exposes only `describe`, `quiesce`, `export`, `import`, `resume`, `stageEffect`, and
`finalizeEffect`. It is not an arbitrary page RPC surface. A capture uses an unguessable fence and checks the app
revision before quiesce, before export, and after export. A changed revision fails with
`APP_SPACE_REVISION_CONFLICT` and publishes no pair.

## AppStateSnapshot

The host creates the content-addressed `pyproc.appStateSnapshot` version 1 envelope. Its closed fields are:

```text
format, version
identity
revision
state
outbox
scope
stateSha256
contentSha256
```

`state` must be canonical JSON data. Object depth is at most 24, the structural item budget is 100,000, and the
configured `maxStateBytes` is at most 8 MiB. The current format has no blob sidecar. Allowed scope labels are
`router`, `form`, `domainStore`, `declaredRecords`, `localOperations`, and `effectOutbox`.

Keys that name passwords, tokens, API keys, cookies, authorization, client secrets, DOM, HTML, or a JavaScript
heap are rejected recursively. Every configured Execution Memory secret literal is also rejected. This is a
bounded literal defense, not general sensitive-data discovery. The host recomputes all digests and repeats secret
and quota validation whenever a pair is opened under the current configuration.

An outbox contains at most 64 unique entries. Each entry has exactly:

```json
{
  "intentSha256": "...",
  "state": "staged",
  "terminal": null,
  "effectReceiptSha256": null
}
```

A terminal entry requires an honest terminal value. A staged entry cannot contain a terminal or receipt.

## PairedGeneration

The immutable `pyproc.pairedAppGeneration` version 1 object contains:

```text
pairId and optional parentPairSha256
exact AppStateSnapshot
Machine checkpoint index
exported Machine image SHA-256, generation, and environment fingerprint
exact Execution Session ID and revision SHA-256
creation provenance
contentSha256
```

The Machine checkpoint index is the live restore handle. The exported portable Machine image and generation are
durable evidence of the captured state. The current Control product cannot import that image into the already
running Machine, so AppSpace restore is an in-process checkpoint operation. A new process can list and verify old
pairs, but it cannot cold-restore their Machine side through AppSpace 1.0.

## Publication and crash rule

Publication has three distinct facts:

1. write the immutable content-addressed pair object;
2. compare-and-swap `pairMarker:<pairId>` to publish a complete candidate;
3. for a checkpoint or adopt, compare-and-swap `appHead:<appId>` to select the active pair.

An object without its pair marker is invisible to `app.list`, cannot be opened by pair ID, and never becomes
active after a crash. A branch publishes a complete candidate without moving the active app HEAD. Its parent must
be the current active pair, preventing sibling work from being based on an unadopted state by accident.

## Restore and adopt

Restore first captures rollback checkpoints for the live app and Machine. It then imports the candidate app
snapshot under the fence, exports it again, verifies state and outbox equality, and restores the Machine
checkpoint. Both sides remain quiesced until verification finishes.

`app.restore` changes live state without changing `appHead`. `app.adopt` restores the pair and then moves
`appHead` with the caller's exact expected digest. If that compare-and-swap loses a race, AppSpace restores the
previous app snapshot and Machine checkpoint. If the HEAD moved but releasing the app fence fails, it attempts to
move the HEAD back as well. A failed paired rollback is `APP_SPACE_ROLLBACK_FAILED` with `outcomeUnknown`; callers
must stop and investigate instead of guessing which side is current.

AppSpace provides adopt, not merge. General merging of interpreter heaps and application state is outside the
contract.

## Effect boundary

`app.effect.stage` accepts only an existing exact Rehearse-Commit transaction in `prepared`, `rehearsed`, or
`approved` state. It gives the cooperative app only the transaction ID, intent digest, destination, and risk. The
operation returns `sent: false` and never dispatches an external effect.

`app.effect.finalize` accepts only the exact `terminal` or `sealed` transaction revision and copies its honest
terminal and receipt digest into the outbox. AppSpace never approves or commits an effect. Only `effect.commit`
owns the durable send lease and live provider boundary. Restoring app state cannot undo a remote effect.

## Operations

| Operation | Success outcome | Meaning |
|---|---|---|
| `app.attach` | `applied` | Bind one configured live cooperative adapter |
| `app.checkpoint` | `applied` | Capture a pair and move the active HEAD |
| `app.branch` | `applied` | Capture a sibling candidate without moving HEAD |
| `app.restore` | `applied` | Restore both sides without changing HEAD |
| `app.adopt` | `applied` | Restore both sides and CAS the active HEAD |
| `app.inspect` | `observed` | Inspect live adapter and active pair |
| `app.list` | `observed` | List complete pair markers |
| `app.effect.stage` | `applied` | Stage an exact effect identity without sending |
| `app.effect.finalize` | `applied` | Record an exact terminal effect result |

JavaScript Control, Python Control, and MCP adapt these same operations. They do not maintain separate state
machines.

## Conformance

A conforming implementation must prove all of the following:

- configured identity and live origin match before attachment;
- DOM, renderer heap, cookie, and cross-origin state are never claimed as captured;
- revision races publish no pair;
- a missing completion marker creates no visible candidate;
- restore and adopt never intentionally leave one side on another pair;
- stale adopt restores both live sides and leaves the existing HEAD unchanged;
- configured secret literals and forbidden state keys are rejected;
- stage performs zero external sends;
- JavaScript, Python, and MCP return the same durable pair digest;
- browser evidence runs from the packed npm artifact in Chrome and Edge.

The executable gates are `npm run test:contracts`, `npm run test:types`, and
`npm run test:app-space`.
