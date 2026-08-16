import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { verifyCanonicalPackages } from "../../scripts/packageBuilder/verifyCanonicalPackage.mjs";

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
  const filename = "pyproc-1.2.3.tgz";
  await writeFile(resolve(directory, filename), bytes);
  const manifest = {
    schemaVersion: 1,
    recipe: "pyproc-canonical-npm-package-v1",
    source: { commit: "a".repeat(40), tree: "b".repeat(40) },
    toolchain: { node: "22.19.0", npm: "11.19.0", gitCoreAutocrlf: false },
    package: {
      name: "pyproc", version: "1.2.3", filename, byteLength: bytes.byteLength,
      sha256: sha256(bytes), fileCount: 1, files: [{ path: "index.js", size: 1, mode: 420 }],
    },
  };
  await writeFile(resolve(directory, "canonical-package-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function assertCanonicalNpmPackage() {
  const lock = JSON.parse(await readFile(resolve(root,
    "scripts/packageBuilder/canonicalPackageLock.json"), "utf8"));
  assert(lock.toolchain.node === "22.19.0" && lock.toolchain.npm === "11.19.0"
    && lock.toolchain.gitCoreAutocrlf === false, "canonical package toolchain drifted");
  assert(lock.knownReproduction.commit === "4fb4d4e31f310477e910b02ec003decbb77fa19c"
    && lock.knownReproduction.sha256 === "084b42764f53269e92c2c9e938d31c27ee62f8120e35d577bc97792ddc3cfc61",
  "published package reproduction oracle drifted");
  const builder = await readFile(resolve(root, "scripts/packageBuilder/buildCanonicalPackage.mjs"), "utf8");
  assert(builder.includes('"-c", "core.autocrlf=false", "archive"'),
    "canonical package builder no longer isolates Git line ending policy");

  const temporary = await mkdtemp(resolve(tmpdir(), "pyproc-canonical-package-contract-"));
  const left = resolve(temporary, "ubuntu");
  const right = resolve(temporary, "windows");
  try {
    await mkdir(left);
    await mkdir(right);
    const bytes = Buffer.from([1, 2, 3, 4]);
    await fixture(left, bytes);
    await fixture(right, bytes);
    await writeFile(resolve(right, "pyproc-1.2.3.tgz"), Buffer.from([1, 2, 3, 5]));
    await rejects(() => verifyCanonicalPackages({
      leftDir: left, rightDir: right, leftOs: "ubuntu", rightOs: "windows",
    }), /integrity mismatch/u);
    await writeFile(resolve(right, "pyproc-1.2.3.tgz"), bytes);
    const receipt = await verifyCanonicalPackages({
      leftDir: left, rightDir: right, leftOs: "ubuntu", rightOs: "windows",
    });
    assert(receipt.byteIdentical && receipt.package.sha256 === sha256(bytes),
      "cross-platform canonical package receipt is incomplete");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
