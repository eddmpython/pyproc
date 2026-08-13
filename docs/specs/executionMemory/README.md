# Execution Memory specification

Execution Memory is the durable index that lets a caller reopen verified execution state instead of reconstructing
it from a conversation. Its unit is an immutable session revision. A mutable session HEAD points to one revision
through compare-and-swap, while the revision links existing pyproc artifacts by digest.

It does not introduce another Machine image, browser recording, or evidence format.

```text
session HEAD
    |
    v
immutable revision
|-- repository identity
|-- .pymachine generation and environment
|-- branch and checkpoint labels
|-- SituationCapsule and recording boundary
|-- Evidence Pack verdict
|-- permission manifest digest
`-- parent revision and provenance
```

## Revision law

The canonical format is `pyproc.executionMemoryRevision`, version 1. Every field is closed and the
`contentSha256` is calculated from canonical JSON without the digest field. A revision has zero or one parent.
The first revision has no parent, and every later revision names the exact former HEAD.

Publication is ordered:

```text
verify referenced artifacts
-> write immutable revision object
-> compare expected HEAD
-> atomically replace HEAD
```

A failed comparison leaves the former HEAD unchanged. It may leave an unreachable immutable object or sidecar,
which `retentionPlan()` reports but never deletes.

## Linked truth

| Link | Verification |
|---|---|
| Project | Exact commit, tree digest, diff digest, and untracked flag |
| Machine | Full state-bundle integrity, generation commit, environment digest, and image digest |
| Cold Machine | The image checks above plus an exact completed suspend receipt |
| Browser | Valid SituationCapsule, recording ID, cursor prefix, and final recording digest |
| Evidence | Valid Evidence Pack and stored verdict |
| Permission | Canonical manifest digest, separate from image signature |

The Control product captures a portable `.pymachine` from its current deterministic Python Machine. A direct
host may mark that image `cold` only when a suspend receipt names the same Machine, generation, and environment
and has no pending cleanup. A caller supplied lifecycle string is not sufficient.

The current Machine sidecar contract is `.pymachine`. A multi-guest `.webmachine` remains owned by
`pyproc/machine` and is not accepted by `captureMachineImage()`.

## Session states

The closed states are `active`, `waitingApproval`, `suspended`, `completed`, `failed`, and `abandoned`.

- `waitingApproval` requires an exact pending intent digest.
- `suspended` requires a cold Machine and rejects `outcomeUnknown`.
- `completed` rejects `outcomeUnknown` and requires a verified Evidence Pack whose repository identity exactly
  matches the session project.
- The Control product publishes portable `active`, `waitingApproval`, `failed`, and `abandoned` checkpoints.
  Direct host composition owns a real cold suspend receipt.

Natural-language status, a successful function return, or an unsigned report cannot produce `completed`.

## Browser boundary

A browser boundary is valid only when the SituationCapsule and Automation Recording were captured together.
For a live RecordingSpace, capture runs inside its serialization queue. The queue remains occupied until the
minimal referenced sidecars have been copied and reloaded. For ReplaySpace, the manifest supplies the exact
recording ID, final digest, cursor, and prefix.

The cursor prefix is the digest of the last consumed entry, not the recording final digest. Cursor zero uses the
all-zero digest. Browser cookies, native profile state, unrecorded page state, and external effects are never
part of the revision.

## Completion

Completion consumes an existing canonical Evidence Pack. The pack must replay as `verified`, and its commit,
tree digest, diff digest, and untracked flag must equal the session project. A rejected or incomplete pack may
be linked to a non-completed revision but cannot close the session.

## Handoff

`exportHandoff()` creates a directory containing a canonical descriptor, Ed25519 signature, signer public key,
the full revision chain, and only sidecars reachable from that chain. Import requires both:

1. an exact trusted signer public-key file;
2. an exact approved permission-manifest digest.

Signature proves origin and descriptor integrity. It does not grant browser, network, file, or device authority.
The importer validates the chain and derives the expected inventory before copying any artifact. Missing,
unrelated, duplicated, unsorted, or path-shaped inventory entries fail closed.
Portable Machine images and cold suspend receipts occupy separate inventory sets. A handoff cannot acquire cold
authority merely because another session links the same Machine image digest.

## Privacy and storage

The store contains `objects/`, `sessions/`, `locks/`, `artifacts/`, `exports/`, and a local signing identity.
Files use content-derived names, and session IDs are encoded before becoming filenames. Export output is confined
to the store's `exports/` directory. Control import paths are confined to configured roots.

`secretEnv` values never enter the persisted manifest or preflight report. During capture and every reopen,
configured values are rejected in structured data and as literal UTF-8 or UTF-16LE bytes in Machine images and
artifact files. Values shorter than eight bytes are rejected at configuration time to avoid meaningless binary
matches. This is literal leak prevention, not semantic screenshot redaction or credential discovery. Callers
must still keep the registry outside source control and use the producing subsystem's redaction policy.

## Conformance

A conforming implementation proves:

1. stale writers cannot replace HEAD;
2. every linked object is reverified on open;
3. cold and completed terminals cannot be declared without their proofs;
4. a signed handoff does not grant permissions;
5. a handoff inventory equals the exact revision reachability set;
6. configured secret fixtures do not enter stored bytes;
7. retention identifies orphans without deleting reachable state;
8. installed Control, JavaScript, Python, and MCP operations preserve the same revision digest.

The executable contracts are `tests/contracts/executionMemory.mjs` and the installed Control product gate.
