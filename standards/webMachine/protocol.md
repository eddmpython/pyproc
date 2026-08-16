# Web Machine Core v1

## Status and conformance

This document defines Web Machine Core version 1. The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, and MAY are to be interpreted as normative requirements.

An implementation conforms when it satisfies every requirement in this document and passes every vector listed by `vectors/coreVectors.js`. Passing repository tests demonstrates agreement with this version. It does not by itself demonstrate external implementation experience or standards-body adoption.

## Terms

A host owns adapters, devices, and machines. An adapter is a guest-engine boundary. A machine is a stateful binding of a machine identifier, adapter identifier, guest manifest, and permission record. An operation control is an optional object containing an `AbortSignal` named `signal`.

The five machine states are `created`, `running`, `paused`, `stopped`, and `failed`. The three snapshot scopes are `portable`, `session`, and `none`.

## Host and adapter

- **WM-CORE-001** A new machine MUST begin in `created`. Its state MUST be one of the five defined machine states at every observable boundary.
- **WM-CORE-002** A host MUST reject a lifecycle operation or request that is not valid in the current state with `WEB_MACHINE_INVALID_STATE` and MUST expose the actual state.
- **WM-CORE-003** Before adapter boot, a host MUST create a fresh adapter and verify callable `boot`, `pause`, `resume`, `snapshot`, `restore`, `shutdown`, `request`, and `inspect` methods. It MUST reject an incomplete adapter with `WEB_MACHINE_ADAPTER_INVALID` before calling its `boot` method.
- **WM-CORE-004** An adapter MUST declare every device it requires. Before adapter boot, the host MUST verify that each named device is both granted by the machine permission record and compatible with the declared kind and optional mode. Missing permission MUST fail with `WEB_MACHINE_DEVICE_PERMISSION_DENIED` before adapter boot.
- **WM-CORE-005** A host MUST serialize all operations for one machine in call order. Starting a later operation before an earlier operation settles internally is not conforming.

## Lifecycle

- **WM-CORE-006** `boot(control)` MUST be valid only in `created` or `stopped`. On adapter success it MUST enter `running`. An adapter boot failure MUST reject the operation and MUST NOT report `running`.
- **WM-CORE-007** `pause(control)` MUST be valid only in `running`. On adapter success it MUST enter `paused`.
- **WM-CORE-008** `resume(control)` MUST be valid only in `paused`. On adapter success it MUST enter `running`.
- **WM-CORE-009** `request(message, control)` MUST be valid only in `running` and MUST return the adapter request result without changing the machine state.
- **WM-CORE-010** `shutdown(control)` MUST call adapter shutdown when an adapter exists, release the active adapter context, and enter `stopped`.
- **WM-CORE-011** `inspect()` MUST return at least the machine identifier, adapter identifier, instance identifier, current state, normalized adapter capabilities when available, and an adapter inspection summary when available. It MUST NOT return a raw device or ambient capability.

## Snapshot envelope

- **WM-CORE-012** `snapshot(control)` MUST be valid only in `paused`. It MUST reject scope `none` with `WEB_MACHINE_SNAPSHOT_UNSUPPORTED`. A successful result MUST contain `schemaVersion: 1`, machine identifier, adapter identifier, adapter version, snapshot scope, origin instance identifier, and an owned byte copy of the opaque adapter payload.
- **WM-CORE-013** A `portable` snapshot MAY be restored into a cold machine in `created` or `stopped`.
- **WM-CORE-014** A successful `restore(envelope, control)` MUST call adapter restore with an owned payload copy and MUST leave the machine in `paused`.
- **WM-CORE-015** Restore MUST reject a mismatched schema, machine identifier, adapter identifier, adapter version, or snapshot scope with a typed snapshot error before reporting success.
- **WM-CORE-016** A `session` snapshot MUST NOT be cold-restored. A warm restore MUST reject it with `WEB_MACHINE_SNAPSHOT_SCOPE` when its origin instance differs from the target instance.

## Abort meaning

- **WM-CORE-017** If an operation signal is already aborted before dispatch, the host MUST NOT invoke the adapter operation. It MUST reject with `WEB_MACHINE_OPERATION_ABORTED` and details containing `retryable: true`.
- **WM-CORE-018** If an operation is aborted after adapter execution begins, the caller MUST be rejected with `WEB_MACHINE_OUTCOME_UNKNOWN` and details containing `retryable: false`. The host MUST allow the internal operation to settle before dispatching the next queued operation and MUST NOT replay it automatically.
- **WM-CORE-019** Every protocol failure MUST be represented by an error object with a stable `code` string. Additional diagnostic details MAY be included, but implementations MUST NOT require message-text parsing for conformance decisions.

## Portable image manifest

The portable image manifest is deterministic metadata over one or more portable snapshot payloads. It is distinct from any product archive container.

- **WM-CORE-020** Image content MUST have exactly `format`, `schemaVersion`, `groupId`, `createdAt`, `machines`, `devices`, and `blobs`. `format` MUST be `webmachine`, `schemaVersion` MUST be 1, and at least one machine record MUST be present. A machine record MUST have exactly `machineId`, `adapterId`, `adapterVersion`, `snapshotScope`, `requiredCapabilities`, `permissions`, `guestManifest`, and `payload`; its snapshot scope MUST be `portable`. A block-device record MUST have exactly `name`, `kind`, `byteLength`, and `payload`. A blob record MUST have exactly `blobId`, `byteLength`, and `digest`.
- **WM-CORE-021** Machine records MUST be ordered by `machineId`, device records by `name`, and blob records by `blobId`, comparing the UTF-8 bytes of each identifier.
- **WM-CORE-022** Machine identifiers, device names, and blob identifiers MUST be unique. Every machine or block-device payload MUST reference exactly one blob, every blob MUST have exactly one owner, each digest MUST match `sha256:` followed by 64 lowercase hexadecimal digits, and block-device byte length MUST equal its blob byte length.
- **WM-CORE-023** Signed image metadata MUST add `integrity` with algorithm `SHA-256` and a valid content digest, plus `signature` with version 1, algorithm `ECDSA-P256-SHA256`, a P-256 public key shape, and non-empty hexadecimal signature bytes. This structural validation does not establish signer trust.

## Product extensions

The `.webmachine` archive container, storage generations, key trust policy, multi-machine transaction protocol, worker topology, and guest-specific device protocols are product extensions. They may carry Core v1 content, but they are not required for Core v1 conformance.
