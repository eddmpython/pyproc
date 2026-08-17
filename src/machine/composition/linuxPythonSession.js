// linuxPythonSession.js - Layer 5/composition: linuxOs 위의 네이티브 CPython 문.
// 기본 boot() WASI 커널을 대체하지 않는다. V86 Linux guest가 있을 때만 serial로 python3를 친다.
import { WebMachineError } from "../contracts/webMachineError.js";

export const LINUX_PYTHON_PROTOCOL = "pyproc.linux-python";
export const LINUX_PYTHON_RECEIPT_PROTOCOL = "pyproc.linux-python-receipt";
export const LINUX_PYTHON_VERSION = 1;

function quoteSingle(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function resolveHandle(getMachine) {
  const handle = getMachine();
  return handle && typeof handle.request === "function" ? handle : null;
}

function readHandle(getMachine) {
  const handle = resolveHandle(getMachine);
  if (!handle) {
    throw new WebMachineError("WEB_MACHINE_UNAVAILABLE",
      "linuxOs is not configured. Pass createWebComputer({ linux }) for native Linux CPython.");
  }
  return handle;
}

export function createLinuxPythonSession(options = {}) {
  const getMachine = typeof options.machine === "function" ? options.machine : () => options.machine || null;
  const python = typeof options.python === "string" && options.python ? options.python : "python3";
  const prompt = typeof options.prompt === "string" && options.prompt ? options.prompt : null;

  async function send(command, requestOptions = {}) {
    const handle = readHandle(getMachine);
    const data = String(command).endsWith("\n") ? String(command) : `${command}\n`;
    const waitFor = requestOptions.waitFor || prompt;
    const serial = await handle.request({
      type: "serial",
      data,
      ...(waitFor ? { waitFor } : {}),
      timeoutMs: requestOptions.timeoutMs || 30000,
    }, requestOptions.control);
    return String(serial ?? "");
  }

  return Object.freeze({
    get available() { return Boolean(resolveHandle(getMachine)); },
    inspect() {
      const handle = resolveHandle(getMachine);
      return Object.freeze({
        protocol: LINUX_PYTHON_PROTOCOL,
        version: LINUX_PYTHON_VERSION,
        available: Boolean(handle),
        machineId: handle?.machineId || null,
        adapterId: handle?.adapterId || null,
        python,
        prompt,
        nativeAbi: "linux-elf",
        replacesDefaultBoot: false,
      });
    },
    async run(source, requestOptions = {}) {
      if (typeof source !== "string" || !source) {
        throw new TypeError("linuxPython.run requires Python source");
      }
      const stdout = await send(`${python} -c ${quoteSingle(source)}`, requestOptions);
      return Object.freeze({
        protocol: LINUX_PYTHON_RECEIPT_PROTOCOL,
        version: LINUX_PYTHON_VERSION,
        kind: "run",
        python,
        argv: Object.freeze([python, "-c", source]),
        stdout,
        native: true,
      });
    },
    async pip(args, requestOptions = {}) {
      if (!Array.isArray(args) || !args.length || args.some((item) => typeof item !== "string" || !item)) {
        throw new TypeError("linuxPython.pip requires a nonempty argv of strings");
      }
      const stdout = await send([python, "-m", "pip", ...args.map(quoteSingle)].join(" "), requestOptions);
      return Object.freeze({
        protocol: LINUX_PYTHON_RECEIPT_PROTOCOL,
        version: LINUX_PYTHON_VERSION,
        kind: "pip",
        python,
        argv: Object.freeze([python, "-m", "pip", ...args]),
        stdout,
        native: true,
      });
    },
  });
}
