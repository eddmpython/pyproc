// fetchWasiAssets.mjs - WASI 게이트 자산 준비(Node 전용, 의존성 0).
// brettcannon/cpython-wasi-build 릴리즈 zip을 받아 tests/attempts/enginePort/에
// python-3.14.6.wasm과 python314-stdlib.zip(모듈이 zip 루트)을 만든다.
// 레시피의 정본: tests/attempts/enginePort/README.md 자산 절. CI가 이 스크립트 +
// actions/cache로 wasiGate를 SKIP이 아니라 실제 GREEN으로 돌린다.
// 압축은 OS 기본 bsdtar(zip 읽기/쓰기 내장, Windows 10+/리눅스/맥)를 쓴다. npm 의존성 0 유지.
import { createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, rmSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const WASI_PYTHON_VERSION = "3.14.6";
const RELEASE_URL = `https://github.com/brettcannon/cpython-wasi-build/releases/download/v${WASI_PYTHON_VERSION}/python-${WASI_PYTHON_VERSION}-wasi_sdk-24.zip`;

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const TARGET = join(ROOT, "tests", "attempts", "enginePort");
const WASM_OUT = join(TARGET, `python-${WASI_PYTHON_VERSION}.wasm`);
const STDLIB_OUT = join(TARGET, "python314-stdlib.zip");
const WORK = join(TARGET, ".wasiFetch");

// zip 추출/생성은 OS별 내장 도구가 다르다: Windows tar = bsdtar(zip 내장),
// 리눅스 tar = GNU tar(zip 불가, 대신 unzip/zip이 러너에 내장). 순서대로 폴백한다.
function extractZip(zipName, cwd) {
  const attempts = [["tar", ["-xf", zipName]], ["unzip", ["-o", "-q", zipName]]];
  const failures = [];
  for (const [cmd, args] of attempts) {
    const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
    if (r.status === 0) return;
    failures.push(`${cmd}: ${(r.stderr || r.stdout || String(r.error || "")).slice(0, 160)}`);
  }
  throw new Error(`zip 추출 실패(${zipName}): ${failures.join(" | ")}`);
}

// zip 파일 판별: 도구가 exit 0으로 엉뚱한 포맷을 만드는 경우(GNU tar -a가 zip 접미사에
// plain tar를 만든 CI 실사고)를 잡는다. 판별 없는 성공은 성공이 아니다.
function isZipFile(path) {
  if (!existsSync(path)) return false;
  const fd = openSync(path, "r");
  const head = Buffer.alloc(2);
  readSync(fd, head, 0, 2, 0);
  closeSync(fd);
  return head[0] === 0x50 && head[1] === 0x4b; // "PK"
}

function createZip(outPath, contentDir) {
  const attempts = [
    ["tar", ["-a", "-cf", outPath, "-C", contentDir, "."], undefined],
    ["zip", ["-q", "-r", outPath, "."], contentDir],
  ];
  const failures = [];
  for (const [cmd, args, cwd] of attempts) {
    rmSync(outPath, { force: true });
    const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
    if (r.status === 0 && isZipFile(outPath)) return;
    failures.push(`${cmd}: ${r.status !== 0 ? (r.stderr || r.stdout || String(r.error || "")).slice(0, 160) : "exit 0이지만 zip 시그니처(PK) 아님"}`);
  }
  throw new Error(`zip 생성 실패(${outPath}): ${failures.join(" | ")}`);
}

async function main() {
  if (existsSync(WASM_OUT) && isZipFile(STDLIB_OUT)) {
    console.log(`이미 준비됨: ${WASM_OUT} + stdlib zip. 다시 받으려면 두 파일을 지우고 재실행.`);
    return;
  }
  rmSync(STDLIB_OUT, { force: true }); // 파손 캐시(가짜 zip)는 재제조 대상이다
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const zipPath = join(WORK, "cpy.zip");
  console.log(`다운로드: ${RELEASE_URL}`);
  const resp = await fetch(RELEASE_URL, { redirect: "follow" });
  if (!resp.ok) throw new Error(`릴리즈 다운로드 실패: ${resp.status}`);
  await pipeline(Readable.fromWeb(resp.body), createWriteStream(zipPath));
  extractZip("cpy.zip", WORK);
  if (!existsSync(join(WORK, "python.wasm"))) throw new Error("릴리즈 zip에 python.wasm이 없다");
  const stdlibDir = join(WORK, "lib", `python3.14`);
  if (!existsSync(stdlibDir)) throw new Error("릴리즈 zip에 lib/python3.14가 없다");
  // 모듈이 zip 루트에 오도록 stdlib 디렉터리 내용을 묶는다(도구 폴백은 createZip 참조).
  createZip(join(WORK, "stdlib.zip"), stdlibDir);
  renameSync(join(WORK, "python.wasm"), WASM_OUT);
  renameSync(join(WORK, "stdlib.zip"), STDLIB_OUT);
  rmSync(WORK, { recursive: true, force: true });
  console.log(`준비 완료: ${WASM_OUT}, ${STDLIB_OUT}`);
}

main().catch((e) => { console.error(String(e)); process.exit(1); });
