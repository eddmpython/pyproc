// 설치 패키지 브라우저 게이트 coverage의 데이터 정본.
// contract.md와 installedPackageGate.mjs가 같은 배열을 본다.
// state-kernel 7b 표면 개편 반영: 루트는 porcelain 6개(boot/open/createWebComputer/
// checkEnvironment/PyProcError/PYPROC_ERROR_CODES)이고, 능력 상세는 machine 핸들의
// runtime escape hatch, the proc() pool, the history verbs, and the pyproc/history signature core.
export const INSTALLED_PACKAGE_COVERAGE_VERSION = 2;

export const INSTALLED_PACKAGE_COVERAGE = Object.freeze([
  Object.freeze({
    gate: "package surface",
    specifiers: Object.freeze(["`pyproc`", "`pyproc/assets`", "`pyproc/history`", "`pyproc/machine`"]),
    publicSurface: Object.freeze([
      "`boot`",
      "`open`",
      "`createWebComputer`",
      "`checkEnvironment`",
      "`getPyProcAssetManifest`",
      "`verifyPyProcAssetIntegrity`",
      "`registerPyProcServiceWorker`",
      "a `commitState`/`openState` kernel round trip",
      "`pyproc-assets` bin",
    ]),
    contract: "package exports, stable subpath, `index.d.ts`, npm files, CLI graph copy and SRI manifest",
  }),
  Object.freeze({
    gate: "installed package - asset path",
    specifiers: Object.freeze(["`pyproc`", "`pyproc/assets`"]),
    publicSurface: Object.freeze([
      "`getPyProcAssetManifest`",
      "`verifyPyProcAssetIntegrity`",
      "`registerPyProcServiceWorker`",
    ]),
    contract: "An asset manifest rooted at `/node_modules/pyproc/`, worker graph SRI, registration of the installed `pyprocSw.js`, and rejection of a bad worker SRI before spawn",
  }),
  Object.freeze({
    gate: "installed package - runtime/server",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["`boot`", "the machine runtime's `enableAsgiServer`", "ASGI delegation wiring of the installed `pyprocSw.js`"]),
    contract: "Machine boot from the installed package, a Python ASGI app, a `fetch(\"/pyproc/...\")` virtual-origin round trip, the S3 timing source",
  }),
  Object.freeze({
    gate: "installed package - device filesystem",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["machine runtime `enableDeviceFs`"]),
    contract: "Reading and writing `/dev/productState` and `/proc/meminfo` through the Python `open()` file contract on an installed-package machine",
  }),
  Object.freeze({
    gate: "installed package - process OS",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["the machine's `proc()` pool"]),
    contract: "Running pool `map` and `terminate` on the installed worker graph, rejection of a bad worker SRI before spawn, and no collision between the SRI and the ASGI Service Worker prefix",
  }),
  Object.freeze({
    gate: "installed package - shell jobs",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["`fork`/`repl`/`signal` on a `proc({ replay })` pool"]),
    contract: "Building an interactive namespace on the installed worker graph and running the `expr &`, `fg`, `kill`, `terminate` job lifecycle",
  }),
  Object.freeze({
    gate: "installed package - machine container",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["child kernels of the machine's `proc()` (a `setup` manifest plus `exec`/`kill`)"]),
    contract: "Spawning, running, measuring heapLen, killing a child machine on the installed worker graph, and rejecting calls after the kill",
  }),
  Object.freeze({
    gate: "installed package - crash resume",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["`boot({ deterministic: true })`", "machine `history.commit`/`history.recover`"]),
    contract: "Leaving a reactive boundary on an installed-package `deterministic` machine with `history.commit()` and recovering product state in a new machine with `history.recover()`",
  }),
  Object.freeze({
    gate: "installed package - immortal python machine",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["`open({ persistent })`", "the `KernelElection` handle"]),
    contract: "Three independent browsing contexts of the installed package sharing one Python state and prepared environment, confirming participant request IDs never collide and late responses are discarded, then continuing execution after the leader is force-removed through persistent epoch succession and recovery of heap plus `/home/web` from OPFS, and reopening from the last commit and the manifest environment after every context has closed",
  }),
  Object.freeze({
    gate: "installed package - permission policy",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["the machine `runtime` escape hatch (the `setGlobal` chokepoint plus the CSP `connect-src`)"]),
    contract: "Enforcement of a product permission manifest (`net=false`, `clipboard=false`, `home=true`, `workers=false`) and of the Python chokepoints",
  }),
  Object.freeze({
    gate: "installed package - portable machine",
    specifiers: Object.freeze(["`pyproc`", "`pyproc/history`"]),
    publicSurface: Object.freeze([
      "`boot({ deterministic: true })`",
      "`open(blob)`",
      "`createStateKeyPair`",
      "`exportStatePublicKey`",
      "`fingerprintStatePublicKey`",
      "machine `history.export({ signingKey })`",
      "Runtime `enableInit`",
    ]),
    contract: "Signed `.pymachine` plus `/home/web` export, signer fingerprint, untrusted and wrong-key rejection, trusted open, reopening the `resume.py` SQLite resource, the S4 timing source",
  }),
  Object.freeze({
    gate: "installed package - web computer",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["`createWebComputer`"]),
    contract: "Assembling a browser computer from the installed package alone: booting the Python guest, running code, and stopping the whole thing",
  }),
]);

export function installedPackageCoverageManifest() {
  return {
    schemaVersion: INSTALLED_PACKAGE_COVERAGE_VERSION,
    rows: INSTALLED_PACKAGE_COVERAGE,
  };
}

export function renderInstalledPackageCoverageMarkdown(rows = INSTALLED_PACKAGE_COVERAGE) {
  const lines = [
    "| Gate | Exposed specifiers | Actual public surface | Contract verified |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    lines.push(`| ${row.gate} | ${row.specifiers.join(", ")} | ${row.publicSurface.join(", ")} | ${row.contract} |`);
  }
  return lines.join("\n");
}
