import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { PackageEnvironment } from "../../src/capabilities/packageEnvironment.js";
import { sha256Address } from "../../src/runtime/contentDigest.js";
import { canonicalPackageJson } from "../../src/runtime/packageCanonical.js";
import { MemoryPackageContentStore } from "../../src/runtime/packageResolver.js";
import {
  OWNED_PACKAGE_CATALOG_PROTOCOL,
  OWNED_PACKAGE_CATALOG_VERSION,
  createOwnedPackageResolver,
} from "../../src/runtime/packages/native/ownedPackageCatalog.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejectionOf(operation) {
  try { await operation(); return null; }
  catch (error) { return error; }
}

function fileResponse(bytes) {
  const copy = new Uint8Array(bytes);
  return { ok: true, status: 200,
    async json() { return JSON.parse(new TextDecoder().decode(copy)); },
    async arrayBuffer() { return copy.slice().buffer; } };
}

function packageFileFetch({ corruptWheel = false } = {}) {
  return async (input) => {
    const url = input instanceof URL ? input : new URL(String(input));
    if (url.protocol !== "file:") return { ok: false, status: 404 };
    const bytes = new Uint8Array(await readFile(fileURLToPath(url)));
    if (corruptWheel && url.pathname.endsWith(".whl")) bytes[40] ^= 1;
    return fileResponse(bytes);
  };
}

async function assertProfile({ profile, requirements, absentRequirement, lockProfile }) {
  const resolver = await createOwnedPackageResolver({ fetch: packageFileFetch(), profile });
  const catalog = resolver.ownedCatalog;
  assert(catalog.protocol === OWNED_PACKAGE_CATALOG_PROTOCOL
    && catalog.packages.length === requirements.length
    && catalog.engine.nativeProfile === profile, `owned ${profile} package catalog protocol drifted`);
  const entries = new Map(catalog.packages.map((entry) => [entry.name, entry]));
  const lockResult = await resolver.resolve(requirements);
  assert(lockResult.lock.engineId === catalog.engine.engineId
    && lockResult.lock.nativeProfile === catalog.engine.nativeProfile
    && lockResult.lock.packages.every((entry) => entries.get(entry.name)?.sha256 === entry.sha256),
  `owned ${profile} package lock lost its exact engine, profile, or artifact identity`);

  const unavailable = await rejectionOf(() => resolver.resolve([absentRequirement]));
  assert(unavailable?.code === "PYPROC_PACKAGE_RESOLUTION",
    `owned ${profile} catalog resolved a package from another native profile`);

  const store = new MemoryPackageContentStore();
  const materialized = await resolver.materialize(lockResult.lock, { contentStore: store, offline: true });
  assert(materialized.wheels.length === requirements.length
    && materialized.wheels.every((wheel) => wheel.source === "package"
      && entries.get(wheel.package.name)?.sha256 === wheel.package.sha256),
  `owned ${profile} wheel did not materialize from package bytes while offline`);
  const cached = await resolver.materialize(lockResult.lock, { contentStore: store, offline: true });
  assert(cached.wheels.every((wheel) => wheel.source === "content-store"),
    `owned ${profile} wheel did not become a verified content-store hit`);

  let installCalls = 0;
  const wrongEngine = new PackageEnvironment({ resolver, contentStore: new MemoryPackageContentStore(), kernel: {
    async describe() { return { engineId: "engine:wrong", nativeProfile: catalog.engine.nativeProfile }; },
    async installEnvironment() { installCalls += 1; },
  } });
  const fenced = await rejectionOf(() => wrongEngine.install({ lock: lockResult.lock, offline: true }));
  assert(fenced?.code === "PYPROC_PACKAGE_ABI_UNSUPPORTED" && installCalls === 0,
    `owned ${profile} package crossed its engine fence or reached an install side effect`);

  const corrupted = await rejectionOf(() => createOwnedPackageResolver({
    fetch: packageFileFetch({ corruptWheel: true }), profile,
  }));
  assert(corrupted?.code === "PYPROC_PACKAGE_INTEGRITY",
    `owned ${profile} package artifact mutation crossed catalog verification`);

  const hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const wrapper = await readFile(new URL(`../../scripts/nativePackageCatalog/${lockProfile.package.wrapperSource}`,
    import.meta.url));
  assert(hex(wrapper) === lockProfile.package.wrapperSourceSha256
    && entries.get(lockProfile.package.name)?.wrapper.sourceSha256 === `sha256:${hex(wrapper)}`,
  `owned ${profile} catalog no longer traces to its locked wrapper source`);
  for (const [index, module] of lockProfile.nativeModules.entries()) {
    const source = await readFile(new URL(`../../scripts/nativePackageCatalog/${module.source}`, import.meta.url));
    assert(hex(source) === module.sourceSha256
      && entries.get(lockProfile.package.name)?.nativeModules[index].sourceSha256 === `sha256:${hex(source)}`
      && entries.get(lockProfile.package.name)?.nativeModules[index].abiVersion === module.abiVersion,
    `owned ${profile} catalog no longer traces to native source ${module.name}`);
  }
  const { catalogDigest, ...catalogBody } = catalog;
  assert(await sha256Address(canonicalPackageJson(catalogBody)) === catalogDigest,
    `owned ${profile} catalog canonical identity is not reproducible`);
}

export async function assertNativePackageCatalogContract() {
  assert(OWNED_PACKAGE_CATALOG_PROTOCOL === "pyproc.owned-package-catalog"
    && OWNED_PACKAGE_CATALOG_VERSION === 1, "owned package catalog protocol drifted");
  const buildLock = JSON.parse(await readFile(new URL(
    "../../scripts/nativePackageCatalog/nativePackageCatalogLock.json", import.meta.url), "utf8"));
  assert(buildLock.schemaVersion === 3 && Object.keys(buildLock.profiles).sort().join(",") === "core,data",
    "owned package profile lock is incomplete");
  await assertProfile({ profile: "core", requirements: ["pyproc-native-host==1.0.0"],
    absentRequirement: "pyproc-native-data==1.0.0", lockProfile: buildLock.profiles.core });
  await assertProfile({ profile: "data", requirements: ["pyproc-native-data==1.0.0", "numpy==2.5.1"],
    absentRequirement: "pyproc-native-host==1.0.0", lockProfile: buildLock.profiles.data });
  const invalid = await rejectionOf(() => createOwnedPackageResolver({ profile: "unknown" }));
  assert(invalid?.code === "PYPROC_INPUT_INVALID", "unknown owned package profile did not fail closed");
}
