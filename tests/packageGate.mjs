// tests/packageGate.mjs - npm tarball 공개 표면 게이트.
// 저장소 소스가 아니라 설치된 패키지 표면만 써서 exports, bin, files 계약을 검증한다.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { binPath, installPackedPyProc, run } from "./packageHarness.mjs";

const { tmp, appDir } = await installPackedPyProc("pyprocPackageGate-");

function markdownLinks(source) {
  return [...source.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)].map((match) => match[1].trim());
}

function readDocumentJsonFixture(source, marker) {
  const markerOffset = source.indexOf(`<!-- ${marker} -->`);
  if (markerOffset < 0) throw new Error(`document fixture marker missing: ${marker}`);
  const fenceOffset = source.indexOf("```json", markerOffset);
  const valueOffset = fenceOffset < 0 ? -1 : fenceOffset + "```json".length;
  const endOffset = valueOffset < 0 ? -1 : source.indexOf("```", valueOffset);
  if (valueOffset < 0 || endOffset < 0) throw new Error(`document fixture fence missing: ${marker}`);
  return JSON.parse(source.slice(valueOffset, endOffset).trim());
}

function assertInstalledReadmeLinks(packageRoot, readmeNames) {
  const broken = [];
  for (const readmeName of readmeNames) {
    const readmePath = join(packageRoot, readmeName);
    const source = readFileSync(readmePath, "utf8");
    for (const href of markdownLinks(source)) {
      if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(href)) continue;
      const clean = href.replace(/^<|>$/gu, "").split(/[?#]/u)[0];
      if (!clean || clean.includes("{") || clean.includes("}")) continue;
      const target = resolve(dirname(readmePath), decodeURIComponent(clean));
      const fromRoot = relative(packageRoot, target);
      if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)
        || !existsSync(target) || !statSync(target).isFile()) broken.push(`${readmeName} -> ${href}`);
    }
  }
  if (broken.length) throw new Error(`installed README link missing: ${broken.join(", ")}`);
}

try {
  const smoke = `
    import { boot, open, createWebComputer, checkEnvironment, PyProcError, PYPROC_ERROR_CODES } from "pyproc";
    import { getPyProcAssetManifest, verifyPyProcAssetIntegrity } from "pyproc/assets";
    import { BrowserStorageDurability, commitState, openState, MemoryStateStore,
      decodeStateBundle, PAGE_SIZE } from "pyproc/history";
    import { createWebComputer as fromMachine, createMachineCryptoProvider, bootKernelMachine,
      KernelMachine } from "pyproc/machine";
    import { PyProcControlClient, ControlRemoteError, ControlRequest, PerceptionClient,
      SituationResult, SituationRequirement, SituationFact, SituationAffordance, SituationUnknown } from "pyproc/control";
    import { bootCpythonWasiKernel, CpythonWasiKernelRuntime, HostCapabilityBroker,
      ProductHostCapabilityPort, createFetchHostAdapter, KERNEL_RUNTIME_CONTRACT_VERSION,
      SimpleApiPackageResolver, MemoryPackageContentStore, PackageEnvironment,
      KernelTerminal, KernelEnvironmentManager, KernelFactory, MemoryKernelAssetStore,
      createKernelEngineManifest, DATA_KERNEL_ENGINE_ID, DEFAULT_KERNEL_ENGINE_ID,
      getDataKernelEngineManifest, getDefaultKernelEngineManifest,
      inspectDataKernelEngineDistribution, createOwnedPackageResolver } from "pyproc/wasi";

    for (const [name, fn] of [["boot", boot], ["open", open], ["createWebComputer", createWebComputer], ["checkEnvironment", checkEnvironment]]) {
      if (typeof fn !== "function") throw new Error(name + " export missing");
    }
    if (fromMachine !== createWebComputer) throw new Error("machine subpath createWebComputer drift");
    const computer = createWebComputer({ createMachines: false });
    for (const verb of ["initialize", "save", "exportImage", "importImage", "inspect", "dispose"]) {
      if (typeof computer[verb] !== "function") throw new Error("durable WebComputer verb missing: " + verb);
    }
    let durabilityCode = "";
    try { await computer.save(); } catch (error) { durabilityCode = error?.code || String(error); }
    if (durabilityCode !== "WEB_MACHINE_DURABILITY_UNAVAILABLE") throw new Error("durability opt-in error drift: " + durabilityCode);
    await computer.dispose();
    if (!Array.isArray(PYPROC_ERROR_CODES) || typeof PyProcError !== "function") throw new Error("error contract missing");
    if (typeof bootCpythonWasiKernel !== "function" || typeof CpythonWasiKernelRuntime !== "function"
      || KERNEL_RUNTIME_CONTRACT_VERSION !== 2) throw new Error("Promise-first kernel surface missing");
    for (const [name, value] of Object.entries({ SimpleApiPackageResolver, MemoryPackageContentStore,
      PackageEnvironment, KernelTerminal, KernelEnvironmentManager, KernelFactory, MemoryKernelAssetStore,
      createKernelEngineManifest, bootKernelMachine, KernelMachine })) {
      if (typeof value !== "function") throw new Error("package environment surface missing: " + name);
    }
    if (DEFAULT_KERNEL_ENGINE_ID !== "cpython-wasi-3.14.6-pyproc-host-1"
      || DATA_KERNEL_ENGINE_ID !== "cpython-wasi-3.14.6-pyproc-data-3"
      || typeof getDefaultKernelEngineManifest !== "function"
      || typeof getDataKernelEngineManifest !== "function"
      || typeof inspectDataKernelEngineDistribution !== "function"
      || typeof createOwnedPackageResolver !== "function") {
      throw new Error("installed owned kernel distribution surface missing");
    }
    const defaultEngineManifest = await getDefaultKernelEngineManifest();
    const dataEngineManifest = await getDataKernelEngineManifest();
    for (const engineManifest of [defaultEngineManifest, dataEngineManifest]) {
      if (engineManifest.threading?.protocol !== "pyproc.thread-capability"
        || engineManifest.threading.mode !== "worker-processes"
        || engineManifest.threading.pythonImplementation !== "pthread-stubs"
        || engineManifest.threading.pythonThreadCreation !== false
        || engineManifest.threading.sharedWasmMemory !== false
        || engineManifest.threading.wasiThreadSpawn !== false
        || engineManifest.threading.failure?.pythonType !== "RuntimeError"
        || engineManifest.threading.failure?.message !== "can't start new thread") {
        throw new Error("installed engine threading boundary drifted");
      }
    }
    const hostBroker = new HostCapabilityBroker();
    const productPort = new ProductHostCapabilityPort();
    if (typeof productPort.install !== "function" || typeof createFetchHostAdapter !== "function") {
      throw new Error("product host capability surface missing");
    }
    hostBroker.close("package surface probe");
    if (PAGE_SIZE !== 65536) throw new Error("history PAGE_SIZE drift");
    for (const fn of [BrowserStorageDurability, commitState, openState,
      decodeStateBundle, createMachineCryptoProvider]) {
      if (typeof fn !== "function") throw new Error("kernel surface missing");
    }
    for (const [name, value] of Object.entries({ PyProcControlClient, ControlRemoteError, ControlRequest,
      PerceptionClient, SituationResult, SituationRequirement, SituationFact, SituationAffordance, SituationUnknown })) {
      if (typeof value !== "function") throw new Error("control surface missing: " + name);
    }
    // 커널 프로토콜이 설치본에서도 실동작하는가(Node webcrypto로 커밋 왕복).
    const store = new MemoryStateStore();
    const committed = await commitState(globalThis.crypto, store, {
      pages: [[0, new Uint8Array(64).fill(7)]], pageSize: 64, heapLen: 64, sp: 0, env: { h0: "pkg" },
    });
    const opened = await openState(globalThis.crypto, store, { expectH0: "pkg" });
    if (opened.commitAddress !== committed.commitAddress || opened.pages.get(0)[0] !== 7) throw new Error("kernel roundtrip failed");
    const manifest = getPyProcAssetManifest({ baseURL: "/vendor/pyproc/" });
    if (manifest.packageRoot !== "/vendor/pyproc/") throw new Error("baseURL normalization failed");
    if (typeof verifyPyProcAssetIntegrity !== "function") throw new Error("verify export missing");
    if (!manifest.assets.some((a) => a.role === "wasiWorker")) throw new Error("wasiWorker role missing");
  `;
  run(process.execPath, ["--input-type=module", "-e", smoke], { cwd: appDir });

  const cli = binPath(appDir, "pyproc-assets");
  if (!existsSync(cli)) throw new Error("installed pyproc-assets bin shim 없음");
  const controlCli = binPath(appDir, "pyproc-control");
  if (!existsSync(controlCli)) throw new Error("installed pyproc-control bin shim 없음");
  const mcpCli = binPath(appDir, "pyproc-mcp");
  if (!existsSync(mcpCli)) throw new Error("installed pyproc-mcp bin shim 없음");
  const installedPackage = JSON.parse(readFileSync(join(appDir, "node_modules", "pyproc", "package.json"), "utf8"));
  const packageRoot = join(appDir, "node_modules", "pyproc");
  if (installedPackage.bin?.["pyproc-mcp"] !== "./scripts/pyprocMcp.mjs") {
    throw new Error("installed pyproc-mcp bin manifest 불일치");
  }
  if (installedPackage.bin?.["pyproc-control"] !== "./scripts/pyprocControl.mjs") {
    throw new Error("installed pyproc-control bin manifest 불일치");
  }
  if (Object.keys(installedPackage.exports || {}).some((key) => key.includes("browser"))) {
    throw new Error("browser automation이 JS package export를 추가했다");
  }
  if (installedPackage.dependencies && Object.keys(installedPackage.dependencies).length) {
    throw new Error("installed pyproc runtime dependency 0 계약 위반");
  }
  assertInstalledReadmeLinks(packageRoot, ["README.md", "README.ko.md"]);
  const controlProtocolPath = join(packageRoot, "skills", "control-pyproc", "references", "control-protocol.md");
  const documentedHello = readDocumentJsonFixture(readFileSync(controlProtocolPath, "utf8"),
    "pyproc-control-client-hello");
  const { acceptControlHello } = await import(pathToFileURL(join(packageRoot,
    "scripts", "controlProtocol", "controlProtocol.js")).href);
  const acceptedHello = acceptControlHello(documentedHello, { operations: ["machine.run"] });
  if (acceptedHello.response.requestId !== documentedHello.requestId
    || acceptedHello.response.role !== "server"
    || acceptedHello.response.operations.join(",") !== "machine.run") {
    throw new Error("installed control document hello was not accepted");
  }
  const incompleteHello = { ...documentedHello };
  delete incompleteHello.capabilities;
  let incompleteCode = null;
  try { acceptControlHello(incompleteHello, { operations: ["machine.run"] }); }
  catch (error) { incompleteCode = error?.code || null; }
  if (incompleteCode !== "CONTROL_INVALID_FRAME") {
    throw new Error(`incomplete documented hello error drift: ${incompleteCode}`);
  }
  for (const profile of ["core", "data"]) {
    const files = ["python.wasm", "python314-stdlib.zip", "engine-build-manifest.json",
      "engine.cyclonedx.json", "stdlib-inventory.json", "native-profile-build-input.json",
      "reproducibility-manifest.json"];
    if (profile === "data") files.push("numpy-2.5.1-py3-none-any.whl", "scientific-package-build.json");
    for (const file of files) {
      if (!existsSync(join(appDir, "node_modules", "pyproc", "src", "runtime", "engines", "wasi", "owned", profile, file))) {
        throw new Error(`installed owned ${profile} kernel asset 누락: ${file}`);
      }
    }
  }
  for (const path of [
    ["src", "runtime", "packages", "native", "core", "catalog.json"],
    ["src", "runtime", "packages", "native", "core", "catalogIdentity.js"],
    ["src", "runtime", "packages", "native", "core", "pyproc_native_host-1.0.0-py3-none-any.whl"],
    ["src", "runtime", "packages", "native", "data", "catalog.json"],
    ["src", "runtime", "packages", "native", "data", "catalogIdentity.js"],
    ["src", "runtime", "packages", "native", "data", "pyproc_native_data-1.0.0-py3-none-any.whl"],
    ["src", "runtime", "packages", "native", "data", "numpy-2.5.1-py3-none-any.whl"],
    ["scripts", "nativePackageCatalog", "buildNativePackageCatalog.mjs"],
    ["scripts", "nativePackageCatalog", "nativePackageCatalogLock.json"],
    ["scripts", "nativePackageCatalog", "packages", "pyproc_native_host", "__init__.py"],
    ["scripts", "nativePackageCatalog", "packages", "pyproc_native_data", "__init__.py"],
    ["scripts", "engineBuilder", "_pyprocHost.c"],
    ["scripts", "engineBuilder", "_pyprocData.c"],
    ["scripts", "scientificPackageBuilder", "numpyStaticBuilder.mjs"],
    ["scripts", "scientificPackageBuilder", "scientificPackageLock.json"],
  ]) {
    if (!existsSync(join(packageRoot, ...path))) throw new Error(`installed native package input 누락: ${path.join("/")}`);
  }
  run(process.execPath, [join(packageRoot, "scripts", "nativePackageCatalog", "buildNativePackageCatalog.mjs")],
    { cwd: packageRoot });
  const installedRootSource = readFileSync(join(appDir, "node_modules", "pyproc", "index.js"), "utf8");
  if (!installedRootSource.includes("bootDefaultKernelMachine")
    || installedRootSource.includes("engine ===")) {
    throw new Error("installed root owned default selection drifted");
  }
  if (!existsSync(join(appDir, "node_modules", "pyproc", "scripts", "assetCatalog.json"))) throw new Error("installed engine catalog 누락");
  for (const path of [
    ["scripts", "pyprocMcp.mjs"],
    ["scripts", "pyprocControl.mjs"],
    ["scripts", "controlProtocolServer.mjs"],
    ["scripts", "mcpProductConfig.mjs"],
    ["scripts", "machineEntrance", "machineProfile.js"],
    ["scripts", "machineEntrance", "profileInitializer.js"],
    ["scripts", "machineEntrance", "machineDoctor.js"],
    ["scripts", "machineEntrance", "engineInspection.js"],
    ["scripts", "machineEntrance", "entranceCli.js"],
    ["scripts", "mcpSandboxServer.mjs"],
    ["scripts", "controlProtocol", "controlProtocol.js"],
    ["scripts", "controlProtocol", "controlHost.js"],
    ["scripts", "controlProtocol", "pageCommandBridge.mjs"],
    ["scripts", "controlProtocol", "mcpControlAdapter.js"],
    ["scripts", "controlProtocol", "controlClient.js"],
    ["scripts", "controlProtocol", "controlApi.js"],
    ["scripts", "controlProtocol", "controlApi.d.ts"],
    ["scripts", "controlProtocol", "controlProduct.mjs"],
    ["scripts", "automationSpace", "automationSpace.js"],
    ["scripts", "automationSpace", "browserControlSpace.js"],
    ["scripts", "automationSpace", "nativeCdpSpace.js"],
    ["scripts", "automationSpace", "frameSpace.js"],
    ["scripts", "automationSpace", "frameSpaceTools.js"],
    ["scripts", "automationSpace", "frameSpacePage.js"],
    ["scripts", "automationSpace", "frameSpaceTarget.js"],
    ["scripts", "automationSpace", "automationRecording.js"],
    ["scripts", "automationSpace", "recordingSpace.js"],
    ["scripts", "automationSpace", "replaySpace.js"],
    ["scripts", "perception", "apxCatalog.js"],
    ["scripts", "perception", "perceptionSpace.js"],
    ["scripts", "perception", "actionEvidence.js"],
    ["scripts", "perception", "worldModel.js"],
    ["scripts", "perception", "situationCatalog.js"],
    ["scripts", "perception", "situationCompiler.js"],
    ["scripts", "perception", "probePlanner.js"],
    ["scripts", "perception", "capabilityProjector.js"],
    ["scripts", "perception", "transitionLedger.js"],
    ["scripts", "perception", "profiles", "webCdpSensor.js"],
    ["scripts", "perception", "profiles", "frameSensor.js"],
    ["scripts", "perception", "profiles", "reportedCapabilitySensor.js"],
    ["scripts", "perception", "schemas", "apxCoreSchema.json"],
    ["scripts", "perception", "schemas", "apxWebSchema.json"],
    ["scripts", "perception", "schemas", "apxActionSchema.json"],
    ["scripts", "perception", "schemas", "apxVisualSchema.json"],
    ["scripts", "perception", "schemas", "apxFocusSchema.json"],
    ["scripts", "perception", "schemas", "apxSituationSchema.json"],
    ["scripts", "verification", "verificationCanonical.js"],
    ["scripts", "verification", "experienceContract.js"],
    ["scripts", "verification", "verificationOracle.js"],
    ["scripts", "verification", "evidencePack.js"],
    ["scripts", "verification", "verificationRunner.js"],
    ["scripts", "verification", "verificationTools.js"],
    ["scripts", "verification", "schemas", "experienceSchema.json"],
    ["scripts", "verification", "schemas", "scenariosSchema.json"],
    ["scripts", "verification", "schemas", "baselinesSchema.json"],
    ["scripts", "verification", "schemas", "evidencePackSchema.json"],
    ["scripts", "browserControl", "mcpMachine.html"],
    ["scripts", "browserControl", "browserArtifactStore.js"],
  ]) {
    if (!existsSync(join(appDir, "node_modules", "pyproc", ...path))) {
      throw new Error(`installed pyproc-mcp runtime 누락: ${path.join("/")}`);
    }
  }
  const controlHelp = run(controlCli, ["--help"], { cwd: appDir });
  const controlVersion = run(controlCli, ["--version"], { cwd: appDir });
  const initHelp = run(mcpCli, ["init", "--help"], { cwd: appDir });
  if (!controlHelp.stdout.includes("pyproc-control --config") || !controlHelp.stdout.includes("pyproc-control doctor")
    || !controlHelp.stdout.includes("pyproc-control run")
    || !initHelp.stdout.includes("Override the installed package's owned CPython engine")
    || !initHelp.stdout.includes("--recording-sha256")
    || controlVersion.stdout.trim() !== installedPackage.version) {
    throw new Error("installed pyproc-control help/version 계약 불일치");
  }
  const entranceProject = join(appDir, "entrance");
  mkdirSync(entranceProject, { recursive: true });
  const entrance = JSON.parse(run(mcpCli, ["init", "--recipe", "pythonOnly", "--project-root",
    entranceProject], { cwd: appDir }).stdout);
  if (!entrance.ok || !existsSync(entrance.manifestPath) || !existsSync(entrance.clientPath)
    || !existsSync(entrance.readmePath)) {
    throw new Error("installed pyproc-mcp init journey가 profile 산출물을 만들지 않았다");
  }
  const entranceManifest = JSON.parse(readFileSync(entrance.manifestPath, "utf8"));
  const installedEngine = join(appDir, "node_modules", "pyproc", "src", "runtime", "engines", "wasi", "owned", "core");
  if (entrance.engine?.source !== "packageDefault" || entrance.engine?.root !== installedEngine
    || entranceManifest.engine.root !== installedEngine
    || entranceManifest.browser.enabled !== false || Object.keys(entranceManifest.browser).length !== 1) {
    throw new Error("installed pythonOnly profile이 package engine 기본값 또는 닫힌 browser authority를 잃었다");
  }

  const manifestOut = join(appDir, "public", "pyproc-assets.json");
  const copyTo = join(appDir, "public", "vendor", "pyproc");
  run(cli, ["--baseURL", "/vendor/pyproc/", "--out", manifestOut, "--copy-to", copyTo], { cwd: appDir });

  const manifest = JSON.parse(readFileSync(manifestOut, "utf8"));
  if (manifest.packageRoot !== "/vendor/pyproc/") throw new Error("installed CLI baseURL 반영 실패");
  const byPath = new Map(manifest.files.map((f) => [f.path, f]));
  for (const path of ["src/runtime/engines/wasi/wasiWorker.js",
    "src/runtime/engines/wasi/browserWasiShim.js", "src/runtime/errors.js"]) {
    const file = byPath.get(path);
    if (!file) throw new Error(`installed CLI graph 파일 누락: ${path}`);
    if (!/^sha256-[A-Za-z0-9+/]+=*$/.test(file.integrity)) throw new Error(`installed CLI SRI 형식 오류: ${path}`);
    if (!existsSync(join(copyTo, ...path.split("/")))) throw new Error(`installed CLI copy 누락: ${path}`);
  }

  console.log(`package gate ok: ${manifest.files.length} files`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
