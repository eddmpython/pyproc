// tests/packageConsumer.mjs - npm tarball 소비자 게이트.
// 저장소 소스가 아니라 설치된 패키지 표면만 써서 exports, bin, files 계약을 검증한다.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { binPath, installPackedPyProc, run } from "./packageHarness.mjs";

const { tmp, appDir } = await installPackedPyProc("pyprocConsumer-");

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

  console.log(`package consumer ok: ${manifest.files.length} files`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
