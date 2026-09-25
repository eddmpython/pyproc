# user-browser

## Contents

- UserBrowserSpace provider
- Install and pair
- Product manifest
- Authority boundary
- Transport and pairing
- Limits
- Verification

## UserBrowserSpace provider

`browser.provider: "userBrowser"` runs the same AutomationSpace, APX, Motor, and control lifecycle contracts as
`nativeCdp`, but in one task window of the user's own Chrome or Edge, where the user is already signed in. The
pyproc User Browser extension attaches `chrome.debugger` only to the tabs of the window it opened for the task and
the tabs those tabs open, and the browser shows its debugging bar while it does. pyproc never launches, configures,
or reads the user's profile. The provider is available on Windows.

Browser-level CDP does not exist in an extension session, so target lifecycle goes through `chrome.windows` and
`chrome.tabs`: the task window opens unfocused, new task tabs open in it, and closing a task closes only the tabs it
opened. The provider declares `dom`, `network`, `target`, `runtime`, `screenshot`, `artifact`, `perception`, and
`actionConvergence`, never `storage`.

## Install and pair

```powershell
npx pyproc-control user-browser setup
```

Setup builds the native host with Cargo, installs it with the extension folder under
`%LOCALAPPDATA%\pyproc\userBrowser\install`, and registers the host for Chrome and Edge under HKCU. Load the
installed `extension` folder once from the browser's extension page (developer mode); its ID is always
`olckphbppfoanoakaaemgfpobocgdogh`. Then pair:

```powershell
npx pyproc-control user-browser pair --browser edge
```

The extension shows `PAIR` on its action; clicking it within two minutes pairs this user's pyproc with that browser
profile. Automation cannot click the action for you. `user-browser status` lists the running profiles (with whether
each is paired) and every pairing kept here (with whether its profile runs now),
`user-browser unpair --browser edge` forgets the pairing on both sides, and `user-browser remove` unregisters the host
and deletes the install.

## Product manifest

```json
{
  "schemaVersion": 1,
  "engine": { "enabled": false },
  "browser": {
    "enabled": true,
    "provider": "userBrowser",
    "userBrowser": "edge",
    "allowedOrigins": ["https://work.example"],
    "maxRisk": "externalEffect",
    "actions": ["snapshot", "screenshot", "click", "fill"],
    "externalEffects": "acknowledged",
    "purpose": "Submit the weekly report in the signed-in portal"
  }
}
```

`browser.userBrowser` is `chrome` or `edge`. The provider refuses `executable`, `headed`, `gpu`, and
`trustedCertificates` (the browser is the user's), and `requests: "safe"`: a read-only session needs browser-level
request interception, which only a browser pyproc launched offers. Origins, actions, risk, and the effect
acknowledgement work exactly as for `nativeCdp`.

## Authority boundary

- The task window's tabs and the tabs they open are the only attachable tabs. The tabs the task opened (and the tabs
  those open) are closed with it; a tab the user opens in the window or drags into it is handed over: it can be
  attached but is never closed. A tab dragged out is detached.
- The extension refuses every CDP domain outside the tab-level ones observation and actions use (Accessibility,
  Audits, CSS, DOM, DOMSnapshot, Emulation, Input, Log, Network, Overlay, Page, Performance, Runtime), and within
  them the methods that read or change the profile's cookies or cache, `Network.loadNetworkResource`, download
  behavior, closing or crashing a tab, and history navigation. `Page.navigate` goes only to http(s). Target, Fetch,
  Storage, Browser, IndexedDB, DOMStorage, and CacheStorage are unreachable. Network events lose their cookie
  headers and cookie lists, and the events that carry raw request and response cookies are not forwarded.
- Cancelling the browser's debugging bar withdraws the whole task: every session detaches and the Control host sees
  `Transport.detached` with `canceled_by_user`.
- Ending the task, closing the Control host, or losing the native host detaches every session and closes the task's
  own tabs.

## Transport and pairing

The browser starts `pyproc-user-browser-host.exe` for the extension. The host relays length-prefixed JSON frames
between the extension and one named pipe, `\\.\pipe\pyproc-userBrowser-<random>`, created as the only instance of
that name with a DACL that admits the current Windows user alone and with remote clients refused. It announces the
pipe in `%LOCALAPPDATA%\pyproc\userBrowser\hosts\<profile>.json` and withdraws it when the browser lets it go; an
announcement whose host is gone is ignored and removed. The Control host connects as a client; it has no listener.

The extension speaks flat CDP whose sessions are its tab sessions, so the port, policy, APX, and Motor code are the
same as for `nativeCdp`. Before anything else a client must present the pairing key; the extension keeps only its
SHA-256. The key is stored in `%LOCALAPPDATA%\pyproc\userBrowser\pairing`.

Each client connection gets a number from the host. A request is bound to the connection it came from: its reply,
and any effect it completes after the connection is gone (authorization, a tab, an attachment, a pairing), is dropped
or undone. The host forwards the extension's frames to a new client only after the extension acknowledged that
client's number, so nothing written for one control host reaches the next. A client that stops reading for ten
seconds is let go.

## Limits

- The boundary is the Windows user: a process running as the same user can read the pairing key and drive the
  paired browser's task windows (visibly, with the debugging bar), as it could already drive the browser through
  input automation. It still cannot reach the cookie store, other origins' storage, or tabs outside the task.
- `Runtime.evaluate` runs in the page, so it reads what the page's own scripts can: cookies that are not HttpOnly
  and the storage of the origin the tab is on.
- Uploads through `DOM.setFileInputFiles` need the extension's file URL access and are not part of the contract;
  downloads are not yet received.
- The extension is loaded in developer mode until it is published in the browser stores.
- Occlusion and focus: the task window opens unfocused. Behavior of `Input.*` while the window is minimized is not
  covered by the gate.

## Verification

`npm run test:user-browser` installs the host under a gate-only name and `LOCALAPPDATA`, loads the extension into
isolated Edge and Chrome, and runs Motor with semantic and network proof, a screenshot, and task cleanup through the
installed Control product. Negative checks cover a wrong pairing key, a tab outside the task, cookie, storage, and
target commands, the pipe's access list and single instance, and the host leaving with the browser.
