// prepareAssets.mjs - v86 guest probe 자산을 해시 검증해 로컬 실험 캐시에 준비한다.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertAssetProvenanceArtifacts, readV86AssetCatalog } from "../../../../scripts/assetProvenance.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "assets");
const consumerOptionIndex = process.argv.indexOf("--consumer");
const consumer = consumerOptionIndex === -1 ? "v86Probe" : process.argv[consumerOptionIndex + 1];
if (!consumer || process.argv.filter((value) => value === "--consumer").length !== (consumerOptionIndex === -1 ? 0 : 1)) {
  throw new TypeError("--consumer는 값 하나만 받아야 한다");
}
await assertAssetProvenanceArtifacts();
const { assets } = await readV86AssetCatalog();
const selectedAssets = assets.filter((asset) => asset.consumers.includes(consumer));
if (!selectedAssets.length) throw new TypeError(`등록되지 않은 asset consumer: ${consumer}`);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeSources(asset) {
  const list = [];
  const seen = new Set();
  const candidates = [...(Array.isArray(asset.sources) ? asset.sources : []), asset.url];
  for (const source of candidates) {
    if (typeof source !== "string" || !source.trim()) continue;
    let parsed;
    try { parsed = new URL(source); } catch (error) { continue; }
    if (parsed.protocol !== "https:") continue;
    if (seen.has(source)) continue;
    seen.add(source);
    list.push(source);
  }
  if (!list.length) throw new Error(`${asset.name}: HTTPS source가 없음`);
  return list;
}

async function download(asset, path) {
  const sources = normalizeSources(asset);
  const temporary = `${path}.tmp`;
  let attempted = false;
  for (const source of sources) {
    attempted = true;
    let response;
    try {
      response = await fetch(source, { redirect: "follow" });
    } catch (error) {
      console.warn(`${asset.name}: 후보 source fetch 실패 (${source})`);
      continue;
    }
    if (!response.ok) continue;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength !== asset.byteLength) {
      console.warn(`${asset.name}: 후보 source byteLength 불일치 (${source})`);
      continue;
    }
    const actual = digest(bytes);
    if (actual !== asset.sha256) {
      console.warn(`${asset.name}: 후보 source SHA-256 불일치 (${source})`);
      continue;
    }
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, path);
      return;
    } finally {
      await rm(temporary, { force: true });
    }
  }
  if (sources.length === 1 && /^https?:\/\//.test(sources[0])) {
    try {
      const host = new URL(sources[0]).hostname;
      if (host === "i.copy.sh") {
        console.warn(`주의: ${asset.name}는 단일 mutable 출처(i.copy.sh)이다. sources를 2개 이상 추가해 fail-over를 확보할 것`);
      }
    } catch (error) {}
  }
  if (!attempted) throw new Error(`${asset.name}: source URL 없음`);
  throw new Error(`${asset.name}: download 실패 [${sources.join(", ")}]`);
}

await mkdir(root, { recursive: true });
for (const asset of selectedAssets) {
  const path = join(root, asset.name);
  let current = null;
  try { current = await readFile(path); } catch (error) {}
  if (current && digest(current) === asset.sha256) {
    if (current.byteLength !== asset.byteLength) throw new Error(`${asset.name}: byteLength ${current.byteLength}`);
    console.log(`READY ${asset.name} ${current.byteLength} bytes`);
    continue;
  }
  await download(asset, path);
  console.log(`FETCH ${asset.name} ${asset.byteLength} bytes`);
}
console.log(`CONSUMER ${consumer} ${selectedAssets.length} assets`);
