// Deterministically builds package-owned facades for source-built native profiles.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDeterministicZip } from "../engineBuilder/deterministicZip.mjs";
import { canonicalPackageJson } from "../../src/runtime/packageCanonical.js";
import { unzipWheel } from "../../src/runtime/engines/wasi/wheelUnzip.js";
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

function metadataField(metadata, name) {
  const matches = [...metadata.matchAll(new RegExp(`^${name}:\\s*(.+)$`, "gmu"))];
  assert(matches.length === 1, `native package wheel metadata field drifted: ${name}`);
  return matches[0][1].trim();
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
  const packages = [{
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
  }];
  const artifacts = [{ filename, bytes: wheel }];
  for (const additional of profileLock.additionalPackages || []) {
    const additionalBytes = await readFile(resolve(HERE, additional.artifactSource));
    assert(digestHex(additionalBytes) === additional.artifactSha256
      && additionalBytes.byteLength === additional.artifactBytes,
    `native package artifact identity drifted: ${additional.name}`);
    const scientificBytes = await readFile(resolve(HERE, additional.scientificBuildSource));
    assert(digestHex(scientificBytes) === additional.scientificBuildSha256,
      `scientific package build identity drifted: ${additional.name}`);
    const scientific = JSON.parse(scientificBytes);
    assert(scientific.protocol === "pyproc.scientific-package-build"
      && scientific.package?.name === additional.name
      && scientific.package?.version === additional.version
      && scientific.package?.sourceSha256 === additional.sourceSha256
      && scientific.package?.wheel?.file === additional.filename
      && scientific.package?.wheel?.sha256 === additional.artifactSha256
      && Array.isArray(scientific.package?.modules) && scientific.package.modules.length > 0,
    `scientific package provenance drifted: ${additional.name}`);
    const wheelEntries = new Map(await unzipWheel(additionalBytes));
    const metadataEntries = [...wheelEntries].filter(([path]) => /\.dist-info\/METADATA$/u.test(path));
    const wrapperBytes = wheelEntries.get(additional.wrapperPath);
    assert(metadataEntries.length === 1 && wrapperBytes
      && digestHex(wrapperBytes) === additional.wrapperSourceSha256,
    `scientific package Python layer drifted: ${additional.name}`);
    const additionalMetadata = new TextDecoder().decode(metadataEntries[0][1]);
    assert(metadataField(additionalMetadata, "Name") === additional.name
      && metadataField(additionalMetadata, "Version") === additional.version
      && metadataField(additionalMetadata, "Requires-Python") === additional.requiresPython,
    `scientific package metadata drifted: ${additional.name}`);
    packages.push({ name: additional.name, version: additional.version,
      filename: additional.filename, artifactPath: `./${profileName}/${additional.filename}`,
      sha256: digestAddress(additionalBytes), size: additionalBytes.byteLength,
      requiresPython: additional.requiresPython, dependencies: [], metadata: additionalMetadata,
      metadataSha256: digestAddress(new TextEncoder().encode(additionalMetadata)), tag: additional.tag,
      wrapper: { module: additional.wrapperModule,
        sourceSha256: `sha256:${additional.wrapperSourceSha256}` },
      nativeModules: scientific.package.modules.map((name) => ({ name,
        abiVersion: `${additional.name}/${additional.version}`, origin: "built-in",
        sourceSha256: `sha256:${additional.sourceSha256}` })) });
    artifacts.push({ filename: additional.filename, bytes: additionalBytes });
  }
  packages.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
  assert(new Set(packages.map((entry) => entry.name)).size === packages.length,
    `native package profile has duplicate packages: ${profileName}`);
  const body = {
    protocol: "pyproc.owned-package-catalog",
    version: 1,
    engine: profileLock.engine,
    packages,
  };
  const catalog = { ...body, catalogDigest: digestAddress(Buffer.from(canonicalPackageJson(body))) };
  const output = resolve(ROOT, `src/runtime/packages/native/${profileName}`);
  const identityPrefix = profileName === "core" ? "DEFAULT" : profileName.toUpperCase();
  await mkdir(output, { recursive: true });
  for (const artifact of artifacts) await writeFile(resolve(output, artifact.filename), artifact.bytes);
  await writeFile(resolve(output, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  await writeFile(resolve(output, "catalogIdentity.js"), [
    "// Produced from scripts/nativePackageCatalog/buildNativePackageCatalog.mjs.",
    `export const ${identityPrefix}_OWNED_PACKAGE_CATALOG_DIGEST = ${JSON.stringify(catalog.catalogDigest)};`,
    `export const ${identityPrefix}_OWNED_PACKAGE_WHEEL_DIGESTS = Object.freeze(${JSON.stringify(
      Object.fromEntries(body.packages.map((entry) => [entry.name, entry.sha256])))});`,
    "",
  ].join("\n"));
  return Object.freeze({ profile: profileName, catalogDigest: catalog.catalogDigest,
    wheels: Object.freeze(body.packages.map((entry) => Object.freeze({ filename: entry.filename,
      sha256: entry.sha256, byteLength: entry.size }))), output });
}

const lock = JSON.parse(await readFile(resolve(HERE, "nativePackageCatalogLock.json"), "utf8"));
assert(lock.schemaVersion === 3 && lock.profiles && typeof lock.profiles === "object",
  "native package catalog lock version is unsupported");
const requestedProfile = textOption("--profile");
const profileNames = requestedProfile ? [requestedProfile] : Object.keys(lock.profiles).sort();
const results = [];
for (const profileName of profileNames) {
  assert(Object.hasOwn(lock.profiles, profileName), `native package profile is not locked: ${profileName}`);
  results.push(await buildProfile(profileName, lock.sourceDateEpoch, lock.profiles[profileName]));
}
console.log(JSON.stringify(results, null, 2));
