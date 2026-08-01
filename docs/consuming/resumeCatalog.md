# resume.py resource policy catalog

`open({ dir, name })`, `machine.history.recover()`, and `open(blob, trustOpts)` revive the Python heap and the `/home/web` file bytes. What they do not guarantee is anything living outside the process: open file handles, SQLite connections, WebSocket or relay connections, browser device permissions, DOM callbacks. A heap delta cannot restore those. This document catalogs what a product should put in `/home/web/resume.py`.

## Shared contract

- The default location is `/home/web/resume.py`. Use `rt.enableInit({ resumePath })` to name a different one.
- After a revival the consumer calls `rt.enableInit().resume(reason)`. Inside `resume.py`, `reason` is readable as the global `pyprocResumeReason`.
- The same file may run more than once, so it must be idempotent. Write table creation, directory creation, and cache rebuilds with `if not exists` and a retryable shape.
- What to reopen is "anything whose platform state can be gone even though the object still looks present in the heap": SQLite connections, open file handles, SocketBridge/relay sessions, an ASGI app's global DB connection, browser device handles, in-memory caches of external permission tokens.
- Treat the files persisted under `/home/web` and your explicit configuration as canonical. Do not trust a stale Python object.
- Permission prompts belong to the product UI. `resume.py` must not silently reopen camera, network relay, or clipboard access.
- Do not put long package installs or network fetches in `resume.py`. The revival path has to converge quickly.

Recommended reason values:

| reason | When |
|---|---|
| `fresh.boot` | The product opens resources through the same hook even on a first boot |
| `session.load` | After `open({ dir, name })` |
| `journal.recover` | After `machine.history.recover()` |
| `image.open` | After `open(blob, trustOptions)` |
| `kernel.failover` | A follower took over after a tab leader change and revived from the journal |

## Currently pinned surfaces

| Surface | Status | resume.py policy | Verification |
|---|---|---|---|
| `tests/attempts/pythonMachine/resumeHookProbe.html` | Contract probe | Reopens a sqlite connection as `resumeConn` and records reason and value. Covers all three revival paths (`open({ dir, name })`, `machine.history.recover()`, `open(blob, trustOpts)`) plus the no-op when the file is absent | `node tests/browser/run.mjs tests/attempts/pythonMachine/resumeHookProbe.html` |
| `examples/machine.html` | Live demo surface | On a first boot or after a revival, `/home/web/resume.py` opens the `appDb` SQLite connection and records the reason in `resumeEvent`. The same hook runs after casting a signed `.pymachine` through `open(blob, trustOpts)` | `npm run test:examples`, or `node tests/browser/run.mjs examples/machine.html?gate=1` |

## Application boundary

pyproc invokes `/home/web/resume.py` with a reason after revival. Which files, databases, sessions, or
device grants are reopened is application policy and stays outside this repository. The hook must rebuild
connections from durable values and must not persist PyProxies, DOM handles, callbacks, or SAB views.

## Minimal template

```python
import os, sqlite3

os.makedirs("/home/web/myApp", exist_ok=True)
resumeReasonSeen = pyprocResumeReason
appDbPath = "/home/web/myApp/app.db"
appDb = sqlite3.connect(appDbPath)
appDb.execute("create table if not exists resumeEvent(reason text)")
appDb.execute("insert into resumeEvent(reason) values (?)", (resumeReasonSeen,))
appDb.commit()
```

Do not copy this template verbatim. Keep your own version thin and driven by your actual resource list. The point is the principle: do not believe the objects left in the heap - reopen from the files under `/home/web` and from explicit permissions.
