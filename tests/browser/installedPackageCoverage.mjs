// Installed tarball browser coverage shared by the gate and its report.
export const INSTALLED_PACKAGE_COVERAGE_VERSION = 5;

export const INSTALLED_PACKAGE_COVERAGE = Object.freeze([
  Object.freeze({
    gate: "package surface",
    specifiers: Object.freeze(["`pyproc`", "`pyproc/runtime`", "`pyproc/history`", "`pyproc/machine`", "`pyproc/assets`", "`pyproc/wasi`", "`pyproc/gpu`"]),
    publicSurface: Object.freeze(["`boot`", "`open`", "`createWebComputer`", "`checkEnvironment`", "owned kernel classes", "registered GPU oracle"]),
    contract: "The installed native ESM exports resolve without package-internal consumer imports",
  }),
  Object.freeze({
    gate: "installed asset graph",
    specifiers: Object.freeze(["`pyproc/assets`", "the `pyproc-assets` binary"]),
    publicSurface: Object.freeze(["`getPyProcAssetManifest`", "`verifyPyProcAssetIntegrity`"]),
    contract: "The generated seven-file worker graph is same-origin and every byte passes SHA-256 verification",
  }),
  Object.freeze({
    gate: "installed owned kernel",
    specifiers: Object.freeze(["`pyproc`", "`pyproc/runtime`", "`pyproc/wasi`"]),
    publicSurface: Object.freeze(["execution", "value transfer", "checkpoint restore", "process clone", "terminal",
      "source-pinned native package catalog"]),
    contract: "The packed owned CPython WASI engine boots and runs only through the worker-owned kernel protocol",
  }),
  Object.freeze({
    gate: "installed Machine lifecycle",
    specifiers: Object.freeze(["`pyproc`", "`pyproc/machine`"]),
    publicSurface: Object.freeze(["Machine image export and open", "`createWebComputer`"]),
    contract: "Portable state, verified package layers, and the default Python guest work from node_modules alone",
  }),
]);

export function installedPackageCoverageManifest() {
  return { schemaVersion: INSTALLED_PACKAGE_COVERAGE_VERSION, rows: INSTALLED_PACKAGE_COVERAGE };
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
