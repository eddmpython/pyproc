// 설치 패키지 consumer gate coverage의 데이터 정본.
// contract.md와 productConsumer.mjs가 같은 배열을 본다.
// state-kernel 7b 표면 개편 반영: 루트는 porcelain 6개(boot/open/createWebComputer/
// checkEnvironment/PyProcError/PYPROC_ERROR_CODES)이고, 능력 상세는 machine 핸들의
// runtime 탈출구와 proc() 풀, history 동사, pyproc/history 서명 코어로 도달한다.
export const PRODUCT_CONSUMER_COVERAGE_VERSION = 2;

export const PRODUCT_CONSUMER_COVERAGE = Object.freeze([
  Object.freeze({
    gate: "package consumer",
    specifiers: Object.freeze(["`pyproc`", "`pyproc/assets`", "`pyproc/history`", "`pyproc/machine`"]),
    publicSurface: Object.freeze([
      "`boot`",
      "`open`",
      "`createWebComputer`",
      "`checkEnvironment`",
      "`getPyProcAssetManifest`",
      "`verifyPyProcAssetIntegrity`",
      "`registerPyProcServiceWorker`",
      "`commitState`/`openState` 커널 왕복",
      "`pyproc-assets` bin",
    ]),
    contract: "package exports, stable subpath, `index.d.ts`, npm files, CLI graph copy and SRI manifest",
  }),
  Object.freeze({
    gate: "product consumer - asset path",
    specifiers: Object.freeze(["`pyproc`", "`pyproc/assets`"]),
    publicSurface: Object.freeze([
      "`getPyProcAssetManifest`",
      "`verifyPyProcAssetIntegrity`",
      "`registerPyProcServiceWorker`",
    ]),
    contract: "`/node_modules/pyproc/` 기준 asset manifest, worker graph SRI, 설치된 `pyprocSw.js` registration, bad worker SRI spawn 전 거부",
  }),
  Object.freeze({
    gate: "product consumer - runtime/server",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["`boot`", "machine runtime `enableAsgiServer`", "설치된 `pyprocSw.js` ASGI 위임 배선"]),
    contract: "설치 패키지 machine boot, Python ASGI app, `fetch(\"/pyproc/...\")` virtual origin 왕복, S3 timing source",
  }),
  Object.freeze({
    gate: "product consumer - device filesystem",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["machine runtime `enableDeviceFs`"]),
    contract: "설치 패키지 machine에서 `/dev/productState`와 `/proc/meminfo`를 Python `open()` 파일 계약으로 읽고 쓴다",
  }),
  Object.freeze({
    gate: "product consumer - process OS",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["machine `proc()` 풀"]),
    contract: "설치 패키지 worker graph로 풀 `map`, `terminate` 실행과 bad worker SRI의 spawn 전 거부, SRI와 ASGI Service Worker prefix 충돌 없음",
  }),
  Object.freeze({
    gate: "product consumer - shell jobs",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["machine `proc({ replay })` 풀의 `fork`/`repl`/`signal`"]),
    contract: "설치 패키지 worker graph로 대화형 namespace를 만들고 `expr &`, `fg`, `kill`, `terminate` 잡 수명주기 실행",
  }),
  Object.freeze({
    gate: "product consumer - machine container",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["machine `proc()` 자식 커널(`setup` manifest + `exec`/`kill`)"]),
    contract: "설치 패키지 worker graph로 자식 머신 spawn, run, heapLen, kill, killed call reject 실행",
  }),
  Object.freeze({
    gate: "product consumer - crash resume",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["`boot({ deterministic: true })`", "machine `history.commit`/`history.recover`"]),
    contract: "설치 패키지 `deterministic` machine의 reactive boundary를 `history.commit()`으로 남기고 새 machine이 `history.recover()`로 제품 상태를 복구",
  }),
  Object.freeze({
    gate: "product consumer - immortal python machine",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["`open({ persistent })`", "`KernelElection` 핸들"]),
    contract: "설치 패키지의 독립 browsing context 3개가 한 Python 상태와 prepared environment를 공유하고 participant request ID 무충돌과 late response 폐기를 확인하며, leader 강제 제거 뒤 영속 epoch 승계와 OPFS의 힙 + `/home/web` 복구로 실행을 계속하고 모든 context 종료 뒤에도 마지막 commit과 manifest 환경에서 다시 연다",
  }),
  Object.freeze({
    gate: "product consumer - product policy",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["machine `runtime` 탈출구(`setGlobal` choke point + CSP `connect-src`)"]),
    contract: "제품 permission manifest(`net=false`, `clipboard=false`, `home=true`, `workers=false`)와 Python choke point 집행",
  }),
  Object.freeze({
    gate: "product consumer - portable machine",
    specifiers: Object.freeze(["`pyproc`", "`pyproc/history`"]),
    publicSurface: Object.freeze([
      "`boot({ deterministic: true })`",
      "`open(blob)`",
      "`createStateKeyPair`",
      "`exportStatePublicKey`",
      "`fingerprintStatePublicKey`",
      "machine `history.export({ signingKey })`",
      "Runtime `enableInit`",
    ]),
    contract: "signed `.pymachine` + `/home/web` export, signer fingerprint, untrusted/wrong key 거부, trusted open, `resume.py` SQLite resource 재개설, S4 timing source",
  }),
  Object.freeze({
    gate: "product consumer - web computer",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["`createWebComputer`"]),
    contract: "설치 패키지만으로 브라우저 컴퓨터를 조립해 python guest 부팅, 코드 실행, 전체 shutdown",
  }),
]);

export function productConsumerCoverageManifest() {
  return {
    schemaVersion: PRODUCT_CONSUMER_COVERAGE_VERSION,
    rows: PRODUCT_CONSUMER_COVERAGE,
  };
}

export function renderProductConsumerCoverageMarkdown(rows = PRODUCT_CONSUMER_COVERAGE) {
  const lines = [
    "| 게이트 | 노출 specifier | 실제 public surface | 검증하는 계약 |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    lines.push(`| ${row.gate} | ${row.specifiers.join(", ")} | ${row.publicSurface.join(", ")} | ${row.contract} |`);
  }
  return lines.join("\n");
}
