// engineInspection.js - local owned CPython/WASI distribution integrity inspection.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inspectDefaultKernelEngineDistribution }
  from "../../src/runtime/engines/wasi/ownedEngineDistribution.js";

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
  const expectedSha256 = String(expected.sha256).replace(/^sha256:/u, "");
  if (actual !== expectedSha256) {
    throw inspectionError("MACHINE_ENGINE_DIGEST_MISMATCH", `${label} SHA-256 mismatch: ${path}`);
  }
  return Object.freeze({ path, byteLength: facts.size, sha256: actual });
}

export async function inspectEngineDistribution(root) {
  const engineRoot = resolve(root);
  const distribution = inspectDefaultKernelEngineDistribution();
  const manifestPath = join(engineRoot, "engine-build-manifest.json");
  let buildManifest;
  try { buildManifest = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch (error) {
    throw inspectionError("MACHINE_ENGINE_MANIFEST_INVALID",
      `engine build manifest is unavailable or invalid: ${manifestPath}`);
  }
  if (buildManifest.engineId !== distribution.engineId
    || buildManifest.source?.version !== distribution.pythonVersion
    || buildManifest.target !== distribution.target) {
    throw inspectionError("MACHINE_ENGINE_VERSION_UNTRUSTED",
      `engine build identity does not match ${distribution.engineId}`);
  }
  const buildManifestBytes = await readFile(manifestPath);
  const buildManifestSha256 = `sha256:${createHash("sha256").update(buildManifestBytes).digest("hex")}`;
  if (buildManifestSha256 !== distribution.buildManifestSha256) {
    throw inspectionError("MACHINE_ENGINE_DIGEST_MISMATCH", "engine build manifest SHA-256 mismatch");
  }
  const artifacts = await Promise.all([
    verifiedFile(join(engineRoot, "python.wasm"), distribution.artifacts.wasm, "engine core python.wasm"),
    verifiedFile(join(engineRoot, "python314-stdlib.zip"), distribution.artifacts.stdlib,
      "engine core python314-stdlib.zip"),
  ]);
  return Object.freeze({
    root: engineRoot,
    engineId: distribution.engineId,
    version: distribution.pythonVersion,
    target: distribution.target,
    coreAssets: artifacts.length,
    packages: 0,
    byteLength: artifacts.reduce((sum, asset) => sum + asset.byteLength, 0) + buildManifestBytes.byteLength,
    buildManifestSha256,
    integrity: "verified",
  });
}
