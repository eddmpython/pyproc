// 기본 WASI boot와 linuxOs 네이티브 CPython 문이 섞이지 않는지 고정한다.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { PYTHON_RUNTIME, PROFILES, pythonOracleProgram } from "../../scripts/buildroot/buildrootProfiles.js";
import {
  createLinuxPythonSession,
  createWebComputer,
  LINUX_PYTHON_PROTOCOL,
  LINUX_PYTHON_RECEIPT_PROTOCOL,
  LINUX_PYTHON_VERSION,
  WebMachineError,
} from "../../src/machine/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function errorOf(operation) {
  try { await operation(); return null; } catch (error) { return error; }
}

function mockLinuxHandle(request) {
  return {
    machineId: "linuxOs",
    adapterId: "x86-linux",
    boot() {},
    request,
    inspectNow() {
      return Object.freeze({ machineId: "linuxOs", adapterId: "x86-linux", state: "created" });
    },
  };
}

export async function assertLinuxPythonContract() {
  const rootApi = await import(pathToFileURL(join(ROOT, "index.js")).href);
  assert(!("createLinuxPythonSession" in rootApi)
    && !("LINUX_PYTHON_PROTOCOL" in rootApi),
  "native Linux CPython plumbing leaked onto the pyproc root");
  assert(typeof rootApi.createWebComputer === "function"
    && typeof rootApi.boot === "function",
  "default WASI doors left the pyproc root");

  assert(LINUX_PYTHON_PROTOCOL === "pyproc.linux-python"
    && LINUX_PYTHON_RECEIPT_PROTOCOL === "pyproc.linux-python-receipt"
    && LINUX_PYTHON_VERSION === 1,
  "linux Python protocol identity drifted");

  const computer = createWebComputer();
  assert([...computer.machines.keys()].join(",") === "pythonOs",
    "default createWebComputer must boot only pythonOs");
  assert(computer.linuxPython.available === false
    && computer.inspect().linuxPython.available === false
    && computer.inspect().linuxPython.replacesDefaultBoot === false
    && computer.inspect().linuxPython.protocol === LINUX_PYTHON_PROTOCOL,
  "default computer advertised native Linux CPython");
  const missing = await errorOf(() => computer.linuxPython.run("print(1)"));
  assert(missing instanceof WebMachineError && missing.code === "WEB_MACHINE_UNAVAILABLE",
    `missing linuxOs must fail closed: ${missing?.code || missing}`);

  const linuxComputer = createWebComputer({
    linux: { V86() {}, manifest: { v86: { options: {}, shellPrompt: "# " } } },
  });
  assert(linuxComputer.machines.has("pythonOs") && linuxComputer.machines.has("linuxOs"),
    "linux option must add linuxOs beside pythonOs");
  assert(linuxComputer.linuxPython.available
    && linuxComputer.linuxPython.inspect().machineId === "linuxOs"
    && linuxComputer.linuxPython.inspect().adapterId === "x86-linux"
    && linuxComputer.linuxPython.inspect().python === "python3"
    && linuxComputer.linuxPython.inspect().prompt === "# "
    && linuxComputer.linuxPython.inspect().nativeAbi === "linux-elf"
    && linuxComputer.linuxPython.inspect().replacesDefaultBoot === false,
  "configured linuxOs did not expose the native Python door");

  const serial = [];
  const bound = createLinuxPythonSession({
    machine: mockLinuxHandle(async (message) => {
      serial.push(message);
      return "ok\n# ";
    }),
    prompt: "# ",
  });
  assert(bound.available && bound.inspect().replacesDefaultBoot === false,
    "session over a linux handle was unavailable");
  const ran = await bound.run("print('x')");
  assert(ran.protocol === LINUX_PYTHON_RECEIPT_PROTOCOL && ran.kind === "run"
    && ran.native === true && ran.python === "python3"
    && ran.argv.join("\0") === "python3\0-c\0print('x')"
    && ran.stdout === "ok\n# ",
  "native run receipt drifted");
  assert(serial[0].type === "serial"
    && serial[0].data === "python3 -c 'print('\\''x'\\'')'\n"
    && serial[0].waitFor === "# ",
  `native run did not send python3 -c: ${JSON.stringify(serial[0])}`);
  const installed = await bound.pip(["install", "demo==1.0.0"]);
  assert(installed.kind === "pip" && installed.native === true
    && installed.argv.join("\0") === "python3\0-m\0pip\0install\0demo==1.0.0"
    && serial[1].data === "python3 -m pip 'install' 'demo==1.0.0'\n",
  `native pip did not send python -m pip: ${JSON.stringify(serial[1])}`);

  const emptyRun = await errorOf(() => bound.run(""));
  const emptyPip = await errorOf(() => bound.pip([]));
  assert(emptyRun instanceof TypeError && emptyPip instanceof TypeError,
    "empty native Python requests must be TypeError");

  const adopted = createWebComputer();
  adopted.adoptMachines(new Map([
    ["pythonOs", adopted.machine("pythonOs")],
    ["linuxOs", mockLinuxHandle(async (message) => {
      serial.push(message);
      return "adopted\n# ";
    })],
  ]));
  assert(adopted.linuxPython.available && adopted.inspect().linuxPython.available,
    "adopted linuxOs did not open the native Python door");
  const adoptedRun = await adopted.linuxPython.run("print(2)");
  assert(adoptedRun.stdout === "adopted\n# " && serial.at(-1).data === "python3 -c 'print(2)'\n",
    "adopted linuxOs did not receive native python3");
  adopted.adoptMachines(new Map([["pythonOs", adopted.machine("pythonOs")]]));
  assert(adopted.linuxPython.available === false, "removing linuxOs left the native door open");

  const unavailable = createLinuxPythonSession();
  const closed = await errorOf(() => unavailable.pip(["install", "demo==1.0.0"]));
  assert(unavailable.available === false && closed instanceof WebMachineError
    && closed.code === "WEB_MACHINE_UNAVAILABLE",
  "unbound session did not fail closed");

  assert(PROFILES.python.recipe === "pyproc-buildroot-python-i686-v1"
    && PROFILES.python.outputName === "buildroot-pyproc-python-i686.bin"
    && PROFILES.python.outputName !== PROFILES.linux.outputName
    && PYTHON_RUNTIME.version === "3.12.13"
    && PYTHON_RUNTIME.revision === "3bb231a6a5dc02b95658877318bf61501a7209e9"
    && PYTHON_RUNTIME.sourceSha256 === "c08bc65a81971c1dd5783182826503369466c7e67374d1646519adf05207b684"
    && PYTHON_RUNTIME.pipVersion === "25.2"
    && PYTHON_RUNTIME.oracle.sha256 === createHash("sha256").update(PYTHON_RUNTIME.oracle.source).digest("hex"),
  "python Buildroot profile identity drifted from CPython 3.12.13");
  const hostPython = spawnSync("python", ["-c", pythonOracleProgram(PYTHON_RUNTIME.oracle.source)], {
    encoding: "utf8",
  });
  assert(hostPython.status === 0, `host python could not run the shipped oracle program: ${hostPython.stderr}`);
  const hostOracle = JSON.parse(hostPython.stdout);
  assert(hostOracle.sha256 === PYTHON_RUNTIME.oracle.sha256,
    `shipped python oracle program drifted: ${hostPython.stdout}`);
  const fragment = readFileSync(join(ROOT, "scripts", "buildroot", "python.fragment"), "utf8");
  assert(fragment.includes("BR2_PACKAGE_PYTHON3=y")
    && fragment.includes("BR2_PACKAGE_PYTHON_PIP=y")
    && fragment.includes("BR2_PACKAGE_PYTHON3_SSL=y"),
  "python fragment does not enable CPython and pip");
  const computerSource = readFileSync(join(ROOT, "src", "machine", "composition", "createWebComputer.js"), "utf8");
  assert(computerSource.includes("createLinuxPythonSession")
    && computerSource.includes("linuxPython"),
  "createWebComputer no longer attaches the shipped linuxPython session");
  const product = readFileSync(join(ROOT, "tests", "support", "linuxPythonProduct.mjs"), "utf8");
  assert(product.includes("computer.linuxPython.run(\"print(40 + 2)\")")
    && product.includes("computer.linuxPython.pip([\"--version\"])")
    && product.includes("createWebComputer")
    && !product.includes("machine.request({type:\"serial\""),
  "product gate does not drive the shipped linuxPython door");
}
