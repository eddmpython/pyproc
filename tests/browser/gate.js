import { boot, open, checkEnvironment } from "../../index.js";

const output = document.getElementById("out");
const checks = [];
const timings = {};

function check(name, pass, info = "") {
  checks.push({ name, pass: pass === true, info: String(info || "") });
  output.textContent += `\n${pass ? "PASS" : "FAIL"} ${name}${info ? ` (${info})` : ""}`;
}

async function report() {
  const body = JSON.stringify({ ok: checks.every((entry) => entry.pass), checks, timings });
  try {
    await fetch("/gateReport", { method: "POST", headers: { "Content-Type": "application/json" }, body });
  } catch {
    output.textContent += "\nThe automated report endpoint is unavailable.";
  }
}

let machine = null;
let opened = null;
let child = null;

try {
  const environment = checkEnvironment();
  check("environment reports browser capabilities",
    typeof environment.ok === "boolean" && Array.isArray(environment.issues));

  let startedAt = performance.now();
  machine = await boot({ deterministic: true });
  timings.ownedBootMs = Math.round(performance.now() - startedAt);
  check("owned CPython WASI kernel boots", !!machine?.kernel, `${timings.ownedBootMs}ms`);

  const inspection = await machine.inspect();
  check("kernel is worker owned",
    inspection.kernel.runtimeKind === "cpython-wasi"
      && inspection.kernel.workerOwned === true
      && inspection.kernel.directHeapAccess === false);

  const execution = await machine.run("print(sum(range(10)))");
  check("Python executes through the public machine", execution.output.trim() === "45", execution.output);

  await machine.run.set("gateValue", { label: "한글", values: [2, 3, 5] });
  const transferred = await machine.run.get("gateValue");
  check("structured values cross the kernel boundary",
    transferred.label === "한글" && transferred.values.join(",") === "2,3,5");

  await machine.run("checkpointValue = 41");
  const checkpoint = await machine.history.checkpoint();
  await machine.run("checkpointValue = 99");
  await machine.history.restore(checkpoint);
  check("checkpoint restore rewinds live state", await machine.run.get("checkpointValue") === 41);

  const image = await machine.history.export({ createdAt: "2026-08-14T00:00:00.000Z" });
  check("Machine image has a verified owned kernel envelope",
    image.protocol === "pyproc.kernel-machine-image"
      && image.engineManifest.engineId.startsWith("cpython-wasi-")
      && typeof image.digest === "string"
      && image.checkpointObjects.length > 0);

  startedAt = performance.now();
  opened = await open(image);
  timings.imageOpenMs = Math.round(performance.now() - startedAt);
  check("Machine image opens through the root API",
    await opened.run.get("checkpointValue") === 41, `${timings.imageOpenMs}ms`);

  startedAt = performance.now();
  const cloned = await machine.proc.clone({ pid: "gate-child" });
  child = cloned.process;
  const childResult = await child.execute("print(checkpointValue + 1)");
  timings.cloneMs = Math.round(performance.now() - startedAt);
  const childExit = await child.wait();
  check("process clone runs in an independent kernel",
    childResult.output.trim() === "42" && childExit.exitCode === 0, `${timings.cloneMs}ms`);

  const terminal = machine.terminal({ timeTravel: true });
  await terminal.install();
  const terminalResult = await terminal.push("print(6 * 7)");
  check("terminal uses the kernel protocol", terminalResult.more === false && terminalResult.out.trim() === "42");

  let invalidOption = null;
  try {
    await boot({ compatibility: true });
  } catch (error) {
    invalidOption = error;
  }
  check("removed compatibility options fail closed", invalidOption?.code === "PYPROC_INPUT_INVALID");

  let corruptImage = null;
  try {
    await open({ ...image, digest: "sha256:corrupt" });
  } catch (error) {
    corruptImage = error;
  }
  check("corrupt Machine image is rejected", corruptImage?.code === "PYPROC_MACHINE_INTEGRITY");

  check("inspection and image share the exact engine identity",
    inspection.kernel.engineId === image.engineManifest.engineId
      && inspection.engineManifestDigest === machine.manifest.digest);
} catch (error) {
  check("uncaught browser gate error", false, error?.stack || error?.message || error);
} finally {
  if (child && child.state === "running") await child.close();
  if (opened) await opened.close();
  if (machine) await machine.close();
  await report();
}
