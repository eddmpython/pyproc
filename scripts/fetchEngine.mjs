#!/usr/bin/env node
// fetchEngine.mjs - 엔진 배포판 자가 호스팅 준비(engine-independence P0: 유통 독립). Node 전용, 의존성 0.
// GitHub Releases의 전체 배포판(코어 + 전 패키지 wheel)을 지정한 pyodide/ 디렉터리로 내려받아 푼다.
// 저장소에서는 vendor/pyodide/, 배포 프로젝트에서는 public/vendor/pyodide/처럼 쓴다.
//
// 버전 상수는 src/runtime/pyodideDistribution.js와 같아야 하며 tests/run.mjs가 기계 검사한다.
// 압축 해제는 OS 기본 tar(bsdtar, Windows 10+/리눅스/맥 내장)를 쓴다. npm 의존성 0 유지.
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const ENGINE_VERSION = "314.0.2";
const RELEASE_URL = `https://github.com/pyodide/pyodide/releases/download/${ENGINE_VERSION}/pyodide-${ENGINE_VERSION}.tar.bz2`;

const PACKAGE_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CATALOG = JSON.parse(readFileSync(join(PACKAGE_ROOT, "scripts", "assetCatalog.json"), "utf8"));

function outputDirectory(argv) {
  let value = "vendor/pyodide";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out") {
      value = argv[index + 1];
      if (!value) throw new Error("--out 뒤에 pyodide 디렉터리가 필요하다");
      index += 1;
    } else {
      throw new Error(`알 수 없는 인자: ${argv[index]}`);
    }
  }
  const target = isAbsolute(value) ? value : resolve(process.cwd(), value);
  if (basename(target).toLowerCase() !== "pyodide") {
    throw new Error(`--out은 pyodide로 끝나야 한다: ${target}`);
  }
  return target;
}

const DIST = outputDirectory(process.argv.slice(2));
const VENDOR = dirname(DIST);
const TARBALL = join(VENDOR, `pyodide-${ENGINE_VERSION}.tar.bz2`);

function coreAssets() {
  return CATALOG.assets.filter((asset) =>
    asset.componentId === `pyodide-release-${ENGINE_VERSION}` &&
    Array.isArray(asset.consumers) && asset.consumers.includes("pyproc"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function verifyPreparedDistribution() {
  const assets = coreAssets();
  if (!assets.length) throw new Error(`assetCatalog에 Pyodide ${ENGINE_VERSION} core가 없다`);
  for (const asset of assets) {
    const path = join(DIST, asset.name);
    if (!existsSync(path)) throw new Error(`engine core 누락: ${path}`);
    const bytes = readFileSync(path);
    if (bytes.byteLength !== asset.byteLength) throw new Error(`${asset.name}: byteLength 불일치`);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== asset.sha256) throw new Error(`${asset.name}: SHA-256 불일치`);
  }
  // 검증된 lock 파일이 가리키는 모든 wheel도 검사한다. 따라서 배포 디렉터리의 실행 가능
  // 바이트는 catalog -> lock -> package hash의 단일 신뢰 사슬로 닫힌다.
  const lock = JSON.parse(readFileSync(join(DIST, "pyodide-lock.json"), "utf8"));
  const packages = Object.values(lock.packages || {}).filter((entry) => entry?.file_name && entry?.sha256);
  if (!packages.length) throw new Error("pyodide-lock.json에 검증할 package가 없다");
  for (const entry of packages) {
    const path = join(DIST, entry.file_name);
    if (!existsSync(path)) throw new Error(`engine package 누락: ${path}`);
    if (sha256(path) !== entry.sha256) throw new Error(`${entry.file_name}: lock SHA-256 불일치`);
  }
  console.log(`검증됨: Pyodide ${ENGINE_VERSION} core ${assets.length}개, package ${packages.length}개`);
}

async function main() {
  // 멱등: 이미 풀린 배포판이 있으면(락 파일 존재) 아무것도 안 한다.
  if (existsSync(join(DIST, "pyodide-lock.json"))) {
    verifyPreparedDistribution();
    console.log(`이미 준비됨: ${DIST}`);
    return;
  }
  mkdirSync(VENDOR, { recursive: true });

  if (!existsSync(TARBALL) || statSync(TARBALL).size === 0) {
    console.log(`내려받는 중: ${RELEASE_URL}`);
    const resp = await fetch(RELEASE_URL);
    if (!resp.ok || !resp.body) throw new Error(`다운로드 실패 ${resp.status}: ${RELEASE_URL}`);
    const total = Number(resp.headers.get("content-length") || 0);
    let seen = 0, lastPct = -10;
    const progress = new TransformStream({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        const pct = total ? Math.floor((seen / total) * 100) : 0;
        if (pct >= lastPct + 10) { lastPct = pct; console.log(`  ${pct}% (${Math.round(seen / 1048576)}MB)`); }
        controller.enqueue(chunk);
      },
    });
    await pipeline(Readable.fromWeb(resp.body.pipeThrough(progress)), createWriteStream(TARBALL));
    console.log(`받음: ${TARBALL} (${Math.round(statSync(TARBALL).size / 1048576)}MB)`);
  } else {
    console.log(`받아둔 파일 재사용: ${TARBALL}`);
  }

  console.log("푸는 중 (tar -xjf, 수 분 걸릴 수 있음)...");
  // Windows는 System32의 bsdtar를 명시한다: PATH의 GNU tar(MSYS)는 "C:\..." 경로를
  // 원격 호스트로 해석해 실패한다. bsdtar는 드라이브 문자 + bz2를 그대로 처리한다.
  const tarBin = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
  const tar = spawnSync(tarBin, ["-xjf", TARBALL, "-C", VENDOR], { stdio: "inherit" });
  if (tar.status !== 0) throw new Error(`tar 실패(status ${tar.status}). OS 내장 tar(bsdtar)가 필요하다.`);
  if (!existsSync(join(DIST, "pyodide-lock.json"))) throw new Error(`해제 결과에 ${DIST}/pyodide-lock.json이 없다(배포판 구조 변경?).`);
  verifyPreparedDistribution();
  rmSync(TARBALL, { force: true }); // 풀린 배포판만 남긴다(중복 426MB 방지)
  console.log(`완료: ${DIST}`);
  console.log("기본 부팅 URL: /vendor/pyodide/");
}

main().catch((e) => { console.error(String(e)); process.exit(1); });
