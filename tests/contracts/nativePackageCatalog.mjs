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

export async function assertNativePackageCatalogContract() {
  const resolver = await createOwnedPackageResolver({ fetch: packageFileFetch() });
  const catalog = resolver.ownedCatalog;
  assert(OWNED_PACKAGE_CATALOG_PROTOCOL === "pyproc.owned-package-catalog"
    && OWNED_PACKAGE_CATALOG_VERSION === 1 && catalog.protocol === OWNED_PACKAGE_CATALOG_PROTOCOL
    && catalog.packages.length === 1, "owned package catalog protocol drifted");
  const entry = catalog.packages[0];
  const lockResult = await resolver.resolve(["pyproc-native-host==1.0.0"]);
  assert(lockResult.lock.engineId === catalog.engine.engineId
    && lockResult.lock.nativeProfile === catalog.engine.nativeProfile
    && lockResult.lock.packages[0].sha256 === entry.sha256,
  "owned package lock lost its exact engine, profile, or artifact identity");

  const store = new MemoryPackageContentStore();
  const materialized = await resolver.materialize(lockResult.lock, { contentStore: store, offline: true });
  assert(materialized.wheels.length === 1 && materialized.wheels[0].source === "package"
    && await sha256Address(materialized.wheels[0].bytes) === entry.sha256,
  "owned wheel did not materialize from package bytes while offline");
  const cached = await resolver.materialize(lockResult.lock, { contentStore: store, offline: true });
  assert(cached.wheels[0].source === "content-store", "owned wheel did not become a verified content-store hit");

  let installCalls = 0;
  const wrongEngine = new PackageEnvironment({ resolver, contentStore: new MemoryPackageContentStore(), kernel: {
    async describe() { return { engineId: "engine:wrong", nativeProfile: catalog.engine.nativeProfile }; },
    async installEnvironment() { installCalls += 1; },
  } });
  const fenced = await rejectionOf(() => wrongEngine.install({ lock: lockResult.lock, offline: true }));
  assert(fenced?.code === "PYPROC_PACKAGE_ABI_UNSUPPORTED" && installCalls === 0,
    "owned package crossed its engine fence or reached an install side effect");

  const corrupted = await rejectionOf(() => createOwnedPackageResolver({ fetch: packageFileFetch({ corruptWheel: true }) }));
  assert(corrupted?.code === "PYPROC_PACKAGE_INTEGRITY",
    "owned package artifact mutation crossed catalog verification");

  const buildLock = JSON.parse(await readFile(new URL("../../scripts/nativePackageCatalog/nativePackageCatalogLock.json",
    import.meta.url), "utf8"));
  const wrapper = await readFile(new URL(`../../scripts/nativePackageCatalog/${buildLock.package.wrapperSource}`,
    import.meta.url));
  const hostSource = await readFile(new URL(`../../scripts/nativePackageCatalog/${buildLock.nativeModules[0].source}`,
    import.meta.url));
  const hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
  assert(hex(wrapper) === buildLock.package.wrapperSourceSha256
    && hex(hostSource) === buildLock.nativeModules[0].sourceSha256
    && entry.wrapper.sourceSha256 === `sha256:${hex(wrapper)}`
    && entry.nativeModules[0].sourceSha256 === `sha256:${hex(hostSource)}`,
  "owned catalog no longer traces to its locked wrapper or native source");
  const { catalogDigest, ...catalogBody } = catalog;
  assert(await sha256Address(canonicalPackageJson(catalogBody)) === catalogDigest,
    "owned catalog canonical identity is not reproducible");
}
