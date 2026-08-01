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
  timings.initialCommitBytes = committed.entries.filter((entry) => entry.id.startsWith("machine/")).reduce((total, entry) => total + entry.byteLength, 0);
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

  // 통합 상태 커널의 시간여행이 제품 표면에서 실동작하는가: checkpoint -> 변이 -> undo -> 복귀.
  const depthBefore = await runtime.pythonHistoryDepth();
  const checkpoint = await runtime.checkpointPython();
  await runtime.runPython("machineValue = 777");
  const afterMutation = await runtime.runPython("machineValue");
  const undone = await runtime.undoPython(checkpoint.index);
  const afterUndo = await runtime.runPython("machineValue");
  const depthAfter = await runtime.pythonHistoryDepth();
  check(checks, "product checkpoint returns a tree index", Number.isInteger(checkpoint.index) && depthAfter.depth > depthBefore.depth, `#${checkpoint.index}, depth ${depthBefore.depth}->${depthAfter.depth}`);
  check(checks, "Python time-travel undo restores pre-mutation state (server-free)", afterMutation === 777 && undone.index === checkpoint.index && afterUndo === 91, `${afterMutation}->${afterUndo}`);
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
  const before = await runtime.store.readHead(runtime.groupId);
  check(checks, "fresh profile has no source generation", !before?.head, before?.head || "empty");
  const response = await fetch("/gateArtifact");
  if (!response.ok) throw new Error(`Artifact download failed: ${response.status}`);
  const file = await response.blob();
  const inspected = await inspectUntrustedWebMachine(file);
  check(checks, "trust screen sees two machines before execution", inspected.machines.join(",") === "linuxOs,pythonOs" || inspected.machines.join(",") === "pythonOs,linuxOs", inspected.machines.join(","));
  check(checks, "portable image includes both block devices", inspected.devices.length === 2, inspected.devices.join(","));
  const startedAt = performance.now();
  const imported = await runtime.importImage(file, inspected.publicKey, inspected.permissions);
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
  check(checks, "imported computer becomes a new local durable generation", !!committed.head?.head || !!committed.commitAddress, committed.commitAddress);

  const durableHead = (await runtime.store.readHead(runtime.groupId))?.head;
  await runtime.runPython("machineValue = 404");
  await runtime.runLinux("machine_value=404; echo ACTIVE:$machine_value");
  const originalCommitGeneration = runtime.store.commitGeneration.bind(runtime.store);
  runtime.store.commitGeneration = async () => {
    const error = new Error("Injected fenced save failure");
    error.code = "WEB_MACHINE_HEAD_CONFLICT";
    throw error;
  };
  const activeImportAt = performance.now();
  let unsavedImportCode = "";
  try {
    await runtime.importImage(file, inspected.publicKey, inspected.permissions);
  } catch (error) {
    unsavedImportCode = error?.code || String(error);
  } finally {
    runtime.store.commitGeneration = originalCommitGeneration;
  }
  timings.rejectedImportMs = Math.round(performance.now() - activeImportAt);
  const afterUnsavedImport = runtime.inspect();
  const headAfterRejectedImport = (await runtime.store.readHead(runtime.groupId))?.head;
  check(checks, "active-context import commit failure is explicit and leaves HEAD unchanged", unsavedImportCode === "WEB_MACHINE_HEAD_CONFLICT" && headAfterRejectedImport === durableHead, `${unsavedImportCode}/${headAfterRejectedImport}`);
  check(checks, "rejected import keeps the previous guests and device endpoints active", Object.values(afterUnsavedImport.machines).every((machine) => machine.state === "running") && afterUnsavedImport.devices.display.attached && afterUnsavedImport.devices.input.attached && afterUnsavedImport.devices.display.listenerErrors === 0, `${afterUnsavedImport.devices.display.attached}/${afterUnsavedImport.devices.input.attached}/${afterUnsavedImport.devices.display.listenerErrors}`);
  const [activePython, activeLinux] = await Promise.all([
    runtime.runPython("from pathlib import Path\nf'{machineValue}:{Path(\"/home/web/product_value\").read_text()}'"),
    runtime.runLinux("echo ACTIVE:$machine_value:$(cat /mnt/web/product_value)"),
  ]);
  check(checks, "rejected import preserves the previous active values without replay", activePython === "404:PYTHON_PRODUCT:91" && activeLinux.includes("ACTIVE:404:LINUX_PRODUCT:91"), `${activePython}/${activeLinux.trim().slice(-100)}`);
  const recoveredCommit = await runtime.save();
  check(checks, "manual save durably commits the preserved active context", runtime.inspect().persistence.durabilityState === "clean" && recoveredCommit.commitAddress !== durableHead, recoveredCommit.commitAddress);
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
