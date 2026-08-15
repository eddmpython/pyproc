// Package-owned catalog for facades backed by source-built modules in the default WASI engine.
import { parseSha256Address, sha256Address } from "../../contentDigest.js";
import { PyProcError } from "../../errors.js";
import { canonicalPackageJson, immutablePackageValue, normalizePackageName } from "../../packageCanonical.js";
import { SimpleApiPackageResolver } from "../../packageResolver.js";
import {
  inspectDataKernelEngineDistribution,
  inspectDefaultKernelEngineDistribution,
} from "../../engines/wasi/ownedEngineDistribution.js";
import {
  DEFAULT_OWNED_PACKAGE_CATALOG_DIGEST,
  DEFAULT_OWNED_PACKAGE_WHEEL_DIGEST,
} from "./core/catalogIdentity.js";
import {
  DATA_OWNED_PACKAGE_CATALOG_DIGEST,
  DATA_OWNED_PACKAGE_WHEEL_DIGEST,
} from "./data/catalogIdentity.js";

export const OWNED_PACKAGE_CATALOG_PROTOCOL = "pyproc.owned-package-catalog";
export const OWNED_PACKAGE_CATALOG_VERSION = 1;

const INDEX_URL = "https://packages.pyproc.invalid/simple/";
const FILES_URL = "https://packages.pyproc.invalid/files/";
const PROFILES = Object.freeze({
  core: Object.freeze({ inspect: inspectDefaultKernelEngineDistribution,
    catalogDigest: DEFAULT_OWNED_PACKAGE_CATALOG_DIGEST,
    wheelDigest: DEFAULT_OWNED_PACKAGE_WHEEL_DIGEST }),
  data: Object.freeze({ inspect: inspectDataKernelEngineDistribution,
    catalogDigest: DATA_OWNED_PACKAGE_CATALOG_DIGEST,
    wheelDigest: DATA_OWNED_PACKAGE_WHEEL_DIGEST }),
});

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", `${label} must be an object`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", `${label} has unknown field(s): ${unknown.join(", ")}`);
}

function digest(value, label) {
  const hex = parseSha256Address(value);
  if (!hex) throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", `${label} digest is invalid`);
  return `sha256:${hex}`;
}

function response(bytes, contentType, status = 200) {
  const body = bytes instanceof Uint8Array ? bytes.slice() : new TextEncoder().encode(String(bytes));
  return Object.freeze({ ok: status >= 200 && status < 300, status, url: "",
    headers: Object.freeze({ get(name) {
      const key = String(name).toLowerCase();
      if (key === "content-type") return contentType;
      if (key === "content-length") return String(body.byteLength);
      return null;
    } }),
    async json() { return JSON.parse(new TextDecoder().decode(body)); },
    async arrayBuffer() { return body.slice().buffer; },
  });
}

function packageEntry(value, profile) {
  exactKeys(value, new Set(["name", "version", "filename", "artifactPath", "sha256", "size",
    "requiresPython", "dependencies", "metadata", "metadataSha256", "tag", "wrapper", "nativeModules"]),
  "Owned package catalog entry");
  exactKeys(value.wrapper, new Set(["module", "sourceSha256"]), "Owned package wrapper");
  if (!Array.isArray(value.nativeModules) || !value.nativeModules.length) {
    throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", "Owned package catalog entry must bind native modules");
  }
  for (const module of value.nativeModules) {
    exactKeys(module, new Set(["name", "abiVersion", "origin", "sourceSha256"]), "Owned native module");
    if (typeof module.name !== "string" || !module.name || typeof module.abiVersion !== "string"
      || !module.abiVersion || module.origin !== "built-in") {
      throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", "Owned native module identity is invalid");
    }
    digest(module.sourceSha256, `${module.name} source`);
  }
  if (normalizePackageName(value.name) !== value.name || typeof value.version !== "string" || !value.version
    || typeof value.filename !== "string" || !value.filename.endsWith(".whl")
    || typeof value.artifactPath !== "string"
    || value.artifactPath !== `./${profile}/${value.filename}`
    || !Number.isSafeInteger(value.size) || value.size < 1 || typeof value.requiresPython !== "string"
    || !Array.isArray(value.dependencies) || value.dependencies.length !== 0 || typeof value.metadata !== "string"
    || value.tag !== "py3-none-any" || typeof value.wrapper.module !== "string" || !value.wrapper.module) {
    throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", "Owned package catalog entry identity is invalid");
  }
  digest(value.sha256, `${value.filename} artifact`);
  digest(value.metadataSha256, `${value.filename} metadata`);
  digest(value.wrapper.sourceSha256, `${value.filename} wrapper source`);
  return value;
}

async function loadCatalog(fetchImpl, profile) {
  const identity = PROFILES[profile];
  const catalogUrl = new URL(`./${profile}/catalog.json`, import.meta.url);
  let fetched;
  try { fetched = await fetchImpl(catalogUrl); }
  catch (error) {
    throw new PyProcError("PYPROC_ASSET_MISSING", "Owned package catalog could not be loaded", { cause: error });
  }
  if (!fetched?.ok || typeof fetched.json !== "function") {
    throw new PyProcError("PYPROC_ASSET_MISSING", `Owned package catalog fetch failed: ${fetched?.status || "unknown"}`);
  }
  const catalog = await fetched.json();
  exactKeys(catalog, new Set(["protocol", "version", "engine", "packages", "catalogDigest"]),
    "Owned package catalog");
  exactKeys(catalog.engine, new Set(["engineId", "nativeProfile", "pythonVersion", "target",
    "buildManifestSha256"]), "Owned package catalog engine");
  if (catalog.protocol !== OWNED_PACKAGE_CATALOG_PROTOCOL || catalog.version !== OWNED_PACKAGE_CATALOG_VERSION
    || !Array.isArray(catalog.packages) || catalog.packages.length !== 1) {
    throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", "Owned package catalog protocol is invalid");
  }
  const entry = packageEntry(catalog.packages[0], profile);
  const { catalogDigest, ...body } = catalog;
  const actualCatalogDigest = await sha256Address(canonicalPackageJson(body));
  if (digest(catalogDigest, "Owned package catalog") !== identity.catalogDigest
    || actualCatalogDigest !== identity.catalogDigest
    || entry.sha256 !== identity.wheelDigest) {
    throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", "Owned package catalog digest differs from the installed identity");
  }
  const distribution = identity.inspect();
  for (const field of ["engineId", "nativeProfile", "pythonVersion", "target", "buildManifestSha256"]) {
    if (catalog.engine[field] !== distribution[field]) {
      throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", `Owned package catalog engine ${field} drifted`);
    }
  }
  const metadataBytes = new TextEncoder().encode(entry.metadata);
  if (await sha256Address(metadataBytes) !== entry.metadataSha256) {
    throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", "Owned package metadata digest differs from the catalog");
  }
  const artifactUrl = new URL(entry.artifactPath, import.meta.url);
  let wheelResponse;
  try { wheelResponse = await fetchImpl(artifactUrl); }
  catch (error) {
    throw new PyProcError("PYPROC_ASSET_MISSING", `Owned package artifact could not be loaded: ${entry.filename}`, { cause: error });
  }
  if (!wheelResponse?.ok || typeof wheelResponse.arrayBuffer !== "function") {
    throw new PyProcError("PYPROC_ASSET_MISSING", `Owned package artifact fetch failed: ${entry.filename}`);
  }
  const wheelBytes = new Uint8Array(await wheelResponse.arrayBuffer());
  if (wheelBytes.byteLength !== entry.size || await sha256Address(wheelBytes) !== entry.sha256) {
    throw new PyProcError("PYPROC_PACKAGE_INTEGRITY", `Owned package artifact differs from the catalog: ${entry.filename}`);
  }
  return Object.freeze({ catalog: immutablePackageValue(catalog), entry, metadataBytes, wheelBytes });
}

export async function createOwnedPackageResolver(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "createOwnedPackageResolver options must be an object");
  }
  const unknown = Object.keys(options).filter((key) => key !== "fetch" && key !== "profile");
  if (unknown.length) throw new PyProcError("PYPROC_INPUT_INVALID",
    `createOwnedPackageResolver does not accept option(s): ${unknown.join(", ")}`);
  const profile = options.profile === undefined ? "core" : options.profile;
  if (!Object.hasOwn(PROFILES, profile)) {
    throw new PyProcError("PYPROC_INPUT_INVALID", `Owned package profile is unsupported: ${profile}`);
  }
  const fetchImpl = options.fetch || (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : null);
  if (typeof fetchImpl !== "function") {
    throw new PyProcError("PYPROC_ENV_UNSUPPORTED", "Owned package catalog requires fetch");
  }
  const loaded = await loadCatalog(fetchImpl, profile);
  const projectUrl = `${INDEX_URL}${encodeURIComponent(loaded.entry.name)}/`;
  const artifactUrl = `${FILES_URL}${encodeURIComponent(loaded.entry.filename)}`;
  const simpleDocument = immutablePackageValue({ meta: { "api-version": "1.0" }, name: loaded.entry.name,
    files: [{ filename: loaded.entry.filename, url: artifactUrl,
      hashes: { sha256: loaded.entry.sha256 }, size: loaded.entry.size,
      "requires-python": loaded.entry.requiresPython,
      "core-metadata": { sha256: loaded.entry.metadataSha256 }, yanked: false }] });
  const catalogFetch = async (url) => {
    const href = String(url);
    if (href === projectUrl) return response(JSON.stringify(simpleDocument), "application/vnd.pypi.simple.v1+json");
    if (href === `${artifactUrl}.metadata`) return response(loaded.metadataBytes, "text/plain");
    return response("missing", "text/plain", 404);
  };
  const resolver = new SimpleApiPackageResolver({ fetch: catalogFetch,
    indexes: [{ url: INDEX_URL, trustRef: `trust:pyproc-owned:${loaded.catalog.catalogDigest}` }],
    pythonVersion: loaded.catalog.engine.pythonVersion, allowedTags: [loaded.entry.tag],
    engineId: loaded.catalog.engine.engineId, nativeProfile: loaded.catalog.engine.nativeProfile,
    bundledArtifacts: [{ sha256: loaded.entry.sha256, bytes: loaded.wheelBytes }] });
  Object.defineProperty(resolver, "ownedCatalog", { value: loaded.catalog, enumerable: true });
  return resolver;
}
