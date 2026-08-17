// runFirstSuccess.js - 공개 boot/open만 쓰는 첫 성공과 내구 재개방.
import {
  DURABLE_REOPEN_NAME,
  DURABLE_REOPEN_PYTHON,
  DURABLE_REOPEN_VALUE,
  FIRST_SUCCESS_OUTPUT,
  FIRST_SUCCESS_PYTHON,
} from "./firstSuccessContract.js";

export async function runFirstSuccess(boot) {
  if (typeof boot !== "function") throw new TypeError("runFirstSuccess requires boot");
  const machine = await boot();
  try {
    const run = machine?.run;
    const python = typeof run?.python === "function" ? run.python.bind(run) : run;
    if (typeof python !== "function") throw new TypeError("boot() must return a Machine with run.python");
    const receipt = await python(FIRST_SUCCESS_PYTHON);
    const installed = await python([
      "%pip install pyproc-native-host==1.0.0",
      "import pyproc_native_host",
      "print(pyproc_native_host.ABI_VERSION)",
    ].join("\n"));
    return Object.freeze({
      output: String(receipt?.output ?? "").trim(),
      expectedOutput: FIRST_SUCCESS_OUTPUT,
      receipt,
      packageOutput: String(installed?.output ?? "").trim(),
    });
  } finally {
    if (typeof machine?.close === "function") await machine.close();
  }
}

export async function runDurableReopen(boot, open) {
  if (typeof boot !== "function" || typeof open !== "function") {
    throw new TypeError("runDurableReopen requires boot and open");
  }
  const machine = await boot({ deterministic: true });
  let image;
  try {
    const python = typeof machine?.run?.python === "function" ? machine.run.python.bind(machine.run) : machine.run;
    if (typeof python !== "function") throw new TypeError("boot() must return a Machine with run.python");
    await python(DURABLE_REOPEN_PYTHON);
    image = await machine.history.export();
  } finally {
    if (typeof machine?.close === "function") await machine.close();
  }
  const restored = await open(image);
  try {
    if (typeof restored?.run?.get !== "function") throw new TypeError("open() must return a Machine with run.get");
    const value = await restored.run.get(DURABLE_REOPEN_NAME);
    return Object.freeze({ recorded: DURABLE_REOPEN_VALUE, restored: value });
  } finally {
    if (typeof restored?.close === "function") await restored.close();
  }
}

export async function runGuestPipReject(python, requirement = "numpy==2.5.1") {
  if (typeof python !== "function") throw new TypeError("runGuestPipReject requires run.python");
  let failure = "";
  try {
    await python(`%pip install ${requirement}`);
  } catch (error) {
    failure = `${error?.code || ""} ${error?.message || error}`.trim();
  }
  const afterward = await python("print(40 + 2)");
  return Object.freeze({
    failure,
    afterward: String(afterward?.output ?? "").trim(),
    receipt: afterward,
  });
}
