// prepareAssets.mjs - v86 guest probe 자산을 해시 검증해 로컬 실험 캐시에 준비한다.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertAssetProvenanceArtifacts, readV86AssetCatalog } from "../../../../scripts/assetProvenance.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "assets");
await assertAssetProvenanceArtifacts();
const { assets } = await readV86AssetCatalog();

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

await mkdir(root, { recursive: true });
for (const asset of assets) {
  const path = join(root, asset.name);
  let current = null;
  try { current = await readFile(path); } catch (error) {}
  if (current && digest(current) === asset.sha256) {
    if (current.byteLength !== asset.byteLength) throw new Error(`${asset.name}: byteLength ${current.byteLength}`);
    console.log(`READY ${asset.name} ${current.byteLength} bytes`);
    continue;
  }
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`${asset.name}: download ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = digest(bytes);
  if (actual !== asset.sha256) throw new Error(`${asset.name}: sha256 ${actual}`);
  if (bytes.byteLength !== asset.byteLength) throw new Error(`${asset.name}: byteLength ${bytes.byteLength}`);
  const temporary = `${path}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(`FETCH ${asset.name} ${bytes.byteLength} bytes`);
}
