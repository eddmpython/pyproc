import { inspectUntrustedWebMachine } from "./imageTrust.js";

const timings = {};

function check(checks, name, pass, info = "") {
  checks.push({ name, pass: !!pass, info: String(info) });
}

async function post(path, value) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
}

async function reportFailure(error) {
  await post("/gateReport", {
    ok: false,
    checks: [{ name: "Web Computer product flow", pass: false, info: String(error?.stack || error).slice(-1800) }],
    timings,
  }).catch(() => undefined);
}

async function initialPhase(runtime, startupMs) {
  const startedAt = performance.now();
  const python = await runtime.runPython("from pathlib import Path\nmachineValue = 91\nPath('/home/web/product_value').write_text('PYTHON_PRODUCT:91')\nf'{machineValue}:{Path(\"/home/web/product_value\").read_text()}'");
  const linux = await runtime.runLinux("machine_value=91; mkdir -p /mnt/web; printf LINUX_PRODUCT:91 > /mnt/web/product_value; sync; echo PRODUCT:$machine_value:$(cat /mnt/web/product_value)");
  if (python !== "91:PYTHON_PRODUCT:91" || !linux.includes("PRODUCT:91:LINUX_PRODUCT:91")) throw new Error("Initial dual guest interaction failed");
  const committed = await runtime.save();
  timings.initialBootMs = startupMs;
  timings.firstUseAndCommitMs = Math.round(performance.now() - startedAt);
  timings.initialCommitBytes = committed.manifest.machines.reduce((total, entry) => total + entry.payload.byteLength, 0);
  await post("/gateRestart", { nextSearch: "?gate=restore", timings });
  await new Promise(() => undefined);
}

async function restorePhase(runtime) {
  const checks = [];
  const startedAt = performance.now();
  const inspection = runtime.inspect();
  check(checks, "product startup restored a durable generation", runtime.startupMode === "restored", runtime.startupMode);
  check(checks, "both guests restored without boot events", Object.values(inspection.machines).every((machine) => machine.history.some((entry) => entry.event === "restored") && !machine.history.some((entry) => entry.event === "booted")));
  const [python, linux] = await Promise.all([
    runtime.runPython("from pathlib import Path\nf'{machineValue}:{Path(\"/home/web/product_value\").read_text()}'"),
    runtime.runLinux("echo RESTORED:$machine_value:$(cat /mnt/web/product_value)"),
  ]);
  check(checks, "Python memory and block file survived browser restart", python === "91:PYTHON_PRODUCT:91", python);
  check(checks, "Linux memory and block file survived browser restart", linux.includes("RESTORED:91:LINUX_PRODUCT:91"), linux.trim().slice(-180));
  if (!checks.every((entry) => entry.pass)) throw new Error(JSON.stringify(checks));
  const exported = await runtime.exportImage();
  const artifactResponse = await fetch("/gateArtifact", { method: "POST", body: exported.file });
  if (!artifactResponse.ok) throw new Error(`Artifact upload failed: ${artifactResponse.status}`);
  timings.processRestoreAndExportMs = Math.round(performance.now() - startedAt);
  timings.imageBytes = exported.file.size;
  await post("/gateRestart", { freshProfile: true, nextSearch: "?gate=import", timings });
  await new Promise(() => undefined);
}

async function importPhase(runtime) {
  const checks = [];
  const before = await runtime.persistence.readHead(runtime.groupId);
  check(checks, "fresh profile has no source generation", !before?.head, before?.head || "empty");
  const response = await fetch("/gateArtifact");
  if (!response.ok) throw new Error(`Artifact download failed: ${response.status}`);
  const file = await response.blob();
  const inspected = await inspectUntrustedWebMachine(file);
  check(checks, "trust screen sees two machines before execution", inspected.machines.join(",") === "linuxOs,pythonOs" || inspected.machines.join(",") === "pythonOs,linuxOs", inspected.machines.join(","));
  check(checks, "portable image includes both block devices", inspected.devices.length === 2, inspected.devices.join(","));
  const startedAt = performance.now();
  const imported = await runtime.importImage(file, inspected.publicKey);
  timings.freshProfileImportMs = Math.round(performance.now() - startedAt);
  const afterImport = runtime.inspect();
  check(checks, "signature and integrity verified before two engines started", imported.archive.signerFingerprint === inspected.fingerprint, imported.archive.signerFingerprint);
  check(checks, "fresh-profile import resumed both guests", Object.values(afterImport.machines).every((machine) => machine.state === "running"), Object.values(afterImport.machines).map((machine) => machine.state).join("/"));
  check(checks, "imported adapters restored without boot", Object.values(afterImport.machines).every((machine) => machine.history.some((entry) => entry.event === "restored") && !machine.history.some((entry) => entry.event === "booted")));
  const [python, linux] = await Promise.all([
    runtime.runPython("from pathlib import Path\nf'{machineValue}:{Path(\"/home/web/product_value\").read_text()}'"),
    runtime.runLinux("echo IMPORTED:$machine_value:$(cat /mnt/web/product_value)"),
  ]);
  check(checks, "Python computer works in the fresh profile", python === "91:PYTHON_PRODUCT:91", python);
  check(checks, "Linux computer works in the fresh profile", linux.includes("IMPORTED:91:LINUX_PRODUCT:91"), linux.trim().slice(-180));
  const committed = imported.committed;
  check(checks, "imported computer becomes a new local durable generation", !!committed.head?.head || !!committed.manifest.generationId, committed.manifest.generationId);

  const durableHead = (await runtime.persistence.readHead(runtime.groupId))?.head;
  const originalSave = runtime.persistence.save.bind(runtime.persistence);
  runtime.persistence.save = async () => {
    const error = new Error("Injected fenced save failure");
    error.code = "WEB_MACHINE_HEAD_CONFLICT";
    throw error;
  };
  const activeImportAt = performance.now();
  let unsavedImportCode = "";
  try {
    await runtime.importImage(file, inspected.publicKey);
  } catch (error) {
    unsavedImportCode = error?.code || String(error);
  } finally {
    runtime.persistence.save = originalSave;
  }
  timings.activeImportUnsavedMs = Math.round(performance.now() - activeImportAt);
  const afterUnsavedImport = runtime.inspect();
  const headAfterUnsavedImport = (await runtime.persistence.readHead(runtime.groupId))?.head;
  check(checks, "active-context import save failure is explicit and leaves HEAD unchanged", unsavedImportCode === "WEB_MACHINE_HEAD_CONFLICT" && afterUnsavedImport.persistence.durabilityState === "unsaved" && headAfterUnsavedImport === durableHead, `${unsavedImportCode}/${afterUnsavedImport.persistence.durabilityState}/${headAfterUnsavedImport}`);
  check(checks, "unsaved imported context keeps both guests and device endpoints active", Object.values(afterUnsavedImport.machines).every((machine) => machine.state === "running") && afterUnsavedImport.devices.display.attached && afterUnsavedImport.devices.input.attached && afterUnsavedImport.devices.display.listenerErrors === 0, `${afterUnsavedImport.devices.display.attached}/${afterUnsavedImport.devices.input.attached}/${afterUnsavedImport.devices.display.listenerErrors}`);
  const [unsavedPython, unsavedLinux] = await Promise.all([
    runtime.runPython("from pathlib import Path\nf'{machineValue}:{Path(\"/home/web/product_value\").read_text()}'"),
    runtime.runLinux("echo UNSAVED:$machine_value:$(cat /mnt/web/product_value)"),
  ]);
  check(checks, "unsaved imported context remains usable without replay", unsavedPython === "91:PYTHON_PRODUCT:91" && unsavedLinux.includes("UNSAVED:91:LINUX_PRODUCT:91"), `${unsavedPython}/${unsavedLinux.trim().slice(-100)}`);
  const recoveredCommit = await runtime.save();
  check(checks, "manual retry durably saves active imported context", runtime.inspect().persistence.durabilityState === "clean" && recoveredCommit.manifest.generationId !== durableHead, recoveredCommit.manifest.generationId);
  await post("/gateReport", { ok: checks.every((entry) => entry.pass), checks, timings });
}

export async function runProductGate({ runtime, phase, startupMs }) {
  try {
    if (phase === "1") await initialPhase(runtime, startupMs);
    else if (phase === "restore") await restorePhase(runtime);
    else if (phase === "import") await importPhase(runtime);
    else throw new Error(`Unknown product gate phase: ${phase}`);
  } catch (error) {
    await reportFailure(error);
  }
}
