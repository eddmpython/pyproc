// guestPackageInstall.js - Layer 5: IPython %pip와 CPython `python -m pip`를 PackageEnvironment로 옮긴다.
// 같은 커널 hostcall 안에서는 installEnvironment가 재진입되지 않으므로, 실행 전에 JS가 설치한다.
import { PyProcError } from "../../runtime/errors.js";
import { parsePackageCommandLine } from "../../capabilities/packageCommands.js";

export { PYTHON_USER_VOCABULARY, parsePackageCommandLine } from "../../capabilities/packageCommands.js";

const LITERAL_INSTALL = /pip\.install\(\s*(["'])([^"'\\\n]+)\1\s*\)/gu;

export function parseGuestPackageInstall(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "pip install request must be an object");
  }
  if (!Array.isArray(value.requirements) || !value.requirements.length
    || value.requirements.length > 32
    || value.requirements.some((item) => typeof item !== "string" || !item.trim() || item.includes("\0"))) {
    throw new PyProcError("PYPROC_INPUT_INVALID",
      "pip install requires 1 to 32 nonempty NUL-free requirement strings");
  }
  return Object.freeze({
    requirements: Object.freeze(value.requirements.map((item) => item.trim())),
    extend: value.extend === true,
  });
}

export function extractLiteralPipInstalls(code) {
  if (typeof code !== "string" || !code) return Object.freeze([]);
  const requirements = [];
  for (const line of code.split(/\r?\n/u)) {
    const command = parsePackageCommandLine(line);
    if (command) requirements.push(command);
  }
  for (const match of code.matchAll(LITERAL_INSTALL)) requirements.push(match[2].trim());
  return Object.freeze([...new Set(requirements.filter(Boolean))]);
}

export function guestPipReceipt(receipt) {
  return Object.freeze({
    protocol: receipt?.protocol || "pyproc.package-environment",
    version: receipt?.version || 2,
    environmentId: receipt?.environmentId || null,
    engineId: receipt?.engineId || null,
    nativeProfile: receipt?.nativeProfile || null,
  });
}

export function replaceLiteralPipInstalls(code, receiptByRequirement) {
  if (typeof code !== "string") return code;
  return code.replace(LITERAL_INSTALL, (_all, _quote, requirement) => {
    const receipt = receiptByRequirement.get(requirement.trim());
    return receipt ? JSON.stringify(receipt) : _all;
  });
}

export function stripPackageCommandLines(code) {
  if (typeof code !== "string") return code;
  const kept = code.split(/\r?\n/u).filter((line) => parsePackageCommandLine(line) === null);
  const remaining = kept.join("\n").trim();
  return remaining || "pass";
}

export async function installFromGuestRequest(environment, value) {
  if (!environment || typeof environment.install !== "function") {
    throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "pip is not attached to this kernel");
  }
  return environment.install(parseGuestPackageInstall(value));
}

export async function applyGuestPipSource(environment, code) {
  const requirements = extractLiteralPipInstalls(code);
  if (!requirements.length) return code;
  if (!environment || typeof environment.install !== "function") {
    throw new PyProcError("PYPROC_PROCESS_UNAVAILABLE", "pip is not attached to this kernel");
  }
  const receiptByRequirement = new Map();
  for (const requirement of requirements) {
    const receipt = guestPipReceipt(await environment.install({
      requirements: [requirement],
      extend: true,
    }));
    receiptByRequirement.set(requirement, receipt);
  }
  return replaceLiteralPipInstalls(stripPackageCommandLines(code), receiptByRequirement);
}
