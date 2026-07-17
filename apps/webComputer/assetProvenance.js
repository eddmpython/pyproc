// 생성물이다. npm run assets:provenance -- --write가 쓰고 --check가 바이트로 대조한다.
// 손으로 고치지 마라. SSOT는 scripts/assetCatalog.json이다.
//
// 서명된 봉투가 이 값을 나른다. 판정(channel)은 없다: 수신자가 재계산할 수 없는 판정은
// 선언이고, imageTrust가 서명 검증 전에 manifest를 읽으므로 공격자 제어 문자열이 된다.
export const WEB_COMPUTER_ASSET_PROVENANCE = Object.freeze({
  policyVersion: 1,
  catalogId: "web-computer-development-assets-v1",
  sourceCatalogId: "web-machine-v86-fixtures-v1",
  sbomDigest: "sha256:96a701218797de71a1c2619eb29668b774a3c2c29e9cc913e8c78e60a8709de2",
});

// 어떤 asset catalog도 기술하지 않는 게스트가 쓴다. 침묵하면 증거 없음이 문제 없음으로
// 읽히므로 부재를 명시로 적는다. pyproc 게스트의 실행 자산(pyodide 배포판의 9.6MB
// pyodide.asm.wasm 등)이 지금 그 상태다: pyodide-lock.json은 선택적 wheel 카탈로그이지
// 부팅 적재 집합이 아니라서 그 합성 바이너리를 0% 덮는다.
export const UNDESCRIBED_ASSET_PROVENANCE = Object.freeze({
  policyVersion: 1,
  catalogId: null,
  sbomDigest: null,
  assetsDescribed: false,
});
