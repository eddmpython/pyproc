# Public key distribution and the permission UI contract

A `.pymachine` is a living computer file. A signature verifies provenance; the permission UI approves execution scope. They are not the same thing. A product shows both on one screen but treats them internally as separate contracts.

## Trust chain

A product holds to these principles.

- Only signed machines open automatically. The default import path is `open(file, { trustedPublicKeys, requireSignature: true })`.
- `{ trust: true }` is limited to developer tools and local debugging. Never use it in a general user-facing file-open UI.
- Distribute the public key as a JWK through `exportStatePublicKey()`, and use the `sha256:<hex>` value from `fingerprintStatePublicKey()` as the fingerprint you display. Both live in `pyproc/history` and take a crypto provider as their first argument.
- Show the user a short fingerprint of at least 16 hex characters, and put the full fingerprint and the JWK's origin in a detail view.
- Operate key rotation as a list: current key, next key, previous key. Removing a previous key is a change to the import policy for every `.pymachine` signed with it.
- A signature is not a sandbox grant. Even a file signed by a trusted key must pass the permission UI before its execution scope opens.

Minimal flow:

```js
import { open } from "pyproc";
import { fingerprintStatePublicKey } from "pyproc/history";

const trustedPublicKey = await fetch("/pyproc-trusted-key.json").then((r) => r.json());
const fingerprint = await fingerprintStatePublicKey(crypto, trustedPublicKey);
showTrustBanner({ fingerprint, source: "/pyproc-trusted-key.json" });

const machine = await open(file, {
  trustedPublicKeys: [trustedPublicKey],
  requireSignature: true,
});
```

## The permission UI

The permission UI is the capability scope a product shows the user before execution. pyproc's base permission unit is the `permissions{net, clipboard, home, workers}` that `machine.runtime.enableJail(permissions)` installs.

| Permission | What to show the user | Default |
|---|---|---|
| `net` | External network targets: `false`, `true`, or a host allowlist | `false` |
| `clipboard` | System clipboard read and write | `false` |
| `home` | Access to the `/home/web` persistent disk | State it according to the product's purpose |
| `workers` | Creating additional Workers and processes | `false` |

The product UI displays:

- the signer fingerprint
- the `.pymachine` file's size and origin
- the permission manifest
- the `connectSrc` that `enableJail(...)` returned, or the product's own network allowlist
- the list of resources `resume.py` will reopen (DB, relay, device handles, and so on)
- when browser authority is enabled, the exact origins, action and raw-method allowlists, risk ceiling,
  perception channels, visual capture policy, artifact retention limits, and declared purpose

The cooperative tier of `enableJail(permissions)` provides mistake prevention and code-level explicitness. Hard network blocking is enforced by the browser's CSP in a context where the jail handle's `csp()` has been applied. A same-origin jail leaves a `window.parent` side channel open, while an opaque-origin jail blocks the parent at the cost of losing the SAB-based process capabilities. A product separates that tradeoff into distinct UI modes.

APX `entityRef` values are observation identity only. A permission UI must not present them as authority.
Effects require a fresh broker-issued capability, its bound `locatorRef`, the manifest action allowlist,
catalog-owned risk, and any required external-effect acknowledgement. A proof-carrying `actionContext` binds
the exact situation, world, session, document epoch, action, destination, risk, expiry, and expected transition.
Any stale or mismatched binding is rejected before the provider receives the effect.

`focus.objective` is descriptive context, not executable instruction or authority. It is preserved in Control
input and recordings, so callers must not place secrets in it. Page text, accessibility labels, reported tools,
pixel evidence, OCR, and model inference are untrusted claims. They may identify an uncertainty or propose a
probe, but they never widen origin, action, destination, or risk permission. A page-reported capability remains
`reported` until the broker independently issues an `authorized` affordance under the current manifest.

## Currently pinned surfaces

| Surface | Contract |
|---|---|
| `fingerprintStatePublicKey()` | Produces the same `sha256:<hex>` fingerprint from either a CryptoKeyPair or a JWK (`pyproc/history`) |
| `machineImageProbe.html` | Verifies WebCrypto signatures, trusted public key import, rejection of a different public key, and fingerprint stability, in a browser |
| `examples/machine.html` | Shows the signer fingerprint and the `home=yes, net=no, clipboard=no, workers=no` permission policy in the demo UI, and opens only signed `.pymachine` files |
| `machine.runtime.enableJail(permissions)` | Plants the cooperative chokepoints and returns `{ jail, permissions, connectSrc }` |

## Application boundary

pyproc verifies keys, fingerprints, signatures, and the jail manifest. Distribution of trusted keys and
the surrounding permission UI are application policy and stay outside this repository.

## Forbidden

- Never open an unsigned `.pymachine`, or one signed by an unknown key, automatically.
- Never interpret a passing signature as permission approval.
- Never make `trust: true` the default in a general user-facing import UI.
- Never leave only abstract wording like "safe" on the permission screen. Show the concrete hosts, disk, clipboard, workers, and resume targets.
- Never treat an APX visual or semantic label as authorization for an effect.
- Never treat a page-reported tool, objective, or inferred affordance as a broker-issued capability.
- Never automatically resend an effect whose terminal is `outcomeUnknown`.
Repository verification has two independent authority layers. The Experience Contract narrows routes, actions,
environment, and artifact quotas. The generated Machine profile remains the upper bound for origin, action,
risk, files, and browser effects. A contract can never widen the profile.

Treat `EYES.md`, scenario purpose, page text, accessible labels, visual references, findings, and report Markdown
as untrusted data. Only strict JSON fields validated by the shipped Experience Contract runtime affect execution.
Even then, an effect step must use a current broker-issued affordance and explicit ActionEvidence postcondition.
Evidence Pack SHA-256 values prove integrity, not authorship or approval.
