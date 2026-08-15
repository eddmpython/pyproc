import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { KernelTerminal } from "../../src/capabilities/kernelTerminal.js";
import {
  PACKAGE_ENVIRONMENT_PROTOCOL,
  PACKAGE_ENVIRONMENT_VERSION,
  PackageEnvironment,
  packageEnvironmentIdentity,
} from "../../src/capabilities/packageEnvironment.js";
import { sha256Address } from "../../src/runtime/contentDigest.js";
import {
  MemoryPackageContentStore,
  PACKAGE_LOCK_PROTOCOL,
  PACKAGE_LOCK_VERSION,
  SimpleApiPackageResolver,
  comparePackageVersions,
  evaluatePackageMarker,
  parsePackageRequirement,
} from "../../src/runtime/packageResolver.js";
import { inspectPurePythonWheel } from "../../src/runtime/wheelInstaller.js";
import { createDeterministicZip } from "../../scripts/engineBuilder/deterministicZip.mjs";

const encoder = new TextEncoder();
const INDEX = "https://packages.test/simple/";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejectionOf(operation) {
  try { await operation(); return null; }
  catch (error) { return error; }
}

function recordHash(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

function wheelFixture(name, version, dependencies = [], moduleSource = `value = ${JSON.stringify(version)}\n`,
  modulePath = `${name}/__init__.py`, extraModules = [], requiresPython = ">=3.14") {
  const filename = `${name}-${version}-py3-none-any.whl`;
  const distInfo = `${name}-${version}.dist-info`;
  const metadata = encoder.encode(["Metadata-Version: 2.4", `Name: ${name}`, `Version: ${version}`,
    `Requires-Python: ${requiresPython}`, ...dependencies.map((value) => `Requires-Dist: ${value}`), "", ""].join("\n"));
  const wheel = encoder.encode(["Wheel-Version: 1.0", "Generator: pyproc-contract",
    "Root-Is-Purelib: true", "Tag: py3-none-any", "", ""].join("\n"));
  const module = encoder.encode(moduleSource);
  const entries = [
    { path: modulePath, bytes: module },
    ...extraModules.map((entry) => ({ path: entry.path, bytes: encoder.encode(entry.source || "value = 1\n") })),
    { path: `${distInfo}/METADATA`, bytes: metadata },
    { path: `${distInfo}/WHEEL`, bytes: wheel },
  ];
  const records = entries.map((entry) => `${entry.path},sha256=${recordHash(entry.bytes)},${entry.bytes.byteLength}`);
  records.push(`${distInfo}/RECORD,,`);
  entries.push({ path: `${distInfo}/RECORD`, bytes: encoder.encode(records.join("\n") + "\n") });
  const bytes = new Uint8Array(createDeterministicZip(entries, 1704067200));
  return { name, version, filename, metadata, bytes, dependencies, requiresPython };
}

async function packageFile(fixture, overrides = {}) {
  return { filename: fixture.filename, url: `https://packages.test/files/${fixture.filename}`,
    hashes: { sha256: (await sha256Address(fixture.bytes)).slice(7) }, size: fixture.bytes.byteLength,
    "requires-python": fixture.requiresPython, "core-metadata": { sha256: (await sha256Address(fixture.metadata)).slice(7) },
    yanked: false, ...(fixture.fileOverrides || {}), ...overrides };
}

async function fixtureFetch(fixtures, calls) {
  const projects = new Map();
  const artifacts = new Map();
  for (const fixture of fixtures) {
    const list = projects.get(fixture.name) || [];
    list.push(await packageFile(fixture));
    projects.set(fixture.name, list);
    artifacts.set(`https://packages.test/files/${fixture.filename}`, fixture);
  }
  return async (url, options = {}) => {
    calls.push({ url: String(url), accept: options.headers?.Accept || null });
    const project = /^https:\/\/packages\.test\/simple\/([^/]+)\/$/u.exec(String(url));
    if (project) {
      const files = projects.get(project[1]);
      if (!files) return new Response("missing", { status: 404 });
      return new Response(JSON.stringify({ meta: { "api-version": "1.0" }, name: project[1], files }), {
        status: 200, headers: { "content-type": "application/vnd.pypi.simple.v1+json" },
      });
    }
    const metadata = String(url).endsWith(".metadata");
    const artifactUrl = metadata ? String(url).slice(0, -".metadata".length) : String(url);
    const fixture = artifacts.get(artifactUrl);
    if (!fixture) return new Response("missing", { status: 404 });
    const bytes = metadata ? fixture.metadata : fixture.bytes;
    return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.byteLength) } });
  };
}

function resolver(fetch, overrides = {}) {
  return new SimpleApiPackageResolver({ fetch, indexes: [{ url: INDEX, trustRef: "trust:test-index" }],
    pythonVersion: "3.14.6", allowedTags: ["py3-none-any"], ...overrides });
}

function corruptPath(wheel) {
  const bytes = Buffer.from(wheel);
  const source = Buffer.from("demo/__init__.py");
  const target = Buffer.from("../x/escape.py??");
  assert(source.byteLength === target.byteLength, "malicious path fixture length changed");
  let offset = 0;
  let replacements = 0;
  while ((offset = bytes.indexOf(source, offset)) >= 0) {
    target.copy(bytes, offset);
    offset += target.byteLength;
    replacements += 1;
  }
  assert(replacements === 2, "malicious path fixture did not patch both ZIP headers");
  return new Uint8Array(bytes);
}

function replaceZipPath(wheel, sourcePath, targetPath) {
  const bytes = Buffer.from(wheel);
  const source = Buffer.from(sourcePath);
  const target = Buffer.from(targetPath);
  assert(source.byteLength === target.byteLength, "malicious replacement path length changed");
  let offset = 0;
  let replacements = 0;
  while ((offset = bytes.indexOf(source, offset)) >= 0) {
    target.copy(bytes, offset);
    offset += target.byteLength;
    replacements += 1;
  }
  assert(replacements === 2, `malicious path fixture patched ${replacements} ZIP headers`);
  return new Uint8Array(bytes);
}

function markSymlink(wheel, path) {
  const bytes = Buffer.from(wheel);
  for (let offset = 0; offset <= bytes.byteLength - 46; offset += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = bytes.readUInt16LE(offset + 28);
    if (bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8") === path) {
      bytes.writeUInt32LE(0xa1ff0000, offset + 38);
      return new Uint8Array(bytes);
    }
  }
  throw new Error("symlink fixture central entry is missing");
}

export async function assertPackageEnvironmentContract() {
  assert(PACKAGE_LOCK_PROTOCOL === "pyproc.package-lock" && PACKAGE_LOCK_VERSION === 2
    && PACKAGE_ENVIRONMENT_PROTOCOL === "pyproc.package-environment" && PACKAGE_ENVIRONMENT_VERSION === 2
    && comparePackageVersions("1.0rc1", "1.0") < 0
    && (await packageEnvironmentIdentity({ engineId: "engine:test", lock: {}, treeDigests: [],
      policyDigest: "policy:test" })).startsWith("sha256:"), "package protocol or identity exports drifted");
  const demo = wheelFixture("demo", "1.0.0", ["helper>=1; python_version >= '3.14'"],
    undefined, undefined, [], ">=2.7, !=3.0.*, !=3.1.*, !=3.2.*");
  demo.fileOverrides = { "requires-python": "!=3.0.*,!=3.1.*,!=3.2.*,>=2.7" };
  const helper = wheelFixture("helper", "1.1.0");
  const tree = await inspectPurePythonWheel(demo.bytes, { filename: demo.filename,
    expectedName: "demo", expectedVersion: "1.0.0", expectedSha256: await sha256Address(demo.bytes),
    allowedTags: ["py3-none-any"] });
  assert(tree.name === "demo" && tree.dependencies.length === 1 && tree.files.length === 4
    && tree.treeDigest.startsWith("sha256:"), "safe wheel did not produce a sealed pure Python tree");

  const malicious = await rejectionOf(() => inspectPurePythonWheel(corruptPath(demo.bytes), { filename: demo.filename }));
  assert(malicious?.code === "PYPROC_PACKAGE_INTEGRITY", "path traversal wheel crossed the staging boundary");
  const absolute = replaceZipPath(demo.bytes, "demo/__init__.py", "/x/escape.py????");
  assert((await rejectionOf(() => inspectPurePythonWheel(absolute, { filename: demo.filename })))?.code
    === "PYPROC_PACKAGE_INTEGRITY", "absolute wheel path crossed the staging boundary");
  const symlink = markSymlink(demo.bytes, "demo/__init__.py");
  assert((await rejectionOf(() => inspectPurePythonWheel(symlink, { filename: demo.filename })))?.code
    === "PYPROC_PACKAGE_INTEGRITY", "wheel symlink crossed the staging boundary");
  const collision = wheelFixture("collision", "1.0.0", [], "value = 1\n", "collision/A.py",
    [{ path: "collision/a.py", source: "value = 2\n" }]);
  assert((await rejectionOf(() => inspectPurePythonWheel(collision.bytes, { filename: collision.filename })))?.code
    === "PYPROC_PACKAGE_INTEGRITY", "case-colliding wheel paths crossed the staging boundary");
  const duplicate = wheelFixture("duplicate", "1.0.0", [], "value = 1\n", "duplicate/item.py",
    [{ path: "duplicate/item.py", source: "value = 2\n" }]);
  assert((await rejectionOf(() => inspectPurePythonWheel(duplicate.bytes, { filename: duplicate.filename })))?.code
    === "PYPROC_PACKAGE_INTEGRITY", "duplicate wheel paths crossed the staging boundary");
  const reserved = wheelFixture("reserved", "1.0.0", [], "value = 1\n", "reserved/CON.py");
  assert((await rejectionOf(() => inspectPurePythonWheel(reserved.bytes, { filename: reserved.filename })))?.code
    === "PYPROC_PACKAGE_INTEGRITY", "reserved device path crossed the staging boundary");
  const script = wheelFixture("scriptpkg", "1.0.0", [], "print('script')\n", "scriptpkg-1.0.0.data/scripts/run.py");
  assert((await rejectionOf(() => inspectPurePythonWheel(script.bytes, { filename: script.filename })))?.code
    === "PYPROC_PACKAGE_INTEGRITY", "wheel install script crossed the no-hook boundary");
  const bomb = wheelFixture("bomb", "1.0.0", [], `value = '${"a".repeat(1024 * 1024)}'\n`);
  assert((await rejectionOf(() => inspectPurePythonWheel(bomb.bytes, { filename: bomb.filename })))?.code
    === "PYPROC_PACKAGE_INTEGRITY", "high-ratio wheel crossed archive limits");
  const native = wheelFixture("nativepkg", "1.0.0", [], "native", "nativepkg/native.so");
  assert((await rejectionOf(() => inspectPurePythonWheel(native.bytes, { filename: native.filename })))?.code
    === "PYPROC_PACKAGE_ABI_UNSUPPORTED", "native wheel crossed the pure Python ABI boundary");
  const badHash = demo.bytes.slice();
  badHash[40] ^= 1;
  assert((await rejectionOf(() => inspectPurePythonWheel(badHash, { filename: demo.filename })))?.code === "PYPROC_PACKAGE_INTEGRITY",
    "corrupt wheel did not fail archive or RECORD integrity");

  const calls = [];
  const onlineResolver = resolver(await fixtureFetch([demo, helper], calls));
  const locked = await onlineResolver.resolve(["demo==1.0.0"]);
  assert(locked.lock.packages.map((entry) => entry.name).join(",") === "demo,helper"
    && locked.lock.packages.every((entry) => entry.sourceIndex === INDEX && entry.sha256.startsWith("sha256:")),
  "online dependency resolution lost canonical package source or hash fields");
  assert(calls.filter((call) => call.url.includes("/simple/")).every((call) =>
    call.accept === "application/vnd.pypi.simple.v1+json"), "Simple API request omitted its exact JSON media type");

  const store = new MemoryPackageContentStore();
  const online = await onlineResolver.materialize(locked.lock, { contentStore: store });
  const networkCalls = calls.length;
  let offlineFetches = 0;
  const offlineResolver = resolver(async () => { offlineFetches += 1; throw new Error("offline fetch attempted"); });
  const offline = await offlineResolver.materialize(locked.lock, { contentStore: store, offline: true });
  assert(online.wheels.every((wheel) => wheel.source === "network")
    && offline.wheels.every((wheel) => wheel.source === "content-store") && offlineFetches === 0
    && calls.length === networkCalls, "offline restore contacted an index or missed hash storage");

  const root = wheelFixture("rootpkg", "1.0.0", ["shared<2"]);
  const other = wheelFixture("otherpkg", "1.0.0", ["shared>=2"]);
  const shared1 = wheelFixture("shared", "1.0.0");
  const shared2 = wheelFixture("shared", "2.0.0");
  const conflictResolver = resolver(await fixtureFetch([root, other, shared1, shared2], []));
  const conflict = await rejectionOf(() => conflictResolver.resolve(["rootpkg", "otherpkg"]));
  assert(conflict?.code === "PYPROC_PACKAGE_RESOLUTION" && /conflict/u.test(conflict.message),
    "dependency conflict did not terminate resolution");
  const feature = wheelFixture("featurepkg", "1.0.0", ["optionaldep>=1; extra == 'fast'"]);
  const optional = wheelFixture("optionaldep", "1.0.0");
  const featureResolver = resolver(await fixtureFetch([feature, optional], []));
  const featureLock = await featureResolver.resolve(["featurepkg[fast]"]);
  assert(featureLock.lock.packages.map((entry) => entry.name).join(",") === "featurepkg,optionaldep",
    "requested extras did not expand their marked dependency");
  assert(parsePackageRequirement("Demo[fast]>=1; python_version >= '3.14'").extras[0] === "fast"
    && evaluatePackageMarker("python_version >= '3.14' and sys_platform == 'wasi'",
      { python_version: "3.14", sys_platform: "wasi" }), "requirement extras or environment markers drifted");

  const prerelease = wheelFixture("prepkg", "2.0rc1");
  const prereleaseCalls = [];
  const explicitResolver = resolver(await fixtureFetch([prerelease], prereleaseCalls), { prereleasePolicy: "explicit" });
  assert((await rejectionOf(() => explicitResolver.resolve(["prepkg>=1"])))?.code === "PYPROC_PACKAGE_RESOLUTION"
    && (await explicitResolver.resolve(["prepkg==2.0rc1"])).lock.packages[0].version === "2.0rc1",
  "prerelease policy accepted an implicit candidate or rejected an exact prerelease");
  const incompatible = wheelFixture("futurepkg", "1.0.0");
  incompatible.fileOverrides = { "requires-python": ">=4" };
  const yanked = wheelFixture("yankedpkg", "1.0.0");
  yanked.fileOverrides = { yanked: "security withdrawal" };
  const incompatibleResolver = resolver(await fixtureFetch([incompatible], []));
  const yankedResolver = resolver(await fixtureFetch([yanked], []));
  assert((await rejectionOf(() => incompatibleResolver.resolve(["futurepkg"])))?.code
    === "PYPROC_PACKAGE_RESOLUTION"
    && (await rejectionOf(() => yankedResolver.resolve(["yankedpkg"])))?.code
      === "PYPROC_PACKAGE_RESOLUTION", "Requires-Python or yanked policy admitted an ineligible artifact");
  const unknownMajor = resolver(async () => new Response(JSON.stringify({ meta: { "api-version": "2.0" },
    name: "demo", files: [] }), { status: 200,
    headers: { "content-type": "application/vnd.pypi.simple.v2+json" } }));
  assert((await rejectionOf(() => unknownMajor.resolve(["demo"])))?.code === "PYPROC_PACKAGE_RESOLUTION",
    "unknown Simple API major version was accepted");

  const kernelCalls = [];
  const kernel = {
    async describe() { return { engineId: "sha256:" + "a".repeat(64), nativeProfile: "core" }; },
    async installEnvironment(request) {
      kernelCalls.push(request);
      return { protocol: "pyproc.environment-receipt", version: 2, environmentId: request.environmentId,
        installed: { files: request.wheels.length } };
    },
  };
  const environment = new PackageEnvironment({ kernel, resolver: onlineResolver, contentStore: store });
  const receipt = await environment.install({ lock: locked.lock, offline: true });
  assert(receipt.environmentId.startsWith("sha256:") && receipt.nativeProfile === "core"
    && receipt.sources.every((source) => source === "content-store")
    && kernelCalls.length === 1 && kernelCalls[0].wheels.length === 2 && environment.inspect() === receipt,
  "package environment did not atomically bind lock, trees, policy, and engine identity");

  let terminalInstalls = 0;
  const terminal = new KernelTerminal({ async execute() {}, async setValue() {}, async getValue() {} }, {
    packageEnvironment: { async install(request) { terminalInstalls += 1; return { environmentId: "sha256:" + "b".repeat(64), request }; } },
  });
  const terminalResult = await terminal.push("%pip install demo==1.0.0");
  assert(terminalInstalls === 1 && terminalResult.out.includes("sha256:"),
    "terminal package command bypassed the package environment contract");

  const sources = await Promise.all([
    "../../src/runtime/packageResolver.js", "../../src/runtime/wheelInstaller.js",
    "../../src/capabilities/packageEnvironment.js", "../../src/capabilities/kernelTerminal.js",
    "../../src/composition/kernelEnvironmentManager.js",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert(sources.join("\n").includes("inspectPurePythonWheel")
    && sources.join("\n").includes("SimpleApiPackageResolver"),
  "M8 package path no longer routes through the owned resolver and wheel inspector");
}
