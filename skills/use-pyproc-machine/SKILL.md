---
name: use-pyproc-machine
description: Use PyProc Machine and WebComputer lifecycle, fleet, checkpoint, resume, execution memory, signed image, trust, permission, and persistence contracts. Use for createWebComputer, machine restore, portable state, fleet, resume, 머신, or trust review.
---

# Use PyProc Machine

## Outcome

Create, persist, move, restore, and inspect browser computers without weakening ownership or trust boundaries.

## Read first

Read the entrance overview, then select fleet, execution memory, resume, or trust reference.

## Procedure

1. Create through the public Machine entrance.
2. Acquire one owner before mutating durable state.
3. Pause at snapshot boundaries and verify signed images before restore.
4. Treat external effects and device handles as non-rewindable.
5. Dispose owners and machines explicitly.

## Verification

Run WebMachine, WebComputer, installed package, and relevant execution memory gates.

## Failure modes

Stop on stale ownership, unsigned import, device permission mismatch, replay of outcome-unknown work, or claims that browser effects were rewound.

## References

- [Machine entrance](references/machine-entrance.md)
- [Machine fleet](references/machine-fleet.md)
- [Execution memory](references/execution-memory.md)
- [Resume catalog](references/resume-catalog.md)
- [Trust and permissions](references/trust-permissions.md)
