import { inspectUntrustedWebMachine, shortFingerprint } from "./imageTrust.js";
import { encodePs2KeyboardEvent } from "./ps2Keyboard.js";
import { WebComputerRuntime } from "./webComputerRuntime.js";

const element = (id) => document.getElementById(id);
const bootCurtain = element("bootCurtain");
const bootMessage = element("bootMessage");
const appShell = element("appShell");
const ownerState = element("ownerState");
const activityMessage = element("activityMessage");
const lastSaved = element("lastSaved");
const storageState = element("storageState");
const pythonState = element("pythonState");
const linuxState = element("linuxState");
const pythonMetric = element("pythonMetric");
const displayMetric = element("displayMetric");
const pythonCode = element("pythonCode");
const pythonOutput = element("pythonOutput");
const linuxDisplay = element("linuxDisplay");
const linuxCommand = element("linuxCommand");
const linuxOutput = element("linuxOutput");
const trustDialog = element("trustDialog");
const toast = element("toast");
const operationButtons = [...document.querySelectorAll("button")];
const params = new URLSearchParams(location.search);
const gatePhase = params.get("gate");
const pageStartedAt = performance.now();
let activeSystem = "python";
let pendingImport = null;
let toastTimer = null;
let busy = false;

function setActivity(message) {
  activityMessage.textContent = String(message || "Ready");
  if (!appShell.hidden) return;
  bootMessage.textContent = String(message || "Preparing your computer");
}

function notify(message) {
  clearTimeout(toastTimer);
  toast.textContent = String(message);
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3600);
}

function setBusy(value) {
  busy = value;
  for (const button of operationButtons) button.disabled = value;
}

function stateClass(target, state) {
  target.textContent = state || "offline";
  target.className = `machineState ${state || ""}`;
}

function renderState(snapshot) {
  const python = snapshot.machines.pythonOs;
  const linux = snapshot.machines.linuxOs;
  stateClass(pythonState, python?.state || "offline");
  stateClass(linuxState, linux?.state || "offline");
  const heapBytes = Number(python?.guest?.heapBytes || 0);
  pythonMetric.textContent = heapBytes ? `${(heapBytes / 1024 / 1024).toFixed(1)} MB live memory` : "Runtime not active";
  const display = snapshot.devices.display;
  displayMetric.textContent = display?.columns ? `${display.columns} × ${display.rows}` : "Waiting for VGA";
  const owned = snapshot.owner?.state === "owned";
  ownerState.className = `ownerState ${owned ? "ready" : ""}`;
  ownerState.lastElementChild.textContent = owned ? "This tab owns the computer" : snapshot.owner?.state || "Connecting";
  if (snapshot.persistence?.durabilityState === "unsaved") storageState.textContent = "Unsaved";
}

function renderDisplay({ frame, text }) {
  linuxDisplay.textContent = text || "Linux display is active.";
  linuxDisplay.scrollTop = linuxDisplay.scrollHeight;
  displayMetric.textContent = `${frame.columns} × ${frame.rows}`;
}

function renderConsole(line) {
  if (!String(line).startsWith("x86:") && !String(line).startsWith("pyproc:")) return;
  activityMessage.textContent = String(line);
}

function resultText(value) {
  if (value === undefined) return "None";
  if (value === null) return "None";
  if (typeof value === "string") return value;
  if (["number", "boolean", "bigint"].includes(typeof value)) return String(value);
  try { return JSON.stringify(value, null, 2); } catch (error) { return String(value); }
}

function operationErrorMessage(error) {
  if (error?.code === "WEB_MACHINE_OPERATION_TIMEOUT") return "The operation timed out before it could finish.";
  if (error?.code === "WEB_MACHINE_OPERATION_ABORTED") return "The operation was canceled.";
  if (error?.code === "WEB_MACHINE_OUTCOME_UNKNOWN") return "The operation stopped after it started. Its outcome is unknown and it was not retried.";
  if (error?.code === "WEB_MACHINE_SCHEMA_UPGRADE_BLOCKED") return "Close other Web Computer tabs, then try again to finish the storage upgrade.";
  if (error?.code === "WEB_MACHINE_OWNER_STALE") return "This tab no longer owns the computer. No changes were saved.";
  if (error?.code === "WEB_MACHINE_HEAD_CONFLICT") return "The saved computer changed in another context. This operation was not committed.";
  if (error?.code === "WEB_MACHINE_INVALID_STATE") return "That action is not available in the machine's current state.";
  if (String(error?.code || "").startsWith("WEB_MACHINE_IMAGE_")) return `The portable image could not be accepted (${error.code}).`;
  if (error?.code) return `The Web Computer operation failed (${error.code}).`;
  return error?.message || String(error);
}

function observeReportedOperation(operation) {
  operation.catch((error) => console.error("Web Computer UI operation failed", error));
}

async function runOperation(label, operation, { autosave = false } = {}) {
  if (busy) return undefined;
  setBusy(true);
  setActivity(label);
  try {
    const result = await operation();
    if (autosave) {
      setActivity("Saving both operating systems");
      const committed = await runtime.save();
      markSaved(committed.manifest.createdAt);
    }
    setActivity("Ready");
    return result;
  } catch (error) {
    ownerState.classList.add("error");
    setActivity("Action failed");
    notify(operationErrorMessage(error));
    throw error;
  } finally {
    setBusy(false);
  }
}

function markSaved(createdAt = Date.now()) {
  const date = new Date(createdAt);
  lastSaved.textContent = `Saved ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  storageState.textContent = "Durable";
}

function selectSystem(system) {
  activeSystem = system;
  for (const button of document.querySelectorAll("[data-machine-tab]")) button.classList.toggle("active", button.dataset.machineTab === system);
  for (const panel of document.querySelectorAll("[data-system-panel]")) {
    const selected = panel.dataset.systemPanel === system;
    panel.hidden = !selected;
    panel.classList.toggle("active", selected);
  }
  element("surfaceEyebrow").textContent = system === "python" ? "PYTHON OS" : "LINUX GUEST";
  element("surfaceTitle").textContent = system === "python" ? "A persistent Python computer" : "A real Linux machine in this tab";
  if (system === "linux") setTimeout(() => linuxDisplay.focus(), 0);
}

async function saveComputer() {
  const committed = await runOperation("Saving both operating systems", () => runtime.save());
  if (committed) {
    markSaved(committed.manifest.createdAt);
    notify("The complete computer is saved locally.");
  }
}

async function exportComputer() {
  const result = await runOperation("Signing the portable computer image", () => runtime.exportImage());
  if (!result) return;
  const url = URL.createObjectURL(result.file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `web-computer-${new Date().toISOString().replaceAll(":", "-")}.webmachine`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  notify(`Exported ${(result.file.size / 1024 / 1024).toFixed(1)} MB signed image.`);
}

async function stageImport(file) {
  const inspection = await inspectUntrustedWebMachine(file);
  pendingImport = { file, inspection };
  element("trustSigner").textContent = shortFingerprint(inspection.fingerprint);
  element("trustMachines").textContent = inspection.machines.join(", ") || "None";
  element("trustDevices").textContent = inspection.devices.join(", ") || "None";
  element("trustSize").textContent = `${(inspection.byteLength / 1024 / 1024).toFixed(1)} MB`;
  trustDialog.showModal();
}

async function importComputer() {
  if (!pendingImport) return;
  const { file, inspection } = pendingImport;
  pendingImport = null;
  trustDialog.close();
  const imported = await runOperation("Importing the trusted computer", () => runtime.importImage(file, inspection.publicKey));
  if (!imported) return;
  markSaved(imported.committed.manifest.createdAt);
  notify(`Imported computer signed by ${shortFingerprint(inspection.fingerprint)}.`);
}

function activeMachineId() {
  return activeSystem === "python" ? "pythonOs" : "linuxOs";
}

const runtime = new WebComputerRuntime({
  onActivity: setActivity,
  onConsole: renderConsole,
  onDisplay: renderDisplay,
  onState: renderState,
});

for (const button of document.querySelectorAll("[data-machine-tab]")) {
  button.addEventListener("click", () => selectSystem(button.dataset.machineTab));
}

element("runPythonButton").addEventListener("click", () => {
  observeReportedOperation((async () => {
    const result = await runOperation("Running code in Python OS", () => runtime.runPython(pythonCode.value), { autosave: true });
    if (result !== undefined) pythonOutput.textContent = resultText(result);
  })());
});

pythonCode.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    element("runPythonButton").click();
  }
});

element("linuxForm").addEventListener("submit", (event) => {
  event.preventDefault();
  observeReportedOperation((async () => {
    const result = await runOperation("Running command in Linux", () => runtime.runLinux(linuxCommand.value), { autosave: true });
    if (result !== undefined) linuxOutput.textContent = String(result).trim();
    linuxCommand.select();
  })());
});

for (const type of ["keydown", "keyup"]) {
  linuxDisplay.addEventListener(type, async (event) => {
    const codes = encodePs2KeyboardEvent(event);
    if (!codes || event.repeat) return;
    event.preventDefault();
    try { await runtime.sendLinuxScanCodes(codes); } catch (error) { notify(operationErrorMessage(error)); }
  });
}

element("pauseButton").addEventListener("click", () => observeReportedOperation(runOperation("Pausing machine", () => runtime.pauseMachine(activeMachineId()))));
element("resumeButton").addEventListener("click", () => observeReportedOperation(runOperation("Starting machine", () => runtime.resumeMachine(activeMachineId()))));
element("shutdownButton").addEventListener("click", () => observeReportedOperation(runOperation("Shutting down machine", () => runtime.shutdownMachine(activeMachineId()))));
element("saveButton").addEventListener("click", () => observeReportedOperation(saveComputer()));
element("exportButton").addEventListener("click", () => observeReportedOperation(exportComputer()));
element("importButton").addEventListener("click", () => element("importFile").click());
element("importFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try { await stageImport(file); } catch (error) { notify(operationErrorMessage(error)); }
});
element("trustImportButton").addEventListener("click", (event) => {
  event.preventDefault();
  observeReportedOperation(importComputer());
});

window.addEventListener("pagehide", () => { runtime.dispose().catch(() => undefined); }, { once: true });

try {
  await runtime.initialize({ deferBoot: gatePhase === "import", indexURL: params.get("indexURL") || undefined });
  bootCurtain.hidden = true;
  appShell.hidden = false;
  renderState(runtime.inspect());
  selectSystem("python");
  if (runtime.startupMode === "restored") markSaved();
  if (gatePhase) {
    const { runProductGate } = await import("./gate.js");
    await runProductGate({ runtime, phase: gatePhase, startupMs: Math.round(performance.now() - pageStartedAt) });
  }
} catch (error) {
  bootMessage.textContent = `Web Computer could not start: ${operationErrorMessage(error)}`;
  ownerState.classList.add("error");
  if (gatePhase) {
    fetch("/gateReport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: false, checks: [{ name: "Web Computer startup", pass: false, info: String(error?.stack || error).slice(-1600) }] }),
    }).catch(() => undefined);
  }
}
