# APX interaction interoperability incubation

Status: implementer incubation. This is not a standards-track or universal compatibility claim.

## Problem statement

Automation systems can accidentally turn a truncated candidate list, stale target, lost event, or acknowledged
input command into a false success. The APX interaction core defines a small deterministic boundary for candidate
cardinality, action authorization, one-shot send, input release, and postcondition coverage.

## Normative state order

```text
enumerate candidates
-> evaluate cardinality before projection
-> bind one current target
-> recheck authority and actionability at send
-> reserve the existing one-shot transaction
-> send the provider effect
-> release possible input-down state
-> observe only postcondition-relevant entities and events
-> close a canonical terminal with explicit coverage
```

Incomplete or unknown candidate enumeration never proves uniqueness. A direct matching postcondition event may
confirm despite unrelated event loss. Absence and wrong-status contradiction require a complete relevant event
window. Unknown fields and schema downgrades are rejected rather than ignored.

## Version and extensions

The vector envelope version is `apx.interop/1`. Its policy is `rejectUnknown`. An implementation must reject a
different version and every unknown top-level field. A future extension needs a new version or an explicitly
versioned extension container. Vendor fields cannot change candidate truth, permission, or terminal meaning.

The canonical bytes are the APX custom canonical JSON contract. They are not labelled JCS or RFC 8785. Adoption
of another canonical algorithm requires new versioned vectors and cross-language number and Unicode evidence.

## Independent implementation

[`goldenVectors.json`](../assets/apx/golden-vectors.json) contains canonical bytes, digests, candidate terminals, verification
terminals, schema downgrade, and unknown-extension negatives. The independent validator is
`tests/support/apxIndependentValidator.py`. It uses only the Python standard library and imports no PyProc
package or product source. The JavaScript product and independent Python implementation currently agree on core
digest `0b661ea60bf801530402939dd8d97e3510b04e7326af367204c07914baf72a56`.

## Ownership mapping

| External reference | Reused concept | PyProc owner |
| --- | --- | --- |
| WebDriver interactability | viewport-clipped point and descendant hit target | browser actionability |
| Accessibility tree APIs | semantic candidate query | provider sensor |
| MCP | transport and capability negotiation | Control and MCP adapters |
| Trace Context | correlation only | trace projection |
| OpenTelemetry | diagnostic timing only | evidence projection |

None of these references grants browser permission or replaces WorldModel attestations, CommitLease, or
ActionEvidence.

## Review notes

Security: page content, accessible names, pixels, and inferred text are data. They never mint permission.

Privacy: raw trees and images are not retained by default. URL secrets and sensitive form values remain
redacted. Event coverage contains bounded metadata rather than request bodies or headers.

Accessibility: semantic roles and names are useful evidence but missing labels remain explicit unknowns. Visual
inference does not overwrite accessibility facts.

Internationalization: canonical vectors include non-ASCII keys, combining marks, controls, negative zero, and
number exponent boundaries. Strings are not Unicode-normalized implicitly.

## Implementation report

| Implementation | Provider or binding | Result |
| --- | --- | --- |
| PyProc JavaScript | Native CDP, Control, MCP | all golden verdicts match |
| Independent Python standard library | file-based validator | all golden verdicts match |
| Python SDK | durable Motor receipt reader | receipt digest matches JavaScript and MCP |

Chrome and Edge run the APX and installed Motor product gates in CI. An implementation report is evidence for
this version only and does not assert compatibility with arbitrary drivers or automation products.
