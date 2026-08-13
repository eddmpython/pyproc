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
