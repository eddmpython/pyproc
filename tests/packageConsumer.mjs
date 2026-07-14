// tests/packageConsumer.mjs - npm tarball 소비자 게이트.
// 저장소 소스가 아니라 설치된 패키지 표면만 써서 exports, bin, files 계약을 검증한다.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { binPath, installPackedPyProc, run } from "./packageHarness.mjs";

const { tmp, appDir } = await installPackedPyProc("pyprocConsumer-");

try {
  const smoke = `
    import { Runtime, PyProc, getPyProcAssetManifest, verifyPyProcAssetIntegrity, registerPyProcServiceWorker } from "pyproc";
    import { getPyProcAssetManifest as fromAssets } from "pyproc/assets";
    import { Runtime as RuntimeFromSubpath, boot as bootFromSubpath } from "pyproc/runtime";

    const manifest = getPyProcAssetManifest({ baseURL: "/vendor/pyproc/" });
    const subpathManifest = fromAssets({ baseURL: "/vendor/pyproc/" });
    if (manifest.packageRoot !== "/vendor/pyproc/") throw new Error("baseURL normalization failed");
    if (subpathManifest.assets.length !== manifest.assets.length) throw new Error("assets subpath drift");
    if (typeof PyProc !== "function") throw new Error("PyProc export missing");
    if (RuntimeFromSubpath !== Runtime) throw new Error("runtime subpath Runtime drift");
    if (typeof bootFromSubpath !== "function") throw new Error("runtime subpath boot missing");
    if (typeof Runtime.prototype.enableReactive !== "function") throw new Error("Runtime capability binding missing");
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
