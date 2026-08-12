# JavaScript Control SDK

The stable `pyproc/control` Node.js subpath starts the installed pyproc product and exposes persistent Python,
checkpoint recovery, browser automation, PyProc Eyes, verified binary attachments, and cancellation through
one supported JavaScript API.

## Install and preflight

Install the exact npm version and prepare the pinned engine distribution.

```sh
npm install --save-exact pyproc@0.0.21
npx pyproc-engine --out /absolute/path/to/pyodide
```

Create the version 1 policy manifest from the [browser automation guide](browserAutomation.md), then validate
it without starting a live product:

```js
import { PyProcControlClient } from "pyproc/control";

const report = await PyProcControlClient.check("pyproc-control.json");
console.log(report.ok);
```

`start()` runs the matching `pyproc-control` file from the installed package. It does not depend on a global
bin lookup. An embedded host can pass `command: [nodePath, controlScriptPath]` explicitly.

## Persistent Python and recovery

```js
import { PyProcControlClient } from "pyproc/control";

const client = await PyProcControlClient.start("pyproc-control.json");
try {
  await client.runPython("prepared = [10, 20, 30]");
  const checkpoint = await client.saveCheckpoint();

  try {
    await client.runPython("prepared.append(999)\nraise ValueError('failed attempt')");
  } catch (error) {
    await client.restoreCheckpoint(checkpoint.output.index);
  }

  console.log((await client.runPython("prepared")).output.value);
} finally {
  await client.close();
}
```

The child process owns one persistent Python Machine for its lifetime. `close()` first closes protocol input,
allows the product to drain, then applies a bounded termination fallback. It is safe to await more than once.

## PyProc Eyes and evidence-backed action

```js
const opened = await client.openTarget("https://example.test", {
  expectedRisk: "externalEffect",
  waitUntil: "load",
});
const attached = await client.attachSession(opened.output.targetRef);
const eyes = client.perception(attached.output);

const save = (await eyes.query({
  role: "button",
  name: "Save",
  actionable: true,
})).one();

const applied = await eyes.act("click", save.locatorRef, {
  verify: { entityAppeared: { role: "status", nameContains: "Saved" } },
});
console.log(applied.output.actions[0].result.evidence.verification.state);
```

`query().one()` checks APX `query.matched` and rejects zero or multiple matches even if the byte budget returned
only one of several candidates. `entityRef` is observation identity;
only the fresh `locatorRef` grants short-lived action authority. `whatChanged(observationRef)` requests a
delta, and `explainActionability(entityRef)` returns the semantic, geometry, and interaction slice.

Native CDP and FrameSpace use the same facade. Native CDP can return verified pixel-on-demand attachments at
level L4. FrameSpace reports its honest L3 boundary and rejects visual inference.

## Screenshots and artifacts

```js
import { writeFile } from "node:fs/promises";

const captured = await client.act(attached.output, [
  { kind: "screenshot", format: "png", expectedRisk: "read" },
]);

const image = captured.attachments[0];
await writeFile("capture.png", image.bytes);
await client.deleteArtifact(captured.output.actions[0].result.artifactRef);
```

Output is not exposed until chunk order, decoded byte length, MIME type, and SHA-256 match the terminal
descriptor. JSON keeps the opaque artifact reference for bounded reads and explicit deletion.

## Cancellation, deadlines, and external effects

```js
const request = client.requestAsync("machine.run", {
  code: "import time\ntime.sleep(30)",
});
await request.cancel("operator deadline");

try {
  await request.result;
} catch (error) {
  console.log(error.code, error.outcome, error.retryable);
}
```

Every high-level method accepts `timeoutMs`. A deadline sends one protocol cancel and waits for the canonical
terminal. If the connection cannot settle, it closes and returns `CONTROL_TIMEOUT` with `outcomeUnknown` and
`retryable: false`. A pending connection loss returns the equally conservative `CONTROL_CONNECTION_LOST`.
Neither case automatically repeats an effect.

Python restore cannot undo navigation, input, storage, download, popup, network, or another external effect.
Never retry an `applied` or `outcomeUnknown` action automatically.

## Verification

The contract gate fixes the public classes, APX operation mapping, one-match refusal, deadline cancel, and
invalid startup input. The package gate imports only `pyproc/control` from a packed install. The installed
Control product gate uses that public import to preflight and start the product, run persistent Python, cancel
a delivered command, query APX through Native CDP and FrameSpace, verify screenshot bytes, reject request ID
reuse, detach, and shut down on Chrome and Edge.
