# Automation recording and ReplaySpace

pyproc can record an authorized `NativeCdpSpace` or `FrameSpace` journey and replay it later without sending
another browser effect. Recording and replay use the same Control Protocol operations, MCP tools, and Python
SDK methods as the source provider. They do not add a JavaScript package export.

## Record a journey

Add `browser.recording` to a normal native or frame manifest:

```json
{
  "schemaVersion": 1,
  "engine": { "root": "/absolute/path/to/pyodide" },
  "browser": {
    "enabled": true,
    "provider": "frame",
    "allowedOrigins": ["https://app.example.test"],
    "maxRisk": "externalEffect",
    "actions": ["snapshot", "screenshot", "fill", "click"],
    "methods": [],
    "externalEffects": "acknowledged",
    "purpose": "authorized reproducible regression run",
    "recording": {
      "mode": "record",
      "file": "/absolute/private/run.pyproc-recording.json",
      "overwrite": false
    }
  }
}
```

Startup acquires an exclusive `<file>.lock`, writes an empty sealed recording before accepting any request, and
creates files with mode `0600` where the operating system honors POSIX modes. Metadata reads and generation
replacement share a short exclusive mutex; replay refuses a recording whose writer lock is active. An existing
recording is refused unless `overwrite` is explicitly `true`. A non-file target, unavailable parent, second
writer, or initial write failure stops startup before a browser operation can run. After an abnormal process
exit, treat a remaining `.lock` or `.mutex` as ownership evidence: confirm that its recorded process is gone
before removing that exact file.

Every completed operation appends one terminal to an in-memory recording and atomically replaces the JSON file.
`automation.space.inspect` reports recording state but is not part of the replay sequence. A provider error is
recorded with its code, outcome, retryability, completed prefix, and details.

The recording contains full operation inputs and outputs. Form values, URLs, runtime parameters, and other
sensitive application data can therefore be present. Store it like a test fixture containing credentials:
use a private directory, apply operating-system access controls, keep it out of source control, and delete it
under a retention policy. Keep the adjacent `<file>.artifacts` directory and lock under the same controls. pyproc
does not upload them.

## Integrity and artifact completeness

The version 1 JSON format has:

- a canonical JSON SHA-256 chain over ordered operation, input, terminal, and artifact-reference fields;
- a final digest over provider identity and policy, the full entry chain, and the artifact table;
- canonical base64, byte length, MIME type, and SHA-256 checks for every screenshot artifact;
- a `complete` flag that is true only when every referenced screenshot has bytes.

Screenshot bytes are stored once as content-addressed `0600` sidecar blobs under a per-recording generation,
not repeated inside each JSON snapshot. Inline screenshots enter that table immediately. A non-inline screenshot becomes complete after the
client reads every artifact chunk through `artifact.read`; chunk terminals retain metadata but not duplicated
base64. Replay preflight rejects a missing artifact, malformed JSON, changed operation, changed input or output,
changed bytes, broken sequence, or wrong digest. The JSON limit is 32 MiB, each recorded artifact is at most
16 MiB, total artifact bytes are at most 64 MiB, each entry is at most 1 MiB, and a recording has at most 10,000
entries.

The chain detects corruption and changes made without recomputing its digests. It is not a signature or HMAC:
anyone who can rewrite the recording can recompute an internally consistent chain. Replay therefore requires an
independently stored `recordingId` and `finalSha256` in the manifest. Protect that manifest and the recording with
separate access controls when provenance matters.

## Replay without effects

Switch the provider and mode while retaining the source action and method catalog:

```json
{
  "browser": {
    "enabled": true,
    "provider": "replay",
    "allowedOrigins": ["https://app.example.test"],
    "maxRisk": "externalEffect",
    "actions": ["snapshot", "screenshot", "fill", "click"],
    "methods": [],
    "externalEffects": "acknowledged",
    "purpose": "review a recorded authorized run",
    "recording": {
      "mode": "replay",
      "file": "/absolute/private/run.pyproc-recording.json",
      "recordingId": "recording:replace-with-preflight-output",
      "finalSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }
  }
}
```

`recordingId` and `finalSha256` are mandatory pins. `pyproc-control --check` and `pyproc-mcp --check` verify them,
the source action/origin/risk policy, the complete entry chain, and all sidecar bytes before starting the machine
browser. ReplaySpace has no source provider object and opens no DevTools port. Each request must match the
next recorded operation and canonical input digest. A mismatch is `AUTOMATION_REPLAY_DIVERGED` with
`notSent`, leaves the cursor unchanged, and never searches ahead. Recorded errors retain their original
outcome and never become retryable after an `applied` or `outcomeUnknown` terminal.

Screenshot bytes are rehydrated only for descriptors that were inline in the original terminal, then pass
through the normal Control Protocol byte length and SHA-256 attachment verification.

APX observations and `ActionEvidence` are ordinary canonical terminals in the same chain. Replay preserves
their graph digests, entity and observation references, verification state, and attachment order byte-for-byte.
It does not recapture the page, rerun a postcondition, or resend the original effect. This gives deterministic
perception review without misrepresenting recorded evidence as a new live observation.

## Checkpoint-aligned resume

`automation.space.inspect` returns the current `recording.cursor` and `recording.prefixSha256`. Store those
two values next to the Python checkpoint handle. To create a new replay process at that boundary, add:

```json
{
  "mode": "replay",
  "file": "/absolute/private/run.pyproc-recording.json",
  "recordingId": "recording:replace-with-preflight-output",
  "finalSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "startCursor": 2,
  "prefixSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

The process starts only if that prefix is exactly the digest at `startCursor`. Restoring Python still does not
undo the original browser effects. Replay makes the remaining evidence and terminals deterministic without
resending them.

## Verification

`npm run test:replay-space` packs and installs pyproc, records a real FrameSpace APX observation plus inline and
non-inline PNG paths, replays the full sequence with target requests fixed at zero, proves divergence does not move the cursor, resumes
a suffix in a new process with pinned identity plus prefix digest, and rejects an unrecomputed mutation, a missing
sidecar, and a non-file record target during Control and MCP installed preflight. The contract suite also fixes single-writer,
post-effect write failure, fatal latch, concurrent FIFO, shutdown drain, missing-artifact, forged-cursor,
recorded-error, and provider-call-count boundaries.
