# FrameSpace product provider

`FrameSpace` runs a cooperative web page inside the same Chromium process as the persistent Python Machine.
It is selected with `browser.provider: "frame"`. The product does not open a DevTools port in this mode.
Python, MCP, JavaScript Control Protocol clients, and the Python SDK keep the same canonical automation
operations.

This provider is for pages that deliberately install the shipped bridge. It does not claim control of an
arbitrary site.

## Product manifest

```json
{
  "schemaVersion": 1,
  "engine": { "root": "/absolute/path/to/pyodide" },
  "browser": {
    "enabled": true,
    "provider": "frame",
    "allowedOrigins": ["https://app.example.test", "https://preview.example.test"],
    "maxRisk": "externalEffect",
    "actions": ["snapshot", "screenshot", "waitFor", "navigate", "fill", "click"],
    "methods": [],
    "externalEffects": "acknowledged",
    "purpose": "authorized embedded regression testing"
  }
}
```

`methods` must be empty. FrameSpace never exposes `automation.command` or `browserCommand`. With `snapshot`
allowed, the provider adds nine browser tools to the four machine tools. `browser.provider` defaults to
`nativeCdp` for compatibility.

The supported action names are `snapshot`, `screenshot`, `waitFor`, `navigate`, `click`, `focus`, `fill`,
`press`, `select`, `check`, `uncheck`, and `scroll`. Read actions require `expectedRisk: "read"`; all other
actions require `expectedRisk: "externalEffect"`.

## Target integration

Copy `scripts/automationSpace/frameSpaceTarget.js` from the installed npm package into the target site's
static assets and load it as a classic script:

```html
<script src="/frameSpaceTarget.js"></script>
```

The bridge announces readiness, accepts a transferred `MessageChannel`, and returns a fresh target epoch.
Requests and responses stay on that private port. Navigation creates another epoch and handshake. A page
without the bridge fails with `FRAME_SPACE_BRIDGE_UNAVAILABLE` instead of being treated as controllable.
The host waits at most ten seconds for readiness and handshake.

## Isolation contract

Each target iframe has exactly these properties:

```text
sandbox="allow-scripts allow-forms"
credentialless
referrerPolicy="no-referrer"
```

There is no `allow-same-origin`, top navigation, popup, download, or parent-DOM power. The target must report
that parent access is blocked before the host accepts the handshake. The machine page CSP adds only the exact
manifest origins to `frame-src`; its Python `connect-src` remains self-only. Origin permission is checked in
Node before a frame or network request is created and checked again after a successful handshake. CSP blocks
a redirect outside `frame-src`; because navigation already started, the missing bridge is reported as
`FRAME_SPACE_BRIDGE_UNAVAILABLE` with `applied` and is never retried automatically.

Credentialless frames use an ephemeral storage and cookie context. FrameSpace is therefore unsuitable for
an existing signed-in browser session. Use `NativeCdpSpace` when native browser input, cookies, network
inspection, arbitrary compatible pages, or compositor screenshots are required.

## APX perception boundary

With `snapshot` allowed, `browserObserve` accepts `apx.graph` and `apx.situation`. The target bridge reports a
fresh document epoch, semantic roles and names, parent and ARIA relations, geometry, hit-test occlusion,
actionability, and short-lived locators. The host maps private target identities to stable `entityRef` values,
removes native identifiers, redacts sensitive values and URL query data, and computes full or delta graphs.
If the target-side entity ceiling truncates capture, that omitted count enters the public APX budget and every
affected completeness channel reports `partial`.

FrameSpace declares APX conformance level L3 with core, web, and situation profiles. It can issue authorized
affordances from its configured action allowlist and rejects stale `actionContext` before bridge dispatch. It
does not claim L4 Action Evidence
or APX visual inference. `visual.mode` values other than `off` fail before target capture. Explicit screenshot
actions remain available under the separate DOM-rendering boundary below.

## Screenshot and artifact boundary

The cooperative bridge serializes its DOM into an SVG `foreignObject`, renders that into a PNG, and reports
the byte length and SHA-256. The host decodes the bytes, verifies the PNG signature and digest, applies
artifact count and byte quotas, and only then emits a Control Protocol attachment. Chunk reads keep base64 in
the JSON payload and do not become duplicate image attachments. Inline screenshots are capped at 512 KiB
and artifact reads at 256 KiB so the page bridge envelope remains bounded.

This is a DOM rendering capture, not a native compositor capture. Canvas pixels, video frames, protected
media, browser chrome, and non-serializable rendering are outside the contract. Use `NativeCdpSpace` for an
authoritative page screenshot.

## Verification

`npm run test:frame-space` packs and installs the npm artifact, starts the Control and MCP products, keeps
Python state, opens cooperative targets on two origins, proves parent and storage isolation, rejects a forged
control-page epoch, preserves a partial-effect outcome, verifies APX identity and delta plus positive and
negative PNG cases, and proves that a denied origin receives zero requests. `npm run test:python-sdk` repeats
the FrameSpace APX query and screenshot journey from an installed wheel. Chrome on Ubuntu and Edge on Windows
run both gates in CI.
