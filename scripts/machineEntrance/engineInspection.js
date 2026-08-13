// engineInspection.js - local Pyodide distribution integrity inspection used by Machine Entrance doctor.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PYODIDE_VERSION } from "../../src/runtime/pyodideDistribution.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CATALOG_PATH = join(PACKAGE_ROOT, "scripts", "assetCatalog.json");

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function inspectionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function verifiedFile(path, expected, label) {
  let facts;
  try { facts = await stat(path); }
  catch (error) { throw inspectionError("MACHINE_ENGINE_ASSET_MISSING", `${label} is unavailable: ${path}`); }
  if (!facts.isFile()) throw inspectionError("MACHINE_ENGINE_ASSET_INVALID", `${label} must be a file: ${path}`);
  if (expected.byteLength !== undefined && facts.size !== expected.byteLength) {
    throw inspectionError("MACHINE_ENGINE_SIZE_MISMATCH", `${label} byteLength mismatch: ${path}`);
  }
  const actual = await sha256(path);
  if (actual !== expected.sha256) {
    throw inspectionError("MACHINE_ENGINE_DIGEST_MISMATCH", `${label} SHA-256 mismatch: ${path}`);
  }
  return Object.freeze({ path, byteLength: facts.size, sha256: actual });
}

export async function inspectEngineDistribution(root, { catalogPath = CATALOG_PATH } = {}) {
  const engineRoot = resolve(root);
  let catalog;
  try { catalog = JSON.parse(await readFile(catalogPath, "utf8")); }
  catch (error) { throw inspectionError("MACHINE_ENGINE_CATALOG_INVALID", "installed engine catalog is unavailable or invalid"); }
  const lockPath = join(engineRoot, "pyodide-lock.json");
  let lock;
  try { lock = JSON.parse(await readFile(lockPath, "utf8")); }
  catch (error) { throw inspectionError("MACHINE_ENGINE_LOCK_INVALID", `engine lock is unavailable or invalid: ${lockPath}`); }
  const version = PYODIDE_VERSION;
  const component = catalog.assets?.filter((asset) => asset.componentId === `pyodide-release-${version}`
    && asset.consumers?.includes("pyproc"));
  if (!component?.length) {
    throw inspectionError("MACHINE_ENGINE_VERSION_UNTRUSTED", `engine version is not pinned by this package: ${version || "unknown"}`);
  }
  const core = [];
  for (const asset of component) core.push(await verifiedFile(join(engineRoot, asset.name), asset, `engine core ${asset.name}`));
  const packages = Object.values(lock.packages || {}).filter((entry) => entry?.file_name && entry?.sha256);
  if (!packages.length) throw inspectionError("MACHINE_ENGINE_LOCK_EMPTY", "engine lock contains no verifiable packages");
  let packageBytes = 0;
  for (const entry of packages) {
    const checked = await verifiedFile(join(engineRoot, entry.file_name), { sha256: entry.sha256 },
      `engine package ${entry.file_name}`);
    packageBytes += checked.byteLength;
  }
  return Object.freeze({
    root: engineRoot,
    version,
    coreAssets: core.length,
    packages: packages.length,
    byteLength: core.reduce((sum, asset) => sum + asset.byteLength, 0) + packageBytes,
    integrity: "verified",
  });
}
