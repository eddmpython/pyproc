import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { createDeterministicZip } from "../engineBuilder/deterministicZip.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCK = JSON.parse(await readFile(join(HERE, "scientificPackageLock.json"), "utf8"));
const encoder = new TextEncoder();

const MODULES = Object.freeze([
  ["numpy._core._multiarray_umath", "numpy/_core/_multiarray_umath.cpython-314-wasm32-wasi.so.p/", "PyInit__multiarray_umath"],
  ["numpy.fft._pocketfft_umath", "numpy/fft/_pocketfft_umath.cpython-314-wasm32-wasi.so.p/", "PyInit__pocketfft_umath"],
  ["numpy.linalg.lapack_lite", "numpy/linalg/lapack_lite.cpython-314-wasm32-wasi.so.p/", "PyInit_lapack_lite"],
  ["numpy.linalg._umath_linalg", "numpy/linalg/_umath_linalg.cpython-314-wasm32-wasi.so.p/", "PyInit__umath_linalg"],
  ["numpy.random._bounded_integers", "numpy/random/_bounded_integers.cpython-314-wasm32-wasi.so.p/", "PyInit__bounded_integers"],
  ["numpy.random._common", "numpy/random/_common.cpython-314-wasm32-wasi.so.p/", "PyInit__common"],
  ["numpy.random._mt19937", "numpy/random/_mt19937.cpython-314-wasm32-wasi.so.p/", "PyInit__mt19937"],
  ["numpy.random._philox", "numpy/random/_philox.cpython-314-wasm32-wasi.so.p/", "PyInit__philox"],
  ["numpy.random._pcg64", "numpy/random/_pcg64.cpython-314-wasm32-wasi.so.p/", "PyInit__pcg64"],
  ["numpy.random._sfc64", "numpy/random/_sfc64.cpython-314-wasm32-wasi.so.p/", "PyInit__sfc64"],
  ["numpy.random.bit_generator", "numpy/random/bit_generator.cpython-314-wasm32-wasi.so.p/", "PyInit_bit_generator"],
  ["numpy.random._generator", "numpy/random/_generator.cpython-314-wasm32-wasi.so.p/", "PyInit__generator"],
  ["numpy.random.mtrand", "numpy/random/mtrand.cpython-314-wasm32-wasi.so.p/", "PyInit_mtrand"],
]);

const MTRAND_LEGACY_SYMBOLS = Object.freeze([
  "random_beta", "random_binomial", "random_binomial_btpe", "random_binomial_inversion",
  "random_bounded_bool_fill", "random_bounded_uint16_fill", "random_bounded_uint32_fill",
  "random_bounded_uint64", "random_bounded_uint64_fill", "random_bounded_uint8_fill",
  "random_buffered_bounded_bool", "random_buffered_bounded_uint16", "random_buffered_bounded_uint32",
  "random_buffered_bounded_uint8", "random_chisquare", "random_exponential", "random_f",
  "random_gamma", "random_gamma_f", "random_geometric", "random_geometric_inversion",
  "random_geometric_search", "random_gumbel", "random_interval", "random_laplace", "random_loggam",
  "random_logistic", "random_lognormal", "random_logseries", "random_multinomial",
  "random_negative_binomial", "random_noncentral_chisquare", "random_noncentral_f", "random_normal",
  "random_pareto", "random_poisson", "random_positive_int", "random_positive_int32",
  "random_positive_int64", "random_power", "random_rayleigh", "random_standard_cauchy",
  "random_standard_exponential", "random_standard_exponential_f", "random_standard_exponential_fill",
  "random_standard_exponential_fill_f", "random_standard_exponential_inv_fill",
  "random_standard_exponential_inv_fill_f", "random_standard_gamma", "random_standard_gamma_f",
  "random_standard_normal", "random_standard_normal_f", "random_standard_normal_fill",
  "random_standard_normal_fill_f", "random_standard_t", "random_standard_uniform",
  "random_standard_uniform_f", "random_standard_uniform_fill", "random_standard_uniform_fill_f",
  "random_triangular", "random_uint", "random_uniform", "random_vonmises", "random_wald",
  "random_weibull", "random_zipf",
]);

function executable(path) {
  return process.platform === "win32" ? `${path}.exe` : path;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024,
    stdio: options.capture ? "pipe" : "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${basename(command)} failed with exit ${result.status}: ${result.stderr?.trim() || "no stderr"}`);
  }
  return result;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256File(path) {
  return sha256(await readFile(path));
}

async function download(cacheDir, name, descriptor) {
  const path = join(cacheDir, name);
  if (!existsSync(path)) {
    const partial = `${path}.partial`;
    const response = await fetch(descriptor.url, { redirect: "follow",
      headers: { "User-Agent": "pyproc-scientific-package-builder/1" } });
    if (!response.ok || !response.body) throw new Error(`download failed ${response.status}: ${descriptor.url}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: "wx" }));
    await rename(partial, path);
  }
  const bytes = await readFile(path);
  if (bytes.byteLength !== descriptor.archiveBytes || sha256(bytes) !== descriptor.archiveSha256) {
    throw new Error(`scientific build input digest mismatch: ${name}`);
  }
  return path;
}

function mesonPath(path) {
  return resolve(path).replaceAll("\\", "/").replaceAll("'", "\\'");
}

function quoted(path) {
  return `'${mesonPath(path)}'`;
}

function lines(value) {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

async function writeResponse(path, args) {
  const body = args.map((arg) => `"${String(arg).replaceAll("\\", "/").replaceAll('"', '\\"')}"`).join("\n");
  await writeFile(path, `${body}\n`);
}

async function targetVariables(hostPython, sysconfigData) {
  const code = [
    "import importlib.util,json,sys",
    "spec=importlib.util.spec_from_file_location('target_sysconfig',sys.argv[1])",
    "module=importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "print(json.dumps(module.build_time_vars,sort_keys=True))",
  ].join(";");
  return JSON.parse(run(hostPython, ["-c", code, sysconfigData], { capture: true }).stdout);
}

function replaceOnce(source, before, after, label) {
  if (source.split(before).length !== 2) throw new Error(`${label} compatibility anchor changed`);
  return source.replace(before, after);
}

function replacePatternOnce(source, pattern, replacement, label) {
  const match = pattern.exec(source);
  if (!match || pattern.exec(source.slice(match.index + match[0].length))) {
    throw new Error(`${label} canonicalization anchor changed`);
  }
  return source.slice(0, match.index) + match[0].replace(pattern, replacement)
    + source.slice(match.index + match[0].length);
}

async function applyCompatibilityOverlay(numpySource) {
  const hashes = {};
  const randomMesonPath = join(numpySource, "numpy", "random", "meson.build");
  let randomMeson = await readFile(randomMesonPath, "utf8");
  randomMeson = replaceOnce(randomMeson, "    c_args: [c_args_random, gen[2]],", [
    "    c_args: [c_args_random, gen[2],",
    "      '-D__pyx_CommonTypesMetaclass_get_module=__pyx_' + gen[0] + '_CommonTypesMetaclass_get_module'],",
  ].join("\n"), "random Cython helper");
  randomMeson = replaceOnce(randomMeson, "    ['-DNP_RANDOM_LEGACY=1'], [npymath_lib],",
    "    ['-DNP_RANDOM_LEGACY=1', '-include', 'pyproc_static_mtrand.h'], [npymath_lib],",
    "legacy random ABI");
  await writeFile(randomMesonPath, randomMeson);
  const legacyHeaderPath = join(numpySource, "numpy", "random", "src", "pyproc_static_mtrand.h");
  await writeFile(legacyHeaderPath, ["#ifndef PYPROC_STATIC_MTRAND_H", "#define PYPROC_STATIC_MTRAND_H",
    ...MTRAND_LEGACY_SYMBOLS.map((symbol) => `#define ${symbol} __pyproc_mtrand_${symbol}`),
    "#endif", ""].join("\n"));

  const coreMesonPath = join(numpySource, "numpy", "_core", "meson.build");
  let coreMeson = await readFile(coreMesonPath, "utf8");
  coreMeson = replaceOnce(coreMeson, "    '-fexceptions',", "    '-fno-exceptions',", "unique exception flag");
  await writeFile(coreMesonPath, coreMeson);

  const uniquePath = join(numpySource, "numpy", "_core", "src", "multiarray", "unique.cpp");
  let unique = await readFile(uniquePath, "utf8");
  unique = replaceOnce(unique, [
    "                // Unexpected error. Throw a C++ exception that will be caught",
    "                // by the caller of unique_vstring() and converted into a Python",
    "                // RuntimeError.",
    "                throw std::runtime_error(\"Failed to load string from packed \"",
    "                                         \"static string.\");",
  ].join("\n"), [
    "                PyErr_SetString(PyExc_RuntimeError,",
    "                                \"Failed to load string from packed static string.\");",
    "                return NULL;",
  ].join("\n"), "unique error path");
  unique = replaceOnce(unique, [
    "    PyObject *result = NULL;", "    try {", "        auto type = PyArray_TYPE(arr);",
    "        // we only support data types present in our unique_funcs map",
    "        if (unique_funcs.find(type) == unique_funcs.end()) {",
    "            result = Py_NewRef(Py_NotImplemented);", "        }", "        else {",
    "            result = unique_funcs[type](arr, equal_nan);", "        }", "    }",
    "    catch (const std::bad_alloc &e) {", "        PyErr_NoMemory();", "        result = NULL;", "    }",
    "    catch (const std::exception &e) {", "        PyErr_SetString(PyExc_RuntimeError, e.what());",
    "        result = NULL;", "    }",
  ].join("\n"), [
    "    PyObject *result = NULL;", "    auto type = PyArray_TYPE(arr);",
    "    // we only support data types present in our unique_funcs map",
    "    if (unique_funcs.find(type) == unique_funcs.end()) {",
    "        result = Py_NewRef(Py_NotImplemented);", "    }", "    else {",
    "        result = unique_funcs[type](arr, equal_nan);", "    }",
  ].join("\n"), "unique exception wrapper");
  await writeFile(uniquePath, unique);

  const fftPath = join(numpySource, "numpy", "fft", "_pocketfft_umath.cpp");
  let fft = await readFile(fftPath, "utf8");
  fft = replaceOnce(fft, [
    "    NPY_ALLOW_C_API_DEF", "    try {", "        cpp_ufunc(args, dimensions, steps, func);", "    }",
    "    catch (std::bad_alloc& e) {", "        NPY_ALLOW_C_API;", "        PyErr_NoMemory();",
    "        NPY_DISABLE_C_API;", "    }", "    catch (const std::exception& e) {",
    "        NPY_ALLOW_C_API;", "        PyErr_SetString(PyExc_RuntimeError, e.what());",
    "        NPY_DISABLE_C_API;", "    }",
  ].join("\n"), "    cpp_ufunc(args, dimensions, steps, func);", "FFT exception wrapper");
  await writeFile(fftPath, fft);

  const pocketfftPath = join(numpySource, "numpy", "fft", "pocketfft", "pocketfft_hdronly.h");
  let pocketfft = await readFile(pocketfftPath, "utf8");
  const throwPattern = /\bthrow(?:\s+std::(?:bad_alloc|runtime_error|invalid_argument)\([^;]*?\))?;/gsu;
  if ([...pocketfft.matchAll(throwPattern)].length !== 20) {
    throw new Error("pocketfft exception compatibility anchors changed");
  }
  pocketfft = pocketfft.replace(throwPattern, "std::abort();");
  await writeFile(pocketfftPath, pocketfft);
  for (const path of [randomMesonPath, legacyHeaderPath, coreMesonPath, uniquePath, fftPath, pocketfftPath]) {
    hashes[relative(numpySource, path).replaceAll("\\", "/")] = await sha256File(path);
  }
  return Object.freeze(hashes);
}

async function generatedSysconfigPath(targetBuildDir) {
  const root = join(targetBuildDir, "build");
  const candidates = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("lib.wasi-wasm32-3.14"));
  if (candidates.length !== 1) throw new Error(`expected one target sysconfig directory, got ${candidates.length}`);
  const files = (await readdir(join(root, candidates[0].name)))
    .filter((name) => /^_sysconfigdata_.*\.py$/u.test(name));
  if (files.length !== 1) throw new Error(`expected one target sysconfig module, got ${files.length}`);
  return join(root, candidates[0].name, files[0]);
}

async function makePythonShim({ workspace, hostPython, sysconfigData, cpythonSource, targetBuildDir, sdkDir }) {
  const shimDir = join(workspace, "python-shim");
  await mkdir(shimDir, { recursive: true });
  const variables = await targetVariables(hostPython, sysconfigData);
  const replaceRoot = (value) => typeof value === "string"
    ? value.replaceAll("/build/pyproc/cpython", mesonPath(cpythonSource))
      .replaceAll("/build/pyproc/wasi-sdk", mesonPath(sdkDir)) : value;
  for (const [name, value] of Object.entries(variables)) variables[name] = replaceRoot(value);
  const include = mesonPath(join(cpythonSource, "Include"));
  const platinclude = mesonPath(targetBuildDir);
  Object.assign(variables, { INCLUDEPY: include, CONFINCLUDEPY: include, LIBDIR: mesonPath(targetBuildDir),
    LIBPL: mesonPath(targetBuildDir), base: mesonPath(cpythonSource), base_prefix: mesonPath(cpythonSource),
    prefix: mesonPath(cpythonSource) });
  const paths = { data: mesonPath(workspace), include, platinclude,
    platlib: mesonPath(join(workspace, "site-packages")), purelib: mesonPath(join(workspace, "site-packages")),
    scripts: mesonPath(join(workspace, "bin")), stdlib: mesonPath(join(cpythonSource, "Lib")) };
  const info = { variables, paths, sysconfig_paths: paths,
    install_paths: { data: "", include: "include/python3.14", platinclude: "include/python3.14",
      platlib: "lib/python3.14/site-packages", purelib: "lib/python3.14/site-packages", scripts: "bin",
      stdlib: "lib/python3.14" }, version: "3.14",
    platform: process.platform === "win32" ? "win-amd64" : "linux-x86_64",
    is_pypy: false, is_venv: false, link_libpython: false,
    suffix: ".cpython-314-wasm32-wasi.so", limited_api_suffix: ".abi3.so", is_freethreaded: false };
  const infoPath = join(shimDir, "python-info.json");
  await writeFile(infoPath, `${JSON.stringify(info)}\n`);
  await writeFile(join(shimDir, "sitecustomize.py"), [
    "import json, os, sys",
    "for entry in reversed(os.environ.get('PYTHONPATH', '').split(os.pathsep)):",
    "    if entry and entry not in sys.path:",
    "        sys.path.insert(0, entry)",
    "if sys.argv and sys.argv[0].replace('\\\\', '/').endswith('/mesonbuild/scripts/python_info.py'):",
    "    with open(os.environ['PYPROC_NUMPY_PYTHON_INFO'], encoding='utf-8') as stream:",
    "        print(json.dumps(json.load(stream), sort_keys=True))",
    "    sys.stdout.flush()", "    os._exit(0)", "",
  ].join("\n"));
  return Object.freeze({ shimDir, infoPath });
}

async function activateIsolatedHostPython(hostPython, shimDir) {
  if (process.platform !== "win32") return null;
  const hostDir = dirname(hostPython);
  const candidates = (await readdir(hostDir)).filter((name) => /^python[0-9]+\._pth$/u.test(name));
  if (!candidates.length) return null;
  if (candidates.length !== 1) throw new Error("isolated host Python has ambiguous path configuration");
  const path = join(hostDir, candidates[0]);
  const original = await readFile(path, "utf8");
  const retained = original.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line
    && line !== "import site" && !/[/\\]scientific[/\\].+[/\\]python-shim$/iu.test(line));
  const configured = `${[resolve(shimDir), ...retained, "import site"].join("\r\n")}\r\n`;
  await writeFile(path, configured);
  return path;
}

async function extractWheel(hostPython, wheel, destination) {
  await mkdir(destination, { recursive: true });
  run(hostPython, ["-c", "import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
    wheel, destination]);
}

async function createCythonLauncher({ launcherDir, hostPython, cythonDir }) {
  await mkdir(launcherDir, { recursive: true });
  const runner = join(launcherDir, "run-cython.py");
  await writeFile(runner, [
    "import runpy, sys",
    `sys.path.insert(0, ${JSON.stringify(resolve(cythonDir))})`,
    "sys.argv[0] = 'cython'",
    "runpy.run_module('cython', run_name='__main__')",
    "",
  ].join("\n"));
  const launcher = join(launcherDir, process.platform === "win32" ? "cython.cmd" : "cython");
  if (process.platform === "win32") {
    await writeFile(launcher, `@echo off\r\n"${hostPython}" "${runner}" %*\r\n`);
  } else {
    await writeFile(launcher, `#!/bin/sh\nexec "${hostPython}" "${runner}" "$@"\n`);
    await chmod(launcher, 0o755);
  }
  return launcher;
}

async function buildStaticArchive({ workspace, numpySource, cpythonSource, targetBuildDir, sdkDir,
  hostPython, cythonDir, ninja }) {
  const buildDir = join(workspace, "build");
  const staticDir = join(workspace, "static");
  const wasmLd = executable(join(sdkDir, "bin", "wasm-ld"));
  const llvmAr = executable(join(sdkDir, "bin", "llvm-ar"));
  const llvmNm = executable(join(sdkDir, "bin", "llvm-nm"));
  const meson = join(numpySource, "vendored-meson", "meson", "meson.py");
  const sysconfigData = await generatedSysconfigPath(targetBuildDir);
  const shim = await makePythonShim({ workspace, hostPython, sysconfigData, cpythonSource, targetBuildDir, sdkDir });
  await activateIsolatedHostPython(hostPython, shim.shimDir);
  const launcherDir = join(workspace, "bin");
  const cythonLauncher = await createCythonLauncher({ launcherDir, hostPython, cythonDir });
  const cross = join(workspace, "numpy-wasi.cross");
  const native = join(workspace, "numpy-build-machine.ini");
  await writeFile(native, ["[binaries]", `cython = ${quoted(cythonLauncher)}`, ""].join("\n"));
  await writeFile(cross, ["[binaries]", `c = ${quoted(executable(join(sdkDir, "bin", "clang")))}`,
    `cpp = ${quoted(executable(join(sdkDir, "bin", "clang++")))}`,
    `cython = ${quoted(cythonLauncher)}`, `ar = ${quoted(llvmAr)}`,
    `strip = ${quoted(executable(join(sdkDir, "bin", "llvm-strip")))}`, `python = ${quoted(hostPython)}`,
    "", "[properties]", "sizeof_long_double = 16", "longdouble_format = 'IEEE_QUAD_LE'", "",
    "[built-in options]", "c_args = ['-O3', '-g0', '-fno-ident', '-msimd128']",
    "cpp_args = ['-O3', '-g0', '-fno-ident', '-msimd128', '-fno-exceptions']", "",
    "[host_machine]", "system = 'wasi'", "cpu_family = 'wasm32'", "cpu = 'wasm32'",
    "endian = 'little'", ""].join("\n"));
  const env = { ...process.env,
    PATH: `${launcherDir}${process.platform === "win32" ? ";" : ":"}${dirname(ninja)}${process.platform === "win32" ? ";" : ":"}${dirname(executable(join(sdkDir, "bin", "clang")))}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
    PYTHONPATH: `${shim.shimDir}${process.platform === "win32" ? ";" : ":"}${cythonDir}`,
    PYPROC_NUMPY_PYTHON_INFO: shim.infoPath, SOURCE_DATE_EPOCH: String(LOCK.sourceDateEpoch),
    LC_ALL: process.platform === "win32" ? process.env.LC_ALL : "C", TZ: "UTC", PYTHONHASHSEED: "0" };
  run(hostPython, [meson, "setup", buildDir, numpySource, "--cross-file", cross, "--native-file", native,
    "--buildtype", "release",
    "-Dblas=none", "-Dlapack=none", "-Dallow-noblas=true", "-Ddisable-threading=true",
    "-Dcpu-baseline=none", "-Dcpu-dispatch=none", "-Ddisable-intel-sort=true", "-Dtest-simd=[]"],
  { cwd: workspace, env });
  const targetOutput = run(ninja, ["-C", buildDir, "-t", "targets", "all"],
    { cwd: workspace, env, capture: true }).stdout;
  const objectTargets = lines(targetOutput).filter((line) => line.includes(".o:"))
    .map((line) => line.slice(0, line.lastIndexOf(":")));
  const moduleTargets = MODULES.flatMap(([, prefix]) => objectTargets.filter((target) => target.startsWith(prefix)));
  const libraryTargets = ["numpy/_core/libnpymath.a", "numpy/_core/libunique_hash.a",
    "numpy/_core/lib_multiarray_umath_mtargets.a", "numpy/_core/libhighway.a", "numpy/random/libnpyrandom.a"];
  const targets = [...new Set([...moduleTargets, ...libraryTargets])];
  for (let index = 0; index < targets.length; index += 32) {
    run(ninja, ["-C", buildDir, "-j", "8", ...targets.slice(index, index + 32)], { cwd: workspace, env });
  }
  await mkdir(staticDir, { recursive: true });
  const artifacts = [];
  const linkObject = async (name, inputs) => {
    const output = join(staticDir, `${name}.o`);
    const response = join(staticDir, `${name}.rsp`);
    await writeResponse(response, ["--relocatable", "-o", output, ...inputs]);
    run(wasmLd, [`@${response}`], { cwd: buildDir });
    artifacts.push(output);
  };
  await linkObject("common-npymath", ["--whole-archive", "numpy/_core/libnpymath.a", "--no-whole-archive"]);
  await linkObject("common-npyrandom", ["--whole-archive", "numpy/random/libnpyrandom.a", "--no-whole-archive"]);
  const lapackObjects = moduleTargets.filter((target) => target.startsWith(MODULES[2][1]));
  await linkObject("common-lapack", lapackObjects.filter((target) => !target.endsWith("/lapack_litemodule.c.o")));
  for (let index = 0; index < MODULES.length; index += 1) {
    const [moduleName, prefix] = MODULES[index];
    let inputs = moduleTargets.filter((target) => target.startsWith(prefix));
    if (index === 0) inputs = [...inputs, "--whole-archive", "numpy/_core/libunique_hash.a",
      "numpy/_core/lib_multiarray_umath_mtargets.a", "numpy/_core/libhighway.a", "--no-whole-archive"];
    if (moduleName === "numpy.linalg.lapack_lite") inputs = inputs.filter((path) => path.endsWith("/lapack_litemodule.c.o"));
    if (moduleName === "numpy.linalg._umath_linalg") inputs = inputs.filter((path) => path.endsWith("/umath_linalg.cpp.o"));
    await linkObject(`module-${String(index).padStart(2, "0")}`, inputs);
  }
  const definitions = new Map();
  const undefined = new Set();
  for (const artifact of artifacts) {
    const output = run(llvmNm, ["--format=posix", artifact], { capture: true }).stdout;
    for (const line of lines(output)) {
      const match = /^(\S+)\s+([A-Za-z?])(?:\s|$)/u.exec(line);
      if (!match) continue;
      if (match[2] === "U") { undefined.add(match[1]); continue; }
      if (!/[A-Z]/u.test(match[2]) || ["W", "V"].includes(match[2])) continue;
      if (!definitions.has(match[1])) definitions.set(match[1], []);
      definitions.get(match[1]).push(basename(artifact));
    }
  }
  const duplicates = [...definitions.entries()].filter(([, owners]) => owners.length > 1);
  const missingInitializers = MODULES.map(([, , symbol]) => symbol).filter((symbol) => !definitions.has(symbol));
  const forbiddenUndefined = ["__cxa_allocate_exception", "__cxa_throw"].filter((symbol) => undefined.has(symbol));
  if (duplicates.length || missingInitializers.length || forbiddenUndefined.length) {
    throw new Error(`NumPy static symbol audit failed: ${JSON.stringify({ duplicates, missingInitializers, forbiddenUndefined })}`);
  }
  const archive = join(staticDir, "libnumpy-2.5.1-pyproc.a");
  run(llvmAr, ["rcsD", archive, ...artifacts]);
  return Object.freeze({ archive, buildDir, archiveSha256: await sha256File(archive),
    archiveBytes: (await stat(archive)).size });
}

function wheelRecordHash(bytes) {
  return createHash("sha256").update(bytes).digest("base64url");
}

async function collectPythonFiles(folder, base = folder) {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.name === "__pycache__" || entry.name === "tests" || entry.name === "test") continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) result.push(...await collectPythonFiles(path, base));
    else if (entry.isFile() && ([".py", ".pyi", ".pxd", ".pxi"].includes(extname(entry.name))
      || entry.name === "py.typed")) {
      result.push({ path, wheelPath: `numpy/${relative(base, path).replaceAll("\\", "/")}` });
    }
  }
  return result;
}

function canonicalNumpyConfig(source) {
  let config = source.replaceAll("\r\n", "\n");
  config = replacePatternOnce(config, /"commands": r"[^"]*clang\+\+(?:\.exe)?"/u,
    '"commands": r"clang++"', "NumPy C++ command");
  config = replacePatternOnce(config, /"commands": r"[^"]*clang(?:\.exe)?"/u,
    '"commands": r"clang"', "NumPy C command");
  config = replacePatternOnce(config, /"commands": r"[^"]*cython(?:\.cmd)?"/u,
    '"commands": r"cython"', "NumPy Cython command");
  config = replacePatternOnce(config, /"path": r"[^"]*python(?:\.exe)?"/u,
    '"path": r"python3.14"', "NumPy Python command");
  if (/[A-Za-z]:[/\\]/u.test(config)) throw new Error("NumPy configuration retains a Windows workspace path");
  return config;
}

async function buildPythonLayer({ workspace, numpySource, numpyBuildDir }) {
  const layer = join(workspace, "python-layer");
  const files = await collectPythonFiles(join(numpySource, "numpy"));
  const overlay = new Map();
  for (const file of files) overlay.set(file.wheelPath, await readFile(file.path));
  overlay.set("numpy/__config__.py", encoder.encode(canonicalNumpyConfig(
    await readFile(join(numpyBuildDir, "numpy", "__config__.py"), "utf8"))));
  const distInfo = "numpy-2.5.1.dist-info";
  const metadata = encoder.encode(["Metadata-Version: 2.4", "Name: numpy", "Version: 2.5.1",
    `Requires-Python: ${LOCK.numpy.requiresPython}`, "Summary: Array computing for Python",
    "License-Expression: BSD-3-Clause", "", ""].join("\n"));
  const wheelMetadata = encoder.encode(["Wheel-Version: 1.0", "Generator: pyproc-scientific-package-builder/1",
    "Root-Is-Purelib: true", "Tag: py3-none-any", "", ""].join("\n"));
  overlay.set(`${distInfo}/METADATA`, metadata);
  overlay.set(`${distInfo}/WHEEL`, wheelMetadata);
  overlay.set(`${distInfo}/licenses/LICENSE.txt`, await readFile(join(numpySource, "LICENSE.txt")));
  if (existsSync(join(numpySource, "LICENSES_bundled.txt"))) {
    overlay.set(`${distInfo}/licenses/LICENSES_bundled.txt`, await readFile(join(numpySource, "LICENSES_bundled.txt")));
  }
  const ordered = [...overlay.entries()].sort((left, right) => Buffer.from(left[0]).compare(Buffer.from(right[0])));
  const record = ordered.map(([path, bytes]) => `${path},sha256=${wheelRecordHash(bytes)},${bytes.byteLength}`);
  record.push(`${distInfo}/RECORD,,`);
  ordered.push([`${distInfo}/RECORD`, encoder.encode(`${record.join("\n")}\n`)]);
  for (const [path, bytes] of ordered) {
    if (!path.startsWith("numpy/")) continue;
    const output = join(layer, ...path.split("/"));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, bytes);
  }
  const wheel = createDeterministicZip(ordered.map(([path, bytes]) => ({ path, bytes })), LOCK.sourceDateEpoch);
  const wheelPath = join(workspace, LOCK.numpy.wheelName);
  await writeFile(wheelPath, wheel);
  return Object.freeze({ layer, wheelPath, wheelBytes: wheel.byteLength, wheelSha256: sha256(wheel),
    fileCount: ordered.length });
}

export async function registerNumpyBuiltins(targetBuildDir) {
  const configPath = join(targetBuildDir, "Modules", "config.c");
  let config = await readFile(configPath, "utf8");
  const registered = MODULES.filter(([name]) => config.includes(`{"${name}",`));
  if (registered.length === MODULES.length) return configPath;
  if (registered.length) throw new Error("NumPy built-in registry is incomplete");
  const externs = MODULES.map(([, , initializer]) => `extern PyObject* ${initializer}(void);`).join("\n");
  const entries = MODULES.map(([name, , initializer]) => `    {"${name}", ${initializer}},`).join("\n");
  config = replaceOnce(config, "/* -- ADDMODULE MARKER 1 -- */",
    `${externs}\n\n/* -- ADDMODULE MARKER 1 -- */`, "CPython registry declaration");
  config = replaceOnce(config, "/* -- ADDMODULE MARKER 2 -- */",
    `${entries}\n\n/* -- ADDMODULE MARKER 2 -- */`, "CPython registry entry");
  await writeFile(configPath, config);
  return configPath;
}

export function numpyMakeSyslibs(archivePath) {
  return `$(LIBM) $(LIBC) ${archivePath} ${LOCK.numpy.linkLibraries.map((name) => `-l${name}`).join(" ")}`;
}

export async function buildOwnedNumpy({ workspace, cacheDir, cpythonSource, targetBuildDir, sdkDir, hostPython }) {
  if (existsSync(workspace)) throw new Error(`refusing to reuse scientific build workspace: ${workspace}`);
  await mkdir(workspace, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  const platformNinja = process.platform === "win32" ? LOCK.ninja.windowsX8664 : LOCK.ninja.linuxX8664;
  const [numpyArchive, cythonWheel, ninjaWheel] = await Promise.all([
    download(cacheDir, "numpy-2.5.1.tar.gz", LOCK.numpy),
    download(cacheDir, "cython-3.1.2-py3-none-any.whl", LOCK.cython),
    download(cacheDir, `ninja-${LOCK.ninja.version}-${process.platform}.whl`, platformNinja),
  ]);
  const numpySource = join(workspace, "source");
  const cythonDir = join(workspace, "cython");
  const ninjaDir = join(workspace, "ninja");
  await mkdir(numpySource, { recursive: true });
  run("tar", ["-xf", numpyArchive, "-C", numpySource, "--strip-components=1"]);
  await extractWheel(hostPython, cythonWheel, cythonDir);
  await extractWheel(hostPython, ninjaWheel, ninjaDir);
  const ninja = join(ninjaDir, ...platformNinja.binary.split("/"));
  if (!existsSync(ninja)) throw new Error(`locked Ninja binary is missing: ${ninja}`);
  if (process.platform !== "win32") await chmod(ninja, 0o755);
  const patchSha256 = await applyCompatibilityOverlay(numpySource);
  const native = await buildStaticArchive({ workspace, numpySource, cpythonSource, targetBuildDir,
    sdkDir, hostPython, cythonDir, ninja });
  const python = await buildPythonLayer({ workspace, numpySource, numpyBuildDir: native.buildDir });
  if (python.wheelBytes > LOCK.numpy.maxWheelBytes) {
    throw new Error(`NumPy Python wheel exceeds budget: ${python.wheelBytes}`);
  }
  await registerNumpyBuiltins(targetBuildDir);
  const manifest = { schemaVersion: 1, protocol: "pyproc.scientific-package-build",
    sourceDateEpoch: LOCK.sourceDateEpoch, target: LOCK.target, pythonVersion: LOCK.pythonVersion,
    package: { name: "numpy", version: LOCK.numpy.version, sourceSha256: LOCK.numpy.archiveSha256,
      wheel: { file: basename(python.wheelPath), byteLength: python.wheelBytes, sha256: python.wheelSha256,
        fileCount: python.fileCount }, staticArchive: { file: basename(native.archive),
        byteLength: native.archiveBytes, sha256: native.archiveSha256 }, modules: MODULES.map(([name]) => name) },
    tools: { cython: { version: LOCK.cython.version, sha256: LOCK.cython.archiveSha256 },
      ninja: { version: LOCK.ninja.version, sha256: platformNinja.archiveSha256 },
      meson: { source: "numpy-sdist-vendored", version: "1.11.1" } },
    compatibilityOverlay: { files: patchSha256, legacyRandomSymbolCount: MTRAND_LEGACY_SYMBOLS.length,
      cxxExceptions: "disabled", unsupportedFailureMode: "abort-on-allocation-or-pocketfft-invariant",
      pythonConfig: "canonical-tool-names" },
    linkLibraries: LOCK.numpy.linkLibraries };
  const manifestPath = join(workspace, "scientific-package-build.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return Object.freeze({ ...native, ...python, manifest, manifestPath, numpySource });
}

export function inspectScientificPackageLock() {
  return structuredClone(LOCK);
}
