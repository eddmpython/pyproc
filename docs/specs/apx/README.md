# APX 1.0 Product Contract

APX, Agent Perception Exchange, is the provider-neutral data contract behind PyProc Eyes. It turns browser
facts into either a bounded temporal graph or a goal-specific SituationCapsule, while keeping observation
identity separate from action authority. This
document describes the shipped 1.0 product contract. It is not a standards-body publication.

The normative implementation artifacts are:

- [APX Core schema](../../../scripts/perception/schemas/apxCoreSchema.json)
- [APX Web schema](../../../scripts/perception/schemas/apxWebSchema.json)
- [APX Action schema](../../../scripts/perception/schemas/apxActionSchema.json)
- [APX Visual schema](../../../scripts/perception/schemas/apxVisualSchema.json)
- [APX Focus schema](../../../scripts/perception/schemas/apxFocusSchema.json)
- [APX Situation schema](../../../scripts/perception/schemas/apxSituationSchema.json)
- [Full observation example](examples/fullObservation.json)
- [Delta observation example](examples/deltaObservation.json)
- [Action evidence example](examples/actionEvidence.json)
- [Unknown situation example](examples/situationUnknown.json)
- [Conflicted situation example](examples/situationConflict.json)
- [Proof-carrying action example](examples/proofCarryingAction.json)

## Product definition

PyProc Eyes is a persistent perception runtime, not a screenshot loop. It combines:

```text
semantic facts
  + structure and relations
  + geometry and occlusion
  + temporal identity and delta
  + pixels only for unresolved regions
  + post-action evidence
  + typed requirements, explicit unknowns, and broker capabilities
```

Sensors stay behind `PerceptionSpace`. A provider can use CDP, a cooperative frame bridge, or another driver
without placing raw driver identifiers in the APX envelope.

## Core invariants

An APX 1.0 implementation MUST preserve these rules:

1. `entityRef` identifies an observed entity within a document epoch. It grants no action authority.
2. `locatorRef` is a short-lived action capability. A provider MUST bind it to its session and document epoch.
3. A document replacement MUST end the old entity identity domain. Similar appearance is not continuity proof.
4. Provider-native node, object, frame, and execution-context identifiers MUST NOT enter a public graph.
5. `observed`, `derived`, `inferred`, and `reported` provenance MUST remain distinguishable.
6. An effect outcome such as `applied` MUST NOT be treated as proof that a business postcondition succeeded.
7. An effect with `outcomeUnknown` MUST NOT be retried automatically.
8. Truncation MUST be reported through `budget.truncated` and `budget.omitted`.
9. Visual inference MUST NOT expand origin, action, or risk permission.
10. Replay MUST return recorded terminals without sending the recorded effect again.
11. A required answer MUST NOT be omitted to fit a byte budget.
12. Page-reported and inferred capabilities MUST NOT become broker authorization.

## Representations

`apx.graph` is the complete bounded observation contract. Its 1.0 byte meaning is unchanged. `apx.situation`
is an opt-in projection over an atomically reconciled world. It answers typed `focus.requirements`, preserves
`known`, `conflicted`, `unknown`, and `stale` truth states, and returns only the facts, changes, unknowns, and
affordances needed for those requirements.

```json
{
  "representation": "apx.situation",
  "focus": {
    "objective": "Submit and prove acceptance",
    "requirements": [{
      "requirementRef": "requirement:submit",
      "select": { "role": "button", "name": "Submit order" },
      "need": ["fact", "affordance"],
      "cardinality": "one"
    }]
  },
  "visual": { "mode": "auto" },
  "budget": { "maxEntities": 120, "maxRelations": 300, "maxBytes": 65536 }
}
```

`objective` is descriptive content. It is never an instruction channel or permission source. Typed requirements
alone control deterministic projection. A cardinality conflict stays conflicted and emits no authorized
affordance. Sensitive semantic values are represented by redacted attestations rather than exported values.

The four affordance kinds are `observed`, `derived`, `reported`, and `authorized`. Only `authorized` carries a
broker-issued `capabilityRef`. The capability binds the situation, world, session, target, document epoch,
action kind, locator, risk, destination, and expiry. `actionContext` re-presents those bindings immediately
before an effect. A stale or mismatched binding fails with `APX_CAPABILITY_STALE`, `outcome: "notSent"`, and no
provider call.

## Observation lifecycle

`automation.observe` remains the only Control Protocol operation. APX is opt-in:

```json
{
  "sessionRef": { "protocolVersion": "1", "sessionId": "...", "targetRef": "..." },
  "expectedRisk": "read",
  "representation": "apx.graph",
  "since": "observation:previous",
  "query": { "role": "button", "name": "Save", "actionable": true },
  "visual": { "mode": "auto", "maxCrops": 2 },
  "budget": { "maxEntities": 120, "maxRelations": 300, "maxBytes": 65536 }
}
```

The first observation is `full`. A later observation with a retained `since` reference is `delta`. An unknown
or different-epoch base produces a full result with `resyncRequired: true`. The timeline is bounded, so a
consumer must be prepared to resynchronize.

The graph digest excludes rotating locator capabilities and temporal bookkeeping. Stable sensor identity
therefore produces stable `entityRef` values and meaningful changed paths while each public observation can
issue fresh locators.

## Channels

| Channel | Meaning | Typical provenance |
| --- | --- | --- |
| `semantic` | Role, accessible name, value, state, sensitivity | browser observation plus page report |
| `structure` | Node kind, opaque frame relation, parent and semantic edges | browser or cooperative page |
| `geometry` | Rect, viewport ratio, paint order, visibility, occlusion | browser observation or page layout |
| `interaction` | Supported actions, actionability, reason codes | deterministic derivation |
| `events` | Bounded console and lifecycle facts | browser observation |
| `networkMetadata` | Redacted request and response metadata | browser observation |
| `environment` | Locale, timezone, color scheme, reduced motion, bounded font metric fingerprint | target-observed trusted read |
| `visual` | Overview or entity crop descriptors | verified artifact store |

Requesting fewer entity channels removes those channels from the returned entities. The internal timeline
still keeps the fused graph, so a later query can request a different view without weakening identity.

The `environment` channel exists for exact comparability, not authority. Native CDP uses one fixed internal
trusted read and does not expose arbitrary `Runtime.evaluate` permission. FrameSpace reports the same facts from
its cooperative target. Verified Change Loop requires exact values before it evaluates a repository scenario.

## Attention query

The 1.0 query surface supports `entityRef`, `kind`, `role`, exact or structured name matching, state,
`actionable`, and `changedSince`. A query returns only matching entities and relations whose two endpoints are
present. `query.matched` reports the match count before byte-budget truncation.

Name matchers are exactly one of `exact`, `prefix`, `contains`, `token`, or `regex`. Input objects reject
unknown keys before a sensor or effect is called. Regex is a bounded safe subset: lookarounds, backreferences,
nested quantifiers, and adjacent quantifiers are rejected before evaluation.

## Pixel on demand

Native CDP can create verified screenshot artifacts for canvas, unlabelled images, and unlabelled controls.
`visual.mode: "auto"` crops unresolved entities. `visual.mode: "full"` may also include a low-resolution
overview when requested. Every descriptor retains MIME type, byte length, SHA-256, and provenance. MCP turns
inline descriptors into native image content; Control and Python clients receive the same verified attachment
bytes. A non-off visual request adds `apx-visual/1` and the `visual` channel to the returned graph. Attention
queries and temporal deltas limit crops to the selected unresolved entities. A failed later crop releases any
artifact already created earlier in the same observation.

FrameSpace reports unresolved entities but advertises only `visualModes: ["off"]`. Its DOM-rendered screenshot
is useful as an explicit screenshot action, but it is not compositor-authoritative APX visual evidence. A
non-off APX visual request therefore fails before target capture.

The current release does not ship OCR or model inference. A future adapter must mark its result `inferred`,
record provider and artifact provenance, and remain outside permission decisions.

## Action Evidence

An external-effect action may include `verify`. PyProc then runs one effect through this lifecycle:

```text
observe before -> authorize -> send once -> capture after -> verify -> return evidence
```

The shipped postconditions are:

- `entityAppeared`, matched by role and name
- `entityState`, matched by `entityRef` and explicit state assertions
- `networkResponse`, matched by method, redacted URL path, and status
- nested `all` or `any`, to four levels and eight children per group
- root `withinMs`, from 1 to 30000 milliseconds

Verification states are `confirmed`, `contradicted`, `ambiguous`, `notObserved`, and `outcomeUnknown`. A capture
failure after the effect has run is always `outcomeUnknown` and non-retryable, even if the underlying sensor
reported a narrower error. Network method and response status are correlated through a broker-issued opaque
`requestRef`; unrelated exchanges on the same URL cannot be combined into a confirmed result.

## Conformance

| Level | Required contract |
| --- | --- |
| L0 Core | Version, refs, schema, provenance, budget, digest |
| L1 Semantic | Semantic entities and relations |
| L2 Spatial | Geometry, viewport, occlusion, interaction |
| L3 Temporal | Epoch, stable identity, full and delta, resynchronization |
| L4 Evidence | One-shot effect boundary, capture window, postcondition result |
| L5 Hybrid | Inference adapter with visual provenance |
| L6 Replay | Sealed recording, artifact integrity, deterministic terminal |

The native CDP provider reports L4 and optional screenshot probes. FrameSpace reports L3 and no APX visual
mode. ReplaySpace preserves recorded APX observations, evidence, and artifacts byte-for-byte without claiming
that it is a live sensor provider. No shipped provider claims L5 inference.

## Security and privacy

Page text, ARIA, DOM, pixels, and inferred labels are untrusted content. The broker owns origin permission,
risk acknowledgement, locators, artifact quotas, and result outcomes. Password and payment autocomplete values
are redacted in semantic observations. URL credentials, query, and fragment are absent from APX page and
network metadata. Request bodies and headers are not collected by the APX sensor.

Native control still uses a broker-owned isolated browser profile. FrameSpace remains credentialless and
sandboxed. APX does not attach to a person's default browser profile and does not make `entityRef` actionable.

## Compatibility

Calls without `representation: "apx.graph"` or `representation: "apx.situation"` retain the existing legacy
accessibility-list result. APX adds no
npm root export and no new Control Protocol operation. MCP and the Python SDK adapt the same operation catalog.
The public compatibility and policy boundaries remain documented in the
[browser automation guide](../../usage/browserAutomation.md).
