# Browser automation product

The installed `pyproc-mcp` command runs a persistent Python Machine and a separately authorized Chromium
automation profile in one stdio MCP session. It ships in the npm package, uses no runtime dependency, never
attaches to a normal browser profile, and never puts the CDP endpoint inside Python.

## Install and start

Install the package and provision a pinned Pyodide distribution. `engine.root` must be an existing absolute
directory containing `pyodide.js` and `pyodide-lock.json`.

```sh
npm install pyproc
npx pyproc-engine --out /absolute/path/to/pyodide
```

Create `pyproc-mcp.json`:

```json
{
  "schemaVersion": 1,
  "engine": { "root": "/absolute/path/to/pyodide" },
  "timeoutMs": 180000,
  "browser": {
    "enabled": true,
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

Validate without starting Chromium, then register the same command and arguments with an MCP client:

```sh
npx pyproc-mcp --config ./pyproc-mcp.json --check
npx pyproc-mcp --config ./pyproc-mcp.json
```

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
| `engine.root` | Existing absolute Pyodide directory. Exclusive with `engine.indexURL` |
| `engine.indexURL` | Absolute HTTP(S) directory URL without credentials, query, or fragment |
| `timeoutMs` | Positive integer, at most 900000 |
| `browser.executable` | Optional absolute Chrome, Chromium, or Edge executable. Discovery is used when absent |
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
| `browserOpen` | Instrument an empty target, apply the configured viewport, navigate to an allowed URL, and return the target plus startup trace |
| `browserAttach` | Create a versioned broker-scoped session |
| `browserObserve` | Compact semantic snapshot with optional screenshot, console, and network data |
| `browserAct` | Run an ordered pipeline of up to 16 high-level actions |
| `browserCommand` | Raw CDP escape hatch under its own exact method allowlist |
| `browserArtifactRead` | Read at most 256 KiB from an opaque screenshot or download artifact |
| `browserArtifactDelete` | Delete an artifact before its TTL expires |
| `browserDetach` | Detach and clear locators, watchers, download state, and popup captures |

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
| `clip` | `{x,y,width,height,scale?}` in CSS pixels. Exclusive with `fullPage` |
| `optimizeForSpeed` | Pass the Chromium encoding preference explicitly |
| `inline` | Defaults to `true`. Permit native MCP image content only when the result is within `inlineMaxBytes`; `false` forces artifact-only delivery |

Width and height are each limited to 32768 CSS pixels and the scaled area to 67108864 CSS pixels. The
returned bytes must match the requested PNG, JPEG, or WebP signature before they enter the artifact store.
The per-artifact byte limit is then enforced independently.

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

A target is exactly one CSS selector, opaque `locatorRef`, or semantic locator. Semantic locators support
CSS, role, text, label, test ID, open shadow roots, inherited same-origin frames, and explicitly authorized
cross-origin frame chains. Closed shadow roots are unsupported. Effects wait for strict uniqueness,
visibility, stable geometry, enabled or editable state, viewport position, and hit target before the first
effect command.

`waitFor` accepts the same three target forms and the states `attached`, `detached`, `visible`, `hidden`,
`enabled`, `disabled`, `editable`, and `stable`. It uses fixed internal read-only resolver scripts rather than
granting `Runtime.evaluate` to `browserCommand`. A strict or stale semantic locator remains an error.

`hydrateLazy` is a separate `externalEffect` action because scrolling can run observers and start requests.
It performs at most 100 viewport steps within a 30-second action bound, waits between steps, reports lazy
element and pending counts, and restores the original scroll position. Put it immediately before a full-page
`screenshot` in the same pipeline. A `truncated` or `timedOut` result is explicit, and screenshot never runs
hydration implicitly.

Dialog, download, and popup effects must be declared on `click`. A denied popup is closed. Navigation and
popup final origins are rechecked after send and report `outcome: "applied"` when the browser already crossed
the effect boundary. Console and network observations omit headers and bodies, redact secret-shaped text,
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
2. Call `browserOpen` with `expectedRisk: "externalEffect"`; inspect its redacted startup console and network
   trace, then call `browserAttach`.
3. Use `waitFor` for user-visible readiness. If required, run `hydrateLazy` and full-page `screenshot` in one
   ordered `browserAct` pipeline.
4. Reconstruct large artifacts with `browserArtifactRead` and verify their SHA-256.
5. Delete consumed artifacts and call `browserDetach`.
6. On failure, inspect `outcome`, `completed`, `failedActionIndex`, and `trace` before deciding what can run.

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
| `BROWSER_AUTOMATION_SCREENSHOT_BOUNDS` | The document or clip exceeds dimension or scaled-area limits |
| `BROWSER_AUTOMATION_ARTIFACT_QUOTA` | Delete artifacts or wait for TTL reap before capturing more |
| `BROWSER_AUTOMATION_ARTIFACT_NOT_FOUND` | The ref expired, was deleted, belongs to another process, or was invalidated by restart |
| `BROWSER_CONTROL_COMMAND_UNSUPPORTED` at startup | Browser family, Chromium major, or CDP protocol is outside the supported range |
| `BROWSER_CONTROL_OUTCOME_UNKNOWN` | The connection died after send. Inspect the external system before a deliberate retry |

## Verification

- `npm run test:contracts` checks manifest rejection, schema derivation, risk ownership, screenshot validation,
  artifact quota, chunking, digest, TTL, deletion, and shutdown cleanup.
- `npm run test:package` checks the installed bin and required runtime files without adding a JS package export.
- `npm run test:mcp` proves the default server remains exactly four Python tools with no browser authority.
- `npm run test:mcp-product` packs and installs the npm package, invokes `--check`, boots the Python Machine,
  captures PNG, JPEG, and WebP as native image content after ordered effects, reconstructs chunks, verifies
  digests, and deletes a ref.
- `npm run test:browser-control` covers viewport emulation, startup trace, readiness states, lazy hydration,
  screenshot and artifact retrieval, semantic actions, lifecycle effects, redirect denial, cancellation,
  browser death, cleanup, and the Python restore boundary.
- `npm run test:browser-control-stress` repeats 48 semantic focus actions and remote-object release boundaries.

Chrome on Ubuntu and Microsoft Edge on Windows run the installed product and browser-control gates in CI.
