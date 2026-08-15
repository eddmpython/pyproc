---
name: benchmark-pyproc
description: Run, compare, and interpret PyProc runtime and browser benchmarks with controlled fixtures and evidence budgets. Use for performance investigation, baseline updates, speed regression, 벤치마크, or measurement review.
---

# Benchmark PyProc

## Outcome

Produce comparable measurements that remain evidence rather than public performance claims.

## Read first

Read the benchmark protocol before changing fixtures, budgets, or baselines.

## Procedure

1. Fix browser, machine state, fixture, repetitions, and warm or cold condition.
2. Record median and tail behavior with the existing artifact format.
3. Separate product regression from host variance.
4. Keep measurements in test artifacts, not package landing claims.

## Verification

Run the benchmark command and its contract gate named in the protocol.

## Failure modes

Reject single-run conclusions, mixed browser results, hidden warm caches, and published comparison numbers.

## References

- [Benchmark protocol](references/benchmarking.md)
