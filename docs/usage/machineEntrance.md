# Machine Entrance

Machine Entrance turns one named recipe into the existing strict version 1 product manifest. It does not add a
second permission system. The expanded `manifest.json` is validated by the same Control and MCP product paths
that execute it.

## Python-only first result

Install and pin the package, then prepare the engine once:

```sh
npm install pyproc@0.0.21 --save-exact
npx pyproc-engine --out vendor/pyodide
```

From the project root, create the default closed profile:

```sh
npx pyproc-mcp init \
  --recipe pythonOnly \
  --engine-root ./vendor/pyodide
```

This writes three project-local files:

```text
.pyproc/
|-- manifest.json
|-- client.json
`-- README.md
```

`manifest.json` contains the fully expanded authority. `client.json` contains a common `mcpServers` stdio
snippet. The generated README contains the exact absolute manifest path and cleanup boundary. No credential,
default browser profile, repository command, or development-server command is generated.

Run the effect-free preflight and the first Python command:

```sh
npx pyproc-control doctor --config ./.pyproc/manifest.json
npx pyproc-control run --config ./.pyproc/manifest.json --code "40 + 2"
```

The successful run returns a `completed` terminal, the existing Control outcome, the Python output, and verified
attachments when an operation has any. A Python-only profile still needs a supported Chromium-family executable
as the browser-native Machine host. It does not enable browser automation, browser actions, or a CDP endpoint.

`doctor` verifies the installed package version, strict manifest, complete local engine core and package digests,
Machine browser discovery, provider authority, operation catalog, and temporary-profile policy. It does not
launch a browser, create a profile, open a CDP endpoint, or send a target request. Target readiness remains an
explicit advisory until the caller opens an allowed URL.

## Read-only application observation

`observeLocal` fixes the action catalog to `snapshot`, `screenshot`, and `waitFor`. Opening the initial URL can
still cause a server-side effect, so exact origin, purpose, and acknowledgement remain mandatory:

```sh
npx pyproc-mcp init \
  --recipe observeLocal \
  --engine-root ./vendor/pyodide \
  --origin http://127.0.0.1:4173 \
  --purpose "inspect the caller-owned local application" \
  --acknowledge-effects
```

The caller starts the application server. The initializer never executes a repository command.

## Authorized browser workflow

Choose every action explicitly. A recipe never lowers the risk assigned by the canonical action catalog:

```sh
npx pyproc-mcp init \
  --recipe authorizedBrowser \
  --engine-root ./vendor/pyodide \
  --origin http://127.0.0.1:4173 \
  --action snapshot \
  --action screenshot \
  --action click \
  --max-risk externalEffect \
  --purpose "verify the caller-owned checkout flow" \
  --acknowledge-effects \
  --overwrite
```

`--overwrite` is required to replace generated files. Without it, one existing target file rejects the entire
initialization before a generated file is changed. `--dry-run` validates the recipe and prints paths without
creating the profile directory.

Advanced bounded options include repeated `--method` and `--file-root`, viewport width and height, device scale,
mobile and touch flags, and artifact byte, count, inline, and TTL limits. File roots remain absolute and existing.
Origins remain exact HTTP(S) origins. Wildcards, credentials, paths, queries, and fragments are rejected.

## Durable Execution Memory

Any recipe can opt into the same immutable session registry without editing the generated manifest:

```sh
npx pyproc-mcp init \
  --recipe pythonOnly \
  --engine-root ./vendor/pyodide \
  --execution-memory-root ./.pyproc/memory \
  --execution-memory-import-root ./approved-handoffs \
  --execution-memory-secret-env WORKSPACE_SECRET
```

Relative memory and import paths resolve against the project root and become absolute in `manifest.json`.
Import roots and secret environment-variable names are repeatable. The initializer requires the named variable
to exist and contain at least eight bytes, but persists only its name. It never writes the secret value. Omit
all three options to keep Execution Memory closed. See [Execution Memory](executionMemory.md).

## Approved effect transactions

An authorized browser recipe can opt into Rehearse-Commit only when Execution Memory is also enabled:

```sh
npx pyproc-mcp init \
  --recipe authorizedBrowser \
  --engine-root ./vendor/pyodide \
  --origin https://records.example.test \
  --action snapshot \
  --action click \
  --max-risk externalEffect \
  --purpose "submit one approved record" \
  --acknowledge-effects \
  --execution-memory-root ./.pyproc/memory \
  --enable-effect-transactions \
  --effect-approval-authority operator:records=./keys/records-public.pem
```

The initializer resolves each authority public-key path against the project root and writes only the public
authority configuration. It never creates or reads a private signing key. The resulting manifest exposes the
seven `effect.*` operations only after strict product validation confirms Execution Memory, an acknowledged
`externalEffect` browser profile, and at least one authority. Omit both effect options to keep the transaction
coordinator closed. See [Rehearse-Commit Transactions](rehearseCommit.md).

## Transactional cooperative app

`transactionalApp` selects credentialless FrameSpace and requires Execution Memory, Rehearse-Commit, an exact app
identity, explicit actions, purpose, and effect acknowledgement:

```sh
npx pyproc-mcp init \
  --recipe transactionalApp \
  --engine-root ./vendor/pyodide \
  --origin https://workspace.example.test \
  --action snapshot --action click \
  --purpose "branch the cooperative workspace" \
  --acknowledge-effects \
  --execution-memory-root ./.pyproc/memory \
  --enable-effect-transactions \
  --effect-approval-authority operator:workspace=./keys/workspace-public.pem \
  --enable-app-space \
  --app-id com.example.workspace \
  --app-origin https://workspace.example.test \
  --app-adapter-version 1.0.0 \
  --app-state-schema workspace/3
```

The app origin must exactly match an allowed origin. `--app-max-state-bytes` may lower the bounded logical-state
limit. This recipe adds no raw browser method and never sends a staged app effect. See
[Transactional AppSpace](appSpace.md).

## Pinned replay

`replayPinned` accepts an existing recording only with its identity and final digest:

```sh
npx pyproc-mcp init \
  --recipe replayPinned \
  --engine-root ./vendor/pyodide \
  --origin https://example.test \
  --action snapshot \
  --max-risk read \
  --purpose "replay an authorized observation" \
  --recording-file ./recording.json \
  --recording-id recording:example \
  --recording-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

The recording path becomes absolute in the expanded manifest. Replay opens no live automation provider and the
doctor verifies the pinned recording chain before startup.

## Long-lived clients and cleanup

Use `PyProcControlClient.start()` or the Python SDK when several operations must share one live Python state,
checkpoint, browser session, and attachment lifecycle. `pyproc-control run` is intentionally one-shot.

Normal client close shuts down the owned Machine browser, automation provider, temporary browser profile,
artifact store, local control server, and locks. A delivered external effect that loses its terminal remains
non-retryable `outcomeUnknown`. Closing a Control process does not claim to preserve its transient checkpoint;
durable browser-restart state is the separate root `open({ name })` Machine contract.

## Failure shape

`doctor` returns a JSON report with `checks`, `blocking`, `advisory`, and exact next commands. `run` and `invoke`
return a completed terminal on success. Programmatic Control errors preserve `code`, `outcome`, `retryable`, and
details such as the completed action prefix. Fix a blocking preflight fact and run `doctor` again before startup.
