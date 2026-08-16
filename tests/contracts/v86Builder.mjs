import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyV86AssetBuild } from "../../scripts/v86Builder/verifyV86Assets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function rejects(action, pattern) {
  let message = "";
  try { await action(); }
  catch (error) { message = String(error?.message || error); }
  assert(pattern.test(message), `expected ${pattern}, got ${message || "success"}`);
}

async function fixture(directory, bytes) {
  const names = [
    "inputs/lock.json", "legal/a", "legal/b", "source-a.tar", "source-b.tar",
    "v86-assets.cyclonedx.json", "libv86.mjs", "v86.wasm", "seabios.bin", "vgabios.bin",
  ];
  const artifacts = [];
  for (const name of names) {
    const path = resolve(directory, ...name.split("/"));
    await mkdir(dirname(path), { recursive: true });
    const content = name === "v86.wasm" ? bytes : Buffer.from(name);
    await writeFile(path, content);
    artifacts.push({ name, byteLength: content.byteLength, sha256: sha256(content) });
  }
  artifacts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const manifest = { schemaVersion: 1, recipe: "fixture", artifacts };
  await writeFile(resolve(directory, "build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function assertV86Builder() {
  const lock = JSON.parse(await readFile(resolve(root, "scripts/v86Builder/v86BuildLock.json"), "utf8"));
  assert(lock.v86.revision === "2f1346b0e7d88d4cbbbcc05fe15b4e369c3de23f"
    && lock.v86.tree === "d84c58b48267b2c0f1933744e26fd0f29cd0035b", "V86 source identity drifted");
  assert(lock.seabios.revision === "ea1b7a0733906b8425d948ae94fba63c32b1d425"
    && lock.seabios.tree === "22c6a019e54b333a381eecd6e1a3d4739de0f99b", "SeaBIOS source identity drifted");
  assert(lock.v86.inputs["Cargo.toml"] === "727880ec3730700c5f07b92f80e96d6c7649efe6e7461b42763f196aa6eb9e2f"
    && lock.v86.inputs.Makefile === "5686395e21fad85cb7cd57faf9b55e8fc6e7bbf66b02dcf99af9629e30cea4c4",
  "V86 exact Git blob input identity drifted");
  assert(lock.toolchain.rust.version === "1.96.1" && lock.toolchain.node === "24.17.0",
    "V86 build toolchain is not exact");
  assert(/^\d{8}T\d{6}Z$/u.test(lock.toolchain.ubuntuSnapshot)
    && lock.toolchain.ubuntuPackages.gcc === "4:13.2.0-7ubuntu1"
    && lock.toolchain.ubuntuPackages["gcc-13"] === "13.3.0-6ubuntu2~24.04.1"
    && lock.toolchain.ubuntuPackages["acpica-tools"] === "20230628-1"
    && lock.toolchain.gcc.includes("13.3.0") && lock.toolchain.iasl.includes("20230628"),
  "V86 Ubuntu package snapshot is not exact");
  assert(Object.values(lock.expectedOutputs).every((entry) => /^[0-9a-f]{64}$/u.test(entry.sha256)
    && Number.isSafeInteger(entry.byteLength)), "V86 expected output descriptors are incomplete");
  assert(lock.expectedOutputs["seabios.bin"].sha256
    === "f0302e4917c59f856d02d24e378a32438f35a111036498dcc2b342f54a94e1d6",
  "V86 reproducible SeaBIOS output is not locked");

  const temporary = await mkdtemp(resolve(tmpdir(), "pyproc-v86-builder-"));
  const left = resolve(temporary, "a");
  const right = resolve(temporary, "b");
  try {
    await mkdir(left);
    await mkdir(right);
    await fixture(left, Buffer.from([0, 1, 2]));
    await fixture(right, Buffer.from([0, 1, 2]));
    await writeFile(resolve(right, "v86.wasm"), Buffer.from([0, 1, 3]));
    await rejects(() => verifyV86AssetBuild({ leftDir: left, rightDir: right }), /integrity mismatch/u);
    await rm(right, { recursive: true, force: true });
    await mkdir(right);
    await fixture(right, Buffer.from([0, 1, 2]));
    const receipt = await verifyV86AssetBuild({ leftDir: left, rightDir: right });
    assert(receipt.byteIdentical && receipt.artifacts.length === 10,
      "V86 byte-identical fixture did not produce a complete receipt");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
