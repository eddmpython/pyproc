// Web Machine browser probe runner. The default lane needs no external guest assets.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const wantV86 = process.argv.includes("--v86");
const ASSET_FREE = [
  "tests/webMachine/browser/probes/hostContractProbe.html",
  "tests/webMachine/browser/probes/ownerSuccessorProbe.html",
  "tests/webMachine/browser/probes/generationContractProbe.html",
  "tests/webMachine/browser/probes/durableComputerProbe.html",
  "tests/webMachine/browser/probes/machineFleetProbe.html",
];
const V86_BACKED = [
  "tests/webMachine/browser/probes/dualBootProbe.html",
  "tests/webMachine/browser/probes/linuxGuestProbe.html",
  "tests/webMachine/browser/probes/clockEntropyProbe.html",
  "tests/webMachine/browser/probes/displayInputProbe.html",
  "tests/webMachine/browser/probes/framebufferPointerProbe.html",
  "tests/webMachine/browser/probes/nestedBrowserBoundaryProbe.html",
];
const V86_ASSET_DIR = join(ROOT, "tests", "webMachine", "fixtures", "v86", "assets");
if (wantV86 && !existsSync(join(V86_ASSET_DIR, "libv86.mjs"))) {
  console.error(`FAIL v86 assets are unavailable: ${V86_ASSET_DIR}`);
  process.exit(1);
}

const pages = [...ASSET_FREE, ...(wantV86 ? V86_BACKED : [])];
let failed = 0;
for (const page of pages) {
  console.log(`\n=== ${page} ===`);
  const result = spawnSync(process.execPath, [join(ROOT, "tests", "browser", "run.mjs"), page], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) failed += 1;
}
console.log(`\nresult: ${failed ? "RED" : "GREEN"} (${pages.length - failed}/${pages.length} probes)`);
process.exit(failed ? 1 : 0);
