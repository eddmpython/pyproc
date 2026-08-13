import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const requiredFiles = [
  "pythonSdk/pyproject.toml",
  "pythonSdk/buildRequirements.txt",
  "pythonSdk/LICENSE.txt",
  "pythonSdk/src/pyprocControl/__init__.py",
  "pythonSdk/src/pyprocControl/client.py",
  "pythonSdk/src/pyprocControl/models.py",
  "pythonSdk/src/pyprocControl/perception.py",
  "pythonSdk/src/pyprocControl/protocol.py",
  "pythonSdk/src/pyprocControl/py.typed",
  "tests/pythonSdk/protocolContract.py",
  "tests/pythonSdk/productJourney.py",
  "tests/pythonSdk/appSpaceList.py",
  "tests/pythonSdk/replayGraphList.py",
  "tests/pythonSdk/motorList.py",
  "tests/pythonSdk/run.mjs",
];

export async function assertPythonSdkContract() {
  for (const file of requiredFiles) {
    if (!existsSync(join(ROOT, file))) throw new Error(`Python SDK 계약 파일 누락: ${file}`);
  }
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const project = readFileSync(join(ROOT, "pythonSdk", "pyproject.toml"), "utf8");
  const version = /^version = "([^"]+)"$/m.exec(project)?.[1];
  if (version !== pkg.version) throw new Error(`Python SDK와 npm 버전 불일치: ${version} != ${pkg.version}`);
  if (!/^dependencies = \[\]$/m.test(project)) throw new Error("Python SDK runtime dependency 0 계약 누락");
  if (!/^requires = \["setuptools==\d+\.\d+\.\d+"\]$/m.test(project)) {
    throw new Error("Python SDK build backend exact pin 누락");
  }
  const source = readFileSync(join(ROOT, "pythonSdk", "src", "pyprocControl", "__init__.py"), "utf8");
  for (const name of ["PyProcClient", "ControlRequest", "ControlResult", "ControlError", "Attachment",
    "PerceptionClient", "PerceptionEntity", "PerceptionQueryResult"]) {
    if (!source.includes(`"${name}"`)) throw new Error(`Python SDK 공개 값 누락: ${name}`);
  }
  if (pkg.scripts?.["test:python-sdk"] !== "node tests/pythonSdk/run.mjs") {
    throw new Error("Python SDK 제품 게이트 npm script 누락");
  }
  const workflow = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  if ((workflow.match(/npm run test:python-sdk/g) || []).length !== 2) {
    throw new Error("Python SDK Chrome/Edge CI 배선 불일치");
  }
  const clientSource = readFileSync(join(ROOT, "pythonSdk", "src", "pyprocControl", "client.py"), "utf8");
  for (const method of ["attachApp", "checkpointApp", "branchApp", "restoreApp", "adoptApp",
    "inspectApp", "listAppPairs", "stageAppEffect", "finalizeAppEffect"]) {
    if (!clientSource.includes(`def ${method}(`)) throw new Error(`Python AppSpace facade 누락: ${method}`);
  }
  for (const method of ["importReplayGraphRecording", "createReplayGraphAppWorld",
    "captureReplayGraphAppBranch", "openReplayWorld", "inspectReplayWorld", "listReplayWorldEdges",
    "traverseReplayWorld", "checkpointReplayWorld", "restoreReplayWorld", "evaluateReplayWorld",
    "inspectReplayWorldCoverage", "listReplayGraphs"]) {
    if (!clientSource.includes(`def ${method}(`)) throw new Error(`Python ReplayGraph facade 누락: ${method}`);
  }
  for (const method of ["executeMotor", "inspectMotor", "listMotorRecords", "replayMotor",
    "evaluateMotorPolicy", "promoteMotorPolicy", "rollbackMotorPolicy"]) {
    if (!clientSource.includes(`def ${method}(`)) throw new Error(`Python Motor facade 누락: ${method}`);
  }
  return true;
}
