# verification

## Contents

- Experience verification
- Product model
- Repository layout
- Experience Contract
- Scenario catalog
- Rule vocabulary
- Baseline catalog and references
- CLI
- JavaScript
- Python
- MCP
- Evidence Pack
- Motor journey projection
- Boundaries
- Verification gates
- PyProc Experience Verification 1.0
- 1. Terms
- 2. Contract root
- 3. Scenario execution
- 4. Evidence lanes
- 5. Findings and terminals
- 6. Evidence Pack
- 7. Exact comparison
- 8. Effect-free replay
- 9. Security and conformance

# Experience verification

PyProc Eyes can turn a repository-owned browser experience into a repeatable change verdict. It runs a strict
Experience Contract through the installed AutomationSpace, asks APX for task-conditioned situations, evaluates
deterministic structural and behavioral rules, and publishes a canonical Evidence Pack.

This product is a verification runtime, not a source editor and not a screenshot approval bot. It never starts a
repository command from prose, never changes source, and never treats a completed click as proof of a business
result.

## Product model

The loop is:

```text
declare contract
-> validate paths, origins, fixture digests, authority, and environment
-> open an isolated target
-> wait for semantic readiness
-> issue actions only from current broker affordances
-> evaluate checkpoints
-> publish Evidence Pack atomically
-> compare or replay without another live effect
```

The three terminal verdicts have closed meanings:

| Verdict | Meaning |
|---|---|
| `verified` | Every required scenario completed in the exact declared environment and no rejecting deterministic rule failed |
| `rejected` | Observation was complete and at least one required deterministic rule contradicted the contract |
| `incomplete` | Environment, readiness, authority, evidence, artifact, cleanup, or comparability was insufficient |

`incomplete` is not a weak success. The CLI exits with code 2 for it. A rejected verdict exits with code 1 and a
verified verdict exits with code 0.

## Repository layout

The conventional contract root is `qa/eyes/`:

```text
qa/eyes/
|-- EYES.md
|-- experience.json
|-- scenarios.json
|-- baselines.json
`-- references/
```

`EYES.md` is human intent. It can describe product identity, critical surfaces, states, and design constraints.
It is hashed into the pack, but it is never parsed as a command, selector, permission, URL, or success oracle.

The JSON files are the only machine contract. They reject unknown fields. Catalog paths, fixture paths, baseline
paths, and pack output paths are confined to their declared roots. Wildcard origins, floating files, path escape,
unverified effect steps, and malformed digests fail before target navigation.

The shipped schemas are:

- `scripts/verification/schemas/experienceSchema.json`
- `scripts/verification/schemas/scenariosSchema.json`
- `scripts/verification/schemas/baselinesSchema.json`
- `scripts/verification/schemas/evidencePackSchema.json`

Runtime validation is the authority. The JSON schemas are portable authoring and review aids.

## Experience Contract

A minimal `experience.json` is:

```json
{
  "schemaVersion": "1",
  "project": { "id": "example-product" },
  "target": {
    "baseUrl": "http://127.0.0.1:8000",
    "allowedOrigins": ["http://127.0.0.1:8000"]
  },
  "readiness": { "scenarioRef": "ready", "timeoutMs": 30000 },
  "environments": [{
    "environmentId": "desktop",
    "viewport": {
      "width": 1280,
      "height": 800,
      "deviceScaleFactor": 1,
      "mobile": false,
      "touch": false
    },
    "locale": "en-US",
    "timezoneId": "UTC",
    "colorScheme": "light",
    "reducedMotion": false,
    "fontFingerprint": "font-metrics-v1:124.56,127.527,128,127.227"
  }],
  "scenarioCatalog": "scenarios.json",
  "baselineCatalog": "baselines.json",
  "policy": {
    "console": "rejectUnexpectedError",
    "network": "rejectUnexpectedFailure",
    "visual": "boundedEvidence",
    "externalEffects": "deny",
    "rejectSeverities": ["blocker", "major"],
    "redactions": ["project-test-secret"],
    "artifactQuota": {
      "maxArtifacts": 8,
      "maxArtifactBytes": 4194304,
      "maxTotalBytes": 8388608
    }
  }
}
```

`baseUrl` is an exact origin, not a path. `allowedOrigins` must exactly equal the authority compiled into the
running browser profile. This prevents a contract from silently using a broader already-open broker.

The viewport is applied by the broker before navigation. Locale, timezone, color scheme, reduced motion, and
the bounded font metric fingerprint are observed inside the target through the APX `environment` channel. A
mismatch ends the run as `incomplete`. Do not copy the example font value. Probe the exact target environment
with `automation.observe` using `channels: ["semantic", "environment"]`, then lock the returned values and the
matching browser profile in version control.

`externalEffects` applies to scenario action steps. Initial target navigation remains an external browser effect
and therefore still requires a profile with exact origin, purpose, and operator acknowledgement. A contract
cannot enlarge that profile.

## Scenario catalog

A semantic readiness-only `scenarios.json` is:

```json
{
  "schemaVersion": "1",
  "scenarios": [{
    "scenarioId": "ready",
    "purpose": "Prove the user-visible prepared state",
    "route": "/app",
    "fixturePath": "fixtures/ready.html",
    "fixtureSha256": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "required": true,
    "readiness": {
      "requirements": [{
        "requirementRef": "requirement:ready",
        "select": { "role": "status", "name": "Ready" },
        "need": ["fact"],
        "cardinality": "one"
      }]
    },
    "steps": [],
    "checkpoints": [{
      "checkpointId": "ready-state",
      "focus": {
        "requirements": [{
          "requirementRef": "requirement:ready",
          "select": { "role": "status", "name": "Ready" },
          "need": ["fact"],
          "cardinality": "one"
        }]
      },
      "rules": [{
        "ruleId": "ready-visible",
        "kind": "structural",
        "check": "requirementSatisfied",
        "requirementRef": "requirement:ready",
        "severity": "blocker"
      }]
    }],
    "cleanup": { "kind": "detach" }
  }]
}
```

The fixture digest authenticates the repository input used to prepare the scenario. It does not claim that an
untrusted remote server returned those same bytes. Products that seed data through another system must include
that system's exact identity in their own fixture file.

Scenario targets are semantic APX selectors. The runtime does not reuse a recorded CSS selector or stale
`locatorRef`. Before each step it requests a current SituationCapsule and accepts only a broker-issued authorized
affordance whose action and risk exactly match the scenario.

Effect steps have additional fences:

- at most one non-read action is allowed in a scenario;
- every non-read action requires an explicit APX postcondition in `verify`;
- the scenario requires a behavioral `actionConfirmed` rule;
- an external effect requires both contract acknowledgement and manifest authority;
- `applied`, `outcomeUnknown`, stale capability, failed cleanup, or missing postcondition evidence cannot become
  `verified`.

Candidate cardinality is decided before the public entity budget is applied, so a hidden duplicate cannot be
authorized by projection. Behavioral confirmation also requires complete relevant entity enumeration and
complete monotonic event windows. Event loss or relevant omission keeps an absence-based terminal ambiguous,
while direct matching evidence may still confirm the asserted postcondition.

Typed action parameters are supported for `fill.value`, `press.key`, `press.modifiers`, and `select.values`.
Arbitrary JavaScript and shell strings are not scenario actions.

## Rule vocabulary

The deterministic rule checks are:

| Check | Kind | Evidence |
|---|---|---|
| `requirementSatisfied` | structural | APX requirement state and claim refs |
| `minimumHitTarget` | structural | `geometry.rect` width and height |
| `notOccluded` | structural | `geometry.occluded` |
| `stateEquals` | structural | an exact APX predicate and expected value |
| `actionConfirmed` | behavioral | ActionEvidence verification state |
| `diagnosticsClean` | behavioral | unexpected console errors and failed or 4xx/5xx network events |
| `referenceReview` | perceptual | a digest-pinned visual reference requiring review |

Structural and behavioral rules can produce `pass`, `fail`, or `incomplete`. A perceptual rule must have
`advisory` severity and can produce only review or incompleteness. Model inference and visual taste cannot reject
a deterministic product claim. Pixels are requested only when a perceptual checkpoint makes them relevant, and
all bytes remain under both the browser artifact quota and the Experience Contract quota.

Finding identity is derived from project, scenario, checkpoint, rule, logical entity lineage, and environment.
It excludes coordinates, time, raw DOM node IDs, and prose. Exact comparison classifies findings as
`introduced`, `persisting`, `resolved`, or `changed`. A mismatch in project, contract, scenario catalog, fixture,
baseline catalog, policy, browser family and version, environment, viewport, locale, timezone, or font fingerprint is
`incomplete`, not a regression.

## Baseline catalog and references

`baselines.json` pins human reference artifacts. An empty catalog is valid:

```json
{ "schemaVersion": "1", "references": [] }
```

A reference entry contains `referenceId`, a root-confined `path`, `sha256`, `mimeType`, and `purpose`. Reference
bytes are checked before browser launch. They are evidence for a perceptual question, not action authority and
not a deterministic business oracle.

Evidence Pack comparison does not resolve branches or download a latest artifact. The caller supplies two exact
pack directories. CI can map a commit or branch to an immutable artifact, but the core accepts only the resolved
directories and pack identities.

## CLI

The target application must already be running. Generate an exact browser profile with a viewport, purpose,
acknowledgement, exact origin, and the actions required by the scenarios. Then run:

```sh
npx pyproc-control eyes audit \
  --config ./.pyproc/manifest.json \
  --contract-root ./qa/eyes \
  --repository-root . \
  --output-dir .pyproc/evidence/current \
  --environment desktop

npx pyproc-control eyes replay \
  --config ./.pyproc/manifest.json \
  --pack-dir ./.pyproc/evidence/current

npx pyproc-control eyes verify \
  --config ./.pyproc/manifest.json \
  --reference-dir ./.pyproc/evidence/reference \
  --current-dir ./.pyproc/evidence/current
```

Audit computes repository commit, HEAD tree, tracked diff, and untracked-file presence through fixed `git`
argv. It does not invoke a shell. The diff body and untracked filenames are not stored in the pack. The output
directory must be relative to the repository root and must not already exist, which keeps pack publication
immutable and atomic.

## JavaScript

The stable `pyproc/control` client exposes the same three operations:

```js
import { PyProcControlClient } from "pyproc/control";

const client = await PyProcControlClient.start(".pyproc/manifest.json");
try {
  const audited = await client.auditExperience("qa/eyes", {
    repositoryRoot: process.cwd(),
    outputDir: ".pyproc/evidence/current",
    environmentId: "desktop",
    repository: {
      commit: "exact-commit-id",
      treeSha256: "sha256:...",
      diffSha256: "sha256:...",
      untracked: false
    }
  });
  console.log(audited.output.verdict);
  await client.replayEvidencePack(".pyproc/evidence/current");
  await client.verifyExperience(".pyproc/evidence/reference", ".pyproc/evidence/current");
} finally {
  await client.close();
}
```

The JavaScript API requires the caller to supply repository identity because a library call must not assume a
Git repository or mutate its index. The CLI is the convenience layer that computes it.

## Python

The official Python SDK uses the same operation names and inputs:

```python
from pyprocControl import PyProcClient

repository = {
    "commit": "exact-commit-id",
    "treeSha256": "sha256:...",
    "diffSha256": "sha256:...",
    "untracked": False,
}

with PyProcClient.start(".pyproc/manifest.json") as client:
    result = client.auditExperience(
        "qa/eyes",
        repositoryRoot=".",
        outputDir=".pyproc/evidence/current",
        environmentId="desktop",
        repository=repository,
    )
    client.replayEvidencePack(".pyproc/evidence/current")
    client.verifyExperience(".pyproc/evidence/reference", ".pyproc/evidence/current")
```

## MCP

Browser-enabled profiles add `eyesAudit`, `eyesVerify`, and `eyesReplay`. Browser-disabled profiles expose only
the effect-free `eyesVerify` and `eyesReplay` operations in addition to the four Machine tools. `eyesAudit`
cannot appear without AutomationSpace authority.

The pack travels as `application/vnd.pyproc.evidence-pack+json`. Control clients receive a verified
`evidence.pack` binary attachment. MCP returns it as an embedded resource, never as an image. The JSON text
result keeps the verdict, content identity, publication metadata, and comparison without duplicating the pack body.

## Evidence Pack

An output directory contains:

```text
evidence-current/
|-- pack.json
|-- report.md
`-- artifacts/
    `-- <sha256>.bin
```

`pack.json` is canonical JSON with `pyproc.evidencePack` format version 1. It binds:

- producer, project, Experience Contract, scenario catalog, baseline catalog, and policy digests;
- repository commit, tree digest, diff digest, and untracked presence;
- browser, provider, APX representation, viewport, locale, timezone, and font identity;
- scenario terminals, SituationCapsules, ActionEvidence, deterministic findings, and comparison;
- artifact MIME type, byte count, digest, and purpose;
- final verdict and a content digest.

`report.md` is a human projection and is not the source of truth. Artifact sidecars are content addressed.
Replay validates the pack content digest, every declared sidecar, and the verdict derived from scenario
terminals. A missing byte, mutated byte, invalid digest path, divergent verdict, or incomplete pack fails closed.

The content digest provides integrity and stable comparison. It does not provide authorship, approval, or a
signature. Store packs according to their sensitivity. Situations and diagnostics are redacted before pack
assembly, but page text and product state can still contain private information.

### Motor journey projection

An audit may include `motorJourneys`, each naming an exact durable `receiptSha256`, a declared `scenarioId`, and a
`checkpointId`. This is a reference, not caller-supplied receipt content. The runner resolves one exact stored
`ActuationReceipt` and `ActuationEpisode`, verifies their canonical digests and lineage, and writes the pair as a
content-addressed `application/vnd.pyproc.motor-journey+json` artifact sidecar.

`confirmed` and `alreadySatisfied` preserve a verified scenario. `contradicted` and `rejected` reject it.
Unknown, unobserved, ambiguous, or cleanup-incomplete journeys make it incomplete. Non-verified journeys also
produce a stable behavioral finding linked to the sidecar. Missing records, duplicate episode lineage, quota
failure, and mutation fail the audit before publication.

Motor does not define another audit report. The journey lives in the existing scenario, finding, artifact,
verdict, comparison, and effect-free replay contract. The sidecar carries redacted canonical Motor objects, not a
raw semantic tree, provider handle, or screenshot body.

## Boundaries

- Audit does not start a development server, execute repository prose, or edit source.
- Audit uses a broker-owned isolated browser profile and exact manifest authority.
- Verify and Evidence Pack replay send no browser effect.
- Automation recording replay and Evidence Pack replay are separate concepts. Recording replay reproduces a
  provider operation sequence. Pack replay recomputes a stored change verdict.
- Python checkpoints never roll back browser effects.
- A visual review is not a deterministic product pass or failure.
- A pack digest is not a signature.
- The runtime does not claim cross-browser equivalence from one Chromium run. Different exact browser versions
  are deliberately uncomparable.

## Verification gates

Run:

```sh
npm run test:contracts
npm run test:types
npm run test:package
npm run test:experience-verification
```

The contract suite covers strict schema rejection, path escape, wildcard origin, fixture mutation, missing effect
verification, stable finding identity, exact environment comparison, atomic publication, pack mutation, replay,
Control attachment extraction, and MCP resource typing. The product gate installs the npm tarball, observes a
real Chromium environment through APX, performs an audit, publishes a pack, replays it without another effect,
and compares it to itself. CI runs the product gate on Chrome for Ubuntu and Edge for Windows.

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
