// Deterministically builds the package-owned facade for a source-built native profile.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDeterministicZip } from "../engineBuilder/deterministicZip.mjs";
import { canonicalPackageJson } from "../../src/runtime/packageCanonical.js";
import { inspectDefaultKernelEngineDistribution } from "../../src/runtime/engines/wasi/ownedEngineDistribution.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const OUTPUT = resolve(ROOT, "src/runtime/packages/native/core");
const encoder = new TextEncoder();

function digestHex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function digestAddress(bytes) {
  return `sha256:${digestHex(bytes)}`;
}

function recordHash(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const lock = JSON.parse(await readFile(resolve(HERE, "nativePackageCatalogLock.json"), "utf8"));
const distribution = inspectDefaultKernelEngineDistribution();
assert(lock.schemaVersion === 1, "native package catalog lock version is unsupported");
for (const field of ["engineId", "nativeProfile", "pythonVersion", "target", "buildManifestSha256"]) {
  assert(lock.engine[field] === distribution[field], `native package catalog engine ${field} drifted`);
}
assert(Array.isArray(lock.nativeModules) && lock.nativeModules.length > 0,
  "native package catalog must bind at least one source-built module");
for (const module of lock.nativeModules) {
  const bytes = await readFile(resolve(HERE, module.source));
  assert(digestHex(bytes) === module.sourceSha256, `native module source digest drifted: ${module.name}`);
}

const wrapperPath = resolve(HERE, lock.package.wrapperSource);
const wrapper = await readFile(wrapperPath);
assert(digestHex(wrapper) === lock.package.wrapperSourceSha256, "native package wrapper source digest drifted");
const normalizedName = lock.package.name.replaceAll("-", "_");
const filename = `${normalizedName}-${lock.package.version}-${lock.package.tag}.whl`;
const distInfo = `${normalizedName}-${lock.package.version}.dist-info`;
const metadata = encoder.encode([
  "Metadata-Version: 2.4",
  `Name: ${lock.package.name}`,
  `Version: ${lock.package.version}`,
  `Requires-Python: ${lock.package.requiresPython}`,
  "Summary: Package facade for a source-built pyproc native profile",
  "",
  "",
].join("\n"));
const wheelMetadata = encoder.encode([
  "Wheel-Version: 1.0",
  "Generator: pyproc-native-package-catalog/1",
  "Root-Is-Purelib: true",
  `Tag: ${lock.package.tag}`,
  "",
  "",
].join("\n"));
const entries = [
  { path: `${lock.package.module}/__init__.py`, bytes: wrapper },
  { path: `${distInfo}/METADATA`, bytes: metadata },
  { path: `${distInfo}/WHEEL`, bytes: wheelMetadata },
];
const record = entries.map((entry) => `${entry.path},sha256=${recordHash(entry.bytes)},${entry.bytes.byteLength}`);
record.push(`${distInfo}/RECORD,,`);
entries.push({ path: `${distInfo}/RECORD`, bytes: encoder.encode(`${record.join("\n")}\n`) });
const wheel = createDeterministicZip(entries, lock.sourceDateEpoch);
const body = {
  protocol: "pyproc.owned-package-catalog",
  version: 1,
  engine: lock.engine,
  packages: [{
    name: lock.package.name,
    version: lock.package.version,
    filename,
    artifactPath: `./core/${filename}`,
    sha256: digestAddress(wheel),
    size: wheel.byteLength,
    requiresPython: lock.package.requiresPython,
    dependencies: [],
    metadata: new TextDecoder().decode(metadata),
    metadataSha256: digestAddress(metadata),
    tag: lock.package.tag,
    wrapper: { module: lock.package.module, sourceSha256: `sha256:${lock.package.wrapperSourceSha256}` },
    nativeModules: lock.nativeModules.map((module) => ({ name: module.name,
      abiVersion: module.abiVersion, origin: module.origin, sourceSha256: `sha256:${module.sourceSha256}` })),
  }],
};
const catalog = { ...body, catalogDigest: digestAddress(Buffer.from(canonicalPackageJson(body))) };
await mkdir(OUTPUT, { recursive: true });
await writeFile(resolve(OUTPUT, filename), wheel);
await writeFile(resolve(OUTPUT, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
await writeFile(resolve(OUTPUT, "catalogIdentity.js"), [
  "// Produced from scripts/nativePackageCatalog/buildNativePackageCatalog.mjs.",
  `export const DEFAULT_OWNED_PACKAGE_CATALOG_DIGEST = ${JSON.stringify(catalog.catalogDigest)};`,
  `export const DEFAULT_OWNED_PACKAGE_WHEEL_DIGEST = ${JSON.stringify(body.packages[0].sha256)};`,
  "",
].join("\n"));
console.log(JSON.stringify({ catalogDigest: catalog.catalogDigest, wheel: { filename,
  sha256: body.packages[0].sha256, byteLength: wheel.byteLength }, output: OUTPUT }, null, 2));
