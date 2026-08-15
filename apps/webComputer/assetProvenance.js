// 생성물이다. npm run assets:provenance -- --write가 쓰고 --check가 바이트로 대조한다.
// 손으로 고치지 마라. SSOT는 scripts/assetCatalog.json이다.
//
// 서명된 봉투가 이 값을 나른다. 판정(channel)은 없다: 수신자가 재계산할 수 없는 판정은
// 선언이고, imageTrust가 서명 검증 전에 manifest를 읽으므로 공격자 제어 문자열이 된다.
export const WEB_COMPUTER_ASSET_PROVENANCE = Object.freeze({
  policyVersion: 3,
  catalogId: "web-computer-development-assets-v1",
  sourceCatalogId: "web-machine-execution-assets-v1",
  sbomDigest: "sha256:a6f1fc94c08b75b6c709270445e6f3145636fd8216f840bf51adede8a91ac98f",
});
