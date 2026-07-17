// staticServer.mjs - 브라우저 실측용 정적 서버. Node 전용, 의존성 0.
// SharedArrayBuffer는 crossOriginIsolated 페이지에서만 열리므로 COOP/COEP 헤더를 단다.
// 기본은 저장소 루트를 그대로 서빙한다: examples/와 tests/의 페이지를 같은 서버로 띄운다.
// 직접 실행: npm run serve  ->  http://localhost:8788/examples/basic.html
//
// 왜 여기인가: 소비자 5개 중 4개가 게이트다(tests/browser의 run/examples/speedBench,
// scripts/mcpSandboxServer). 진열장(examples/)에 두면 제품 데모가 검증 인프라의 의존 대상이
// 되는 방향 역전이 생긴다. 이건 개발 도구지 예제가 아니다.
//
// 조각(MIME/COI_HEADERS/safeJoin/sendFile)을 따로 내는 이유: productConsumer 게이트는
// 저장소 루트를 서빙하면 안 된다(설치된 node_modules만 노출하는 것이 그 게이트의 존재 이유다).
// 라우팅은 각자 하되 MIME 표와 COI 헤더와 경로 탈출 방어는 한 곳에서 가져간다.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, normalize, extname, sep } from "node:path";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

export const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
  ".data": "application/octet-stream",
  ".whl": "application/octet-stream",
  // 브랜드 마크(assets/logo.svg): 파비콘·헤더 로고가 파일로 참조한다. 이 타입이 없으면
  // 브라우저가 octet-stream을 이미지로 안 그린다(GitHub Pages는 알아서 붙이지만 로컬은 여기가 정본).
  ".svg": "image/svg+xml",
};

// crossOriginIsolated 요건: 앞의 두 헤더가 없으면 SharedArrayBuffer가 잠긴다.
// Service-Worker-Allowed는 pyprocSw를 루트 스코프로 등록하기 위함(가상 오리진/오프라인 캐시).
export const COI_HEADERS = Object.freeze({
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Service-Worker-Allowed": "/",
});

// 경로 탈출 방어의 정본. urlPath가 root 밖을 가리키면 null(호출자가 403).
export function safeJoin(root, urlPath) {
  const rootNorm = normalize(root);
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
  const file = normalize(join(rootNorm, rel));
  if (file !== rootNorm && !file.startsWith(rootNorm + sep)) return null;
  return file;
}

// 파일 1개를 MIME/캐시/COI 헤더와 함께 보낸다. 없으면 404, 그 외 오류는 500.
export async function sendFile(res, file, opts = {}) {
  try {
    const body = await readFile(file);
    const headers = { "Content-Type": MIME[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" };
    if (opts.coi !== false) Object.assign(headers, COI_HEADERS);
    res.writeHead(200, headers);
    res.end(body);
  } catch (e) {
    res.writeHead(e.code === "ENOENT" ? 404 : 500);
    res.end(e.code === "ENOENT" ? "not found: " + file : "error: " + e.code);
  }
}

// COOP/COEP 정적 서버를 만든다(listen은 호출자 몫).
// onRequest(req, res)가 true를 반환하면 그 요청은 호출자가 처리한 것으로 보고 넘긴다
// (게이트 하네스의 POST 백채널 같은 동적 엔드포인트용).
// opts.coi=false면 COOP/COEP/SW 헤더를 뺀다: GitHub Pages처럼 헤더를 못 다는 호스팅을
// 로컬에서 재현하는 실측용(pythonMachine/noCoiProbe, swCoiProbe).
// opts.root로 서빙 루트를 바꾼다(기본 = 저장소 루트).
export function createStaticServer(onRequest = null, opts = {}) {
  const coi = opts.coi !== false;
  const root = opts.root ? normalize(opts.root) : ROOT;
  return createServer(async (req, res) => {
    if (onRequest && (await onRequest(req, res))) return;
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    // "/"는 랜딩을 서빙한다(URL은 루트 유지: 랜딩의 상대 경로가 배포 루트 기준이라서).
    const rel = urlPath === "/" ? "/examples/index.html" : urlPath.endsWith("/") ? `${urlPath}index.html` : urlPath;
    const file = safeJoin(root, rel);
    if (!file) { res.writeHead(403); return res.end("forbidden"); }
    await sendFile(res, file, { coi });
  });
}

// 직접 실행일 때만 기본 포트로 listen (import 시에는 아무것도 하지 않는다).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = Number(process.env.PORT || 8788);
  createStaticServer().listen(PORT, () => {
    console.log(`pyproc 실측 서버 (COOP/COEP)  http://localhost:${PORT}/examples/basic.html`);
    console.log(`                              http://localhost:${PORT}/examples/processOs.html`);
    console.log(`                              http://localhost:${PORT}/apps/webComputer/`);
  });
}
