// 생성물이다. npm run assets:provenance -- --write가 쓰고 --check가 바이트로 대조한다.
// 손으로 고치지 마라. SSOT는 scripts/assetCatalog.json이다.
//
// 서명된 봉투가 이 값을 나른다. 판정(channel)은 없다: 수신자가 재계산할 수 없는 판정은
// 선언이고, imageTrust가 서명 검증 전에 manifest를 읽으므로 공격자 제어 문자열이 된다.
export const WEB_COMPUTER_ASSET_PROVENANCE = Object.freeze({
  policyVersion: 2,
  catalogId: "web-computer-development-assets-v1",
  sourceCatalogId: "web-machine-execution-assets-v1",
  sbomDigest: "sha256:33e1b2b142b7906c8971999d4117a17130d516b7a6295c5cf0d207caf7a7d204",
});
