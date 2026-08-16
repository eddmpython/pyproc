import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MachineHandle,
  WebMachineHost,
  createSnapshotEnvelope,
  createWebMachineManifest,
  createWebMachineManifestContent,
  validateSnapshotEnvelope,
  validateWebMachineManifest,
} from "../../src/machine/index.js";
import { createProductConformanceFactory } from "../../standards/webMachine/conformance/productImplementation.js";
import { runConformance, validateProtocolCoverage } from "../../standards/webMachine/conformance/runVectors.js";
import { createReferenceConformanceFactory } from "../../standards/webMachine/reference/minimalWebMachine.js";
import { WEB_MACHINE_CORE_VECTORS } from "../../standards/webMachine/vectors/coreVectors.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function source(relativePath) {
  return readFile(resolve(ROOT, ...relativePath.split("/")), "utf8");
}

async function json(relativePath) {
  return JSON.parse(await source(relativePath));
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function methods(value) {
  return new Set(Object.getOwnPropertyNames(value.prototype));
}

export async function assertWebMachineStandard() {
  const base = "standards/webMachine/";
  const manifest = await json(`${base}protocolManifest.json`);
  const surface = await json(`${base}surfaceLock.json`);
  const protocol = await source(`${base}protocol.md`);
  const reference = await source(`${base}reference/minimalWebMachine.js`);
  const productBinding = await source(`${base}conformance/productImplementation.js`);
  const wpt = await source(`${base}conformance/wpt/webMachineCore.any.js`);

  assert(manifest.protocol === "web-machine-core" && manifest.version === 1
    && manifest.status === "standard-ready-product-protocol", "protocol identity drifted");
  const documentRequirements = [...protocol.matchAll(/\*\*(WM-CORE-\d{3})\*\*/gu)].map((match) => match[1]);
  assert(JSON.stringify(documentRequirements) === JSON.stringify(manifest.requirements),
    "normative requirement order or membership drifted");
  const coverage = validateProtocolCoverage(manifest.requirements);
  assert(coverage.requirements === 23 && coverage.vectors === 9, "protocol coverage count drifted");

  let negativeFailed = false;
  try {
    validateProtocolCoverage(manifest.requirements, WEB_MACHINE_CORE_VECTORS.filter((vector) => vector.id !== "adapter-contract-before-boot"));
  } catch (error) {
    negativeFailed = /WM-CORE-003/u.test(String(error));
  }
  assert(negativeFailed, "missing-vector negative fixture did not turn the coverage gate red");

  for (const [relativePath, expectedDigest] of Object.entries(manifest.artifacts)) {
    assert(digest(await source(`${base}${relativePath}`)) === expectedDigest,
      `${relativePath}: protocol artifact digest drifted`);
  }

  assert(!/^\s*import\s/mu.test(reference) && !/\b(?:Buffer|process|require)\b/u.test(reference)
    && !/node:/u.test(reference), "minimal implementation gained a product, runtime, or package dependency");
  const bindingImports = [...productBinding.matchAll(/\bfrom\s+["']([^"']+)["']/gu)].map((match) => match[1]);
  assert(bindingImports.length === 1 && bindingImports[0] === "../../../src/machine/index.js",
    "product conformance binding must use only the public machine barrel");

  const product = await runConformance(createProductConformanceFactory());
  const minimal = await runConformance(createReferenceConformanceFactory());
  assert(JSON.stringify(product) === JSON.stringify(minimal), "product and minimal transcripts differ");

  const machineMethods = methods(MachineHandle);
  const hostMethods = methods(WebMachineHost);
  for (const name of surface.machineMethods) assert(machineMethods.has(name), `machine method missing: ${name}`);
  for (const name of surface.hostMethods) assert(hostMethods.has(name), `host method missing: ${name}`);
  for (const [name, value] of Object.entries({
    createSnapshotEnvelope,
    createWebMachineManifest,
    createWebMachineManifestContent,
    validateSnapshotEnvelope,
    validateWebMachineManifest,
  })) assert(typeof value === "function" && surface.imageExports.includes(name), `image surface missing: ${name}`);

  const declarations = await source("src/machine/index.d.ts");
  for (const value of [...surface.machineStates, ...surface.snapshotScopes, ...surface.errorCodes]) {
    assert(declarations.includes(value), `declared surface value missing: ${value}`);
  }
  assert(surface.adapterMethods.join(",") === surface.machineMethods.join(","),
    "adapter and machine core method locks differ");
  assert(/setup\(\{ explicit_done: true \}\)/u.test(wpt) && /promise_test\(/u.test(wpt)
    && /vector\.id/u.test(wpt), "WPT-shaped test lost atomic named asynchronous subtests");
}

