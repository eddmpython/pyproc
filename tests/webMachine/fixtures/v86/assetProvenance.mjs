// assetProvenance.mjs - fixture catalog 검증과 SPDX 2.3 SBOM의 단일 생성 경계.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const catalogPath = resolve(root, "assetCatalog.json");
const sbomPath = resolve(root, "fixtureSbom.json");
const sha256Pattern = /^[0-9a-f]{64}$/;
const allowedDistributions = new Set(["local-test-only"]);

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
  if (value.packagePolicy?.thirdPartyBinaryBundling !== "forbidden") {
    throw new TypeError("third-party binary package bundling은 forbidden이어야 한다");
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
    if (!sha256Pattern.test(asset.sha256)) throw new TypeError(`${label}.sha256 형식 불일치`);
    if (!Number.isSafeInteger(asset.byteLength) || asset.byteLength <= 0) throw new TypeError(`${label}.byteLength 불일치`);
    if (!componentSet.has(asset.componentId)) throw new TypeError(`${label}.componentId 없음: ${asset.componentId}`);
    if (!allowedDistributions.has(asset.distribution)) throw new TypeError(`${label}.distribution 미지원: ${asset.distribution}`);
    assertString(asset.role, `${label}.role`);
    assertString(asset.licenseConcluded, `${label}.licenseConcluded`);
    if (!Array.isArray(asset.bundleBlockers) || !asset.bundleBlockers.length) throw new TypeError(`${label}.bundleBlockers 필요`);
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
    fileName: `./assets/${asset.name}`,
    checksums: [{ algorithm: "SHA256", checksumValue: asset.sha256 }],
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
    documentNamespace: `https://github.com/eddmpython/pyproc/sbom/${catalog.catalogId}`,
    creationInfo: {
      created: "2026-07-15T00:00:00Z",
      creators: ["Organization: pyproc contributors"],
      licenseListVersion: "3.28.0",
    },
    documentComment: "이 문서는 로컬 Web Machine probe가 내려받는 미번들 fixture를 기술한다. package 배포 목록이 아니다.",
    packages,
    files,
    relationships: [...described, ...generatedFrom],
  };
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function assertV86FixtureSbom() {
  const expected = serialize(createV86FixtureSbom(await readV86AssetCatalog()));
  const actual = await readFile(sbomPath, "utf8");
  if (actual !== expected) throw new Error("fixtureSbom.json이 assetCatalog.json과 불일치한다");
  return true;
}

async function runCommand() {
  const mode = process.argv[2] || "--check";
  if (mode === "--write") {
    await writeFile(sbomPath, serialize(createV86FixtureSbom(await readV86AssetCatalog())));
    console.log("WRITE fixtureSbom.json");
    return;
  }
  if (mode === "--check") {
    await assertV86FixtureSbom();
    console.log("PASS v86 fixture provenance/SBOM");
    return;
  }
  throw new TypeError(`지원하지 않는 mode: ${mode}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCommand();
