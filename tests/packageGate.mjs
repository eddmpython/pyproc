// tests/packageGate.mjs - npm tarball 공개 표면 게이트.
// 저장소 소스가 아니라 설치된 패키지 표면만 써서 exports, bin, files 계약을 검증한다.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { binPath, installPackedPyProc, run } from "./packageHarness.mjs";

const { tmp, appDir } = await installPackedPyProc("pyprocPackageGate-");

try {
  const smoke = `
    import { boot, open, createWebComputer, checkEnvironment, PyProcError, PYPROC_ERROR_CODES } from "pyproc";
    import { getPyProcAssetManifest, verifyPyProcAssetIntegrity, registerPyProcServiceWorker } from "pyproc/assets";
    import { commitState, openState, MemoryStateStore, decodeStateBundle, PAGE_SIZE } from "pyproc/history";
    import { createWebComputer as fromMachine, createMachineCryptoProvider } from "pyproc/machine";

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
    if (PAGE_SIZE !== 65536) throw new Error("history PAGE_SIZE drift");
    for (const fn of [commitState, openState, decodeStateBundle, createMachineCryptoProvider]) {
      if (typeof fn !== "function") throw new Error("kernel surface missing");
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
    if (typeof registerPyProcServiceWorker !== "function") throw new Error("service worker register export missing");
    if (!manifest.assets.some((a) => a.role === "processWorker")) throw new Error("processWorker role missing");
  `;
  run(process.execPath, ["--input-type=module", "-e", smoke], { cwd: appDir });

  const cli = binPath(appDir, "pyproc-assets");
  if (!existsSync(cli)) throw new Error("installed pyproc-assets bin shim 없음");
  const engineCli = binPath(appDir, "pyproc-engine");
  if (!existsSync(engineCli)) throw new Error("installed pyproc-engine bin shim 없음");
  const controlCli = binPath(appDir, "pyproc-control");
  if (!existsSync(controlCli)) throw new Error("installed pyproc-control bin shim 없음");
  const mcpCli = binPath(appDir, "pyproc-mcp");
  if (!existsSync(mcpCli)) throw new Error("installed pyproc-mcp bin shim 없음");
  const installedPackage = JSON.parse(readFileSync(join(appDir, "node_modules", "pyproc", "package.json"), "utf8"));
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
  const installedEngineCli = readFileSync(join(appDir, "node_modules", "pyproc", "scripts", "fetchEngine.mjs"), "utf8");
  if (!installedEngineCli.includes('argv[index] === "--out"')) throw new Error("installed pyproc-engine --out 계약 누락");
  if (!existsSync(join(appDir, "node_modules", "pyproc", "scripts", "assetCatalog.json"))) throw new Error("installed engine catalog 누락");
  for (const path of [
    ["scripts", "pyprocMcp.mjs"],
    ["scripts", "pyprocControl.mjs"],
    ["scripts", "controlProtocolServer.mjs"],
    ["scripts", "mcpProductConfig.mjs"],
    ["scripts", "mcpSandboxServer.mjs"],
    ["scripts", "controlProtocol", "controlProtocol.js"],
    ["scripts", "controlProtocol", "controlHost.js"],
    ["scripts", "controlProtocol", "pageCommandBridge.mjs"],
    ["scripts", "controlProtocol", "mcpControlAdapter.js"],
    ["scripts", "controlProtocol", "controlClient.js"],
    ["scripts", "controlProtocol", "controlProduct.mjs"],
    ["scripts", "automationSpace", "automationSpace.js"],
    ["scripts", "automationSpace", "browserControlSpace.js"],
    ["scripts", "automationSpace", "nativeCdpSpace.js"],
    ["scripts", "automationSpace", "frameSpace.js"],
    ["scripts", "automationSpace", "frameSpaceTools.js"],
    ["scripts", "automationSpace", "frameSpacePage.js"],
    ["scripts", "automationSpace", "frameSpaceTarget.js"],
    ["scripts", "browserControl", "mcpMachine.html"],
    ["scripts", "browserControl", "browserArtifactStore.js"],
  ]) {
    if (!existsSync(join(appDir, "node_modules", "pyproc", ...path))) {
      throw new Error(`installed pyproc-mcp runtime 누락: ${path.join("/")}`);
    }
  }
  const controlHelp = run(controlCli, ["--help"], { cwd: appDir });
  const controlVersion = run(controlCli, ["--version"], { cwd: appDir });
  if (!controlHelp.stdout.includes("pyproc-control --config")
    || controlVersion.stdout.trim() !== installedPackage.version) {
    throw new Error("installed pyproc-control help/version 계약 불일치");
  }

  const manifestOut = join(appDir, "public", "pyproc-assets.json");
  const copyTo = join(appDir, "public", "vendor", "pyproc");
  run(cli, ["--baseURL", "/vendor/pyproc/", "--out", manifestOut, "--copy-to", copyTo], { cwd: appDir });

  const manifest = JSON.parse(readFileSync(manifestOut, "utf8"));
  if (manifest.packageRoot !== "/vendor/pyproc/") throw new Error("installed CLI baseURL 반영 실패");
  const byPath = new Map(manifest.files.map((f) => [f.path, f]));
  for (const path of ["src/processOs/worker.js", "src/processOs/ipc.js", "src/runtime/runtime.js"]) {
    const file = byPath.get(path);
    if (!file) throw new Error(`installed CLI graph 파일 누락: ${path}`);
    if (!/^sha256-[A-Za-z0-9+/]+=*$/.test(file.integrity)) throw new Error(`installed CLI SRI 형식 오류: ${path}`);
    if (!existsSync(join(copyTo, ...path.split("/")))) throw new Error(`installed CLI copy 누락: ${path}`);
  }

  console.log(`package gate ok: ${manifest.files.length} files`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
