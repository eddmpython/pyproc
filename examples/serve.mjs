// serve.mjs - 브라우저 실측용 정적 서버. Node 전용, 의존성 0.
// SharedArrayBuffer는 crossOriginIsolated 페이지에서만 열리므로 COOP/COEP 헤더를 단다.
// 저장소 루트를 그대로 서빙한다: examples/와 tests/의 페이지를 같은 서버로 띄운다.
// 직접 실행: npm run serve  ->  http://localhost:8788/examples/basic.html
// 재사용: tests/browser/run.mjs가 createStaticServer()를 import해 게이트 하네스로 쓴다.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, normalize, extname, sep } from "node:path";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
};

// COOP/COEP 정적 서버를 만든다(listen은 호출자 몫).
// onRequest(req, res)가 true를 반환하면 그 요청은 호출자가 처리한 것으로 보고 넘긴다
// (게이트 하네스의 POST 백채널 같은 동적 엔드포인트용).
// opts.coi=false면 COOP/COEP/SW 헤더를 뺀다: GitHub Pages처럼 헤더를 못 다는 호스팅을
// 로컬에서 재현하는 실측용(pythonMachine/noCoiProbe, swCoiProbe).
export function createStaticServer(onRequest = null, opts = {}) {
  const coi = opts.coi !== false;
  return createServer(async (req, res) => {
    if (onRequest && (await onRequest(req, res))) return;
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    // "/"는 랜딩을 서빙한다(URL은 루트 유지: 랜딩의 상대 경로가 배포 루트 기준이라서).
    const rel = urlPath === "/" ? "/examples/index.html" : urlPath;
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT + sep)) { res.writeHead(403); return res.end("forbidden"); }
    try {
      const body = await readFile(file);
      const headers = { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" };
      if (coi) {
        // crossOriginIsolated 요건: 이 두 헤더가 없으면 SharedArrayBuffer가 잠긴다.
        headers["Cross-Origin-Opener-Policy"] = "same-origin";
        headers["Cross-Origin-Embedder-Policy"] = "require-corp";
        // src/capabilities/pyprocSw.js를 루트 스코프로 등록할 수 있게(가상 오리진/오프라인).
        headers["Service-Worker-Allowed"] = "/";
      }
      res.writeHead(200, headers);
      res.end(body);
    } catch (e) {
      res.writeHead(e.code === "ENOENT" ? 404 : 500);
      res.end(e.code === "ENOENT" ? "not found: " + rel : "error: " + e.code);
    }
  });
}

// 직접 실행일 때만 기본 포트로 listen (import 시에는 아무것도 하지 않는다).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = Number(process.env.PORT || 8788);
  createStaticServer().listen(PORT, () => {
    console.log(`pyproc 실측 서버 (COOP/COEP)  http://localhost:${PORT}/examples/basic.html`);
    console.log(`                              http://localhost:${PORT}/examples/processOs.html`);
  });
}
