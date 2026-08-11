# Browser automation recipe

The repository MCP server can run a persistent Python Machine and a separately authorized Chromium
automation profile in one stdio session. This integration is opt-in, is not an npm export, never attaches
to a normal browser profile, and never puts the CDP endpoint inside Python.

## Product boundary

```text
MCP client
  | stdio
  v
mcpSandboxServer.mjs
  | exact origin, action, method, event, file, and risk policy
  v
Node CDP broker
  | broker-owned loopback DevTools WebSocket
  v
temporary Chrome or Edge profile
```

The default server exposes only `pythonRun`, `checkpointSave`, `checkpointRestore`, and `sandboxReset`.
`PYPROC_BROWSER_CONTROL=1` adds eight browser tools. The CDP endpoint, target IDs, session IDs, backend DOM
IDs, and filesystem download names remain inside the broker. MCP receives only versioned opaque references
and bounded artifacts.

This path supports Chrome, Chromium, and Edge at Chromium major 137 or newer with CDP protocol major 1.
The broker reads `Browser.getVersion` at startup and fails before opening a target when the product or
protocol is outside that range. `browserInspect.compatibility` reports the detected family, browser major,
protocol version, and any incompatibility reason without returning the complete user agent.

## Configuration

Read-only observation of an existing target needs an exact origin. Creating a target with `browserOpen` is
an external effect and needs the stronger configuration shown below.

```sh
PYPROC_BROWSER_CONTROL=1 \
PYPROC_BROWSER_ALLOWED_ORIGINS=https://example.test \
npm run mcp:sandbox
```

External effects require an `externalEffect` ceiling, an exact action allowlist, the acknowledgement token,
a printable purpose, and the matching `expectedRisk` on every action.

```sh
PYPROC_BROWSER_CONTROL=1 \
PYPROC_BROWSER_ALLOWED_ORIGINS=https://example.test,https://assets.example.test \
PYPROC_BROWSER_MAX_RISK=externalEffect \
PYPROC_BROWSER_ACTIONS=snapshot,waitFor,navigate,click,fill,press,select,scroll \
PYPROC_BROWSER_EXTERNAL_EFFECTS=acknowledged \
PYPROC_BROWSER_PURPOSE="authorized regression testing" \
npm run mcp:sandbox
```

| Variable | Contract |
|---|---|
| `PYPROC_BROWSER_CONTROL` | Only the exact value `1` enables browser authority |
| `PYPROC_BROWSER_ALLOWED_ORIGINS` | Comma-separated exact HTTP(S) origins. Paths, credentials, and non-HTTP schemes fail at startup |
| `PYPROC_BROWSER_MAX_RISK` | Maximum fixed risk. Defaults to `read` |
| `PYPROC_BROWSER_ACTIONS` | Exact high-level action allowlist. Defaults to `snapshot,waitFor` |
| `PYPROC_BROWSER_METHODS` | Separate raw CDP allowlist for `browserCommand`. Internal action methods never become raw permissions |
| `PYPROC_BROWSER_EXTERNAL_EFFECTS` | Must equal `acknowledged` when the maximum risk is `externalEffect` |
| `PYPROC_BROWSER_PURPOSE` | Required printable operator purpose for `externalEffect` |
| `PYPROC_BROWSER_FILE_ROOTS` | Existing absolute upload roots, separated by the operating system path delimiter. Required when upload is enabled |
| `PYPROC_MCP_TIMEOUT` | Browser startup and tool timeout ceiling |

File roots are resolved through the filesystem at configuration time. A missing path, a file instead of a
directory, a relative path, a symlink escape, or a requested file outside every root fails closed. Downloads
always use a broker-owned directory under the temporary profile and are deleted after bounded capture.

The risk map, action map, schema, required methods, events, and inspect metadata have one source each in
`browserControlPolicy.js`, `browserAutomationCatalog.js`, and `browserObservationCatalog.js`.

## Tools

| Tool | Meaning |
|---|---|
| `browserInspect` | Active policy, compatibility diagnostic, action catalog, and bounded resource counters |
| `browserListTargets` | Exact-origin targets as opaque `targetRef` values |
| `browserOpen` | Opens an allowed URL in the temporary profile |
| `browserAttach` | Creates a versioned, broker-scoped opaque session |
| `browserObserve` | Compact semantic snapshot with optional screenshot, console, and network artifacts |
| `browserAct` | Runs an ordered pipeline of up to 16 high-level actions |
| `browserCommand` | Advanced raw CDP escape hatch under its own exact method allowlist |
| `browserDetach` | Detaches the session and clears locators, watchers, buffers, download state, and popup captures |

## High-level actions

| Action | Fixed risk | Input and result |
|---|---|---|
| `snapshot` | `read` | Optional node and artifact limits; returns compact semantic nodes and opaque locators |
| `waitFor` | `read` | CSS selector, `attached` or `detached`, and optional timeout |
| `navigate` | `externalEffect` | Allowed URL, `commit`, `domcontentloaded`, or `load`; returns redacted final URL, final origin, loader, state, and polls |
| `click` | `externalEffect` | One target and at most one declared `dialog`, `download`, or `popup` lifecycle effect |
| `hover` | `externalEffect` | Trusted pointer move after actionability checks |
| `focus` | `externalEffect` | Focuses one visible and enabled target |
| `check`, `uncheck` | `externalEffect` | Trusted checkbox or radio transition with postcondition verification |
| `drag` | `externalEffect` | Source target plus semantic `to` locator; uses intercepted native drag data and trusted events |
| `fill` | `externalEffect` | Editable target and bounded value; dispatches input and change events |
| `press` | `externalEffect` | Key, optional target, and optional Alt, Control, Meta, or Shift modifiers |
| `select` | `externalEffect` | Select target and one or more exact option values |
| `scroll` | `externalEffect` | Target and optional block alignment. Lazy loading makes this an external effect |
| `upload` | `externalEffect` | File input and one or more files inside configured roots |
| `cookiesGet` | `read` | Optional allowed URL and bound; returns cookie metadata without values |
| `cookieSet` | `externalEffect` | Name, value, optional allowed URL, path, flags, SameSite, and expiry. Domain widening is not accepted |
| `cookieDelete` | `externalEffect` | Name and optional allowed URL |
| `storageGet` | `read` | `local` or `session`, optional bound; returns clipped entries and raw byte count |
| `storageSet` | `externalEffect` | Storage area, key, and value |
| `storageRemove` | `externalEffect` | Storage area and key |
| `storageClear` | `externalEffect` | Storage area for the attached exact origin |

Every action carries its catalog-owned `expectedRisk`. A caller cannot relabel `click`, `Runtime.evaluate`,
cookie mutation, storage mutation, scrolling, or navigation as read-only. The pipeline stops at the first
failure and returns only the completed prefix plus `failedActionIndex` and a bounded trace.

## Locators and actionability

A target is exactly one of a CSS selector, an opaque `locatorRef`, or a semantic locator.

```json
{"by":"css","value":"button.save"}
{"by":"role","value":"button","name":"Save"}
{"by":"text","value":"Ready"}
{"by":"label","value":"Work email"}
{"by":"testId","value":"submit-order"}
```

Semantic lookup traverses the main document, same-origin frames, and open shadow roots. `shadow: "open"`
can make that boundary explicit. Any other shadow mode is rejected as unsupported. A frame chain is explicit
and strict:

```json
{
  "by": "role",
  "value": "button",
  "name": "Approve",
  "frame": [
    {"by":"url","value":"https://assets.example.test/frame.html"}
  ]
}
```

Each frame document is re-authorized. `about:blank` and `about:srcdoc` inherit the nearest authorized parent
origin. Cross-origin frames run locator code in a broker-created isolated world. Raw frame IDs do not leave
the broker.

Before an effect, target actions require the applicable combination of attachment, uniqueness, visibility,
stable geometry, enabled state, editability, viewport position, and hit target. The broker may repeat only
these pre-effect reads. It scrolls once when needed, then requires consecutive stable polls. After the first
effect command it never repeats the action automatically.

## Lifecycle effects

- `click.dialog` must declare `accept` or `dismiss`. No dialog is handled implicitly.
- `click.download: true` captures one completed download under 2 MiB, returns SHA-256 and base64, and deletes
  the temporary file. It never overwrites a caller path.
- `click.popup: true` snapshots targets before the click, requires exactly one new page with the attached
  page as opener, waits for a stable allowed URL, and returns an opaque `targetRef`. A popup observed at a
  denied final origin is closed and the action fails with `outcome: "applied"`.
- `drag` waits for both source and destination actionability, intercepts Chromium drag data, and dispatches
  `dragEnter`, `dragOver`, and `drop` through CDP.

`browserAttach` rechecks a returned popup origin. Navigation also rechecks the root frame on every wait poll,
so an allowed URL that redirects to a denied origin fails after send with `outcome: "applied"`.

## Observation, privacy, and trace

`browserObserve` can combine a compact accessibility snapshot with these bounded artifacts:

- PNG screenshot with a 2 MiB maximum, byte length, and SHA-256
- console level, timestamp, and at most ten clipped scalar arguments
- network method, redacted URL without query or credentials, resource type, status, MIME, and timing phase

Headers, request bodies, response bodies, authorization values, remote object IDs, backend node IDs, and
cookie values are absent. Secret-shaped console values are redacted. Cookie names and Web Storage values are
still potentially sensitive and require least privilege and output review.

Trace schema version `1` records action position, fixed risk, command method, opaque request ID, context epoch,
duration, outcome, completed prefix, failed index, and bounded omission counts. It does not record action
inputs, cookie values, upload paths, storage values, headers, or bodies. `browserInspect` returns only counters
for resident locators, sessions, watchers, queued events, buffers, download enablement, and popup captures.

## Outcome and checkpoint law

- `observed`: a classified read completed.
- `applied`: a mutation or external effect completed, or a post-send guard observed an already applied effect.
- `notSent`: no command for the failing effect crossed the transport boundary.
- `rejected`: Chromium rejected the command.
- `outcomeUnknown`: transport was lost after send, so the effect may have happened.

Python `checkpointRestore` rewinds Python heap and filesystem state only. It never rewinds DOM changes,
navigation, cookies, Web Storage, popup creation, downloads, or network requests. A cancelled or dead-browser
effect with an unknown outcome is never retried automatically.

## Minimal flow

1. Call `browserInspect` and require `compatibility.supported: true`.
2. Call `browserOpen` with `expectedRisk: "externalEffect"`, then `browserAttach`.
3. Call `browserObserve` with `expectedRisk: "read"`.
4. Choose an opaque locator or provide a strict semantic locator.
5. Send an ordered `browserAct` array with the fixed risk on every action.
6. On failure, inspect `outcome`, `completed`, `failedActionIndex`, and `trace` before deciding what can run next.
7. Call `browserDetach` and verify resource counters when operating a long-lived server.

The corresponding tool arguments for one small workflow are:

```json
{"url":"https://example.test/form","expectedRisk":"externalEffect"}
```

Pass the returned `targetRef` to `browserAttach`, then pass its `sessionRef` to the next calls:

```json
{"sessionRef":{"protocolVersion":"1","brokerId":"...","brokerEpoch":1,"sessionId":"...","targetRef":"..."},"expectedRisk":"read","maxNodes":100,"includeScreenshot":true}
```

```json
{
  "sessionRef": {"protocolVersion":"1","brokerId":"...","brokerEpoch":1,"sessionId":"...","targetRef":"..."},
  "actions": [
    {"kind":"fill","locator":{"by":"label","value":"Work email"},"value":"person@example.test","expectedRisk":"externalEffect"},
    {"kind":"click","locator":{"by":"role","value":"button","name":"Submit"},"expectedRisk":"externalEffect"}
  ]
}
```

The opaque fields are examples only. Always pass through the exact values returned by this broker instance.
They are invalid after detach, broker restart, or document replacement.

## Authorized-use boundary

The broker proves configured authority boundaries, not ownership of a site or legal permission to automate
it. The operator owns applicable law, site terms, account authorization, data minimization, and approval for
consequential actions. The repository provides no CAPTCHA bypass, stealth, fingerprint evasion, credential
harvesting, default-profile attachment, or automatic retry of uncertain effects.

Raw `Runtime.evaluate` is a powerful escape hatch. It is absent from the default raw allowlist and must be
named separately under an external-effect configuration. High-level actions use broker-owned static scripts
without granting that raw method to `browserCommand`.

## Troubleshooting

| Symptom | Meaning and response |
|---|---|
| `BROWSER_CONTROL_PERMISSION_DENIED` before send | Check exact origins, action and method lists, fixed risk, acknowledgement, purpose, and file roots |
| `BROWSER_CONTROL_PERMISSION_DENIED` with `outcome: applied` | A popup or navigation crossed the send boundary and reached a denied final origin. Do not retry automatically |
| `BROWSER_AUTOMATION_ACTIONABILITY_TIMEOUT` | The target never became unique, visible, stable, enabled, editable, or hittable within the bound |
| `BROWSER_AUTOMATION_STRICT_LOCATOR` | The semantic locator matched more than one target |
| `BROWSER_AUTOMATION_STALE_LOCATOR` | A snapshot locator belongs to an older document or another session. Observe again |
| `BROWSER_CONTROL_COMMAND_UNSUPPORTED` at startup | Browser family, Chromium major, or CDP protocol is outside the supported range |
| `BROWSER_CONTROL_OUTCOME_UNKNOWN` | The connection died after send. Inspect the external system before any deliberate retry |

## Verification

- `npm run test:contracts` checks schema derivation, risk ownership, origin and filesystem guards, popup
  fencing, compatibility rejection, trace bounds, locator epochs, and partial completion.
- `npm run test:mcp` proves that the default server remains exactly four Python tools with no browser authority.
- `npm run test:browser-control` exercises 58 browser-control assertions in real Chrome and Edge, including
  semantic frames and shadow roots, actionability, trusted input, popup closure, dialog, upload, download,
  drag, cookie and storage actions, redirect denial, cancellation, browser death, resource cleanup, and the
  Python restore boundary.
- `npm run test:browser-control-stress` repeats 48 semantic focus actions across three maximum-length
  pipelines in each browser and requires every actionability and remote-object release trace.
- `npm run test:package` proves that the repository-only broker and MCP server are absent from the npm tarball.
