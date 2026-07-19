// assetProvenance.mjs - 실행 자산 catalog 검증과 SPDX 2.3 SBOM의 단일 생성 경계.
//
// 왜 scripts/인가: 이 도구는 제품(apps/webComputer)의 compliance 산출물을 만든다. 예전엔
// tests/webMachine/fixtures/v86/에 살았는데, 그러면 제품이 test 경로에 의존하게 된다
// (구조 게이트가 그 사실을 잡았다). prepareWebComputerAssets.mjs와 같은 층이 제자리다.
//
// 이 생성기는 결정적이어야 한다: --check가 재생성물과 커밋된 산출물을 바이트로
// 비교하고, sbomDigest가 봉투에 실린다. 그래서 시각·난수·환경 같은 비결정 입력을 쓰지 않고,
// 시간이 필요한 자리는 catalog가 값을 준다(하드코딩 금지 원칙: 값은 계약에서 온다).
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const catalogPath = resolve(root, "assetCatalog.json");
const sbomPath = resolve(root, "assetSbom.json");
// 제품 catalog는 이 SSOT의 파생물이라 여기서 함께 쓰고 검사한다.
const webComputerCatalogPath = resolve(root, "..", "apps", "webComputer", "assetCatalog.json");
const webComputerProvenancePath = resolve(root, "..", "apps", "webComputer", "assetProvenance.js");
const sha1Pattern = /^[0-9a-f]{40}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
// 배포 판정 두 값. 둘 다 "우리는 바이트를 재배포하지 않는다"이고 사용처가 다르다:
// local-test-only는 로컬 시험에서만 내려받아 쓰는 fixture, upstream-cdn-runtime-reference는
// 라이브러리가 런타임에 상류 자신의 배포 지점(CDN)을 참조하는 자산이다. 참조는 재배포가
// 아니다(정책 문서 결정 3의 정밀화, policyVersion 2).
const allowedDistributions = new Set(["local-test-only", "upstream-cdn-runtime-reference"]);
// 이 자산들을 적재하는 곳. pyproc은 라이브러리 런타임 자신(엔진 부팅 집합),
// v86Probe는 수동 probe 6개, webComputer는 제품(두 guest OS의 실행 자산 전부).
const knownConsumers = new Set(["pyproc", "v86Probe", "webComputer"]);
// 출처: SPDX License List 3.28.0(이 문서가 쓰는 라이선스 식별자의 발행 버전).
const SPDX_LICENSE_LIST_VERSION = "3.28.0";

// catalog 내용의 내용 주소. documentNamespace의 유일성 축이라 catalog가 바뀌면 같이 바뀐다.
function catalogDigest(catalog) {
  return createHash("sha256").update(JSON.stringify(catalog)).digest("hex").slice(0, 16);
}

function assertString(value, label) {
  if (typeof value !== "string" || !value) throw new TypeError(`${label}: 문자열 필요`);
  return value;
}

function unique(values, label) {
  if (new Set(values).size !== values.length) throw new TypeError(`${label}: 중복 금지`);
}

function spdxId(prefix, value) {
  return `SPDXRef-${prefix}-${value.replace(/[^A-Za-z0-9.-]+/g, "-")}`;
}

export function validateV86AssetCatalog(value) {
  if (!value || value.schemaVersion !== 1) throw new TypeError("asset catalog schemaVersion 불일치");
  // createdAt: SPDX creationInfo.created의 값. 생성기가 시각을 읽으면 재생성이 비결정이 되고
  // --check의 바이트 비교가 매 실행 깨진다. 그래서 시각도 catalog가 주는 계약값이다.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value.createdAt || "")) {
    throw new TypeError("asset catalog createdAt: ISO8601 Z 형식 필요");
  }
  if (value.packagePolicy?.thirdPartyBinaryBundling !== "forbidden") {
    throw new TypeError("third-party binary package bundling은 forbidden이어야 한다");
  }
  // webComputer: 파생 제품 catalog의 정책 블록. 자산 기술은 아래 assets가 정본이고
  // 여기는 제품 고유의 채널 정책만 담는다.
  const product = value.webComputer;
  if (!product || product.channel !== "development" || product.redistribution !== "disabled") {
    throw new TypeError("webComputer: development/disabled 정책 필요");
  }
  assertString(product.catalogId, "webComputer.catalogId");
  // policyVersion: 봉투가 나르는 값. docs/operations/assetProvenance.md의 버전과 같아야 한다.
  if (!Number.isSafeInteger(product.policyVersion) || product.policyVersion < 1) throw new TypeError("webComputer.policyVersion: 양의 정수 필요");
  if (!Array.isArray(product.promotionRequires) || !product.promotionRequires.length) {
    throw new TypeError("webComputer.promotionRequires 필요");
  }
  if (!Array.isArray(value.components) || !value.components.length) throw new TypeError("components가 필요하다");
  if (!Array.isArray(value.assets) || !value.assets.length) throw new TypeError("assets가 필요하다");
  const componentIds = value.components.map((component, index) => {
    const label = `components[${index}]`;
    const componentId = assertString(component.componentId, `${label}.componentId`);
    // licenseConcluded는 명시 필드다. 예전엔 생성기가 licenseDeclared를 결론으로 복사했는데,
    // 그건 "상류가 뭐라 했나"와 "우리가 뭐라 결론냈나"를 같은 것으로 만든다. 정책 본문이
    // 정확히 그 패턴을 금지한다: component/revision/build config를 모르면 판정은 NOASSERTION.
    for (const field of ["name", "version", "downloadLocation", "sourceLocation", "sourceRevision", "licenseDeclared", "licenseConcluded", "copyrightText", "provenanceStatus"]) {
      assertString(component[field], `${label}.${field}`);
    }
    if (!Array.isArray(component.evidence) || !component.evidence.length || component.evidence.some((url) => !String(url).startsWith("https://"))) {
      throw new TypeError(`${label}.evidence: HTTPS URL 필요`);
    }
    return componentId;
  });
  unique(componentIds, "componentId");
  const componentSet = new Set(componentIds);
  const assetNames = value.assets.map((asset, index) => {
    const label = `assets[${index}]`;
    const name = assertString(asset.name, `${label}.name`);
    if (!String(asset.url).startsWith("https://")) throw new TypeError(`${label}.url: HTTPS 필요`);
    if (!sha1Pattern.test(asset.sha1)) throw new TypeError(`${label}.sha1 형식 불일치`);
    if (!sha256Pattern.test(asset.sha256)) throw new TypeError(`${label}.sha256 형식 불일치`);
    if (!Number.isSafeInteger(asset.byteLength) || asset.byteLength <= 0) throw new TypeError(`${label}.byteLength 불일치`);
    if (!componentSet.has(asset.componentId)) throw new TypeError(`${label}.componentId 없음: ${asset.componentId}`);
    if (!allowedDistributions.has(asset.distribution)) throw new TypeError(`${label}.distribution 미지원: ${asset.distribution}`);
    // localPath: 바이트가 로컬에 존재할 때의 저장소 상대 위치(SBOM fileName의 출처).
    if (!String(asset.localPath).startsWith("./")) throw new TypeError(`${label}.localPath: "./" 상대 경로 필요`);
    assertString(asset.role, `${label}.role`);
    assertString(asset.licenseConcluded, `${label}.licenseConcluded`);
    if (!Array.isArray(asset.bundleBlockers) || !asset.bundleBlockers.length) throw new TypeError(`${label}.bundleBlockers 필요`);
    // consumers: 이 자산을 실제로 적재하는 곳. 파생 catalog의 선택 기준이라 명시 필드다.
    if (!Array.isArray(asset.consumers) || !asset.consumers.length || asset.consumers.some((c) => !knownConsumers.has(c))) {
      throw new TypeError(`${label}.consumers: ${[...knownConsumers].join("|")} 중 하나 이상 필요`);
    }
    return name;
  });
  unique(assetNames, "asset name");
  assertConcludedLicenseNotStrongerThanFiles(value);
  return value;
}

// 증거 없음이 통과로 새지 않게 하는 불변식.
//
// Package(component)의 결론은 자기가 덮는 File(asset) 중 가장 약한 것보다 강할 수 없다.
// SPDX 의미론이자 정책 본문("component/revision/build config를 모르면 판정은 NOASSERTION")의
// 기계 표현이다. 이게 없던 동안 저장소는 File 층위에서 강제하는 것을 Package 층위에서
// 스스로 위반했다: KolibriOS Package가 licenseConcluded=GPL-2.0-only인데 같은 자산의 File은
// NOASSERTION이었다(생성기가 licenseDeclared를 결론으로 복사한 결과).
//
// 약함의 순서는 하나뿐이다: NOASSERTION은 어떤 결론보다 약하다. 그래서 비교가 아니라
// 전파로 표현한다(NOASSERTION인 File이 하나라도 있으면 Package도 NOASSERTION).
function assertConcludedLicenseNotStrongerThanFiles(catalog) {
  const filesOf = new Map();
  for (const asset of catalog.assets) {
    if (!filesOf.has(asset.componentId)) filesOf.set(asset.componentId, []);
    filesOf.get(asset.componentId).push(asset);
  }
  for (const component of catalog.components) {
    const files = filesOf.get(component.componentId) || [];
    if (!files.length) throw new TypeError(`components.${component.componentId}: 덮는 asset이 없다(기술만 하고 쓰지 않는 component 금지)`);
    const unresolved = files.filter((asset) => asset.licenseConcluded === "NOASSERTION");
    if (unresolved.length && component.licenseConcluded !== "NOASSERTION") {
      throw new TypeError(
        `components.${component.componentId}.licenseConcluded=${component.licenseConcluded}: `
        + `결론이 없는 file(${unresolved.map((a) => a.name).join(", ")})을 덮으므로 NOASSERTION이어야 한다`,
      );
    }
  }
}

export async function readV86AssetCatalog() {
  return validateV86AssetCatalog(JSON.parse(await readFile(catalogPath, "utf8")));
}

// 제품 catalog는 이 SSOT의 파생물이다(SBOM과 같은 규율: 파생 + 커밋 + 바이트 비교).
//
// 왜 파생인가: 예전엔 같은 자산 5개가 두 파일에 두 어휘로 손수 중복 기술돼 있었고, 그래서
// 제품 쪽 봉인이 장식이었다. 제품 catalog에서 Linux image의 license를 거짓 MIT로 바꿔도
// 게이트가 통과했다. 어느 쪽도 상대를 몰랐기 때문이다.
//
// 어휘는 SSOT의 것으로 통일한다. 제품 쪽 asset.provenanceStatus는 SSOT의 bundleBlockers를
// 라벨 하나로 압축한 뒤 표류한 것이었다(v86.wasm의 composite-binary-inventory-incomplete는
// blocker composite-binary-license-inventory-not-verified와 같은 사실이고, firmware의
// upstream-recipe-not-reproduced는 upstream-source-recipe-not-reproduced와 같은 뜻이다).
// 압축을 버리고 목록을 그대로 나른다. provenanceStatus는 출처에 대한 판정이라 component 층위다.
export function createWebComputerCatalog(catalogValue) {
  const catalog = validateV86AssetCatalog(catalogValue);
  const componentOf = new Map(catalog.components.map((component) => [component.componentId, component]));
  const assets = catalog.assets
    .filter((asset) => asset.consumers.includes("webComputer"))
    .map((asset) => ({
      name: asset.name,
      role: asset.role,
      url: asset.url,
      sha1: asset.sha1,
      sha256: asset.sha256,
      byteLength: asset.byteLength,
      licenseConcluded: asset.licenseConcluded,
      distribution: asset.distribution,
      provenanceStatus: componentOf.get(asset.componentId).provenanceStatus,
      bundleBlockers: asset.bundleBlockers,
    }));
  return {
    schemaVersion: 1,
    catalogId: catalog.webComputer.catalogId,
    createdAt: catalog.createdAt,
    channel: catalog.webComputer.channel,
    redistribution: catalog.webComputer.redistribution,
    promotionRequires: catalog.webComputer.promotionRequires,
    sourceCatalogId: catalog.catalogId,
    assets,
  };
}

export function createV86FixtureSbom(catalogValue) {
  const catalog = validateV86AssetCatalog(catalogValue);
  const packages = catalog.components.map((component) => ({
    SPDXID: spdxId("Package", component.componentId),
    name: component.name,
    versionInfo: component.version,
    downloadLocation: component.downloadLocation,
    filesAnalyzed: false,
    // 결론은 catalog가 정한다. 여기서 licenseDeclared를 복사하면 상류의 주장이 우리의
    // 결론으로 둔갑한다(그 복사가 KolibriOS Package에 GPL-2.0-only를 박아놓고 있었다).
    licenseConcluded: component.licenseConcluded,
    licenseDeclared: component.licenseDeclared,
    copyrightText: component.copyrightText,
    sourceInfo: `source=${component.sourceLocation} revision=${component.sourceRevision} provenance=${component.provenanceStatus}`,
    packageComment: `evidence=${component.evidence.join(",")}`,
  }));
  const files = catalog.assets.map((asset) => ({
    SPDXID: spdxId("File", asset.name),
    fileName: asset.localPath,
    // SPDX 2.3 §8.4: 파일 checksum은 SHA1이 1..1(필수), 나머지 알고리즘이 0..*.
    // 외부 검증기가 이 문서를 읽을 수 있어야 SBOM 요구가 의미를 갖는다.
    checksums: [
      { algorithm: "SHA1", checksumValue: asset.sha1 },
      { algorithm: "SHA256", checksumValue: asset.sha256 },
    ],
    licenseConcluded: asset.licenseConcluded,
    licenseInfoInFiles: [asset.licenseConcluded],
    copyrightText: "NOASSERTION",
    comment: `distribution=${asset.distribution}; role=${asset.role}; bundleBlockers=${asset.bundleBlockers.join(",")}`,
  }));
  const described = [...packages, ...files].map((entry) => ({
    spdxElementId: "SPDXRef-DOCUMENT",
    relationshipType: "DESCRIBES",
    relatedSpdxElement: entry.SPDXID,
  }));
  const generatedFrom = catalog.assets.map((asset) => ({
    spdxElementId: spdxId("File", asset.name),
    relationshipType: "GENERATED_FROM",
    relatedSpdxElement: spdxId("Package", asset.componentId),
  }));
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: catalog.catalogId,
    // SPDX는 문서 인스턴스마다 유일한 네임스페이스를 요구하는데, 우리는 sbomDigest를 봉투에
    // 실어야 하므로 재생성이 결정적이어야 한다(--check가 바이트 비교를 한다). catalog 내용의
    // digest를 넣으면 둘을 동시에 만족한다: 내용이 다르면 유일하고, 내용이 같으면 결정적이다.
    // UUID는 유일성만 주고 결정성을 깨므로 쓸 수 없다.
    documentNamespace: `https://github.com/eddmpython/pyproc/sbom/${catalog.catalogId}/${catalogDigest(catalog)}`,
    creationInfo: {
      created: catalog.createdAt,
      creators: ["Organization: pyproc contributors"],
      licenseListVersion: SPDX_LICENSE_LIST_VERSION,
    },
    documentComment: "이 문서는 pyproc이 실행 시 적재하는 미번들 자산 전부를 기술한다(엔진 부팅 집합 + Web Machine fixture). package 배포 목록이 아니다.",
    packages,
    files,
    relationships: [...described, ...generatedFrom],
  };
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

// 봉투가 나르는 출처. 제품이 브라우저에서 import하므로 JSON이 아니라 모듈로 낸다.
//
// channel은 싣지 않는다. 수신자는 catalog도 자산도 없어서 재계산할 수 없고, 재계산 불가능한
// 판정은 계산이 아니라 선언이다. 게다가 imageTrust가 서명 검증 "전에" manifest를 파싱해
// 신뢰 화면에 쓰므로, 봉투의 channel을 띄우면 공격자 제어 문자열을 제품 판정으로 표시하게
// 된다. 정책 본문이 같은 말을 한다: trusted signature는 출처 identity를 증명할 뿐
// license compliance를 대신하지 않는다.
//
// 그래서 봉투는 판정이 아니라 "어떤 catalog와 SBOM으로 만들어졌는가"만 나른다.
export function createWebComputerProvenanceModule(catalogValue) {
  const catalog = validateV86AssetCatalog(catalogValue);
  const sbomDigest = createHash("sha256").update(serialize(createV86FixtureSbom(catalog))).digest("hex");
  return [
    "// 생성물이다. npm run assets:provenance -- --write가 쓰고 --check가 바이트로 대조한다.",
    "// 손으로 고치지 마라. SSOT는 scripts/assetCatalog.json이다.",
    "//",
    "// 서명된 봉투가 이 값을 나른다. 판정(channel)은 없다: 수신자가 재계산할 수 없는 판정은",
    "// 선언이고, imageTrust가 서명 검증 전에 manifest를 읽으므로 공격자 제어 문자열이 된다.",
    "export const WEB_COMPUTER_ASSET_PROVENANCE = Object.freeze({",
    `  policyVersion: ${catalog.webComputer.policyVersion},`,
    `  catalogId: ${JSON.stringify(catalog.webComputer.catalogId)},`,
    `  sourceCatalogId: ${JSON.stringify(catalog.catalogId)},`,
    `  sbomDigest: ${JSON.stringify(`sha256:${sbomDigest}`)},`,
    "});",
    "",
  ].join("\n");
}

// 파생물 전부. 하나라도 손으로 고치면 --check가 잡는다.
async function derivedArtifacts() {
  const catalog = await readV86AssetCatalog();
  return [
    { path: sbomPath, label: "scripts/assetSbom.json", text: serialize(createV86FixtureSbom(catalog)) },
    { path: webComputerCatalogPath, label: "apps/webComputer/assetCatalog.json", text: serialize(createWebComputerCatalog(catalog)) },
    { path: webComputerProvenancePath, label: "apps/webComputer/assetProvenance.js", text: createWebComputerProvenanceModule(catalog) },
  ];
}

export async function assertAssetProvenanceArtifacts() {
  for (const artifact of await derivedArtifacts()) {
    const actual = await readFile(artifact.path, "utf8");
    if (actual !== artifact.text) throw new Error(`${artifact.label}이 assetCatalog.json과 불일치한다(파생물을 손으로 고쳤거나 SSOT가 바뀌었다)`);
  }
  return true;
}

async function runCommand() {
  const mode = process.argv[2] || "--check";
  if (mode === "--write") {
    for (const artifact of await derivedArtifacts()) {
      await writeFile(artifact.path, artifact.text);
      console.log(`WRITE ${artifact.label}`);
    }
    return;
  }
  if (mode === "--check") {
    await assertAssetProvenanceArtifacts();
    console.log("PASS 실행 자산 provenance: SBOM과 제품 산출물이 SSOT의 파생물");
    return;
  }
  throw new TypeError(`지원하지 않는 mode: ${mode}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCommand();
