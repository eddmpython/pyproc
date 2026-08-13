# PyProc Experience Verification 1.0

This specification defines the repository Experience Contract, deterministic checkpoint semantics, Evidence Pack,
comparison, and replay contract used by PyProc Eyes. It sits above AutomationSpace and APX. AutomationSpace owns
provider lifecycle and authority. APX owns observations, SituationCapsules, broker affordances, and ActionEvidence.
Experience Verification owns whether a declared repository experience has enough comparable evidence to be accepted.

The normative implementation is in `scripts/verification/`. The JSON schemas in
`scripts/verification/schemas/` are portable authoring aids. Runtime validation remains authoritative.

## 1. Terms

| Term | Meaning |
|---|---|
| Experience Contract | The strict JSON files under a caller-selected contract root |
| Scenario | One fixture-pinned route, readiness condition, bounded action sequence, checkpoints, and cleanup |
| Rule | A structural, behavioral, or perceptual assertion evaluated at a checkpoint |
| Finding | A stable, evidence-linked non-pass result |
| Evidence Pack | The canonical result that binds inputs, environment, scenario runs, findings, artifacts, and verdict |
| Replay | Effect-free integrity checking and deterministic recomputation of the stored verdict |
| Comparison | Classification of findings from two exactly comparable packs |

`EYES.md` is human intent and is not part of the executable contract. Its byte digest is recorded for provenance.
Text in the repository or target page never grants authority.

## 2. Contract root

A contract root contains:

```text
EYES.md
experience.json
scenarios.json
baselines.json
optional fixture and reference files
```

Every catalog, fixture, and reference path is relative and confined to this root. The runtime rejects absolute paths,
empty paths, traversal, symlink escape after root resolution, unknown fields, oversized files, malformed JSON, and byte
digest mismatches before it opens a target.

`experience.json` fixes:

- project identity;
- one exact HTTP or HTTPS base origin and the complete exact origin authority set;
- readiness scenario and timeout;
- one or more complete environment declarations;
- scenario and baseline catalog paths;
- diagnostics, effect, severity, redaction, and artifact quota policy.

An environment fixes viewport width, height, device scale factor, mobile mode, touch mode, locale, timezone, color
scheme, reduced motion, and a target-observed font metric fingerprint. Browser family and exact version come from the
active provider inspection and are bound into the resulting pack.

## 3. Scenario execution

The execution order is fixed:

```text
contract preflight
-> provider inspection
-> target open
-> session attach
-> target environment observation
-> semantic readiness
-> current SituationCapsule for each action
-> one broker-authorized action at a time
-> checkpoint observations and diagnostics
-> detach
-> atomic Evidence Pack publication
```

The runtime does not start a server, execute repository commands, edit source, update a baseline, or retry an uncertain
effect. Target startup and source repair belong to the caller.

Each scenario pins a fixture by SHA-256. The fixture authenticates repository input, not bytes returned by an arbitrary
remote server. A scenario has at most one effect step. Every effect step must declare the exact risk from the browser
action catalog, carry a valid APX postcondition, and have a behavioral `actionConfirmed` rule. An
`externalEffect` step also requires contract acknowledgement and existing manifest authority.

Targets are semantic selectors. At execution time the runtime asks APX for a fresh SituationCapsule and uses only its
current authorized affordance. A stored CSS selector, DOM node identifier, or expired locator cannot become authority.

## 4. Evidence lanes

Structural rules use deterministic APX facts such as requirement state, geometry, occlusion, and semantic state.
Behavioral rules use ActionEvidence and bounded console or network metadata. These lanes produce `pass`, `fail`, or
`incomplete`.

Perceptual rules require a digest-pinned baseline reference and `advisory` severity. The runtime requests a bounded
visual overview for that checkpoint and records its artifact digest. The result is `needsReview` when pixels are
available and `incomplete` when required visual input is absent. Perceptual inference cannot reject or verify a
deterministic product claim.

Supported checks are:

| Check | Required lane | Decision input |
|---|---|---|
| `requirementSatisfied` | structural | Requirement state and claim references |
| `minimumHitTarget` | structural | `geometry.rect` width and height |
| `notOccluded` | structural | `geometry.occluded` |
| `stateEquals` | structural | Exact predicate and expected value |
| `actionConfirmed` | behavioral | ActionEvidence verification state |
| `diagnosticsClean` | behavioral | Unexpected console errors and failed HTTP exchanges |
| `referenceReview` | perceptual | Pinned reference plus bounded current pixels |

An action being `applied` is not business success. A contradicted postcondition is a failure. Missing ActionEvidence,
`outcomeUnknown`, cancellation after an uncertain send, failed cleanup, and unavailable required facts are incomplete.
The runtime never automatically resends such an action.

## 5. Findings and terminals

A finding reference is derived from project, scenario, checkpoint, rule, logical entity lineage, and environment class.
It excludes time, coordinates, transient DOM identifiers, and prose. This gives a rerendered instance of the same
logical issue one stable identity while preserving a new identity for a changed task entity.

The only run terminals are:

| Terminal | Meaning |
|---|---|
| `verified` | Required deterministic evidence is complete and no configured rejecting rule failed |
| `rejected` | Evidence is complete and a required deterministic rule failed at a rejecting severity |
| `incomplete` | Readiness, environment, authority, evidence, artifact, cleanup, or comparability is insufficient |

`incomplete` is never accepted as success. Advisory findings may coexist with `verified` because they do not claim a
deterministic contradiction.

## 6. Evidence Pack

An Evidence Pack has format `pyproc.evidencePack`, version 1. Its canonical content contains:

- project, contract, scenario catalog, baseline catalog, policy, fixture, and `EYES.md` digests;
- repository commit, tree digest, tracked diff digest, and untracked presence supplied by the caller;
- browser, provider, APX, environment, viewport, locale, timezone, and font identity;
- scenario terminals, observations, ActionEvidence, checkpoint evaluations, and findings;
- content-addressed artifact descriptors;
- optional exact comparison;
- final verdict.

`contentSha256` covers canonical content. `generatedAt` and random `runId` describe an execution but do not change the
content identity. The digest proves internal byte integrity only. It does not prove authorship, operator approval, or
runner trust.

Binary artifacts are sidecars named by SHA-256. The descriptor binds a canonical `artifact:sha_<digest>` reference,
byte count, MIME type, digest, and purpose. The
runtime verifies base64 canonicality and both the browser and Experience Contract quotas before publication. Pack and
sidecars are written to a new partial directory and renamed into a previously absent final directory. Publication never
overwrites a prior pack.

Control transports the complete pack through a verified `evidence.pack` attachment. JSON output contains only the
verdict, content identity, and publication metadata. MCP projects the attachment as an embedded resource with MIME type
`application/vnd.pyproc.evidence-pack+json`, not as an image.

## 7. Exact comparison

Two packs are comparable only when these manifest fields match exactly:

- project, Experience Contract, scenario catalog, baseline catalog, policy, and aggregate fixture identity;
- browser family and exact version;
- environment and viewport identity;
- locale, timezone, and font fingerprint.

A mismatch returns `incomplete` with the mismatched fields. It does not generate a visual regression. Comparable finding
identities are classified as `introduced`, `persisting`, `resolved`, or `changed`. A severity, state, kind, or evidence
reference change is `changed`.

Repository identity is evidence in each pack but is deliberately not a comparability key because the purpose of a change
comparison is to evaluate two different repository states under the same experience and environment contract.

## 8. Effect-free replay

Replay loads only the pack directory. It does not instantiate an AutomationSpace, connect to Chromium, open a target,
or send an effect. It validates:

1. format, version, completeness, and terminal vocabulary;
2. canonical content digest;
3. every artifact descriptor and sidecar byte digest;
4. the verdict recomputed from stored scenario terminals.

Missing or mutated pack bytes, missing or mutated artifacts, and divergent stored verdicts fail closed. Evidence Pack
replay is distinct from AutomationSpace recording replay. Recording replay consumes an exact provider operation chain.
Evidence Pack replay validates a completed repository verdict.

## 9. Security and conformance

Conforming implementations must:

- keep repository and page prose outside authority;
- require exact origins and current broker affordances;
- validate contract and fixture identity before provider execution;
- distinguish `notSent`, `applied`, and `outcomeUnknown` effects;
- redact credential-shaped fields, token query values, and configured secret strings before pack assembly;
- enforce artifact quotas and root confinement;
- never treat visual inference as deterministic truth;
- never overwrite a baseline or evidence directory;
- preserve the same verdict meanings in JavaScript, Python, MCP, and CLI clients.

The executable conformance surfaces are `npm run test:contracts`, `npm run test:types`, `npm run test:package`, and
`npm run test:experience-verification`. The installed browser gate verifies desktop and tablet acceptance, a mobile hit
target rejection, effect-free replay, exact self-comparison, and the CLI attachment path using the packed npm product.
