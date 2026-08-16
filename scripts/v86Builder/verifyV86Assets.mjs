// 두 격리 V86 asset build의 모든 선언 산출물을 byte 단위로 대조한다.
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const sha256Pattern = /^[0-9a-f]{64}$/u;

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function filesBelow(root, directory = root) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...await filesBelow(root, path));
    else if (entry.isFile()) found.push(relative(root, path).split(sep).join("/"));
  }
  return found.sort();
}

function assertManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || typeof manifest.recipe !== "string") {
    throw new Error("V86 build manifest schema mismatch");
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length < 10) {
    throw new Error("V86 build manifest artifact inventory is incomplete");
  }
  const names = manifest.artifacts.map((entry) => entry.name);
  if (new Set(names).size !== names.length) throw new Error("V86 build manifest artifact names are duplicated");
  for (const entry of manifest.artifacts) {
    if (!entry.name || entry.name.startsWith("/") || entry.name.split("/").includes("..")) {
      throw new Error(`V86 build manifest artifact path is unsafe: ${entry.name}`);
    }
    if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength <= 0 || !sha256Pattern.test(entry.sha256)) {
      throw new Error(`V86 build manifest artifact descriptor is invalid: ${entry.name}`);
    }
  }
}

async function verifyOne(directory, manifest) {
  const declared = manifest.artifacts.map((entry) => entry.name).sort();
  const actual = (await filesBelow(directory)).filter((name) => ![
    "build-manifest.json", "reproducibility-manifest.json",
  ].includes(name));
  if (declared.join("\n") !== actual.join("\n")) throw new Error("V86 build artifact inventory drifted");
  for (const entry of manifest.artifacts) {
    const path = resolve(directory, ...entry.name.split("/"));
    if ((await stat(path)).size !== entry.byteLength || await sha256(path) !== entry.sha256) {
      throw new Error(`V86 build artifact integrity mismatch: ${entry.name}`);
    }
  }
}

export async function verifyV86AssetBuild({ leftDir, rightDir, receiptPath, runId = null, headSha = null }) {
  const left = resolve(leftDir);
  const right = resolve(rightDir);
  if (left === right) throw new Error("V86 reproduction requires two independent directories");
  const leftBytes = await readFile(resolve(left, "build-manifest.json"));
  const rightBytes = await readFile(resolve(right, "build-manifest.json"));
  if (!leftBytes.equals(rightBytes)) throw new Error("V86 build manifests differ");
  const manifest = JSON.parse(leftBytes.toString("utf8"));
  assertManifest(manifest);
  await Promise.all([verifyOne(left, manifest), verifyOne(right, manifest)]);
  for (const entry of manifest.artifacts) {
    const leftArtifact = await readFile(resolve(left, ...entry.name.split("/")));
    const rightArtifact = await readFile(resolve(right, ...entry.name.split("/")));
    if (!leftArtifact.equals(rightArtifact)) throw new Error(`V86 independent build bytes differ: ${entry.name}`);
  }
  const receipt = {
    schemaVersion: 1,
    recipe: manifest.recipe,
    independentBuilds: ["a", "b"],
    byteIdentical: true,
    ...(runId ? { runId: String(runId) } : {}),
    ...(headSha ? { headSha: String(headSha) } : {}),
    artifacts: manifest.artifacts,
  };
  if (receiptPath) await writeFile(resolve(receiptPath), `${JSON.stringify(receipt, null, 2)}\n`);
  return Object.freeze(receipt);
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked === fileURLToPath(import.meta.url)) {
  const leftIndex = process.argv.indexOf("--left");
  const rightIndex = process.argv.indexOf("--right");
  const receiptIndex = process.argv.indexOf("--receipt");
  if (leftIndex < 0 || rightIndex < 0 || !process.argv[leftIndex + 1] || !process.argv[rightIndex + 1]) {
    throw new Error("usage: verifyV86Assets.mjs --left <dir> --right <dir> [--receipt <path>]");
  }
  const receipt = await verifyV86AssetBuild({
    leftDir: process.argv[leftIndex + 1],
    rightDir: process.argv[rightIndex + 1],
    receiptPath: receiptIndex >= 0 ? process.argv[receiptIndex + 1] : null,
    runId: process.env.GITHUB_RUN_ID,
    headSha: process.env.GITHUB_SHA,
  });
  console.log(JSON.stringify(receipt, null, 2));
}
