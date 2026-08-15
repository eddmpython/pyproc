# SituationCapsule candidate and authority contract

This document defines the strict candidate fields used by `apx.situation`. It supplements the versioned JSON
Schema and does not create a second truth store.

## Candidate state machine

| Cardinality | Match evidence | Enumeration | State | Authorized target |
| --- | --- | --- | --- | --- |
| `one` | exactly one | complete | `satisfied` | eligible |
| `one` | two or more | any | `conflicted` | never |
| `one` | zero or one | incomplete or unknown | `unknown` | never |
| `oneOrMore` | one or more | complete | `satisfied` | only under an exact action binding |
| `oneOrMore` | any | incomplete or unknown | `unknown` | never |
| `zeroOrMore` | any | complete | `satisfied` | not an action target claim |

Candidate truth is computed over the provider universe before `maxEntities`, relation, or byte projection.
Complete evidence has `matchedCount` and `matchSetSha256`. Incomplete evidence has `matchedLowerBound` and may
have an opaque read continuation. Unknown evidence has a lower bound but makes no continuation claim.

The continuation is bound to the source world, document epoch, requirement, selector digest, canonical ordering
digest, next offset, and expiry. Any mismatch or expiry rejects the read. It is not a capability and cannot be
passed as action authority.

`projectedCount` is the number of diagnostic candidate refs in the response. `omittedMatchedCount` is the known
matched count or lower bound minus that projection. Neither field changes the requirement state. A conflict
never emits an authorized affordance, including when output projection retains only one candidate.

## Send boundary

An authorized affordance binds `worldRef`, `situationRef`, `capabilityRef`, locator, action, risk, destination,
document epoch, transition shape, session, and expiry. A verified action prepares an exact target, computes its
actionability fingerprint, then repeats authority and binding checks immediately before the first provider
effect command. Any changed field fails with `APX_CAPABILITY_STALE` and `outcome: "notSent"`.

For a retryable document replacement only, the browser provider can replay the original typed focus once and
reissue a capability. It requires one matching target and unchanged authority facts. The public convergence
record says two observation/action attempts and zero effect retries. It never repeats an effect after dispatch.

This recheck is not atomic with CDP input. The receipt therefore includes preflight, actionability, authority,
send-request, and provider-acknowledgement times. Business success still belongs to postcondition evidence, not
to a short check-to-send interval.

## Input release and observation coverage

After a provider acknowledges a mouse-down or key-down command, `InputStateGuard` records the possibly-down
state until the matching release is acknowledged. Cancellation of the business action does not cancel the
independent bounded safety release. A release failure records residual input risk, keeps the action terminal
unknown where necessary, and quarantines further effects for that session.

`ActionEvidence.observationCoverage` binds the postcondition read-plan digest, focused or complete entity
enumeration, relevant omissions, and monotonic event windows. Absence and mismatch terminals require complete
relevant coverage. Direct matching evidence can confirm the asserted condition even when unrelated history was
dropped.
