// playgroundServer.js - 설치 패키지 그래프를 COOP/COEP로 서빙하는 첫 성공 서버.
import { createStaticServer, COI_HEADERS } from "../staticServer.mjs";
import { FIRST_SUCCESS_PAGE } from "./firstSuccessContract.js";

export const PLAYGROUND_PAGE_PATH = `/${FIRST_SUCCESS_PAGE}`;

export function createPlaygroundServer(options = {}) {
  const packageRoot = options.root;
  if (!packageRoot) throw new TypeError("createPlaygroundServer requires root");
  const seen = [];
  const server = createStaticServer(async (request, response) => {
    const urlPath = decodeURIComponent(new URL(request.url, "http://local").pathname);
    seen.push(urlPath);
    if (options.onRequest && await options.onRequest(request, response)) return true;
    if (urlPath === "/" || urlPath === "/index.html") {
      response.writeHead(302, { ...COI_HEADERS, Location: PLAYGROUND_PAGE_PATH });
      response.end();
      return true;
    }
    return false;
  }, { root: packageRoot, coi: options.coi !== false });
  server.requestedPaths = seen;
  return server;
}

export function extractRelativeModuleSpecifiers(source) {
  const specs = [];
  const patterns = [
    /(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/gu,
    /import\s*\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/gu,
    /<script[^>]+src=["'](\.{1,2}\/[^"']+)["']/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specs.push(match[1].split(/[?#]/u)[0]);
  }
  return specs;
}

export function resolvePlaygroundPath(fromPath, specifier) {
  const from = fromPath === "/" ? FIRST_SUCCESS_PAGE : fromPath.replace(/^\//u, "");
  const stack = from.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return `/${stack.join("/")}`;
}
