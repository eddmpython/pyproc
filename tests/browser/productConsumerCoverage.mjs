// 설치 패키지 consumer gate coverage의 데이터 정본.
// contract.md와 productConsumer.mjs가 같은 배열을 본다.
export const PRODUCT_CONSUMER_COVERAGE_VERSION = 1;

export const PRODUCT_CONSUMER_COVERAGE = Object.freeze([
  Object.freeze({
    gate: "package consumer",
    specifiers: Object.freeze(["`pyproc`", "`pyproc/assets`", "`pyproc/runtime`"]),
    publicSurface: Object.freeze([
      "`Runtime`",
      "`PyProc`",
      "`getPyProcAssetManifest`",
      "`verifyPyProcAssetIntegrity`",
      "`registerPyProcServiceWorker`",
      "runtime subpath `boot`/`Runtime`",
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
    publicSurface: Object.freeze(["`boot`", "`VirtualOrigin`", "Runtime `enableAsgiServer`"]),
    contract: "설치 패키지 Runtime boot, Python ASGI app, `fetch(\"/pyproc/...\")` virtual origin 왕복, S3 timing source",
  }),
  Object.freeze({
    gate: "product consumer - device filesystem",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["`DeviceFs`", "Runtime `enableDeviceFs`"]),
    contract: "설치 패키지 Runtime에서 `/dev/productState`와 `/proc/meminfo`를 Python `open()` 파일 계약으로 읽고 쓴다",
  }),
  Object.freeze({
    gate: "product consumer - process OS",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["`PyProc`"]),
    contract: "설치 패키지 worker graph로 `boot`, `map`, `terminate` 실행, SRI와 ASGI Service Worker prefix 충돌 없음",
  }),
  Object.freeze({
    gate: "product consumer - shell jobs",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["`JobControl`"]),
    contract: "설치 패키지 worker graph로 대화형 namespace를 만들고 `expr &`, `fg`, `kill`, `terminate` 잡 수명주기 실행",
  }),
  Object.freeze({
    gate: "product consumer - crash resume",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["`bootSession`", "`MachineJournal`", "Runtime `enableJournal`"]),
    contract: "설치 패키지 Session reactive boundary를 `MachineJournal.commit()`으로 남기고 새 Session이 `recover()`로 제품 상태를 복구",
  }),
  Object.freeze({
    gate: "product consumer - product policy",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze(["`MachineJail`"]),
    contract: "제품 permission manifest(`net=false`, `clipboard=false`, `home=true`, `workers=false`)와 Python choke point 집행",
  }),
  Object.freeze({
    gate: "product consumer - portable machine",
    specifiers: Object.freeze(["`pyproc`"]),
    publicSurface: Object.freeze([
      "`bootSession`",
      "`openMachine`",
      "`createMachineKeyPair`",
      "`exportMachinePublicKey`",
      "`fingerprintMachinePublicKey`",
      "Session `exportImage`",
      "Runtime `enableInit`",
    ]),
    contract: "signed `.pymachine` + `/home/web` export, signer fingerprint, untrusted/wrong key 거부, trusted open, `resume.py` SQLite resource 재개설, S4 timing source",
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
