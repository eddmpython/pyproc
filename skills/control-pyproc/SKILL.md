---
name: control-pyproc
description: Control PyProc through JavaScript, Python SDK, CLI, and MCP using the versioned control protocol, cancellation, attachment, authority, and terminal contracts. Use for control client code, python SDK, MCP tools, 제어 프로토콜, or automation transport.
---

# Control PyProc

## Outcome

Drive the same product operations from each binding while preserving terminal truth and bounded attachments.

## Read first

Read the control protocol, then the JavaScript or Python binding reference used by the caller.

## Procedure

1. Initialize an explicit manifest and authority boundary.
2. Use stable operations rather than page-internal paths.
3. Bind cancellation and deadlines to one terminal.
4. Verify attachment digest before use.
5. Never retry an outcome-unknown effect automatically.
6. Use `skills.search` and `skills.read` only for read-only knowledge retrieval. They do not grant control authority.

## Verification

Run control contract, control product, MCP product, and Python SDK gates as applicable.

## Failure modes

Reject duplicate request IDs, second terminals, authority escalation, unbounded frames, stale attachment references, and effect retries.

## References

- [Control protocol](references/control-protocol.md)
- [JavaScript control](references/javascript-control.md)
- [Python SDK](references/python-sdk.md)
- [Skill OS transport contract](../start-pyproc/references/skill-os-contract.md)
