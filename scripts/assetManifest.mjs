#!/usr/bin/env node
// assetManifest.mjs - pyproc 실행 자산 copy/SRI manifest 생성기.
// 빌드 단계는 도입하지 않는다. 소비 제품 배포 파이프라인이 필요할 때 실행하는 zero-dep CLI다.
// 정본 경로는 공개 API getPyProcAssetManifest()에서 가져오고, 이 스크립트는 파일 바이트의
// sha256 SRI와 상대 import graph를 계산한다.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getPyProcAssetManifest } from "../index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_BASE_URL = "/vendor/pyproc/";
const IMPORT_RE = /^\s*(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/gm;
const DYNAMIC_IMPORT_RE = /import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;
const IMPORT_SCRIPTS_RE = /importScripts\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;

function usage() {
  return `usage: pyproc-assets [--baseURL /vendor/pyproc/] [--out file] [--copy-to dir] [--pretty]

Generates a JSON manifest for pyproc runtime assets. The manifest includes every Worker,
SharedWorker, and Service Worker entrypoint plus its relative import graph, with sha256 SRI.
`;
}

function parseArgs(argv) {
  const opts = { baseURL: DEFAULT_BASE_URL, out: null, copyTo: null, pretty: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { console.log(usage()); process.exit(0); }
    if (a === "--pretty") { opts.pretty = true; continue; }
    if (a === "--baseURL") { opts.baseURL = argv[++i]; continue; }
    if (a === "--out") { opts.out = argv[++i]; continue; }
    if (a === "--copy-to") { opts.copyTo = argv[++i]; continue; }
    throw new Error(`알 수 없는 인자: ${a}`);
  }
  if (!opts.baseURL) throw new Error("--baseURL 값이 비었다");
  return opts;
}

function toPosix(p) {
  return p.replaceAll("\\", "/");
}

function absFromRel(relPath) {
  const abs = resolve(ROOT, relPath);
  if (!(abs === ROOT || abs.startsWith(ROOT + sep))) throw new Error(`패키지 루트 밖 경로: ${relPath}`);
  return abs;
}

function relFromAbs(absPath) {
  return toPosix(absPath.slice(ROOT.length + 1));
}

function sri(bytes) {
  return "sha256-" + createHash("sha256").update(bytes).digest("base64");
}

function publicURL(root, path) {
  if (root.startsWith("/") || root.startsWith("./") || root.startsWith("../")) return root + path;
  return new URL(path, root).href;
}

function localSpecifiers(src) {
  const found = new Set();
  for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE, IMPORT_SCRIPTS_RE]) {
    re.lastIndex = 0;
    for (const m of src.matchAll(re)) found.add(m[1]);
  }
  return [...found];
}

function resolveLocal(fromRel, spec) {
  if (!spec.startsWith(".")) return null;
  const base = dirname(absFromRel(fromRel));
  let abs = resolve(base, spec);
  if (!/\.[a-z0-9]+$/i.test(abs)) abs += ".js";
  if (!(abs === ROOT || abs.startsWith(ROOT + sep))) throw new Error(`import가 패키지 루트 밖을 가리킴: ${fromRel} -> ${spec}`);
  return relFromAbs(abs);
}

async function collectGraph(entryRel) {
  const seen = new Set();
  const stack = [entryRel];
  while (stack.length) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    const abs = absFromRel(rel);
    if (!existsSync(abs)) throw new Error(`자산 파일 없음: ${rel}`);
    seen.add(rel);
    const src = await readFile(abs, "utf8");
    for (const spec of localSpecifiers(src)) {
      const dep = resolveLocal(rel, spec);
      if (dep && !seen.has(dep)) stack.push(dep);
    }
  }
  return [...seen].sort();
}

async function buildManifest(opts) {
  const contract = getPyProcAssetManifest({ baseURL: opts.baseURL });
  const fileRoles = new Map();
  const entrypoints = [];
  for (const asset of contract.assets) {
    const graph = await collectGraph(asset.path);
    entrypoints.push({ ...asset, graph });
    for (const p of graph) {
      if (!fileRoles.has(p)) fileRoles.set(p, new Set());
      fileRoles.get(p).add(asset.role);
    }
  }

  const files = [];
  for (const p of [...fileRoles.keys()].sort()) {
    const bytes = await readFile(absFromRel(p));
    files.push({
      path: p,
      url: publicURL(contract.packageRoot, p),
      bytes: bytes.byteLength,
      integrity: sri(bytes),
      roles: [...fileRoles.get(p)].sort(),
    });
  }

  const fileByPath = new Map(files.map((f) => [f.path, f]));
  for (const e of entrypoints) {
    const f = fileByPath.get(e.path);
    e.integrity = f.integrity;
    e.bytes = f.bytes;
  }

  return {
    version: contract.version,
    packageRoot: contract.packageRoot,
    policy: contract.policy,
    entrypoints,
    files,
  };
}

async function copyGraph(files, copyTo) {
  const root = resolve(copyTo);
  await mkdir(root, { recursive: true });
  for (const f of files) {
    const dest = resolve(root, f.path);
    if (!(dest === root || dest.startsWith(root + sep))) throw new Error(`복사 대상이 루트 밖: ${f.path}`);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(absFromRel(f.path), dest);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const manifest = await buildManifest(opts);
  if (opts.copyTo) await copyGraph(manifest.files, opts.copyTo);
  const json = JSON.stringify(manifest, null, opts.pretty ? 2 : 0) + "\n";
  if (opts.out) {
    const out = resolve(opts.out);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, json);
  } else {
    process.stdout.write(json);
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
