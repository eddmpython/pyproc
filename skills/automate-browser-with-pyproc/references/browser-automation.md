# browser-automation

## Contents

- Browser automation product
- Install and start
- Manifest contract
- Process and permission boundary
- PyProc Eyes and APX
- Ordered actions and screenshots
- Artifact lifecycle
- Locators, lifecycle, and privacy
- Checkpoints and outcomes
- Minimal tool flow
- Troubleshooting
- Verification

# Browser automation product

The installed `pyproc-mcp` command runs a persistent Python Machine and a separately authorized Chromium
automation profile in one stdio MCP session. It ships in the npm package, uses no runtime dependency, never
attaches to a normal browser profile, and never puts the CDP endpoint inside Python.

The same host is available through `pyproc-control` and the Python SDK. `browser.provider` selects a provider
behind the [AutomationSpace contract](./automation-space.md). The default `NativeCdpSpace` declares DOM,
network, target, storage, runtime, screenshot, artifact, perception, and action-convergence capabilities while keeping endpoint and provider
objects private. The cooperative [FrameSpace provider](./frame-space.md) uses a credentialless sandbox and no
DevTools port.

## Install and start

Install the exact package and point `engine.root` at the installed owned engine directory. It must contain
`python.wasm`, `python314-stdlib.zip`, and `engine-build-manifest.json`.

```sh
npm install pyproc@0.0.23 --save-exact
npm install pyproc@<exact-version>
```

Compile the common authorized profile without hand-editing JSON:

```sh
npx pyproc-mcp init \
  --recipe authorizedBrowser \
  --origin https://example.test \
  --action snapshot --action screenshot --action waitFor \
  --action hydrateLazy --action navigate --action fill --action click \
  --max-risk externalEffect \
  --purpose "authorized regression testing" \
  --acknowledge-effects
npx pyproc-control doctor --config ./.pyproc/manifest.json
```

The initializer expands to the strict manifest below. The `.pyproc/manifest.json` JSON form remains available
for advanced embedding and must pass the same validator:

```json
{
  "schemaVersion": 1,
  "engine": { "root": "/absolute/path/to/cpython-wasi" },
  "timeoutMs": 180000,
  "browser": {
    "enabled": true,
    "provider": "nativeCdp",
    "allowedOrigins": ["https://example.test"],
    "maxRisk": "externalEffect",
    "actions": ["snapshot", "screenshot", "waitFor", "hydrateLazy", "navigate", "fill", "click"],
    "methods": [],
    "viewport": {
      "width": 390,
      "height": 844,
      "deviceScaleFactor": 3,
      "mobile": true,
      "touch": true
    },
    "externalEffects": "acknowledged",
    "purpose": "authorized regression testing",
    "artifacts": {
      "maxArtifactBytes": 16777216,
      "maxTotalBytes": 67108864,
      "maxArtifacts": 64,
      "inlineMaxBytes": 2097152,
      "ttlMs": 900000
    }
  }
}
```

Validate compatibility without starting Chromium, then register the same command and arguments with an MCP client:

```sh
npx pyproc-mcp --config ./.pyproc/manifest.json --check
npx pyproc-mcp --config ./.pyproc/manifest.json
```

`pyproc-control doctor` is the stronger first-use preflight: it also verifies every local engine digest and
returns blocking facts, advisories, and next commands. See [Machine Entrance](../../use-pyproc-machine/references/machine-entrance.md).

`engine.indexURL` can replace `engine.root` when an immutable HTTP(S) engine directory is already hosted.
The local root is the recommended deployment because the command serves it on the machine page's isolated
loopback origin and boot needs no third-party request.

To run only the Python Machine, set `browser` to `{ "enabled": false }`. The surface then remains exactly
`pythonRun`, `checkpointSave`, `checkpointRestore`, and `sandboxReset` with no debugging authority.

## Manifest contract

The manifest is validated before browser launch. Unknown keys, a schema version other than `1`, relative or
missing engine paths, malformed origins, unknown actions or methods, missing upload roots, invalid limits,
and incomplete external-effect approval fail closed.

| Field | Contract |
|---|---|
| `engine.root` | Existing absolute owned engine directory with the three verified core files |
| `engine.indexURL` | Absolute HTTP(S) directory URL without credentials, query, or fragment |
| `timeoutMs` | Positive integer, at most 900000 |
| `browser.executable` | Optional absolute Chrome, Chromium, or Edge executable. Discovery is used when absent |
| `browser.provider` | `nativeCdp` by default, or `frame` for a cooperative credentialless target bridge |
| `browser.headed`, `browser.gpu` | Optional booleans. Headless with an isolated profile is the default |
| `browser.allowedOrigins` | Non-empty list of exact HTTP(S) origins. Paths and credentials are rejected |
| `browser.maxRisk` | `read`, `mutate`, or `externalEffect` |
| `browser.actions` | Non-empty exact high-level action allowlist |
| `browser.methods` | Separate exact raw CDP allowlist. An empty list opens no raw command |
| `browser.viewport` | Optional strict `{width,height,deviceScaleFactor?,mobile?,touch?}` device metrics. Dimensions are 1 to 10000 and scale is 0.1 to 10 |
| `browser.fileRoots` | Existing absolute upload roots. Required when upload is enabled |
| `browser.externalEffects` | Must equal `acknowledged` when `maxRisk` is `externalEffect` |
| `browser.purpose` | Required printable purpose for an external-effect configuration |
| `browser.artifacts` | Optional disk, count, inline, and TTL limits described below |
| `browser.recording` | Optional `{mode:"record",file,overwrite?}` for native/frame, or required `{mode:"replay",file,recordingId,finalSha256,startCursor?,prefixSha256?}` for ReplaySpace. Paths are absolute and nonzero cursors require a prefix digest |

FrameSpace supports a smaller action catalog and requires `browser.methods` to be empty. Its exact setup,
sandbox, screenshot, and credentialless-session limits are in the [FrameSpace guide](./frame-space.md).
Hash-chained recording, sensitive-input retention, deterministic replay, and cursor resume are in the
[ReplaySpace guide](./replay-space.md).

The repository `npm run mcp:sandbox` command still accepts the corresponding `PYPROC_*` environment
variables for development and compatibility. The shipped command's versioned manifest is the product entry.
It clears ambient product variables before projecting the manifest so an inherited shell variable cannot
silently widen authority.

## Process and permission boundary

```text
MCP client
  | stdio
  v
pyproc-mcp
  | validated manifest
  v
machine page + Node CDP broker
  | exact origin, action, method, event, file, artifact, and risk policy
  v
broker-owned temporary Chrome or Edge profile
```

The command supports Chromium-family major 137 or newer with CDP protocol major 1. It reads
`Browser.getVersion` before opening a target and reports bounded compatibility information through
`browserInspect`. The broker owns the loopback DevTools WebSocket. MCP receives versioned opaque target,
session, locator, and artifact references. It receives no CDP endpoint, backend node ID, download staging
name, or filesystem path.

The ten opt-in browser tools are:

| Tool | Meaning |
|---|---|
| `browserInspect` | Active policy, compatibility, action catalog, artifact limits, and resource counters |
| `browserListTargets` | Allowed exact-origin targets as opaque `targetRef` values |
| `browserOpen` | Instrument an empty target, apply the viewport, navigate to an allowed URL, and return at commit by default |
| `browserAttach` | Create a versioned broker-scoped session |
| `browserObserve` | Compact semantic snapshot with optional screenshot, console, and network data |
| `browserAct` | Run an ordered pipeline of up to 16 high-level actions |
| `browserCommand` | Raw CDP escape hatch under its own exact method allowlist |
| `browserArtifactRead` | Read at most 256 KiB from an opaque screenshot or download artifact |
| `browserArtifactDelete` | Delete an artifact before its TTL expires |
| `browserDetach` | Detach and clear locators, watchers, download state, and popup captures |

`browserInspect.resources` is the provider-neutral live ownership snapshot. It contains target and owned-target
handles, retained sessions, locators, quarantined sessions, semantic inventories and continuations, observation
listeners and events, lifecycle sessions and watchers, artifact count and bytes, transport sessions, pending
commands and listeners, plus the perception sensor, identity, timeline, world, Situation history, capability,
and turn counts. Each count comes from the module that owns the resource. An accumulated operation count such as
`perception.observations` is diagnostic history and is deliberately outside `resources`.

For an isolated profile, explicit artifact deletion, `browserDetach`, and `browserClose` must return every
`resources` value to zero. In a shared allowed profile, compare with the snapshot taken before the owned flow so
borrowed targets are not mistaken for leaks. A detach event and an explicit detach both remove the port and
transport session immediately while preserving the stale-session error contract.

## PyProc Eyes and APX

`browserObserve` keeps its legacy compact accessibility result unless the caller opts into `apx.graph` or
`apx.situation`. The graph result fuses semantic, structural, geometric, interaction, temporal,
event, and redacted network facts into a bounded graph. It is provider-neutral and never exposes CDP node,
frame, object, or execution-context identifiers.

### Complete legacy semantic inventories

A legacy observation returns at most 1,000 nodes per call. When more nodes belong to the captured snapshot,
the result includes an opaque `continuationRef` and `inventory.complete` is false. Continue it with only the
same `sessionRef`, `expectedRisk: "read"`, and that reference:

```json
{
  "sessionRef": { "protocolVersion": "1", "spaceId": "space:native", "sessionId": "...", "targetRef": "..." },
  "expectedRisk": "read",
  "continuationRef": "continuation:..."
}
```

Do not repeat `mode`, `maxNodes`, screenshot, event, or representation options on continuation calls. Pages are
single-use, expire after five minutes, and preserve provider order. `inventory.offset`, `returned`, `nextOffset`,
and `total` make omissions and duplicates observable. `pageSha256` covers the current page, `prefixSha256` covers
the returned prefix, and `nodesSha256` covers the full captured inventory. On the final page,
`inventory.complete` is true and `prefixSha256` equals `nodesSha256`.

The same `receiptSha256`, `snapshotRef`, `documentEpoch`, `bindingSha256`, and `evidenceSha256` appear on every
page. Screenshot, console, and network payloads are emitted only on the first page; the compact `evidence`
descriptor binds their digests to every later page. Starting another observation invalidates the older
continuation. A replaced document returns `AUTOMATION_OBSERVATION_CONTINUATION_STALE`, and an expired or consumed
reference never resumes from a guessed offset. The complete inventory is capped at 10,000 nodes and 16 MiB;
larger captures fail explicitly with `AUTOMATION_OBSERVATION_INVENTORY_TOO_LARGE`.

```json
{
  "sessionRef": { "protocolVersion": "1", "spaceId": "space:native", "sessionId": "...", "targetRef": "..." },
  "expectedRisk": "read",
  "representation": "apx.graph",
  "query": { "role": "button", "name": "Save", "actionable": true },
  "visual": { "mode": "auto", "maxCrops": 2 },
  "budget": { "maxEntities": 120, "maxRelations": 300, "maxBytes": 131072 }
}
```

The first response is a full observation. Passing its `observationRef` as `since` requests a temporal delta.
An `entityRef` is stable observation identity within one document epoch and grants no authority. A
`locatorRef` is a fresh, session-bound action capability and becomes stale after another observation or
document replacement.

`apx.situation` reconciles that graph into a goal-specific world projection. Its typed requirements state what
must be known, changed, or actionable. It returns explicit unknown and conflict states, and only an
`authorized` affordance carries broker authority. Page-reported capabilities remain untrusted content.

Each requirement includes `candidateEvidence`. Candidate cardinality is computed before the response budget.
An incomplete or unknown inventory cannot prove a unique target, even if the response shows one entity.

```json
{
  "sessionRef": { "protocolVersion": "1", "spaceId": "space:native", "sessionId": "...", "targetRef": "..." },
  "expectedRisk": "read",
  "representation": "apx.situation",
  "focus": { "requirements": [{
    "requirementRef": "requirement:save",
    "select": { "role": "button", "name": "Save", "actionable": true },
    "need": ["fact", "affordance"],
    "cardinality": "one"
  }] },
  "visual": { "mode": "off" },
  "budget": { "maxEntities": 120, "maxRelations": 300, "maxBytes": 131072 }
}
```

Copy the selected authorized affordance's `situationRef`, `worldRef`, and `capabilityRef` into the action's
`actionContext`. After target preparation, the broker rechecks session, target identity, actionability
fingerprint, epoch, action, locator, risk, destination, transition shape, and expiry at the send boundary. A
mismatch is `APX_CAPABILITY_STALE` with `notSent`.

If a proof-carrying action finds a detached target or a replaced document before the first effect, Control
replays the original typed focus as a fresh Situation exactly once. It proceeds only when the same requirement
again has one authorized target with unchanged risk, destination, and transition. The provider-neutral
`pyproc.actionConvergence` version 1 receipt fixes `maxAttempts: 2`, `maxReobservations: 1`,
`effectRetries: 0`, and `maxPreEffectDurationMs: 30000`. It records actual attempts, reobservations,
`effectAttempts`, `preEffectDurationMs`, total `durationMs`, actionability polls and reasons, and both Situation
and document epochs when rebinding occurred.

`reason` is `staleTarget` for a same-document rebind, `documentReplacement` for a new document, and
`occlusionCleared` when a temporarily intercepted target becomes actionable. Ambiguity and persistent occlusion
return `ambiguousTarget` or `actionabilityTimeout` in the error's `details.convergence` with zero effect
attempts. A second mismatch, changed authority, any sent effect, or an unknown outcome is terminal and never
causes another provider effect. Actions without `actionContext` are never reissued.

Native CDP uses pixels only for unresolved canvas, images, and controls. A verified crop enters the normal
artifact and attachment path. FrameSpace provides semantic, spatial, and temporal APX through its cooperative
bridge but rejects non-off visual modes because a DOM-rendered screenshot is not compositor evidence.

An external-effect action can attach a bounded `verify` condition:

```json
{
  "kind": "click",
  "locatorRef": "locator:...",
  "expectedRisk": "externalEffect",
  "actionContext": {
    "situationRef": "situation:...",
    "worldRef": "world:...",
    "capabilityRef": "capability:..."
  },
  "verify": {
    "all": [
      { "entityAppeared": { "role": "status", "nameContains": "Saved" } },
      { "networkResponse": { "method": "POST", "urlPath": "/orders", "status": 201 } }
    ],
    "withinMs": 5000
  }
}
```

The result contains `ActionEvidence` with before and after observations, the one-shot effect outcome, matched
entity and event references, and one of `confirmed`, `contradicted`, `ambiguous`, `notObserved`, or
`outcomeUnknown`. `observationCoverage` records the focused read plan, entity enumeration, event sequence
window, dropped count, and relevant omissions. Event loss cannot prove absence. The action result also includes
send-boundary timing and `safetyRelease`; unresolved pointer or key state quarantines the session from later
effects. A completed click is not itself proof that the requested postcondition happened. The full
wire, provenance, budget, visual, evidence, and conformance contract is the
[APX 1.0 product contract](../../verify-browser-experience/references/apx.md).

## Ordered actions and screenshots

The 23-action catalog includes `snapshot`, `screenshot`, `waitFor`, `hydrateLazy`, `navigate`, `click`, `hover`, `focus`,
`check`, `uncheck`, `drag`, `fill`, `press`, `select`, `scroll`, `upload`, cookie get/set/delete, and Web
Storage get/set/remove/clear.

`screenshot` is an ordered read action. A pipeline can fill and click, capture the resulting page, continue
with another effect, and capture again without a client-side race. Supported options are:

| Option | Contract |
|---|---|
| `format` | `png` by default, `jpeg`, or `webp` |
| `quality` | Integer 0 to 100, valid only for JPEG and WebP |
| `fullPage` | Capture the guarded document content bounds |
| `clip` | `{x,y,width,height,scale?}` in CSS pixels. Exclusive with `fullPage`; omitted `scale` is normalized to `1` before CDP capture |
| `optimizeForSpeed` | Pass the Chromium encoding preference explicitly |
| `inline` | Defaults to `true`. Permit native MCP image content only when the result is within `inlineMaxBytes`; `false` forces artifact-only delivery |

Width and height are each limited to 32768 CSS pixels and the scaled area to 67108864 CSS pixels. The
returned bytes must match the requested PNG, JPEG, or WebP signature before they enter the artifact store.
The per-artifact byte limit is then enforced independently.

The guard reads `cssContentSize` from `Page.getLayoutMetrics`, as required by the current
[Chrome DevTools Protocol Page contract](https://chromedevtools.github.io/devtools-protocol/tot/Page/), and uses
the deprecated `contentSize` only as a compatibility fallback. A bounds failure happens before
`Page.captureScreenshot` and returns `BROWSER_AUTOMATION_SCREENSHOT_BOUNDS`, `outcome: notSent`, and
`retryable: false`. Its stable detail fields are:

| Field | Meaning |
|---|---|
| `reason` | `dimension`, `area`, `extent`, `origin`, or `scale` |
| `source` | `content`, `viewport`, or `clip` |
| `measured` | `x`, `y`, `cssWidth`, `cssHeight`, `scale`, and `scaledCssPixels` |
| `limits` | `maxCssDimension`, `maxScaledCssPixels`, `minScale`, and `maxScale` |
| `recovery` | Automatic retry is false and viewport scrolling may trigger effects |

Do not infer a provider limit from its raw message. A caller may request a smaller clip. Viewport scrolling is
not an automatic screenshot retry because it can run observers and lazy loaders, so it requires the same
explicit effect approval as `hydrateLazy`.

When an inline screenshot fits the configured bound, the MCP result contains its text descriptor followed by
one native `image` content block. The text descriptor omits the duplicate base64. Multiple screenshots keep
action order. When a screenshot exceeds the inline bound, capture still succeeds and the descriptor plus
`browserArtifactRead` remains the fallback.

Every action carries its catalog-owned `expectedRisk`. A caller cannot relabel a click, navigation,
`Runtime.evaluate`, upload, cookie change, or storage change as read-only. The pipeline stops at the first
failure and reports the completed prefix, failed index, and bounded trace. It never silently replays an
applied effect.

## Artifact lifecycle

Screenshots, snapshot screenshots, and downloads use one broker-owned disk store under the temporary
profile. A descriptor contains `artifactRef`, kind, MIME type, byte length, SHA-256, creation and expiry
times, plus safe format-specific metadata. It contains no host path.

| Limit | Default | Manifest maximum |
|---|---:|---:|
| one artifact | 16 MiB | 64 MiB |
| total live bytes | 64 MiB | 512 MiB |
| live artifact count | 64 | 1024 |
| inline response | 2 MiB | 4 MiB |
| TTL | 15 minutes | 24 hours |
| one read chunk | 256 KiB | fixed |

Read chunks by passing the returned `artifactRef`, the previous `nextOffset`, and an optional `maxBytes`.
Verify the reconstructed SHA-256, then call `browserArtifactDelete`. An expired, deleted, foreign, or
restart-invalidated ref returns `BROWSER_AUTOMATION_ARTIFACT_NOT_FOUND`. TTL reap, explicit deletion, and
command shutdown remove both the record and its file. Download staging files are removed immediately after
the bytes enter this store.

## Locators, lifecycle, and privacy

`browserClose` is an explicit `externalEffect` lifecycle operation. The broker accepts it only for a target
created by that same broker. It tracks the exact underlying target identity, so an existing tab with the same URL
cannot be mistaken for the owned target. Closing detaches sessions first. Borrowed targets can be detached but
cannot be closed through this operation.

A target is exactly one CSS selector, opaque `locatorRef`, or semantic locator. Semantic locators support
CSS, role, text, label, test ID, open shadow roots, inherited same-origin frames, and explicitly authorized
cross-origin frame chains. Closed shadow roots are unsupported. Effects wait for strict uniqueness,
visibility, stable geometry, enabled or editable state, viewport position, and hit target before the first
effect command.

`browserObserve` uses `mode: "all"` by default for compatibility. Use `mode: "interactive"` on large product
pages when the next step is an action. This mode scans the full accessibility tree, selects controls,
landmarks, live regions, and live-region text, and only then applies the per-page `maxNodes`. The result reports `mode`,
`eligibleNodes`, `candidateNodes`, and `truncated`, so a caller can distinguish page size from the focused
result size. `truncated` remains a compatibility statement about one page; use `inventory.complete` for full
traversal state. It keeps opaque `locatorRef` values for immediate actions. A later observation replaces the
session's locator set, so finish actions derived from one snapshot before observing again.

`fill` uses the native value setter for `input` and `textarea`. For contenteditable editors it focuses and
selects the current document content, then sends trusted browser text input so controlled editors update
their application state instead of only changing displayed DOM text. A contenteditable result reports
`inputMode: "trusted"` and the resulting visible value.

`waitFor` accepts the same three target forms and the states `attached`, `detached`, `visible`, `hidden`,
`enabled`, `disabled`, `editable`, and `stable`. It uses fixed internal read-only resolver scripts rather than
granting `Runtime.evaluate` to `browserCommand`. A strict or stale semantic locator remains an error.

`hydrateLazy` is a separate `externalEffect` action because scrolling can run observers and start requests.
It performs at most 100 viewport steps within a 30-second action bound, waits between steps, reports lazy
element and pending counts, and restores the original scroll position. Put it immediately before a full-page
`screenshot` in the same pipeline. A `truncated` or `timedOut` result is explicit, and screenshot never runs
hydration implicitly.

Dialog, download, and popup effects must be declared on `click`. A denied popup is closed and its opener is
reactivated as part of the already acknowledged popup cleanup, while an allowed popup keeps its browser focus.
This prevents later capture from inheriting a closed popup surface. Navigation and popup final origins are
rechecked after send and report `outcome: "applied"` when the browser already crossed the effect boundary.
Console and network observations omit headers and bodies, redact secret-shaped text,
and remove URL credentials, query, and fragment. Cookie reads omit values.

The broker proves configured authority boundaries, not ownership of a site or legal permission to automate
it. The operator owns applicable law, site terms, account authorization, data minimization, and approval for
consequential actions. The product provides no CAPTCHA bypass, stealth, fingerprint evasion, credential
harvesting, default-profile attachment, or automatic retry of uncertain effects.

## Checkpoints and outcomes

Python `checkpointRestore` rewinds Python heap and filesystem state only. It never rewinds DOM changes,
navigation, cookies, Web Storage, popup creation, downloads, or network requests.

- `observed`: a classified read completed.
- `applied`: a mutation or external effect completed, or a post-send guard saw an applied effect.
- `notSent`: no command for the failing effect crossed the transport boundary.
- `rejected`: Chromium rejected the command.
- `outcomeUnknown`: transport was lost after send, so the effect may have happened.

An `outcomeUnknown` effect is never retried automatically.

## Minimal tool flow

1. Call `browserInspect` and require `compatibility.supported: true`.
2. Call `browserOpen` with `expectedRisk: "externalEffect"`; it returns at navigation `commit` by default so
   long application startup cannot withhold the target. Use `waitUntil: "domcontentloaded"` or `"load"` only
   when that stronger boundary is required, inspect the bounded startup trace, then call `browserAttach`.
3. Use `waitFor` for user-visible readiness. If required, run `hydrateLazy` and full-page `screenshot` in one
   ordered `browserAct` pipeline.
4. Reconstruct large artifacts with `browserArtifactRead` and verify their SHA-256.
5. Delete consumed artifacts and call `browserDetach`.
6. Close targets created by the broker, then require `browserInspect.resources` to equal the starting baseline.
7. On failure, inspect `outcome`, `completed`, `failedActionIndex`, and `trace` before deciding what can run.

Example screenshot action:

```json
{
  "kind": "screenshot",
  "format": "webp",
  "quality": 75,
  "fullPage": true,
  "expectedRisk": "read"
}
```

## Troubleshooting

| Symptom | Meaning and response |
|---|---|
| `pyproc-mcp: ...` during `--check` | Fix the manifest, engine directory, browser executable, or permission combination before registration |
| `BROWSER_CONTROL_PERMISSION_DENIED` before send | Check exact origins, action and method lists, fixed risk, acknowledgement, purpose, and file roots |
| `BROWSER_CONTROL_PERMISSION_DENIED` with `outcome: applied` | A popup or navigation reached a denied final origin after send. Do not retry automatically |
| `BROWSER_AUTOMATION_ACTIONABILITY_TIMEOUT` | The target never became unique, visible, stable, enabled, editable, or hittable within the bound |
| `BROWSER_AUTOMATION_SCREENSHOT_BOUNDS` | Read `details.measured` and `details.limits`. Request a smaller clip, or explicitly approve a viewport-scroll workflow because scrolling may trigger effects |
| `BROWSER_AUTOMATION_ARTIFACT_QUOTA` | Delete artifacts or wait for TTL reap before capturing more |
| `BROWSER_AUTOMATION_ARTIFACT_NOT_FOUND` | The ref expired, was deleted, belongs to another process, or was invalidated by restart |
| `BROWSER_CONTROL_COMMAND_UNSUPPORTED` at startup | Browser family, Chromium major, or CDP protocol is outside the supported range |
| `BROWSER_CONTROL_OUTCOME_UNKNOWN` | The connection died after send. Inspect the external system before a deliberate retry |

## Verification

- `npm run test:contracts` checks manifest rejection, schema derivation, risk ownership, screenshot validation,
  artifact quota, chunking, digest, TTL, deletion, and shutdown cleanup.
- `npm run test:package` checks the installed bin and required runtime files without adding a JS package export.
- `npm run test:mcp` proves the standalone Python sandbox remains exactly four Python tools with no browser
  authority. The installed shared Control product additionally exposes effect-free Evidence Pack verify and replay.
- `npm run test:mcp-product` packs and installs the npm package, invokes `--check`, boots the Python Machine,
  returns APX graph, visual, and action evidence, captures PNG, JPEG, and WebP as native image content after
  ordered effects, reconstructs chunks, verifies digests, and deletes a ref.
- `npm run test:apx` verifies Native CDP occlusion, stable entity identity, temporal delta, pixel-on-demand,
  raw identifier exclusion, and DOM plus network postconditions in one real-browser journey.
- `npm run test:browser-control` covers viewport emulation, startup trace, readiness states, lazy hydration,
  focused interactive observation, trusted contenteditable input, screenshot and artifact retrieval,
  semantic actions, lifecycle effects, redirect denial, cancellation, browser death, cleanup, and the
  Python restore boundary.
- `npm run test:browser-control-stress` repeats 48 semantic focus actions and remote-object release boundaries.
- `npm run test:automation-lifecycle` uses the packed Control product for 20 Situation, visual screenshot,
  proof-carrying action, action screenshot, artifact deletion, detach, and target-close rounds. Every owner count,
  the Control process, and the temporary browser profile return to zero.

Chrome on Ubuntu and Microsoft Edge on Windows run the installed product and browser-control gates in CI.
APX also exposes an opt-in `environment` channel. Native CDP and FrameSpace observe locale, timezone, color
scheme, reduced motion, and a bounded font metric fingerprint inside the target. Verified Change Loop uses those
facts with the broker viewport and exact browser version to refuse an uncomparable run. The fixed environment
probe is a trusted internal read. It does not expose arbitrary `Runtime.evaluate` authority to the caller.

Repository-wide change verification is built above AutomationSpace rather than inside the action catalog. Its
`eyesAudit` tool loads only a strict `qa/eyes` JSON contract, obtains current broker affordances from
SituationCapsules, and publishes a canonical Evidence Pack. `eyesVerify` and `eyesReplay` send no browser effect.
See [experience verification](../../verify-browser-experience/references/verification.md).

For consequential actions that need separate approval and a durable one-shot send boundary, enable
[Rehearse-Commit](../../commit-pyproc-effects/references/rehearse-commit.md). It composes this same AutomationSpace and ActionEvidence path. It does not
add a second browser implementation or claim remote rollback.

For absolute desired-state execution, deterministic actuator selection, one-effect receipts, and task-owned
cleanup, enable [Proof-Carrying Motor](./actuation.md). Motor consumes the same APX observations and broker actions.
It does not add a raw browser route or turn pixels into action authority.
