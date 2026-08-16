import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ROOT } from "../packageHarness.mjs";
import { assembleV86Release } from "../../scripts/release/assembleV86Release.mjs";

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

async function makeFixture(directory, lock, targetCommit) {
  const names = [
    "libv86.mjs", "v86.wasm", "seabios.bin", "vgabios.bin",
    `v86-${lock.v86.version}-source.tar`, `seabios-${lock.seabios.version}-source.tar`,
    "v86-assets.cyclonedx.json",
    "legal/COPYING.LESSER.seabios", "legal/COPYING.seabios",
    "legal/LICENSE.softfloat-source.c", "legal/LICENSE.v86", "legal/LICENSE.v86-mit",
    "legal/LICENSE.zstd-source.c", "inputs/fetch-and-build-seabios.sh",
    "inputs/seabios.config", "inputs/v86BuildLock.json",
  ];
  const artifacts = [];
  for (const name of names) {
    const path = resolve(directory, ...name.split("/"));
    await mkdir(resolve(path, ".."), { recursive: true });
    let bytes = Buffer.from(name);
    if (name === "v86-assets.cyclonedx.json") bytes = Buffer.from(`${JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      components: [
        ["v86", "BSD-2-Clause"], ["v86 QEMU floppy portions", "MIT"],
        ["Berkeley SoftFloat", "BSD-3-Clause"],
        ["Zstandard single-file decompressor", "BSD-3-Clause"], ["SeaBIOS", "LGPL-3.0-only"],
      ].map(([componentName, license]) => ({
        type: "library", name: componentName, licenses: [{ license: { id: license } }],
      })),
    }, null, 2)}\n`);
    await writeFile(path, bytes);
    artifacts.push({ name, byteLength: bytes.byteLength, sha256: sha256(bytes) });
  }
  artifacts.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
  const manifest = {
    schemaVersion: 1,
    recipe: lock.recipe,
    sources: {
      v86: { version: lock.v86.version, revision: lock.v86.revision, tree: lock.v86.tree },
      seabios: { version: lock.seabios.version, revision: lock.seabios.revision, tree: lock.seabios.tree },
    },
    toolchain: { ubuntuSnapshot: lock.toolchain.ubuntuSnapshot },
    expectedMatches: Object.fromEntries(["libv86.mjs", "v86.wasm", "seabios.bin", "vgabios.bin"]
      .map((name) => [name, true])),
    artifacts,
  };
  const receipt = {
    schemaVersion: 1, recipe: lock.recipe, independentBuilds: ["a", "b"], byteIdentical: true,
    runId: "123", headSha: targetCommit, artifacts,
  };
  await writeFile(resolve(directory, "build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(resolve(directory, "reproducibility-manifest.json"), `${JSON.stringify(receipt, null, 2)}\n`);
}

export async function assertV86ReleaseAssembler() {
  const lock = JSON.parse(await readFile(resolve(ROOT, "scripts/v86Builder/v86BuildLock.json"), "utf8"));
  const cache = resolve(ROOT, ".cache");
  await mkdir(cache, { recursive: true });
  const workspace = await mkdtemp(join(cache, "v86ReleaseContract-"));
  const verified = resolve(workspace, "verified");
  const targetCommit = "c".repeat(40);
  try {
    await mkdir(verified);
    await makeFixture(verified, lock, targetCommit);
    const firstDir = resolve(workspace, "first");
    const secondDir = resolve(workspace, "second");
    const first = await assembleV86Release({ verifiedDir: verified,
      releaseTag: "pyproc-v86-assets-v1", targetCommit, outputDir: firstDir });
    const second = await assembleV86Release({ verifiedDir: verified,
      releaseTag: "pyproc-v86-assets-v1", targetCommit, outputDir: secondDir });
    assert(first.assets.length === 11 && first.legalEntries === 6 && first.inputEntries === 3,
      "V86 release asset inventory is incomplete");
    for (const name of ["v86-assets-legal.zip", "v86-assets-inputs.zip", "releaseAssets.json"]) {
      assert((await readFile(resolve(firstDir, name))).equals(await readFile(resolve(secondDir, name))),
        `V86 release assembly is not deterministic: ${name}`);
    }
    await writeFile(resolve(verified, "v86.wasm"), Buffer.from("mutated"));
    await rejects(() => assembleV86Release({ verifiedDir: verified,
      releaseTag: "pyproc-v86-assets-v1", targetCommit, outputDir: resolve(workspace, "mutated") }),
    /integrity mismatch/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}
