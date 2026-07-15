// prepareAssets.mjs - v86 guest probe 자산을 해시 검증해 로컬 실험 캐시에 준비한다.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "assets");
const assets = [
  {
    name: "libv86.mjs",
    url: "https://cdn.jsdelivr.net/npm/v86@0.5.424/build/libv86.mjs",
    sha256: "b58774370dcd62e534e05d2b6bb734f7057ef2166c3cc034e45847945d0910d1",
  },
  {
    name: "v86.wasm",
    url: "https://cdn.jsdelivr.net/npm/v86@0.5.424/build/v86.wasm",
    sha256: "aec2c16bb0a1618aa641bb44d9c0fe14681f8c1459fa08c32e3e0562020884e8",
  },
  {
    name: "seabios.bin",
    url: "https://raw.githubusercontent.com/copy/v86/2f1346b/bios/seabios.bin",
    sha256: "73e3f359102e3a9982c35fce98eb7cd08f18303ac7f1ba6ebfbe6cdc1c244d98",
  },
  {
    name: "vgabios.bin",
    url: "https://raw.githubusercontent.com/copy/v86/2f1346b/bios/vgabios.bin",
    sha256: "a4bc0d80cc3ca028c73dafa8fee396b8d054ce87ebd8abfbd31b06b437607880",
  },
  {
    name: "buildroot-bzimage68.bin",
    url: "https://i.copy.sh/buildroot-bzimage68.bin",
    sha256: "507a759c70ab7a490a233be454d0b5b88bc667956a410b531cb4edc091e2eb1c",
  },
  {
    name: "kolibri.img",
    url: "https://i.copy.sh/kolibri.img",
    sha256: "f3ec74d5b70e5b7a8b0d053a1ada738a75159366b50af8a427845f87e0a91be5",
  },
];

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

await mkdir(root, { recursive: true });
for (const asset of assets) {
  const path = join(root, asset.name);
  let current = null;
  try { current = await readFile(path); } catch (error) {}
  if (current && digest(current) === asset.sha256) {
    console.log(`READY ${asset.name} ${current.byteLength} bytes`);
    continue;
  }
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`${asset.name}: download ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = digest(bytes);
  if (actual !== asset.sha256) throw new Error(`${asset.name}: sha256 ${actual}`);
  const temporary = `${path}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(`FETCH ${asset.name} ${bytes.byteLength} bytes`);
}
