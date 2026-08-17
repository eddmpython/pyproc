// 공개 설치 문이 IPython %pip와 CPython python -m pip인지 고정한다.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PyProcError } from "../../src/runtime/errors.js";
import { PYTHON_USER_VOCABULARY } from "../../src/capabilities/packageCommands.js";
import {
  applyGuestPipSource,
  extractLiteralPipInstalls,
  installFromGuestRequest,
  parseGuestPackageInstall,
  parsePackageCommandLine,
} from "../../src/machine/composition/guestPackageInstall.js";
import { KernelTerminal } from "../../src/capabilities/kernelTerminal.js";
import { runGuestPipReject } from "../../examples/runFirstSuccess.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function assertGuestPipContract() {
  assert(PYTHON_USER_VOCABULARY.runSource === "python -c"
    && PYTHON_USER_VOCABULARY.install[0] === "%pip install"
    && PYTHON_USER_VOCABULARY.install[1] === "python -m pip install"
    && PYTHON_USER_VOCABULARY.importModule === "import"
    && PYTHON_USER_VOCABULARY.subprocessInstall === "unsupported"
    && PYTHON_USER_VOCABULARY.nativeWheel === "unsupported",
    "Python user vocabulary drifted from CPython/IPython commands");
  assert(parsePackageCommandLine("%pip install demo==1.0.0") === "demo==1.0.0"
    && parsePackageCommandLine("python -m pip install demo==1.0.0") === "demo==1.0.0"
    && parsePackageCommandLine("-m pip install demo==1.0.0") === "demo==1.0.0"
    && parsePackageCommandLine("import demo") === null,
    "package command lines are not %pip / python -m pip");

  const parsed = parseGuestPackageInstall({ requirements: [" demo==1.0.0 "], extend: true });
  assert(parsed.requirements[0] === "demo==1.0.0" && parsed.extend === true,
    "guest pip parser did not normalize a Python requirement");

  const extracted = extractLiteralPipInstalls([
    "%pip install demo==1.0.0",
    "import demo",
  ].join("\n"));
  assert(extracted.join(",") === "demo==1.0.0", "%pip install was not extracted from source");
  assert(extractLiteralPipInstalls("python -m pip install helper==2.0.0").join(",") === "helper==2.0.0",
    "python -m pip install was not extracted from source");

  const calls = [];
  const environment = {
    install: async (requestValue) => {
      calls.push(requestValue);
      if (requestValue.requirements[0].startsWith("numpy")) {
        throw new PyProcError("PYPROC_PACKAGE_RESOLUTION", "numpy==2.5.1 is not in the catalog");
      }
      return { protocol: "pyproc.package-environment", version: 2, environmentId: "sha256:fixture",
        engineId: "engine:test", nativeProfile: "core" };
    },
    inspect: () => ({ environmentId: "sha256:fixture" }),
  };
  const installed = await installFromGuestRequest(environment, { requirements: ["demo==1.0.0"] });
  assert(installed.environmentId === "sha256:fixture" && calls[0].requirements[0] === "demo==1.0.0",
    "package command did not reach PackageEnvironment.install");

  const rewritten = await applyGuestPipSource(environment,
    "%pip install demo==1.0.0\nimport demo\n");
  assert(rewritten.includes("import demo") && !rewritten.includes("%pip"),
    "%pip line was not stripped after install");
  const moduleRewritten = await applyGuestPipSource(environment,
    "python -m pip install demo==1.0.0\nimport demo\n");
  assert(moduleRewritten.includes("import demo") && !moduleRewritten.includes("-m pip"),
    "python -m pip line was not stripped after install");

  let rejected = null;
  try { await applyGuestPipSource(environment, "%pip install numpy==2.5.1"); }
  catch (error) { rejected = error; }
  assert(rejected?.code === "PYPROC_PACKAGE_RESOLUTION",
    "unsupported package rejection did not stay a package error");

  const pythonCalls = [];
  const rejectProbe = await runGuestPipReject(async (code) => {
    pythonCalls.push(code);
    if (code.includes("%pip install") || code.includes("-m pip install")) {
      throw new PyProcError("PYPROC_PACKAGE_RESOLUTION", "numpy==2.5.1 is not in the catalog");
    }
    return { output: "42\n" };
  });
  assert(pythonCalls.some((code) => code.includes("%pip install")),
    "reject probe did not use %pip install");
  assert(rejectProbe.failure.includes("PYPROC_PACKAGE_RESOLUTION") && rejectProbe.afterward === "42",
    "reject probe did not keep later Python execution");

  const english = readFileSync(join(ROOT, "README.md"), "utf8");
  const korean = readFileSync(join(ROOT, "README.ko.md"), "utf8");
  for (const [name, text] of [["README.md", english], ["README.ko.md", korean]]) {
    assert(text.includes("%pip install") && text.includes("python -m pip install"),
      `${name} does not teach %pip / python -m pip`);
    assert(!text.includes("pip.install("), `${name} still teaches a custom pip.install API`);
    assert(text.includes("subprocess") && text.includes("native"),
      `${name} does not name the subprocess and native-wheel limits`);
  }

  const factory = readFileSync(join(ROOT, "src", "composition", "kernelFactory.js"), "utf8");
  assert(factory.includes("%pip install") && factory.includes("python -m pip install"),
    "guest pip fallback does not point at %pip / python -m pip");
  const machine = readFileSync(join(ROOT, "src", "machine", "composition", "kernelMachine.js"), "utf8");
  assert(machine.includes("attachDefaultPackages") && machine.includes("applyGuestPipSource"),
    "default Machine does not attach package commands");
  const runner = readFileSync(join(ROOT, "examples", "runFirstSuccess.js"), "utf8");
  assert(runner.includes("%pip install pyproc-native-host==1.0.0"),
    "first-success runner does not call %pip install");

  const kernel = {
    execute: async () => ({ state: "completed" }),
    setValue: async () => {},
    getValue: async () => ({ value: null }),
    checkpoint: async () => ({ checkpointRef: "cp:1" }),
  };
  const terminal = new KernelTerminal(kernel, { packageEnvironment: environment });
  await terminal.install();
  const magic = await terminal.push("%pip install demo==1.0.0");
  const modulePip = await terminal.push("python -m pip install demo==1.0.0");
  assert(magic.out.includes("environment: sha256:fixture")
    && modulePip.out.includes("environment: sha256:fixture"),
    "terminal does not accept %pip and python -m pip");
}
