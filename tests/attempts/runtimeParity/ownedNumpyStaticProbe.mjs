// ownedNumpyStaticProbe.mjs - upstream NumPy의 WASI 정적 편입 첫 불일치를 재현한다.

import { existsSync } from "node:fs";
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const MTRAND_LEGACY_SYMBOLS = Object.freeze([
  "random_beta", "random_binomial", "random_binomial_btpe", "random_binomial_inversion",
  "random_bounded_bool_fill", "random_bounded_uint16_fill", "random_bounded_uint32_fill",
  "random_bounded_uint64", "random_bounded_uint64_fill", "random_bounded_uint8_fill",
  "random_buffered_bounded_bool", "random_buffered_bounded_uint16", "random_buffered_bounded_uint32",
  "random_buffered_bounded_uint8", "random_chisquare", "random_exponential", "random_f",
  "random_gamma", "random_gamma_f", "random_geometric", "random_geometric_inversion",
  "random_geometric_search", "random_gumbel", "random_interval", "random_laplace",
  "random_loggam", "random_logistic", "random_lognormal", "random_logseries",
  "random_multinomial", "random_negative_binomial", "random_noncentral_chisquare",
  "random_noncentral_f", "random_normal", "random_pareto", "random_poisson",
  "random_positive_int", "random_positive_int32", "random_positive_int64", "random_power",
  "random_rayleigh", "random_standard_cauchy", "random_standard_exponential",
  "random_standard_exponential_f", "random_standard_exponential_fill",
  "random_standard_exponential_fill_f", "random_standard_exponential_inv_fill",
  "random_standard_exponential_inv_fill_f", "random_standard_gamma", "random_standard_gamma_f",
  "random_standard_normal", "random_standard_normal_f", "random_standard_normal_fill",
  "random_standard_normal_fill_f", "random_standard_t", "random_standard_uniform",
  "random_standard_uniform_f", "random_standard_uniform_fill", "random_standard_uniform_fill_f",
  "random_triangular", "random_uint", "random_uniform", "random_vonmises", "random_wald",
  "random_weibull", "random_zipf",
]);

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return resolve(process.argv[index + 1]);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    stdio: options.capture ? "pipe" : "inherit",
    ...options });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${basename(command)} failed with exit ${result.status}: ${result.stderr?.trim() || "no stderr"}`);
  }
  return result;
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

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function writeResponse(path, args) {
  const encoded = args.map((arg) => `"${String(arg).replaceAll("\\", "/").replaceAll('"', '\\"')}"`).join("\n");
  await writeFile(path, `${encoded}\n`);
}

async function targetVariables(python, sysconfigData) {
  const code = [
    "import importlib.util,json,sys",
    "spec=importlib.util.spec_from_file_location('target_sysconfig',sys.argv[1])",
    "module=importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "print(json.dumps(module.build_time_vars,sort_keys=True))",
  ].join(";");
  const result = run(python, ["-c", code, sysconfigData], { capture: true });
  return JSON.parse(result.stdout);
}

async function main() {
  if (process.platform !== "win32") throw new Error("this first-boundary probe requires Windows");
  const workspace = option("--workspace");
  const upstreamSource = option("--numpy-source");
  const engineWorkspace = option("--engine-workspace");
  const buildTools = option("--build-tools");
  if (existsSync(workspace)) throw new Error(`refusing to reuse probe workspace: ${workspace}`);

  const numpySource = join(workspace, "source");
  const sourceDir = join(engineWorkspace, "cpython");
  const targetBuild = join(sourceDir, "cross-build", "wasm32-wasip1");
  const sdkDir = join(engineWorkspace, "wasi-sdk");
  const python = join(buildTools, "Scripts", "python.exe");
  const cython = join(buildTools, "Scripts", "cython.exe");
  const ninja = join(buildTools, "Scripts", "ninja.exe");
  const wasmLd = join(sdkDir, "bin", "wasm-ld.exe");
  const llvmAr = join(sdkDir, "bin", "llvm-ar.exe");
  const llvmNm = join(sdkDir, "bin", "llvm-nm.exe");
  const sysconfigData = join(targetBuild, "build", "lib.wasi-wasm32-3.14",
    "_sysconfigdata__wasi_wasm32-wasi.py");
  for (const required of [join(upstreamSource, "pyproject.toml"), join(upstreamSource, "LICENSE.txt"),
    join(targetBuild, "python.wasm"), join(targetBuild, "pyconfig.h"), sysconfigData,
    join(sdkDir, "bin", "clang.exe"), python, cython, ninja, wasmLd, llvmAr, llvmNm]) {
    if (!existsSync(required)) throw new Error(`required probe input is missing: ${required}`);
  }
  const pyproject = await readFile(join(upstreamSource, "pyproject.toml"), "utf8");
  if (!/^version = "2\.5\.1"$/mu.test(pyproject)) {
    throw new Error("probe requires the exact NumPy 2.5.1 source tree");
  }

  await mkdir(workspace, { recursive: true });
  await cp(upstreamSource, numpySource, { recursive: true, force: false, errorOnExist: true });
  const randomMesonPath = join(numpySource, "numpy", "random", "meson.build");
  const randomMeson = await readFile(randomMesonPath, "utf8");
  const patchAnchor = "    c_args: [c_args_random, gen[2]],";
  const patchReplacement = [
    "    c_args: [c_args_random, gen[2],",
    "      '-D__pyx_CommonTypesMetaclass_get_module=__pyx_' + gen[0] + '_CommonTypesMetaclass_get_module'],",
  ].join("\n");
  const legacyAnchor = "    ['-DNP_RANDOM_LEGACY=1'], [npymath_lib],";
  const legacyReplacement = "    ['-DNP_RANDOM_LEGACY=1', '-include', 'pyproc_static_mtrand.h'], [npymath_lib],";
  if (randomMeson.split(patchAnchor).length !== 2 || randomMeson.split(legacyAnchor).length !== 2) {
    throw new Error("NumPy random compatibility patch anchor changed");
  }
  await writeFile(randomMesonPath, randomMeson.replace(patchAnchor, patchReplacement)
    .replace(legacyAnchor, legacyReplacement));
  const legacyHeaderPath = join(numpySource, "numpy", "random", "src", "pyproc_static_mtrand.h");
  await writeFile(legacyHeaderPath, [
    "#ifndef PYPROC_STATIC_MTRAND_H",
    "#define PYPROC_STATIC_MTRAND_H",
    ...MTRAND_LEGACY_SYMBOLS.map((symbol) => `#define ${symbol} __pyproc_mtrand_${symbol}`),
    "#endif",
    "",
  ].join("\n"));
  const uniqueMesonPath = join(numpySource, "numpy", "_core", "meson.build");
  const uniqueMeson = await readFile(uniqueMesonPath, "utf8");
  const exceptionFlag = "    '-fexceptions',";
  if (uniqueMeson.split(exceptionFlag).length !== 2) {
    throw new Error("NumPy unique exception flag anchor changed");
  }
  await writeFile(uniqueMesonPath, uniqueMeson.replace(exceptionFlag, "    '-fno-exceptions',"));
  const uniquePath = join(numpySource, "numpy", "_core", "src", "multiarray", "unique.cpp");
  let uniqueSource = await readFile(uniquePath, "utf8");
  const uniqueThrow = [
    "                // Unexpected error. Throw a C++ exception that will be caught",
    "                // by the caller of unique_vstring() and converted into a Python",
    "                // RuntimeError.",
    "                throw std::runtime_error(\"Failed to load string from packed \"",
    "                                         \"static string.\");",
  ].join("\n");
  const uniqueError = [
    "                PyErr_SetString(PyExc_RuntimeError,",
    "                                \"Failed to load string from packed static string.\");",
    "                return NULL;",
  ].join("\n");
  const uniqueTry = [
    "    PyObject *result = NULL;",
    "    try {",
    "        auto type = PyArray_TYPE(arr);",
    "        // we only support data types present in our unique_funcs map",
    "        if (unique_funcs.find(type) == unique_funcs.end()) {",
    "            result = Py_NewRef(Py_NotImplemented);",
    "        }",
    "        else {",
    "            result = unique_funcs[type](arr, equal_nan);",
    "        }",
    "    }",
    "    catch (const std::bad_alloc &e) {",
    "        PyErr_NoMemory();",
    "        result = NULL;",
    "    }",
    "    catch (const std::exception &e) {",
    "        PyErr_SetString(PyExc_RuntimeError, e.what());",
    "        result = NULL;",
    "    }",
  ].join("\n");
  const uniqueDirect = [
    "    PyObject *result = NULL;",
    "    auto type = PyArray_TYPE(arr);",
    "    // we only support data types present in our unique_funcs map",
    "    if (unique_funcs.find(type) == unique_funcs.end()) {",
    "        result = Py_NewRef(Py_NotImplemented);",
    "    }",
    "    else {",
    "        result = unique_funcs[type](arr, equal_nan);",
    "    }",
  ].join("\n");
  if (uniqueSource.split(uniqueThrow).length !== 2 || uniqueSource.split(uniqueTry).length !== 2) {
    throw new Error("NumPy unique exception compatibility anchor changed");
  }
  uniqueSource = uniqueSource.replace(uniqueThrow, uniqueError).replace(uniqueTry, uniqueDirect);
  await writeFile(uniquePath, uniqueSource);
  const fftPath = join(numpySource, "numpy", "fft", "_pocketfft_umath.cpp");
  let fftSource = await readFile(fftPath, "utf8");
  const fftTry = [
    "    NPY_ALLOW_C_API_DEF",
    "    try {",
    "        cpp_ufunc(args, dimensions, steps, func);",
    "    }",
    "    catch (std::bad_alloc& e) {",
    "        NPY_ALLOW_C_API;",
    "        PyErr_NoMemory();",
    "        NPY_DISABLE_C_API;",
    "    }",
    "    catch (const std::exception& e) {",
    "        NPY_ALLOW_C_API;",
    "        PyErr_SetString(PyExc_RuntimeError, e.what());",
    "        NPY_DISABLE_C_API;",
    "    }",
  ].join("\n");
  if (fftSource.split(fftTry).length !== 2) {
    throw new Error("NumPy FFT exception wrapper anchor changed");
  }
  fftSource = fftSource.replace(fftTry, "    cpp_ufunc(args, dimensions, steps, func);");
  await writeFile(fftPath, fftSource);
  const pocketfftPath = join(numpySource, "numpy", "fft", "pocketfft", "pocketfft_hdronly.h");
  let pocketfftSource = await readFile(pocketfftPath, "utf8");
  const pocketfftThrow = /\bthrow(?:\s+std::(?:bad_alloc|runtime_error|invalid_argument)\([^;]*?\))?;/gsu;
  if ([...pocketfftSource.matchAll(pocketfftThrow)].length !== 20) {
    throw new Error("NumPy pocketfft exception compatibility anchors changed");
  }
  pocketfftSource = pocketfftSource.replace(pocketfftThrow, "std::abort();");
  await writeFile(pocketfftPath, pocketfftSource);
  const mesonScript = join(numpySource, "vendored-meson", "meson", "meson.py");
  if (!existsSync(mesonScript)) throw new Error(`vendored Meson is missing: ${mesonScript}`);

  const shimDir = join(workspace, "python-shim");
  const buildDir = join(workspace, "build");
  await mkdir(shimDir, { recursive: true });
  const variables = await targetVariables(python, sysconfigData);
  const replaceRoot = (value) => typeof value === "string"
    ? value.replaceAll("/build/pyproc/cpython", mesonPath(sourceDir))
      .replaceAll("/build/pyproc/wasi-sdk", mesonPath(sdkDir))
    : value;
  for (const [name, value] of Object.entries(variables)) variables[name] = replaceRoot(value);
  variables.INCLUDEPY = mesonPath(join(sourceDir, "Include"));
  variables.CONFINCLUDEPY = variables.INCLUDEPY;
  variables.LIBDIR = mesonPath(targetBuild);
  variables.LIBPL = mesonPath(targetBuild);
  variables.base = mesonPath(sourceDir);
  variables.base_prefix = variables.base;
  variables.prefix = variables.base;
  const include = mesonPath(join(sourceDir, "Include"));
  const platinclude = mesonPath(targetBuild);
  const pythonInfo = {
    variables,
    paths: { data: mesonPath(workspace), include, platinclude,
      platlib: mesonPath(join(workspace, "site-packages")),
      purelib: mesonPath(join(workspace, "site-packages")), scripts: mesonPath(join(workspace, "bin")),
      stdlib: mesonPath(join(sourceDir, "Lib")) },
    sysconfig_paths: { data: mesonPath(workspace), include, platinclude,
      platlib: mesonPath(join(workspace, "site-packages")),
      purelib: mesonPath(join(workspace, "site-packages")), scripts: mesonPath(join(workspace, "bin")),
      stdlib: mesonPath(join(sourceDir, "Lib")) },
    install_paths: { data: "", include: "include/python3.14", platinclude: "include/python3.14",
      platlib: "lib/python3.14/site-packages", purelib: "lib/python3.14/site-packages", scripts: "bin",
      stdlib: "lib/python3.14" },
    version: "3.14",
    platform: "win-amd64",
    is_pypy: false,
    is_venv: false,
    link_libpython: false,
    suffix: ".cpython-314-wasm32-wasi.so",
    limited_api_suffix: ".abi3.so",
    is_freethreaded: false,
  };
  const infoPath = join(shimDir, "python-info.json");
  await writeFile(infoPath, `${JSON.stringify(pythonInfo)}\n`);
  await writeFile(join(shimDir, "sitecustomize.py"), [
    "import json, os, sys",
    "if sys.argv and sys.argv[0].replace('\\\\', '/').endswith('/mesonbuild/scripts/python_info.py'):",
    "    with open(os.environ['PYPROC_NUMPY_PYTHON_INFO'], encoding='utf-8') as stream:",
    "        print(json.dumps(json.load(stream), sort_keys=True))",
    "    sys.stdout.flush()",
    "    os._exit(0)",
    "",
  ].join("\n"));

  const crossFile = join(workspace, "numpy-wasi.cross");
  await writeFile(crossFile, [
    "[binaries]",
    `c = ${quoted(join(sdkDir, "bin", "clang.exe"))}`,
    `cpp = ${quoted(join(sdkDir, "bin", "clang++.exe"))}`,
    `cython = ${quoted(cython)}`,
    `ar = ${quoted(join(sdkDir, "bin", "llvm-ar.exe"))}`,
    `strip = ${quoted(join(sdkDir, "bin", "llvm-strip.exe"))}`,
    `python = ${quoted(python)}`,
    "",
    "[properties]",
    "sizeof_long_double = 16",
    "longdouble_format = 'IEEE_QUAD_LE'",
    "",
    "[built-in options]",
    "c_args = ['-O3', '-g0', '-fno-ident', '-msimd128']",
    "cpp_args = ['-O3', '-g0', '-fno-ident', '-msimd128', '-fno-exceptions']",
    "",
    "[host_machine]",
    "system = 'wasi'",
    "cpu_family = 'wasm32'",
    "cpu = 'wasm32'",
    "endian = 'little'",
    "",
  ].join("\n"));

  const env = { ...process.env,
    PATH: `${join(buildTools, "Scripts")};${join(sdkDir, "bin")};${process.env.PATH}`,
    PYTHONPATH: shimDir,
    PYPROC_NUMPY_PYTHON_INFO: infoPath,
    SOURCE_DATE_EPOCH: "1781085833",
  };
  const setup = run(python, [mesonScript, "setup", buildDir, numpySource, "--cross-file", crossFile,
    "--buildtype", "release", "-Dblas=none", "-Dlapack=none", "-Dallow-noblas=true",
    "-Ddisable-threading=true", "-Dcpu-baseline=none", "-Dcpu-dispatch=none",
    "-Ddisable-intel-sort=true", "-Dtest-simd=[]"], { cwd: workspace, env, capture: true, allowFailure: true });
  await writeFile(join(workspace, "meson-setup.stdout.log"), setup.stdout || "");
  await writeFile(join(workspace, "meson-setup.stderr.log"), setup.stderr || "");
  let stage = "meson-setup";
  let status = setup.status;
  let stdout = setup.stdout || "";
  let stderr = setup.stderr || "";
  const moduleSpecs = [
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
  ];
  const artifacts = [];
  const symbolsByObject = new Map();
  const undefinedSymbols = new Set();
  if (status === 0) {
    stage = "object-discovery";
    const targetsResult = run(ninja, ["-C", buildDir, "-t", "targets", "all"],
      { cwd: workspace, env, capture: true, allowFailure: true });
    status = targetsResult.status;
    stdout += targetsResult.stdout || "";
    stderr += targetsResult.stderr || "";
    if (status === 0) {
      const objectTargets = lines(targetsResult.stdout)
        .filter((line) => line.includes(".o:"))
        .map((line) => line.slice(0, line.lastIndexOf(":")));
      const moduleTargets = moduleSpecs.flatMap(([, prefix]) =>
        objectTargets.filter((target) => target.startsWith(prefix)));
      const libraryTargets = [
        "numpy/_core/libnpymath.a",
        "numpy/_core/libunique_hash.a",
        "numpy/_core/lib_multiarray_umath_mtargets.a",
        "numpy/_core/libhighway.a",
        "numpy/random/libnpyrandom.a",
      ];
      const compileTargets = [...new Set([...moduleTargets, ...libraryTargets])];
      stage = "object-compile";
      for (let index = 0; index < compileTargets.length && status === 0; index += 32) {
        const compile = run(ninja, ["-C", buildDir, "-j", "8", ...compileTargets.slice(index, index + 32)],
          { cwd: workspace, env, capture: true, allowFailure: true });
        status = compile.status;
        stdout += compile.stdout || "";
        stderr += compile.stderr || "";
      }
      if (status === 0) {
        const staticDir = join(workspace, "static");
        await mkdir(staticDir, { recursive: true });
        const linkRelocatable = async (name, inputs) => {
          const output = join(staticDir, `${name}.o`);
          const response = join(staticDir, `${name}.rsp`);
          await writeResponse(response, ["--relocatable", "-o", output, ...inputs]);
          const linked = run(wasmLd, [`@${response}`], { cwd: buildDir, capture: true, allowFailure: true });
          stdout += linked.stdout || "";
          stderr += linked.stderr || "";
          if (linked.status !== 0) status = linked.status;
          artifacts.push(output);
          return output;
        };
        stage = "static-assembly";
        const coreLibraries = ["numpy/_core/libunique_hash.a",
          "numpy/_core/lib_multiarray_umath_mtargets.a", "numpy/_core/libhighway.a"];
        await linkRelocatable("common-npymath", ["--whole-archive", "numpy/_core/libnpymath.a", "--no-whole-archive"]);
        await linkRelocatable("common-npyrandom", ["--whole-archive", "numpy/random/libnpyrandom.a", "--no-whole-archive"]);
        const lapackPrefix = moduleSpecs[2][1];
        const lapackObjects = moduleTargets.filter((target) => target.startsWith(lapackPrefix));
        const lapackCommon = lapackObjects.filter((target) => !target.endsWith("/lapack_litemodule.c.o"));
        await linkRelocatable("common-lapack", lapackCommon);
        for (let index = 0; index < moduleSpecs.length && status === 0; index += 1) {
          const [moduleName, prefix] = moduleSpecs[index];
          let inputs = moduleTargets.filter((target) => target.startsWith(prefix));
          if (moduleName === "numpy._core._multiarray_umath") {
            inputs = [...inputs, "--whole-archive", ...coreLibraries, "--no-whole-archive"];
          }
          if (moduleName === "numpy.linalg.lapack_lite") {
            inputs = inputs.filter((target) => target.endsWith("/lapack_litemodule.c.o"));
          }
          if (moduleName === "numpy.linalg._umath_linalg") {
            inputs = inputs.filter((target) => target.endsWith("/umath_linalg.cpp.o"));
          }
          await linkRelocatable(`module-${index.toString().padStart(2, "0")}`, inputs);
        }
        if (status === 0) {
          stage = "symbol-audit";
          for (const artifact of artifacts) {
            const symbols = run(llvmNm, ["--format=posix", artifact],
              { capture: true, allowFailure: true });
            if (symbols.status !== 0) {
              status = symbols.status;
              stderr += symbols.stderr || "";
              break;
            }
            for (const line of lines(symbols.stdout)) {
              const match = /^(\S+)\s+([A-Za-z?])(?:\s|$)/u.exec(line);
              if (!match) continue;
              if (match[2] === "U") {
                undefinedSymbols.add(match[1]);
                continue;
              }
              if (!/[A-Z]/u.test(match[2]) || ["W", "V"].includes(match[2])) continue;
              if (!symbolsByObject.has(match[1])) symbolsByObject.set(match[1], []);
              symbolsByObject.get(match[1]).push(basename(artifact));
            }
          }
          const duplicateStrongSymbols = [...symbolsByObject.entries()]
            .filter(([, owners]) => owners.length > 1)
            .map(([symbol, owners]) => ({ symbol, owners }));
          const allSymbols = new Set(symbolsByObject.keys());
          const missingInitSymbols = moduleSpecs.map(([, , symbol]) => symbol)
            .filter((symbol) => !allSymbols.has(symbol));
          const forbiddenUndefinedSymbols = ["__cxa_allocate_exception", "__cxa_throw"]
            .filter((symbol) => undefinedSymbols.has(symbol));
          if (duplicateStrongSymbols.length || missingInitSymbols.length || forbiddenUndefinedSymbols.length) {
            status = 1;
            stderr += `\nstatic symbol audit failed: ${JSON.stringify({ duplicateStrongSymbols,
              missingInitSymbols, forbiddenUndefinedSymbols })}\n`;
          } else {
            stage = "deterministic-archive";
            const archive = join(staticDir, "libnumpy-2.5.1-pyproc.a");
            const archived = run(llvmAr, ["rcsD", archive, ...artifacts],
              { cwd: buildDir, capture: true, allowFailure: true });
            status = archived.status;
            stdout += archived.stdout || "";
            stderr += archived.stderr || "";
            if (status === 0) {
              const archiveStat = await stat(archive);
              const manifest = { schemaVersion: 1, numpyVersion: "2.5.1",
                moduleNames: moduleSpecs.map(([name]) => name), commonObjects: 3,
                archiveBytes: archiveStat.size, archiveSha256: await sha256(archive),
                compatibilityPatch: { file: "numpy/random/meson.build",
                  purpose: "isolate generated Cython helpers and the WASI32 legacy random ABI",
                  patchedSha256: await sha256(randomMesonPath),
                  legacyHeaderSha256: await sha256(legacyHeaderPath),
                  legacySymbolCount: MTRAND_LEGACY_SYMBOLS.length,
                  noExceptionSourceSha256: [await sha256(uniqueMesonPath), await sha256(uniquePath),
                    await sha256(fftPath), await sha256(pocketfftPath)] } };
              await writeFile(join(staticDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
            }
          }
        }
      }
    }
  }
  await writeFile(join(workspace, `${stage}.stdout.log`), stdout);
  await writeFile(join(workspace, `${stage}.stderr.log`), stderr);
  const report = { stage, status, stdout: stdout.trim(), stderr: stderr.trim(),
    inputs: { numpyVersion: "2.5.1", target: "wasm32-wasip1", pythonVersion: "3.14.6",
      engineProfile: "data", simd: "wasm-simd128" }, artifacts: artifacts.map((path) => basename(path)) };
  await writeFile(join(workspace, "first-boundary.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (status !== 0) process.exitCode = 1;
}

main().catch((error) => { console.error(error?.stack || String(error)); process.exitCode = 1; });
