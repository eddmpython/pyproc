// prepareWebComputerAssets.mjs - 제품 실행 자산을 catalog hash로 검증해 로컬에 준비한다.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = join(root, "apps", "webComputer", "assetCatalog.json");
const targetDirectory = join(root, "apps", "webComputer", "assets");
const reusableDirectory = join(root, "tests", "webMachine", "fixtures", "v86", "assets");

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
  const response = await fetch(asset.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${asset.name}: download ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength !== asset.byteLength) throw new Error(`${asset.name}: byteLength ${bytes.byteLength} != ${asset.byteLength}`);
  if (digest(bytes) !== asset.sha256) throw new Error(`${asset.name}: SHA-256 mismatch`);
  const temporary = `${target}.part`;
  await writeFile(temporary, bytes);
  await rename(temporary, target);
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
