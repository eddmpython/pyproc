import { KernelFactory } from "../../src/composition/kernelFactory.js";
import { sha256Address } from "../../src/runtime/contentDigest.js";
import { createKernelEngineManifest } from "../../src/runtime/kernel/engineManifest.js";

const CORE_ASSET_ROOT = "/.cache/owned-engine/core/a/";
const DATA_ASSET_ROOT = "/.cache/owned-engine/data/a/";

function createGate() {
  const output = document.getElementById("out");
  const checks = [];
  const timings = {};
  const check = (name, pass, info = "") => {
    checks.push({ name, pass: Boolean(pass), info: String(info) });
    output.textContent += `\n${pass ? "PASS" : "FAIL"} ${name}${info ? ` (${info})` : ""}`;
  };
  const report = async () => {
    window.__ownedEngineReported = true;
    await fetch("/gateReport", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: checks.length > 0 && checks.every((entry) => entry.pass), checks, timings }) });
  };
  return { check, report, timings };
}

function withTimeout(promise, milliseconds, label) {
  return Promise.race([promise, new Promise((resolve, reject) => setTimeout(
    () => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds))]);
}

async function jsonAsset(root, name) {
  const response = await fetch(root + name);
  if (!response.ok) throw new Error(`owned engine artifact unavailable: ${name} (${response.status})`);
  return response.json();
}

async function loadBuildManifest(root, nativeProfile) {
  const response = await fetch(root + "engine-build-manifest.json");
  if (!response.ok) throw new Error(`owned engine build manifest unavailable: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const build = JSON.parse(new TextDecoder().decode(bytes));
  const buildManifestSha256 = await sha256Address(bytes);
  const manifest = await createKernelEngineManifest({
    engineId: build.engineId,
    environmentId: buildManifestSha256,
    runtimeKind: "cpython-wasi",
    target: "wasm32-wasip1",
    pythonVersion: build.source.version,
    nativeProfile,
    stdlibDir: "python3.14",
    artifacts: {
      wasm: { url: root + build.outputs.engine.file,
        sha256: `sha256:${build.outputs.engine.sha256}`, byteLength: build.outputs.engine.byteLength },
      stdlib: { url: root + build.outputs.stdlib.file,
        sha256: `sha256:${build.outputs.stdlib.sha256}`, byteLength: build.outputs.stdlib.byteLength },
    },
    buildManifestSha256,
  });
  return { build, manifest };
}

async function runPython(kernel, commandId, code) {
  const result = await kernel.execute({ commandId, code });
  if (result.state !== "completed") throw new Error(result.error?.message || `Python command failed: ${commandId}`);
  return result.stdout.map((chunk) => chunk.text).join("\n");
}

export async function runOwnedEngineCoreProduct() {
  const gate = createGate();
  let kernel = null;
  try {
    window.__ownedEngineStage = "core-evidence";
    gate.check("cross-origin isolated worker boundary", crossOriginIsolated === true);
    const [{ build, manifest }, inventory] = await Promise.all([
      loadBuildManifest(CORE_ASSET_ROOT, "core"),
      jsonAsset(CORE_ASSET_ROOT, "stdlib-inventory.json"),
    ]);
    gate.check("pinned source and SDK manifest", build.source.commit
      === "c63aec69bd59c55314c06c23f4c22c03de76fe45"
      && build.toolchain.wasiSdkVersion === "24.0");
    gate.check("stdlib inventory", inventory.fileCount >= 500
      && inventory.files.some((entry) => entry.path === "asyncio/__init__.py"), inventory.fileCount);

    window.__ownedEngineStage = "core-browser-boot";
    const started = performance.now();
    const factory = new KernelFactory();
    kernel = await withTimeout(factory.open(manifest), 30000, "owned core browser boot");
    gate.timings.bootMs = Math.round(performance.now() - started);
    const host = JSON.parse(await runPython(kernel, "core:host-oracle", `
import json, sys, _pyprocHost
print(json.dumps({"version": sys.version.split()[0], "origin": _pyprocHost.__spec__.origin,
                  "abi": _pyprocHost.abiVersion(), "noop": _pyprocHost.noop()}, sort_keys=True))
`));
    gate.check("owned CPython 3.14.6 browser boot", host.version === "3.14.6",
      `${host.version}, ${gate.timings.bootMs}ms`);
    gate.check("static _pyprocHost import", host.origin === "built-in"
      && host.abi === "pyproc.hostcall/1" && host.noop === null, JSON.stringify(host));
    const stdlib = await runPython(kernel, "core:stdlib-oracle",
      "import decimal, hashlib, pathlib\nprint(decimal.Decimal('1.25') + decimal.Decimal('2.75'), hashlib.sha256(b'pyproc').hexdigest()[:8], pathlib.PurePosixPath('/a') / 'b')");
    gate.check("external stdlib import and oracle", stdlib.trim() === "4.00 efca726f /a/b", stdlib.trim());
    await runPython(kernel, "core:state", "owned_state = {'value': 41}");
    const checkpoint = await factory.checkpoint(kernel, { commandId: "core:checkpoint" });
    await runPython(kernel, "core:mutate", "owned_state['value'] = 99");
    await kernel.restore({ commandId: "core:restore", checkpointRef: checkpoint.checkpointRef });
    gate.check("owned engine checkpoint resume",
      (await runPython(kernel, "core:restored-value", "print(owned_state['value'])")).trim() === "41");
  } catch (error) {
    gate.check("owned core product probe completes", false,
      `${window.__ownedEngineStage}: ${String(error).slice(-600)}`);
  } finally {
    await kernel?.close();
  }
  await gate.report();
}

export async function runOwnedEngineDataProduct() {
  const gate = createGate();
  let dataKernel = null;
  let coreKernel = null;
  try {
    window.__ownedEngineStage = "data-evidence";
    gate.check("cross-origin isolated native profile boundary", crossOriginIsolated === true);
    const [coreLoaded, dataLoaded, profileInput, sbom] = await Promise.all([
      loadBuildManifest(CORE_ASSET_ROOT, "core"),
      loadBuildManifest(DATA_ASSET_ROOT, "data"),
      jsonAsset(DATA_ASSET_ROOT, "native-profile-build-input.json"),
      jsonAsset(DATA_ASSET_ROOT, "engine.cyclonedx.json"),
    ]);
    const coreManifest = coreLoaded.build;
    const dataManifest = dataLoaded.build;
    const dataModules = dataManifest.recipe?.nativeModules?.map((entry) => entry.name) || [];
    const inputModules = profileInput.recipe?.modules?.map((entry) => entry.name) || [];
    gate.check("profile compiler seals source and provenance",
      profileInput.protocol === "pyproc.native-profile-build-input" && profileInput.version === 1
      && profileInput.profile === "data" && profileInput.engineId === dataManifest.engineId
      && dataManifest.recipe.nativeProfileInputSha256 === dataManifest.outputs.nativeProfileBuildInput.sha256
      && inputModules.join(",") === "_pyprocHost,_pyprocData"
      && dataModules.join(",") === "_pyprocHost,_pyprocData"
      && sbom.components.some((entry) => entry.name === "_pyprocData"));
    const wasmDelta = dataManifest.outputs.engine.byteLength - coreManifest.outputs.engine.byteLength;
    gate.check("profile identity and size budget", dataManifest.nativeProfile === "data"
      && dataManifest.engineId === "cpython-wasi-3.14.6-pyproc-data-2"
      && dataManifest.engineId !== coreManifest.engineId
      && dataManifest.outputs.engine.byteLength <= profileInput.budgets.maxWasmBytes
      && dataManifest.outputs.stdlib.byteLength <= profileInput.budgets.maxStdlibZipBytes
      && wasmDelta >= 0 && wasmDelta <= profileInput.budgets.maxWasmDeltaFromCoreBytes,
    `${dataManifest.outputs.engine.byteLength} bytes, delta ${wasmDelta}`);

    window.__ownedEngineStage = "data-browser-boot";
    const started = performance.now();
    const dataFactory = new KernelFactory();
    dataKernel = await withTimeout(dataFactory.open(dataLoaded.manifest), 30000, "owned data browser boot");
    gate.timings.dataBootMs = Math.round(performance.now() - started);
    const oracle = JSON.parse(await runPython(dataKernel, "data:oracle", `
import json, _pyprocData
from array import array
left = array("d", [1, 2.5, -4])
right = array("d", [3, 4.5, 6])
added = array("d")
added.frombytes(_pyprocData.vector_add_f64(left, right))
print(json.dumps({"origin": _pyprocData.__spec__.origin, "profile": _pyprocData.profile(),
                  "simd": _pyprocData.simd(), "sum": _pyprocData.vector_add([1, 2.5], [3, 4.5]),
                  "dot": _pyprocData.dot([1, 2, 3], [4, 5, 6]), "simdSum": list(added),
                  "simdDot": _pyprocData.dot_f64(left, right)}, sort_keys=True))
`));
    gate.check("source-built data module static import", oracle.origin === "built-in"
      && oracle.profile === "pyproc.data/2" && oracle.simd === "wasm-simd128",
    `${oracle.origin}, ${oracle.simd}, ${gate.timings.dataBootMs}ms`);
    gate.check("data profile scalar and SIMD numerical oracles", oracle.sum.join(",") === "4,7"
      && oracle.dot === 32 && oracle.simdSum.join(",") === "4,7,2" && oracle.simdDot === -9.75,
      JSON.stringify(oracle));
    const scientific = JSON.parse(await runPython(dataKernel, "data:scientific-boundary", `
import importlib, json
result = {}
for name in ("numpy", "scipy", "pandas", "polars"):
    try:
        importlib.import_module(name)
    except Exception as error:
        result[name] = type(error).__name__
    else:
        result[name] = "IMPORTED"
print(json.dumps(result, sort_keys=True))
`));
    gate.check("representative scientific import boundary remains explicit",
      Object.values(scientific).every((value) => value === "ModuleNotFoundError"), JSON.stringify(scientific));
    const workload = JSON.parse(await runPython(dataKernel, "data:workload", `
import json, _pyprocData
value = 0.0
for index in range(10000):
    value += _pyprocData.dot([index, 2, 3], [1, 5, 7])
print(json.dumps({"calls": 10000, "value": value}))
`));
    gate.check("repeated native calls remain deterministic",
      workload.calls === 10000 && workload.value === 50305000);
    const rejected = JSON.parse(await runPython(dataKernel, "data:negative", `
import json, _pyprocData
from array import array
errors = []
for operation in (lambda: _pyprocData.vector_add([1], [2, 3]),
                  lambda: _pyprocData.dot([float("nan")], [1]),
                  lambda: _pyprocData.dot(["not-a-number"], [1]),
                  lambda: _pyprocData.dot_f64(array("d", [1]), array("d", [2, 3])),
                  lambda: _pyprocData.vector_add_f64(array("d", [float("nan")]), array("d", [1]))):
    try:
        operation()
    except Exception as error:
        errors.append(type(error).__name__)
print(json.dumps(errors))
`));
    gate.check("invalid native inputs fail closed",
      rejected.join(",") === "ValueError,ValueError,TypeError,ValueError,ValueError", rejected.join(","));
    await runPython(dataKernel, "data:state",
      "native_profile_state = _pyprocData.dot([3, 4], [5, 6])");
    const checkpoint = await dataFactory.checkpoint(dataKernel, { commandId: "data:checkpoint" });
    await runPython(dataKernel, "data:mutate", "native_profile_state = -1");
    await dataKernel.restore({ commandId: "data:restore", checkpointRef: checkpoint.checkpointRef });
    gate.check("data profile checkpoint restores exact state",
      (await runPython(dataKernel, "data:restored-value",
        "print(native_profile_state, _pyprocData.profile())")).trim()
        === "39.0 pyproc.data/2");
    await dataKernel.close();
    dataKernel = null;

    window.__ownedEngineStage = "core-profile-separation";
    coreKernel = await withTimeout(new KernelFactory().open(coreLoaded.manifest),
      30000, "owned core separation boot");
    const coreImport = (await runPython(coreKernel, "core:data-import-negative", `
try:
    import _pyprocData
except Exception as error:
    print(type(error).__name__)
else:
    print("IMPORTED")
`)).trim();
    gate.check("data module is absent from core profile", coreImport === "ModuleNotFoundError", coreImport);
  } catch (error) {
    gate.check("owned data product probe completes", false,
      `${window.__ownedEngineStage}: ${String(error).slice(-1000)}`);
  } finally {
    await dataKernel?.close();
    await coreKernel?.close();
  }
  await gate.report();
}
