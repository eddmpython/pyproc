// packageEnvironment.js - Layer 2: locked package environment composition over a v2 kernel.
import { sha256Address } from "../runtime/contentDigest.js";
import { PyProcError } from "../runtime/errors.js";
import { canonicalPackageJson, immutablePackageValue } from "../runtime/packageCanonical.js";
import {
  MemoryPackageContentStore,
  PACKAGE_RESOLVER_VERSION,
} from "../runtime/packageResolver.js";
import { DEFAULT_WHEEL_LIMITS, inspectPurePythonWheel } from "../runtime/wheelInstaller.js";

export const PACKAGE_ENVIRONMENT_PROTOCOL = "pyproc.package-environment";
export const PACKAGE_ENVIRONMENT_VERSION = 1;

export async function packageEnvironmentIdentity({ engineId, lock, treeDigests, policyDigest }) {
  if (typeof engineId !== "string" || !engineId || !Array.isArray(treeDigests)
    || typeof policyDigest !== "string") {
    throw new PyProcError("PYPROC_INPUT_INVALID", "Package environment identity inputs are invalid");
  }
  return sha256Address(canonicalPackageJson({ engineId, resolverVersion: PACKAGE_RESOLVER_VERSION,
    lock, treeDigests, policyDigest }));
}

export class PackageEnvironment {
  #kernel;
  #resolver;
  #store;
  #policy;
  #active = null;

  constructor(options = {}) {
    if (!options.kernel || typeof options.kernel.installEnvironment !== "function"
      || typeof options.kernel.describe !== "function" || !options.resolver
      || typeof options.resolver.resolve !== "function" || typeof options.resolver.materialize !== "function") {
      throw new PyProcError("PYPROC_INPUT_INVALID", "PackageEnvironment requires a v2 kernel and package resolver");
    }
    this.#kernel = options.kernel;
    this.#resolver = options.resolver;
    this.#store = options.contentStore || new MemoryPackageContentStore();
    this.#policy = immutablePackageValue({ wheelLimits: { ...DEFAULT_WHEEL_LIMITS,
      ...(options.policy?.wheelLimits || {}) }, compileBytecode: options.policy?.compileBytecode === true,
      importSmoke: true });
  }

  async install(request) {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      throw new PyProcError("PYPROC_INPUT_INVALID", "PackageEnvironment.install request must be an object");
    }
    const offline = request.offline === true;
    let locked;
    if (request.lock) locked = await this.#resolver.validateLock(request.lock);
    else {
      if (offline) throw new PyProcError("PYPROC_PACKAGE_RESOLUTION", "Offline package installation requires a lock");
      let requirements = request.requirements;
      if (request.extend === true && this.#active) {
        requirements = [...new Set([...this.#active.lock.requirements, ...(requirements || [])])];
      }
      locked = await this.#resolver.resolve(requirements);
    }
    const materialized = await this.#resolver.materialize(locked.lock, { contentStore: this.#store, offline });
    const trees = [];
    for (const wheel of materialized.wheels) {
      const tree = await inspectPurePythonWheel(wheel.bytes, { filename: wheel.package.filename,
        expectedName: wheel.package.name, expectedVersion: wheel.package.version,
        expectedSha256: wheel.package.sha256, allowedTags: locked.lock.allowedTags,
        limits: this.#policy.wheelLimits });
      if (tree.requiresPython !== wheel.package.requiresPython
        || canonicalPackageJson([...tree.dependencies].sort())
          !== canonicalPackageJson(wheel.package.dependencies)) {
        throw new PyProcError("PYPROC_PACKAGE_INTEGRITY",
          `Wheel metadata differs from locked index metadata: ${wheel.package.filename}`);
      }
      trees.push(tree);
    }
    const policyDigest = await sha256Address(canonicalPackageJson(this.#policy));
    const descriptor = await this.#kernel.describe();
    const environmentId = await packageEnvironmentIdentity({ engineId: descriptor.engineId,
      lock: locked.lock, treeDigests: trees.map((tree) => tree.treeDigest), policyDigest });
    const installed = await this.#kernel.installEnvironment({ environmentId,
      lockDigest: locked.lockDigest, policyDigest, allowedTags: locked.lock.allowedTags,
      limits: this.#policy.wheelLimits, wheels: materialized.wheels.map((wheel) => ({
        filename: wheel.package.filename, name: wheel.package.name, version: wheel.package.version,
        sha256: wheel.package.sha256, bytes: wheel.bytes,
      })) });
    const receipt = immutablePackageValue({ protocol: PACKAGE_ENVIRONMENT_PROTOCOL,
      version: PACKAGE_ENVIRONMENT_VERSION, environmentId, engineId: descriptor.engineId,
      lock: locked.lock, lockDigest: locked.lockDigest, policyDigest,
      treeDigests: trees.map((tree) => tree.treeDigest), offline,
      sources: materialized.wheels.map((wheel) => wheel.source), installed });
    this.#active = receipt;
    return receipt;
  }

  inspect() { return this.#active; }
}
