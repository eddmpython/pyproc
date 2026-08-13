// cleanupProbe.mjs - browser launcher가 owned process 종료 뒤 profile을 회수하는지 측정한다.
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { launchBrowser } from "../../../scripts/browserControl/browserLauncher.mjs";

async function exists(path) {
  try { await access(path, constants.F_OK); return true; } catch (error) { return false; }
}

const executable = process.env.PYPROC_BROWSER;
if (!executable) {
  console.log("machine entrance cleanup probe skipped: PYPROC_BROWSER is not set");
} else {
  const session = launchBrowser("about:blank", { executable, prefix: "pyprocEntranceCleanup-" });
  const profile = session.profile;
  if (!await exists(profile)) throw new Error("owned browser profile was not created");
  session.close();
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (await exists(profile)) throw new Error("owned browser profile remained after close");
  console.log("machine entrance cleanup probe passed");
}
