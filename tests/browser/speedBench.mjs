// Runs the public command loop lab. Measurements are produced inside the browser page.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const result = spawnSync(process.execPath,
  [join(root, "tests", "browser", "run.mjs"), "examples/speedLab.html"],
  { cwd: root, env: process.env, stdio: "inherit" });
process.exit(result.status ?? 1);
