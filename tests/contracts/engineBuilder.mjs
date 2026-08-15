import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDeterministicZip } from "../../scripts/engineBuilder/deterministicZip.mjs";
import {
  NATIVE_PROFILE_COMPILER_VERSION,
  NATIVE_PROFILE_INPUT_PROTOCOL,
  nativeProfileBuildInput,
} from "../../scripts/engineBuilder/nativeProfileCompiler.mjs";
import {
  WINDOWS_CROSS_SYSCONFIG_WRAPPER,
  patchWindowsMakefile,
} from "../../scripts/engineBuilder/buildOwnedEngineWindowsProbe.mjs";
import {
  CANONICAL_BUILD_ROOT,
  canonicalizeGeneratedPlatformData,
  collectGeneratedPlatformData,
  ownedBuildDetailsArguments,
} from "../../scripts/engineBuilder/packageOwnedEngine.mjs";
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
  assert(lock.nativeProfiles?.data?.engineId === "cpython-wasi-3.14.6-pyproc-data-2"
    && lock.nativeProfiles.data.modules.map((module) => module.name).join(",") === "_pyprocHost,_pyprocData"
    && lock.nativeProfiles.data.modules[1].abiVersion === "pyproc.data/2"
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
  assert(dataSource.includes("PyInit__pyprocData") && dataSource.includes("wasm_f64x2_add")
    && dataSource.includes("wasm_f64x2_mul") && dataSource.includes("wasm-simd128")
    && dataSetup.split(/\r?\n/u).includes("MODULE__PYPROCDATA_CFLAGS=-msimd128")
    && dataSetup.split(/\r?\n/u).includes("_pyprocData _pyprocData.c $(MODULE__PYPROCDATA_CFLAGS)"),
  "static data profile module recipe is incomplete");
  const compiledData = await nativeProfileBuildInput("data");
  const compiledCore = await nativeProfileBuildInput("core");
  assert(compiledData.input.protocol === NATIVE_PROFILE_INPUT_PROTOCOL
    && compiledData.input.version === NATIVE_PROFILE_COMPILER_VERSION
    && compiledData.input.engineId !== compiledCore.input.engineId
    && /^[0-9a-f]{64}$/u.test(compiledData.input.recipe.packagerSha256)
    && /^[0-9a-f]{64}$/u.test(compiledData.input.recipe.linuxBuilderSha256)
    && /^[0-9a-f]{64}$/u.test(compiledData.input.recipe.windowsBuilderSha256)
    && compiledData.input.recipe.modules[1].sourceSha256 === lock.nativeProfiles.data.modules[1].sourceSha256
    && compiledData.input.recipe.setupSha256 === lock.nativeProfiles.data.setupSha256
    && compiledData.input.outputs.includes("native-profile-build-input.json"),
  "native profile compiler did not seal source, ABI, engine, and output provenance");

  const sysconfigFixture = await mkdtemp(join(tmpdir(), "pyprocSysconfigData-"));
  try {
    const nested = join(sysconfigFixture, "build", "lib.wasi");
    const fixtureRoot = sysconfigFixture.replaceAll("\\", "/");
    await mkdir(nested, { recursive: true });
    await writeFile(join(sysconfigFixture, "pybuilddir.txt"), "build/lib.wasi\n");
    await writeFile(join(nested, "_sysconfigdata__wasi_wasm32-wasi.py"),
      `build_time_vars = {'abs_builddir': '${fixtureRoot}/target'}\r\n`);
    await writeFile(join(nested, "_sysconfig_vars__wasi_wasm32-wasi.json"),
      `${JSON.stringify({ abs_builddir: `${fixtureRoot}/target` })}\r\n`);
    await writeFile(join(nested, "build-details.json"), `${JSON.stringify({
      schema_version: "1.0",
      base_prefix: "/usr/local",
      base_interpreter: "/usr/local/bin/python3.14",
      platform: "wasi-0.0.0-wasm32",
      suffixes: { extensions: [".cpython-314-wasm32-wasi.so", ".abi3.so", ".so"] },
    })}\n`);
    const invocation = await ownedBuildDetailsArguments({
      sourceDir: "/source", buildDir: sysconfigFixture, target: "wasm32-wasip1",
    });
    assert(invocation.args.includes("_PYTHON_SYSCONFIGDATA_PATH=/cross-build/wasm32-wasip1/build/lib.wasi")
      && invocation.args.at(-1) === "/cross-build/wasm32-wasip1/build/lib.wasi/build-details.json",
    "target runtime build details invocation is not rooted in generated sysconfig data");
    await canonicalizeGeneratedPlatformData({ buildDir: sysconfigFixture, workspaceRoot: sysconfigFixture });
    const canonicalData = await readFile(join(nested, "_sysconfigdata__wasi_wasm32-wasi.py"), "utf8");
    const canonicalVars = await readFile(join(nested, "_sysconfig_vars__wasi_wasm32-wasi.json"), "utf8");
    assert(canonicalData.includes(`${CANONICAL_BUILD_ROOT}/target`) && !canonicalData.includes("\r")
      && JSON.parse(canonicalVars).abs_builddir === `${CANONICAL_BUILD_ROOT}/target`,
    "generated sysconfig data retains a local workspace path or host newline");
    const generated = await collectGeneratedPlatformData(sysconfigFixture);
    assert(generated.map((entry) => entry.archivePath).join(",")
      === "_sysconfig_vars__wasi_wasm32-wasi.json,_sysconfigdata__wasi_wasm32-wasi.py,build-details.json",
    "generated platform metadata is not promoted to the stdlib root");
    await rm(join(nested, "build-details.json"));
    let missingRejected = false;
    try { await collectGeneratedPlatformData(sysconfigFixture); }
    catch (error) { missingRejected = /exactly one/u.test(error.message); }
    assert(missingRejected, "incomplete generated platform metadata was accepted");
  } finally {
    await rm(sysconfigFixture, { recursive: true, force: true });
  }

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
  assert(WINDOWS_CROSS_SYSCONFIG_WRAPPER.includes("os.name = 'posix'")
    && WINDOWS_CROSS_SYSCONFIG_WRAPPER.includes("runpy.run_module('sysconfig'"),
  "Windows host sysconfig wrapper does not isolate target POSIX generation");

  const workflow = await readFile(new URL("../../.github/workflows/owned-engine.yml", import.meta.url), "utf8");
  const windowsBuilder = await readFile(new URL("../../scripts/engineBuilder/buildOwnedEngineWindowsProbe.mjs",
    import.meta.url), "utf8");
  const linuxBuilder = await readFile(new URL("../../scripts/engineBuilder/buildOwnedEngine.mjs",
    import.meta.url), "utf8");
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
  assert(windowsBuilder.includes("MSYS2_ARG_CONV_EXCL")
    && windowsBuilder.includes("generateWindowsCrossSysconfigData")
    && windowsBuilder.includes("ownedBuildDetailsArguments"),
    "Windows owned engine build does not generate platform metadata");
  assert(linuxBuilder.includes("ownedBuildDetailsArguments"),
    "Linux owned engine build does not generate platform metadata");
}
