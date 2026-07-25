// prepareWebComputerAssets.mjs - 제품 실행 자산을 catalog hash로 검증해 로컬에 준비한다.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = join(root, "apps", "webComputer", "assetCatalog.json");
const targetDirectory = join(root, "apps", "webComputer", "assets");
const reusableDirectory = join(root, "tests", "webMachine", "fixtures", "v86", "assets");
const mutableSourceHosts = new Set(["i.copy.sh"]);

function normalizeSources(asset) {
  const list = [];
  const seen = new Set();
  const candidates = [...(Array.isArray(asset.sources) ? asset.sources : []), asset.url];
  for (const source of candidates) {
    if (typeof source !== "string" || !source.trim()) continue;
    if (!source.startsWith("https://")) continue;
    if (seen.has(source)) continue;
    seen.add(source);
    list.push(source);
  }
  if (!list.length) throw new Error(`${asset.name}: HTTPS source가 없음`);
  return list;
}

function isMutableSingleSource(asset) {
  const sources = normalizeSources(asset);
  if (sources.length !== 1) return false;
  return mutableSourceHosts.has(new URL(sources[0]).hostname);
}

async function downloadFromSources(asset, target, bytesExpected) {
  const sources = normalizeSources(asset);
  const attempts = [];
  const temporary = `${target}.part`;
  for (const source of sources) {
    attempts.push(source);
    let response;
    try {
      response = await fetch(source, { redirect: "follow" });
    } catch (error) {
      console.warn(`${asset.name}: 후보 source fetch 실패 (${source})`);
      continue;
    }
    if (!response.ok) continue;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength !== bytesExpected) {
      console.warn(`${asset.name}: candidate source byteLength 불일치 (${source})`);
      continue;
    }
    const actual = digest(bytes);
    if (actual !== asset.sha256) {
      console.warn(`${asset.name}: candidate source SHA-256 불일치 (${source})`);
      continue;
    }
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, target);
      return;
    } finally {
      await rm(temporary, { force: true });
    }
  }
  if (isMutableSingleSource(asset)) {
    console.warn(`주의: ${asset.name}는 단일 mutable 출처(i.copy.sh)이다. sources를 2개 이상 추가해 fail-over를 확보할 것`);
  }
  throw new Error(`${asset.name}: download 실패 [${attempts.join(", ")}]`);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function validFile(path, asset) {
  try {
    const info = await stat(path);
    if (info.size !== asset.byteLength) return false;
    return digest(await readFile(path)) === asset.sha256;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function download(asset, target) {
  await downloadFromSources(asset, target, asset.byteLength);
}

const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
if (catalog.schemaVersion !== 1 || catalog.channel !== "development" || catalog.redistribution !== "disabled") {
  throw new Error("Web Computer asset policy is invalid");
}
await mkdir(targetDirectory, { recursive: true });

for (const asset of catalog.assets) {
  const target = join(targetDirectory, asset.name);
  if (await validFile(target, asset)) {
    console.log(`verified ${asset.name}`);
    continue;
  }
  await rm(target, { force: true });
  const reusable = join(reusableDirectory, asset.name);
  if (await validFile(reusable, asset)) {
    await copyFile(reusable, target);
    console.log(`reused ${asset.name}`);
    continue;
  }
  await download(asset, target);
  console.log(`downloaded ${asset.name}`);
}

console.log(`Web Computer development assets ready: ${catalog.assets.length}`);
