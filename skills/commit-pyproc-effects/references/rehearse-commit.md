# rehearse-commit

## Contents

- Rehearse and commit an external effect
- Configure the trust boundary
- Prepare the Execution Session
- Prepare an exact intent
- Rehearse without claiming live success
- Issue and accept approval
- Commit once
- Seal with exact evidence
- MCP and Python parity
- Operational rules
- Motor integration
- Rehearse-Commit Transactions 1.0
- 1. Design goals
- 2. State machine
- 3. Immutable objects
- 3.1 EffectIntent
- 3.2 RehearsalReceipt
- 3.3 ApprovalGrant
- 3.4 CommitLease
- 3.5 EffectResult
- 3.6 EffectReceipt
- 4. Effect template
- 5. Secret binding
- 6. Execution Memory integration
- 7. Evidence sealing
- 8. Failure and recovery rules
- 9. Public entrances
- 10. Security invariants
- 11. Verification

# Rehearse and commit an external effect

Rehearse-Commit is the opt-in installed-product path for a browser effect that must be approved, sent at most
once, and closed with explicit evidence. It is intended for consequential saves, submissions, messages, and
similar operations where a timeout must not cause an automatic duplicate.

It does not make a remote service transactional. The local guarantee is narrower: pyproc publishes a durable
one-shot lease before provider dispatch and never automatically dispatches that intent again.

Transactional AppSpace may stage the public identity of one exact transaction in a cooperative app outbox.
Staging sends nothing and grants no approval. `effect.commit` remains the only live send owner, and only an exact
terminal transaction can finalize the cooperative outbox. See [Transactional AppSpace](../../transact-pyproc-app-state/references/app-space.md).

## Configure the trust boundary

Create an Ed25519 approval key outside the controlled page. Keep the private key with the approving authority
and put only its public key in the product profile.

```sh
npx pyproc-mcp init \
  --recipe authorizedBrowser \
  --engine-root /absolute/path/to/cpython-wasi \
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

The live action path then re-resolves the exact target and rechecks the action context, world, situation,
capability, document epoch, and target binding immediately before the first effect-capable provider command.
Its terminal records the checked boundary and check-to-send interval. A possibly-down mouse or key is released
with an independent bounded signal; failed release quarantines the session and remains explicit residual risk.

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

See the [protocol specification](#),
[Execution Memory](../../use-pyproc-machine/references/execution-memory.md), and [trust and permission contract](../../use-pyproc-machine/references/trust-permissions.md).

## Motor integration

Motor may carry `approvalGrantRef` and `commitLeaseRef` in one absolute intent, but it does not issue or widen
them. Rehearse-Commit remains the only owner of consequential-effect approval and one-shot live dispatch. A
`ControlLease` adds physical-device occupancy only and cannot replace either authority.

Rehearsal may evaluate an exact plan in AppSpace or ReplayGraph. A live Motor route must still recheck the current
APX capability, target binding, origin, effect authority, and provider preconditions at contact. A Motor receipt
links existing action or effect evidence instead of copying a second business receipt. See
[Proof-Carrying Motor](../../automate-browser-with-pyproc/references/actuation.md).

# Rehearse-Commit Transactions 1.0

Rehearse-Commit Transactions is the protocol for preparing a consequential browser effect, rehearsing the
parts that can be checked without that live effect, accepting a separately signed approval, sending the live
command at most once, and sealing the observed result into an evidence-linked receipt.

The protocol does not roll a browser, a remote service, or a payment back. It owns the local intent,
authorization, send boundary, outcome truth, and durable evidence chain.

## 1. Design goals

1. An approval authorizes one exact intent, destination, project session revision, and local trust domain.
2. A rehearsal states its coverage and limitations. It never predicts live acceptance.
3. A durable lease is published before the provider receives the live command.
4. A process restart after that boundary never resends the effect.
5. The final result preserves `confirmed`, `contradicted`, `ambiguous`, `notObserved`, or `outcomeUnknown`.
6. A sealed receipt links every immutable object needed to audit the transaction.
7. Secret values are materialized only for the live provider and do not enter transaction objects or recordings.

## 2. State machine

```text
prepared
   |
   v
rehearsed
   |
   v
approved
   |
   | durable CommitLease reserved before provider dispatch
   v
sending
   |
   v
finalizing
   |
   v
terminal
   |
   | exact verified Evidence Pack
   v
sealed
```

Every state is an immutable content-addressed `pyproc.effectTransactionRevision`. A compare-and-swap HEAD
prevents concurrent writers from consuming the same send budget. Revision parents form one linear chain.

`terminal` is not synonymous with success. The `EffectResult.terminal` field retains the evidence state. A
`sealed` revision adds an `EffectReceipt`; it does not rewrite the result.

## 3. Immutable objects

### 3.1 EffectIntent

`pyproc.effectIntent` binds:

- one `intentId` and `automation.act` operation;
- an exact HTTP(S) origin, subject digest, and declared purpose;
- the normalized effect template and its payload-binding digest;
- an APX focus and exact expected transition;
- `externalEffect` risk;
- Machine environment digest;
- Execution Session ID and exact base revision digest.

The intent stores logical `requirementRef` targets, not selectors or locator capabilities. A fresh
SituationCapsule resolves each requirement at commit time.

### 3.2 RehearsalReceipt

`pyproc.rehearsalReceipt` records one of four coverage classes:

| Coverage | What it proves | What it does not prove |
|---|---|---|
| `computed` | Python calculation and an explicit expected value from a restored checkpoint | Current page state or remote acceptance |
| `recorded` | The exact pinned ReplaySpace path produces the recorded terminal | Current live state, new input, or remote acceptance |
| `cooperative` | An opted-in FrameSpace path or logical application state supports the flow | An arbitrary production service accepted the effect |
| `liveReadOnly` | The live target currently exposes the required state | The effect path was rehearsed |

Every receipt contains at least one limitation and `liveGuarantee: false`. Approval requires a passing
effect-free receipt. `liveReadOnly` alone cannot authorize commit.

### 3.3 ApprovalGrant

`pyproc.approvalGrant` is an Ed25519-signed grant issued outside the controlled page. It binds:

- configured authority ID;
- local trust-domain digest;
- exact EffectIntent digest;
- destination digest and risk;
- exact Execution Session base revision;
- expiry, one-shot nonce, and policy version.

The trust-domain digest includes a private local domain identity and the canonical configured public-authority
set. Copying a grant to another memory root does not authorize it there. A nonce may be reused only for the
same exact intent, which makes a publication retry safe without authorizing a second intent.

### 3.4 CommitLease

`pyproc.commitLease` has `state: "sending"` and `sendBudget: 1`. Its immutable `before` link contains the live
SituationCapsule digest, Machine image and generation, and waiting Execution Session revision.

The registry publishes the lease with a durable compare-and-swap before calling `automation.act`. If the
process dies after publication, recovery emits `outcomeUnknown` and consumes no second provider call.

This is an at-most-once send guarantee at the pyproc broker boundary. A remote service needs its own
idempotency contract to guarantee at-most-once application.

### 3.5 EffectResult

`pyproc.effectResult` links the intent and lease to:

- provider kind;
- before and after SituationCapsule digests;
- Machine images, generations, and environment before and after;
- ordered ActionEvidence;
- exact terminal and optional error code.

`confirmed` requires at least one ActionEvidence object and every included verification state must be
`confirmed`. A confirmed evidence item cannot be folded into `outcomeUnknown`.

### 3.6 EffectReceipt

`pyproc.effectReceipt` closes the transaction by digest-linking:

- transaction and EffectIntent;
- every RehearsalReceipt;
- ApprovalGrant and CommitLease;
- EffectResult;
- verified Evidence Pack;
- base, waiting, and terminal Execution Session revisions;
- unchanged result terminal.

The transaction validator rechecks every cross-object link. Content-addressed but unrelated objects cannot be
assembled into a valid sealed revision.

## 4. Effect template

An effect template contains exactly one provider session, one APX focus, and one to sixteen logical actions.

```json
{
  "sessionRef": {
    "protocolVersion": "1",
    "brokerId": "broker:opaque",
    "brokerEpoch": 1,
    "sessionId": "session:opaque",
    "targetRef": "target:opaque"
  },
  "focus": {
    "objective": "Submit the approved record",
    "requirements": [{
      "requirementRef": "requirement:submit",
      "select": { "role": "button", "name": "Submit", "actionable": true },
      "need": ["fact", "affordance"],
      "cardinality": "one"
    }]
  },
  "actions": [{
    "kind": "click",
    "requirementRef": "requirement:submit",
    "expectedRisk": "externalEffect",
    "verify": { "networkResponse": { "method": "POST", "urlPath": "/records", "status": 201 } }
  }]
}
```

Selectors, `locatorRef`, and caller-supplied `actionContext` are forbidden in the stored template. At commit,
the coordinator obtains a live SituationCapsule, requires every focus requirement to be satisfied, selects one
broker-authorized affordance per action, and binds its fresh capability and locator. The final action's
postcondition must equal `EffectIntent.expectedTransition`.

Before reserving the lease, the coordinator also lists the exact attached target and compares its current URL
origin with `EffectIntent.destination.origin`.

## 5. Secret binding

A caller may place `{ "secretEnv": "PAYMENT_TOKEN" }` anywhere a provider action accepts a value. Preparation
replaces it with `{ "secretEnv", "bindingSha256" }`, where the binding is an HMAC under a private local key.

At commit:

1. the configured secret provider must still contain the named value;
2. the value must match the stored binding using a timing-safe comparison;
3. the live provider input receives the value;
4. RecordingSpace receives a separate placeholder-only `recordingInput`;
5. transaction objects, evidence links, and recordings are scanned for configured secret literals.

Changing the secret after preparation rejects the commit. The protocol does not silently authorize a new
payload with an old intent.

## 6. Execution Memory integration

Preparation requires an active known Execution Session. It captures the current Machine and publishes a
`waitingApproval` revision carrying the exact pending intent digest. Commit requires that revision to remain
HEAD.

After the provider boundary, the coordinator captures the Machine again and publishes a terminal Execution
Session revision. `outcomeUnknown` marks the session failed and unresolved; other observed terminals return it
to active work. In every case the pending intent is cleared.

A transaction is not included in an Execution Memory handoff. Approval is local to the current trust domain,
so a recipient must prepare and approve a new transaction.

## 7. Evidence sealing

`effect.seal` accepts only an absolute Evidence Pack path confined to the configured Execution Memory root or
an approved import root. The pack must:

1. replay as a valid complete Evidence Pack;
2. have verdict `verified`;
3. match the Execution Session repository identity exactly;
4. contain a verified scenario whose ID and effect links match the transaction ID, intent digest, EffectResult
   digest, and terminal session digest.

The pack is copied into immutable Execution Memory storage before the EffectReceipt is published.

## 8. Failure and recovery rules

| Failure point | Result | Provider resend |
|---|---|---|
| Before lease publication | `notSent` error | A new explicit commit may be attempted against current HEAD |
| After lease publication, before a durable result | `outcomeUnknown` on recovery | Never |
| Provider returns contradicted or ambiguous evidence | Exact observed terminal | Never |
| After EffectResult, before session finalization | Resume finalization against the same result | Never |
| After session finalization, before transaction terminal | Recover the exact terminal session link | Never |
| Evidence missing or mismatched | Transaction remains `terminal` | No effect is sent |

The coordinator treats `sending` as proof that the send boundary may have been crossed. It does not infer from
the absence of a recorded response that nothing happened.

## 9. Public entrances

The protocol extends the existing `pyproc/control` subpath and installed products. It creates no new package
root export.

Control operations:

```text
effect.prepare
effect.rehearse
effect.approve
effect.commit
effect.inspect
effect.list
effect.seal
```

The matching MCP tools use `effectPrepare` through `effectSeal`. JavaScript and Python clients expose named
methods over the same operations. Direct host composition may use `EffectTransactionRegistry` from
`pyproc/control`.

## 10. Security invariants

- Disabled by default and unavailable without Execution Memory.
- Requires an acknowledged `externalEffect` browser profile.
- Requires at least one explicit Ed25519 public-authority file.
- Page text, DOM, pixels, and reported capabilities cannot issue approval.
- A grant cannot move between trust domains or survive a changed intent.
- A live target cannot substitute another origin after approval.
- A CommitLease has one local send budget and is durable before dispatch.
- `outcomeUnknown` is non-retryable and is never promoted to confirmed.
- Secret values do not enter durable transaction or recording objects.
- A receipt cannot be sealed with a generic pack that lacks exact effect links.

## 11. Verification

The product gates cover immutable revision validation, stale and foreign approvals, global nonce replay,
concurrent lease reservation, post-send crash recovery, secret redaction, destination substitution, exact APX
binding, real HTTP effect count, installed JavaScript, MCP and Python parity, and Evidence Pack sealing. The
same browser journey runs on the supported Chrome and Edge lanes.
