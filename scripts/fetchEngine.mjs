// fetchEngine.mjs - 엔진 배포판 자가 호스팅 준비(engine-independence P0: 유통 독립). Node 전용, 의존성 0.
// GitHub Releases의 전체 배포판(코어 + 전 패키지 wheel, 약 426MB)을 vendor/pyodide/로 내려받아 푼다.
// 이후 어떤 부팅도 CDN 없이 된다: boot({ indexURL: "/vendor/pyodide/" }) 또는
// PYPROC_INDEX_URL=/vendor/pyodide/ npm run test:browser (게이트 전 검사를 자가 경로로).
//
// 버전 상수의 출처: src/runtime/runtime.js DEFAULT_INDEX(배포 지점의 유일 정의처)와 같은 값이어야
// 하며 tests/run.mjs가 일치를 기계 검사한다. 버전 변경 = 릴리즈 사유(docs/consuming/contract.md).
// 압축 해제는 OS 기본 tar(bsdtar, Windows 10+/리눅스/맥 내장)를 쓴다. npm 의존성 0 유지.
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const ENGINE_VERSION = "314.0.2";
const RELEASE_URL = `https://github.com/pyodide/pyodide/releases/download/${ENGINE_VERSION}/pyodide-${ENGINE_VERSION}.tar.bz2`;

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const VENDOR = join(ROOT, "vendor");
const DIST = join(VENDOR, "pyodide");
const TARBALL = join(VENDOR, `pyodide-${ENGINE_VERSION}.tar.bz2`);

async function main() {
  // 멱등: 이미 풀린 배포판이 있으면(락 파일 존재) 아무것도 안 한다.
  if (existsSync(join(DIST, "pyodide-lock.json"))) {
    console.log(`이미 준비됨: ${DIST} (pyodide-lock.json 존재). 다시 받으려면 vendor/pyodide/를 지우고 재실행.`);
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
  rmSync(TARBALL, { force: true }); // 풀린 배포판만 남긴다(중복 426MB 방지)
  console.log(`완료: ${DIST}`);
  console.log(`자가 경로 부팅: boot({ indexURL: "/vendor/pyodide/" })`);
  console.log(`게이트 전 검사: PYPROC_INDEX_URL=/vendor/pyodide/ npm run test:browser`);
}

main().catch((e) => { console.error(String(e)); process.exit(1); });
