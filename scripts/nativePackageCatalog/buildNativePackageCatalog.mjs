// Deterministically builds package-owned facades for source-built native profiles.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDeterministicZip } from "../engineBuilder/deterministicZip.mjs";
import { canonicalPackageJson } from "../../src/runtime/packageCanonical.js";
import {
  inspectDataKernelEngineDistribution,
  inspectDefaultKernelEngineDistribution,
} from "../../src/runtime/engines/wasi/ownedEngineDistribution.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
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

function textOption(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  if (!process.argv[index + 1]) throw new Error(`missing ${name} value`);
  return process.argv[index + 1];
}

const distributions = Object.freeze({
  core: inspectDefaultKernelEngineDistribution,
  data: inspectDataKernelEngineDistribution,
});

async function buildProfile(profileName, sourceDateEpoch, profileLock) {
  assert(Object.hasOwn(distributions, profileName), `native package profile is unsupported: ${profileName}`);
  const distribution = distributions[profileName]();
  assert(profileLock.engine.nativeProfile === profileName, `native package profile identity drifted: ${profileName}`);
  for (const field of ["engineId", "nativeProfile", "pythonVersion", "target", "buildManifestSha256"]) {
    assert(profileLock.engine[field] === distribution[field], `native package catalog engine ${field} drifted`);
  }
  assert(Array.isArray(profileLock.nativeModules) && profileLock.nativeModules.length > 0,
    "native package catalog must bind at least one source-built module");
  for (const module of profileLock.nativeModules) {
    const bytes = await readFile(resolve(HERE, module.source));
    assert(digestHex(bytes) === module.sourceSha256, `native module source digest drifted: ${module.name}`);
  }

  const wrapperPath = resolve(HERE, profileLock.package.wrapperSource);
  const wrapper = await readFile(wrapperPath);
  assert(digestHex(wrapper) === profileLock.package.wrapperSourceSha256,
    "native package wrapper source digest drifted");
  const normalizedName = profileLock.package.name.replaceAll("-", "_");
  const filename = `${normalizedName}-${profileLock.package.version}-${profileLock.package.tag}.whl`;
  const distInfo = `${normalizedName}-${profileLock.package.version}.dist-info`;
  const metadata = encoder.encode([
    "Metadata-Version: 2.4",
    `Name: ${profileLock.package.name}`,
    `Version: ${profileLock.package.version}`,
    `Requires-Python: ${profileLock.package.requiresPython}`,
    "Summary: Package facade for a source-built pyproc native profile",
    "",
    "",
  ].join("\n"));
  const wheelMetadata = encoder.encode([
    "Wheel-Version: 1.0",
    "Generator: pyproc-native-package-catalog/1",
    "Root-Is-Purelib: true",
    `Tag: ${profileLock.package.tag}`,
    "",
    "",
  ].join("\n"));
  const entries = [
    { path: `${profileLock.package.module}/__init__.py`, bytes: wrapper },
    { path: `${distInfo}/METADATA`, bytes: metadata },
    { path: `${distInfo}/WHEEL`, bytes: wheelMetadata },
  ];
  const record = entries.map((entry) => `${entry.path},sha256=${recordHash(entry.bytes)},${entry.bytes.byteLength}`);
  record.push(`${distInfo}/RECORD,,`);
  entries.push({ path: `${distInfo}/RECORD`, bytes: encoder.encode(`${record.join("\n")}\n`) });
  const wheel = createDeterministicZip(entries, sourceDateEpoch);
  const body = {
    protocol: "pyproc.owned-package-catalog",
    version: 1,
    engine: profileLock.engine,
    packages: [{
      name: profileLock.package.name,
      version: profileLock.package.version,
      filename,
      artifactPath: `./${profileName}/${filename}`,
      sha256: digestAddress(wheel),
      size: wheel.byteLength,
      requiresPython: profileLock.package.requiresPython,
      dependencies: [],
      metadata: new TextDecoder().decode(metadata),
      metadataSha256: digestAddress(metadata),
      tag: profileLock.package.tag,
      wrapper: { module: profileLock.package.module,
        sourceSha256: `sha256:${profileLock.package.wrapperSourceSha256}` },
      nativeModules: profileLock.nativeModules.map((module) => ({ name: module.name,
        abiVersion: module.abiVersion, origin: module.origin,
        sourceSha256: `sha256:${module.sourceSha256}` })),
    }],
  };
  const catalog = { ...body, catalogDigest: digestAddress(Buffer.from(canonicalPackageJson(body))) };
  const output = resolve(ROOT, `src/runtime/packages/native/${profileName}`);
  const identityPrefix = profileName === "core" ? "DEFAULT" : profileName.toUpperCase();
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, filename), wheel);
  await writeFile(resolve(output, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(resolve(output, "catalogIdentity.js"), [
    "// Produced from scripts/nativePackageCatalog/buildNativePackageCatalog.mjs.",
    `export const ${identityPrefix}_OWNED_PACKAGE_CATALOG_DIGEST = ${JSON.stringify(catalog.catalogDigest)};`,
    `export const ${identityPrefix}_OWNED_PACKAGE_WHEEL_DIGEST = ${JSON.stringify(body.packages[0].sha256)};`,
    "",
  ].join("\n"));
  return Object.freeze({ profile: profileName, catalogDigest: catalog.catalogDigest,
    wheel: Object.freeze({ filename, sha256: body.packages[0].sha256, byteLength: wheel.byteLength }), output });
}

const lock = JSON.parse(await readFile(resolve(HERE, "nativePackageCatalogLock.json"), "utf8"));
assert(lock.schemaVersion === 2 && lock.profiles && typeof lock.profiles === "object",
  "native package catalog lock version is unsupported");
const requestedProfile = textOption("--profile");
const profileNames = requestedProfile ? [requestedProfile] : Object.keys(lock.profiles).sort();
const results = [];
for (const profileName of profileNames) {
  assert(Object.hasOwn(lock.profiles, profileName), `native package profile is not locked: ${profileName}`);
  results.push(await buildProfile(profileName, lock.sourceDateEpoch, lock.profiles[profileName]));
}
console.log(JSON.stringify(results, null, 2));
