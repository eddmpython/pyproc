# Rehearse and commit an external effect

Rehearse-Commit is the opt-in installed-product path for a browser effect that must be approved, sent at most
once, and closed with explicit evidence. It is intended for consequential saves, submissions, messages, and
similar operations where a timeout must not cause an automatic duplicate.

It does not make a remote service transactional. The local guarantee is narrower: pyproc publishes a durable
one-shot lease before provider dispatch and never automatically dispatches that intent again.

Transactional AppSpace may stage the public identity of one exact transaction in a cooperative app outbox.
Staging sends nothing and grants no approval. `effect.commit` remains the only live send owner, and only an exact
terminal transaction can finalize the cooperative outbox. See [Transactional AppSpace](appSpace.md).

## Configure the trust boundary

Create an Ed25519 approval key outside the controlled page. Keep the private key with the approving authority
and put only its public key in the product profile.

```sh
npx pyproc-mcp init \
  --recipe authorizedBrowser \
  --engine-root /absolute/path/to/pyodide \
  --origin https://work.example.test \
  --action snapshot --action click \
  --max-risk externalEffect \
  --purpose "submit approved records" \
  --acknowledge-effects \
  --execution-memory-root /absolute/private/pyproc-memory \
  --enable-effect-transactions \
  --effect-approval-authority operator:records=/absolute/keys/records-public.pem
```

Each `--effect-approval-authority` value is `<authority-id>=<absolute-or-project-relative-public-key-file>`.
The initializer resolves it to an exact real file. The feature requires both Execution Memory and an
acknowledged `externalEffect` browser profile.

For bounded secret values, declare their environment names in the Execution Memory profile:

```sh
--execution-memory-secret-env RECORD_TOKEN
```

The process environment must contain `RECORD_TOKEN` when the profile is validated and when commit runs. The
value is never written to the normalized manifest.

Run the effect-free check before starting a client:

```sh
npx pyproc-control --config .pyproc/manifest.json --check
```

The report contains `effectTransactions.enabled` and the configured public authority identities. It never
contains a private key or secret value.

## Prepare the Execution Session

Every effect starts from an exact Execution Memory revision:

```js
import { PyProcControlClient } from "pyproc/control";

const client = await PyProcControlClient.start(".pyproc/manifest.json");
const project = {
  workspaceId: "workspace:records",
  commit: "exact-commit",
  treeSha256: "sha256:...",
  diffSha256: "sha256:...",
  untracked: false,
};
const session = await client.createExecutionSession("session:records", project);
```

The session must be active, have no unresolved outcome, and remain at that exact HEAD through preparation.

## Prepare an exact intent

Open and attach the approved origin, then describe logical APX requirements instead of storing selectors:

```js
const opened = await client.openTarget("https://work.example.test/records/42", {
  expectedRisk: "externalEffect",
  waitUntil: "load",
});
const attached = await client.attachSession(opened.output.targetRef);

const transition = {
  all: [
    { entityAppeared: { role: "status", nameContains: "submitted" } },
    { networkResponse: { method: "POST", urlPath: "/records/42", status: 201 } },
  ],
  withinMs: 5000,
};

const prepared = await client.prepareEffectTransaction({
  transactionId: "effect:record-42",
  intentId: "intent:record-42",
  executionSessionId: "session:records",
  expectedSessionRevisionSha256: session.output.contentSha256,
  destination: {
    origin: "https://work.example.test",
    subjectSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    purpose: "Submit approved record 42",
  },
  effectTemplate: {
    sessionRef: attached.output,
    focus: {
      objective: "Submit record 42",
      requirements: [{
        requirementRef: "requirement:submit",
        select: { role: "button", name: "Submit", actionable: true },
        need: ["fact", "affordance"],
        cardinality: "one",
      }],
    },
    actions: [{
      kind: "click",
      requirementRef: "requirement:submit",
      expectedRisk: "externalEffect",
      verify: transition,
    }],
  },
  expectedTransition: transition,
});
```

Preparation moves the Execution Session to `waitingApproval` and returns the local trust-domain digest. A page
cannot supply or modify that digest.

For a secret fill, use a placeholder:

```js
{
  kind: "fill",
  requirementRef: "requirement:token",
  value: { secretEnv: "RECORD_TOKEN" },
  expectedRisk: "externalEffect",
  verify: { entityAppeared: { role: "status", nameContains: "accepted" } }
}
```

## Rehearse without claiming live success

A computed rehearsal checkpoints the Python Machine, runs the check, and restores the checkpoint in a
`finally` boundary:

```js
const rehearsed = await client.rehearseEffectTransaction(
  "effect:record-42",
  prepared.output.transaction.contentSha256,
  { mode: "computed", code: "validatePreparedRecord()", expectedValue: "True" },
);
```

Use `{ mode: "provider" }` to inspect or exercise the configured AutomationSpace. Native CDP produces only
`liveReadOnly` coverage and cannot satisfy the effect-free approval prerequisite by itself. ReplaySpace and an
explicitly capable cooperative provider can produce effect-free path coverage.

Inspect `rehearsed.output.rehearsals.at(-1).limitations` and present it with the approval request.

## Issue and accept approval

The approving authority signs the exact returned intent. Node.js authorities can use the helper from the
existing Control subpath:

```js
import { createApprovalGrant } from "pyproc/control";

const grant = createApprovalGrant({
  intent: rehearsed.output.intent,
  authorityId: "operator:records",
  trustDomainSha256: prepared.output.trustDomain.trustDomainSha256,
  expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  nonce: "approval:record-42:revision-7",
  policyVersion: "records/7",
}, approvalPrivateKey);

const approved = await client.approveEffectTransaction(
  "effect:record-42",
  rehearsed.output.contentSha256,
  grant,
);
```

Do not put the private key in the page, Machine image, manifest, or effect template. The grant expires within
24 hours and becomes stale if the destination, payload binding, risk, project session revision, or trust
domain changes.

## Commit once

```js
const terminal = await client.commitEffectTransaction(
  "effect:record-42",
  approved.output.contentSha256,
);

console.log(terminal.output.effectResult.terminal);
```

Commit performs these checks before dispatch:

1. transaction and Execution Session HEADs still match;
2. approval remains valid and unexpired;
3. the attached live target still has the approved origin;
4. the fresh SituationCapsule satisfies every requirement;
5. every logical action resolves to exactly one broker-authorized affordance;
6. bound secrets still match their preparation-time HMAC;
7. the durable one-shot lease is published.

Calling commit again on the returned `terminal` or `sealed` digest returns the same transaction without another
provider call. If recovery finds `sending`, it records `outcomeUnknown`, finalizes the Execution Session, and
does not resend.

## Seal with exact evidence

Create a verified Evidence Pack under the configured memory or import root. Its repository identity must equal
the Execution Session project. One verified scenario must include:

```json
{
  "scenarioId": "effect:record-42",
  "required": true,
  "terminal": "verified",
  "effectTransaction": {
    "transactionId": "effect:record-42",
    "intentSha256": "...",
    "effectResultSha256": "...",
    "sessionTerminalSha256": "..."
  }
}
```

Then seal:

```js
const sealed = await client.sealEffectTransaction(
  "effect:record-42",
  terminal.output.contentSha256,
  "/absolute/private/pyproc-memory/packs/record-42",
);

console.log(sealed.output.receipt.contentSha256);
```

`effectInspect` reports the next safe lifecycle action. `effectList` returns durable transaction HEADs without
opening an effect.

## MCP and Python parity

MCP exposes `effectPrepare`, `effectRehearse`, `effectApprove`, `effectCommit`, `effectInspect`, `effectList`,
and `effectSeal`. Their arguments and returned objects match the Control operations.

The Python SDK methods use the same names as the JavaScript methods:

```python
prepared = client.prepareEffectTransaction(intentInput)
rehearsed = client.rehearseEffectTransaction(
    "effect:record-42",
    prepared.output["transaction"]["contentSha256"],
    {"mode": "computed", "code": "6 * 7", "expectedValue": "42"},
)
approved = client.approveEffectTransaction(
    "effect:record-42", rehearsed.output["contentSha256"], signedGrant)
terminal = client.commitEffectTransaction(
    "effect:record-42", approved.output["contentSha256"])
```

The approving service may be written in any language as long as it emits the canonical signed grant. The
controlled page is never the approving service.

## Operational rules

- Never treat rehearsal success as live success.
- Never retry `outcomeUnknown` automatically.
- Investigate the remote system before preparing a replacement intent after an unknown result.
- Keep public approval keys explicit and private keys outside the controlled process.
- Use remote idempotency keys when the service provides them, but do not confuse them with the local lease.
- Preserve the terminal transaction and sealed receipt for audit and incident recovery.

See the [protocol specification](../specs/rehearseCommit/README.md),
[Execution Memory](executionMemory.md), and [trust and permission contract](trustPermissions.md).
