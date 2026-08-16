# Web Machine Core v1 Readiness

## Current claim

Web Machine Core v1 is a `standard-ready product protocol`. It is not a web standard and is not presented as a standards-track proposal. The repository now contains a bounded normative contract, an explainer, stable requirement identifiers, shared test vectors, a product binding, a dependency-free minimal implementation, browser execution, and a WPT-shaped test file.

The second implementation is structurally separate from product source, but it is written and maintained in the same repository. It is useful evidence that the text and vectors do not require product internals. It is not independent external implementation experience.

## Evidence and gaps

| Criterion | Evidence | Status |
| --- | --- | --- |
| Normative contract | `protocol.md` defines 23 versioned requirements | Met in repository |
| Shared executable tests | Nine atomic vectors cover every requirement | Met in repository |
| Product implementation | Public `pyproc/machine` behavior is bound without deep imports | Met in repository |
| Separate implementation | Dependency-free minimal host passes identical transcripts | Met in repository, not external |
| Browser execution | Product and minimal implementations run in the browser gate | Met in repository |
| WPT shape | One named asynchronous subtest is generated per vector | Prepared, not upstreamed |
| External implementation by a non-author | No verified implementation exists outside this repository | Not met |
| Two browser-engine families | Release gates cover Chromium-based Chrome and Edge, not an independent engine family | Not met |
| Public deployment and consumer reports | The product package is public, but protocol-specific authoring reports are not yet collected | Partially met |
| Public incubation | No community-group or standards-body venue has adopted the proposal | Not met |
| Wide review | No recorded external architecture, security, privacy, accessibility, or internationalization review | Not met |
| Patent and licensing review | Repository licensing exists, but no standards-track patent review has occurred | Not met |

## Horizontal review checklist

Security and privacy review must treat every device and inspection field as a potential capability or data leak. The current core requires explicit device grants, forbids raw capabilities in inspection, and makes post-dispatch uncertainty non-retryable. A future review must still examine identifier correlation, storage lifetime, denial of service, side channels, user consent, and malicious adapters.

Accessibility review applies to every product interface that exposes permission, progress, error, pause, restore, or trust decisions. Internationalization review must confirm that identifier comparison remains deterministic without presenting byte order as human collation. Architecture review must decide whether machine lifecycle is the right abstraction boundary and whether existing platform primitives can satisfy the use cases with less surface.

## Advancement conditions

The claim must remain `standard-ready product protocol` until all of the following have verifiable public evidence:

1. At least one implementation maintained by people outside the repository passes the shared vectors.
2. Interoperable snapshot and manifest exchange is demonstrated without private coordination.
3. Tests run in at least two independent browser-engine families where the underlying features exist.
4. Public authoring and consuming experience identifies difficult or unused features.
5. Security, privacy, accessibility, internationalization, and architecture reviews are recorded and addressed.
6. A suitable public incubation venue accepts the work and wide review begins.

## Process basis

The [W3C Process](https://www.w3.org/policies/process/) asks whether each feature is implemented, whether independent interoperable implementations exist, whether people other than specification authors implemented it, whether there are public deployments, and what implementation difficulty was reported. It also expects tests to develop alongside implementation and requires adequate implementation experience and wide review before Recommendation.

The test layout follows the atomic named-subtest model described by [web-platform-tests testharness documentation](https://web-platform-tests.org/writing-tests/testharness-api.html) and the [JavaScript test guide](https://web-platform-tests.org/writing-tests/testharness.html). Horizontal review preparation follows the [Security and Privacy Questionnaire](https://www.w3.org/TR/security-privacy-questionnaire/), [Internationalization Best Practices](https://www.w3.org/TR/international-specs/), [Web Platform Design Principles](https://www.w3.org/TR/design-principles/), and [W3C accessibility standards and guidelines](https://www.w3.org/WAI/standards-guidelines/).
