import { readFile } from "node:fs/promises";

import { createDeterministicZip } from "../../scripts/engineBuilder/deterministicZip.mjs";
import {
  NATIVE_PROFILE_COMPILER_VERSION,
  NATIVE_PROFILE_INPUT_PROTOCOL,
  nativeProfileBuildInput,
} from "../../scripts/engineBuilder/nativeProfileCompiler.mjs";
import { patchWindowsMakefile } from "../../scripts/engineBuilder/buildOwnedEngineWindowsProbe.mjs";
import { unzipWheel } from "../../src/runtime/engines/wasi/wheelUnzip.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function assertOwnedEngineBuilder() {
  const base = new URL("../../scripts/engineBuilder/", import.meta.url);
  const lock = JSON.parse(await readFile(new URL("engineBuildLock.json", base), "utf8"));
  assert(lock.engineId === "cpython-wasi-3.14.6-pyproc-host-1"
    && lock.cpython.commit === "c63aec69bd59c55314c06c23f4c22c03de76fe45"
    && lock.wasiSdk.version === "24.0"
    && lock.cflags === "-O3 -g0 -fno-ident",
  "owned engine build lock drifted");
  assert(lock.nativeProfiles?.data?.engineId === "cpython-wasi-3.14.6-pyproc-data-1"
    && lock.nativeProfiles.data.modules.map((module) => module.name).join(",") === "_pyprocHost,_pyprocData"
    && lock.nativeProfiles.data.budgets.maxWasmBytes === 7850000,
  "owned data native profile lock is incomplete");
  const hashes = [
    lock.cpython.archiveSha256,
    lock.wasiSdk.linuxX8664.archiveSha256,
    lock.wasiSdk.windowsX8664.archiveSha256,
    lock.wasmtime.linuxX8664.archiveSha256,
    lock.wasmtime.windowsX8664.archiveSha256,
    ...Object.values(lock.windowsProbeTools).map((entry) => entry.archiveSha256),
  ];
  assert(hashes.every((hash) => /^[0-9a-f]{64}$/u.test(hash)), "owned engine input digest is not exact");

  const hostSource = await readFile(new URL("_pyprocHost.c", base), "utf8");
  const setup = await readFile(new URL("Setup.local", base), "utf8");
  const dataSource = await readFile(new URL("_pyprocData.c", base), "utf8");
  const dataSetup = await readFile(new URL("Setup.data.local", base), "utf8");
  assert(hostSource.includes("PyInit__pyprocHost") && hostSource.includes("abiVersion")
    && hostSource.includes("pyproc.hostcall/1")
    && setup.split(/\r?\n/u).includes("_pyprocHost _pyprocHost.c"),
  "static PyProc host module recipe is incomplete");
  assert(dataSource.includes("PyInit__pyprocData") && dataSource.includes("pyproc_data_vector_add")
    && dataSource.includes("pyproc_data_dot")
    && dataSetup.split(/\r?\n/u).includes("_pyprocData _pyprocData.c"),
  "static data profile module recipe is incomplete");
  const compiledData = await nativeProfileBuildInput("data");
  const compiledCore = await nativeProfileBuildInput("core");
  assert(compiledData.input.protocol === NATIVE_PROFILE_INPUT_PROTOCOL
    && compiledData.input.version === NATIVE_PROFILE_COMPILER_VERSION
    && compiledData.input.engineId !== compiledCore.input.engineId
    && compiledData.input.recipe.modules[1].sourceSha256 === lock.nativeProfiles.data.modules[1].sourceSha256
    && compiledData.input.outputs.includes("native-profile-build-input.json"),
  "native profile compiler did not seal source, ABI, engine, and output provenance");

  const entries = [
    { path: "b/value.txt", bytes: Buffer.from("two") },
    { path: "a/value.txt", bytes: Buffer.from("one") },
  ];
  const first = createDeterministicZip(entries, lock.sourceDateEpoch);
  const second = createDeterministicZip([...entries].reverse(), lock.sourceDateEpoch);
  assert(first.equals(second), "deterministic stdlib ZIP depends on input order");
  const extracted = await unzipWheel(first);
  assert(extracted.length === 2 && extracted[0][0] === "a/value.txt"
    && Buffer.from(extracted[1][1]).toString("utf8") === "two",
  "deterministic stdlib ZIP is not readable by the product extractor");

  const makeFixture = [
    'MULTIARCH_CPPFLAGS = -DMULTIARCH=\\"wasm32-wasi\\"',
    '-DPYTHONPATH=\'"$(PYTHONPATH)"\'', '-DPREFIX=\'"$(host_prefix)"\'',
    '-DEXEC_PREFIX=\'"$(host_exec_prefix)"\'', '-DVERSION=\'"$(VERSION)"\'',
    '-DVPATH=\'"$(VPATH)"\'', '-DPLATLIBDIR=\'"$(PLATLIBDIR)"\'',
    '-DPYTHONFRAMEWORK=\'"$(PYTHONFRAMEWORK)"\'', '-DSOABI=\'"$(SOABI)"\'',
    '-DSHLIB_EXT=\'"$(EXT_SUFFIX)"\'', '-DABIFLAGS=\'"$(ABIFLAGS)"\'',
    '-DPLATFORM=\'"$(MACHDEP)"\'',
  ].join("\n");
  const patched = patchWindowsMakefile(makeFixture);
  assert(patched.includes('-DPLATFORM=\\\\\\"$(MACHDEP)\\\\\\"'),
    "Windows make quoting patch no longer preserves C string literals");

  const workflow = await readFile(new URL("../../.github/workflows/owned-engine.yml", import.meta.url), "utf8");
  const attributes = await readFile(new URL("../../.gitattributes", import.meta.url), "utf8");
  assert(attributes.includes("*.c    text eol=lf")
    && attributes.includes("scripts/engineBuilder/Setup*.local text eol=lf"),
  "native engine build inputs are not pinned to LF checkout bytes");
  assert(workflow.includes("slot: [a, b]")
    && workflow.includes("profile: [core, data]")
    && workflow.includes("byte-identical-and-browser-boot")
    && workflow.includes('- ".gitattributes"')
    && workflow.includes("name: pyproc-owned-engine-core-a")
    && workflow.includes("tests/browser/ownedEngineCoreProduct.html")
    && workflow.includes("tests/browser/ownedEngineDataProduct.html")
    && !workflow.includes("tests/attempts/")
    && !/uses:\s+[^@\s]+@(v|main|master)/u.test(workflow),
  "owned engine workflow is not an exact two-runner gate");
}
