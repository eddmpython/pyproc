#!/usr/bin/env node
// 검증된 V86 실행 자산과 source, legal material을 project release 한 벌로 조립한다.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createDeterministicZip } from "./assembleBuildrootRelease.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..", "..");
const cacheRoot = resolve(root, ".cache");
const lock = JSON.parse(await readFile(resolve(root, "scripts/v86Builder/v86BuildLock.json"), "utf8"));
const sha256Pattern = /^[0-9a-f]{64}$/u;
const commitPattern = /^[0-9a-f]{40}$/u;
const runtimeNames = ["libv86.mjs", "v86.wasm", "seabios.bin", "vgabios.bin"];
const legalNames = [
  "legal/COPYING.LESSER.seabios",
  "legal/COPYING.seabios",
  "legal/LICENSE.softfloat-source.c",
  "legal/LICENSE.v86",
  "legal/LICENSE.v86-mit",
  "legal/LICENSE.zstd-source.c",
];
const inputNames = [
  "inputs/fetch-and-build-seabios.sh",
  "inputs/seabios.config",
  "inputs/v86BuildLock.json",
];

function sortPaths(paths) {
  return [...paths].sort((left, right) => Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8")));
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function descriptor(path, name) {
  return Object.freeze({ name, byteLength: (await stat(path)).size, sha256: await sha256(path) });
}

async function filesBelow(directory, current = directory) {
  const found = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) found.push(...await filesBelow(directory, path));
    else if (entry.isFile()) found.push(relative(directory, path).split(sep).join("/"));
    else throw new Error(`V86 verified directory has unsupported entry: ${entry.name}`);
  }
  return sortPaths(found);
}

function assertSourceIdentity(manifest) {
  const v86 = manifest.sources?.v86;
  const seabios = manifest.sources?.seabios;
  if (v86?.version !== lock.v86.version || v86?.revision !== lock.v86.revision || v86?.tree !== lock.v86.tree
    || seabios?.version !== lock.seabios.version || seabios?.revision !== lock.seabios.revision
    || seabios?.tree !== lock.seabios.tree || manifest.toolchain?.ubuntuSnapshot !== lock.toolchain.ubuntuSnapshot) {
    throw new Error("V86 release source or toolchain identity mismatch");
  }
}

async function assertSbom(directory) {
  const sbom = JSON.parse(await readFile(resolve(directory, "v86-assets.cyclonedx.json"), "utf8"));
  const licenses = new Map((sbom.components || []).map((entry) => [
    entry.name, entry.licenses?.[0]?.license?.id,
  ]));
  const required = new Map([
    ["v86", "BSD-2-Clause"],
    ["v86 QEMU floppy portions", "MIT"],
    ["Berkeley SoftFloat", "BSD-3-Clause"],
    ["Zstandard single-file decompressor", "BSD-3-Clause"],
    ["SeaBIOS", "LGPL-3.0-only"],
  ]);
  if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.6"
    || [...required].some(([name, license]) => licenses.get(name) !== license)) {
    throw new Error("V86 release SBOM component or license inventory mismatch");
  }
}

export async function validateV86VerifiedDirectory({ verifiedDir, targetCommit }) {
  const directory = resolve(verifiedDir);
  if (!commitPattern.test(targetCommit || "")) throw new TypeError("target commit must be a 40 character Git SHA");
  const manifestBytes = await readFile(resolve(directory, "build-manifest.json"));
  const receiptBytes = await readFile(resolve(directory, "reproducibility-manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const receipt = JSON.parse(receiptBytes.toString("utf8"));
  assertSourceIdentity(manifest);
  if (manifest.schemaVersion !== 1 || manifest.recipe !== lock.recipe
    || receipt.schemaVersion !== 1 || receipt.recipe !== manifest.recipe
    || receipt.headSha !== targetCommit || !/^\d+$/u.test(receipt.runId || "")
    || receipt.independentBuilds?.join(",") !== "a,b" || receipt.byteIdentical !== true
    || Object.values(manifest.expectedMatches || {}).length !== runtimeNames.length
    || Object.values(manifest.expectedMatches || {}).some((entry) => entry !== true)
    || JSON.stringify(receipt.artifacts) !== JSON.stringify(manifest.artifacts)) {
    throw new Error("V86 build manifest and reproducibility receipt mismatch");
  }
  const sourceNames = [
    `v86-${lock.v86.version}-source.tar`,
    `seabios-${lock.seabios.version}-source.tar`,
  ];
  const required = sortPaths([...runtimeNames, ...sourceNames, "v86-assets.cyclonedx.json",
    ...legalNames, ...inputNames]);
  const declared = sortPaths(manifest.artifacts.map((entry) => entry.name));
  if (declared.join("\n") !== required.join("\n")
    || new Set(declared).size !== declared.length
    || manifest.artifacts.some((entry) => !Number.isSafeInteger(entry.byteLength)
      || entry.byteLength < 1 || !sha256Pattern.test(entry.sha256 || ""))) {
    throw new Error("V86 release artifact inventory mismatch");
  }
  const actual = await filesBelow(directory);
  const expectedActual = sortPaths([...declared, "build-manifest.json", "reproducibility-manifest.json"]);
  if (actual.join("\n") !== expectedActual.join("\n")) throw new Error("V86 verified directory inventory drifted");
  for (const entry of manifest.artifacts) {
    const path = resolve(directory, ...entry.name.split("/"));
    if ((await stat(path)).size !== entry.byteLength || await sha256(path) !== entry.sha256) {
      throw new Error(`V86 verified artifact integrity mismatch: ${entry.name}`);
    }
  }
  await assertSbom(directory);
  return Object.freeze({ directory, manifest, receipt, sourceNames });
}

function assertOutput(path) {
  const output = resolve(path);
  if (output === cacheRoot || !output.startsWith(`${cacheRoot}${sep}`)) {
    throw new TypeError("V86 release output must be below repository .cache");
  }
  if (existsSync(output)) throw new Error("V86 release output already exists");
  return output;
}

export async function assembleV86Release({ verifiedDir, releaseTag, targetCommit, outputDir }) {
  if (!/^pyproc-v86-assets-v\d+$/u.test(releaseTag || "")) throw new TypeError("V86 release tag is invalid");
  const output = assertOutput(outputDir);
  const verified = await validateV86VerifiedDirectory({ verifiedDir, targetCommit });
  await mkdir(dirname(output), { recursive: true });
  const workspace = await mkdtemp(join(dirname(output), ".v86Release-"));
  const staged = resolve(workspace, "release");
  try {
    await mkdir(staged);
    const copied = [
      ...runtimeNames,
      ...verified.sourceNames,
      "v86-assets.cyclonedx.json",
      "build-manifest.json",
      "reproducibility-manifest.json",
    ];
    for (const name of copied) await copyFile(resolve(verified.directory, name), resolve(staged, name));
    await createDeterministicZip({
      sourceDirectory: verified.directory,
      target: resolve(staged, "v86-assets-legal.zip"),
      files: legalNames,
      sourceDateEpoch: lock.v86.sourceDateEpoch,
    });
    await createDeterministicZip({
      sourceDirectory: verified.directory,
      target: resolve(staged, "v86-assets-inputs.zip"),
      files: inputNames,
      sourceDateEpoch: lock.v86.sourceDateEpoch,
    });
    const assetNames = sortPaths(await readdir(staged));
    const assets = await Promise.all(assetNames.map((name) => descriptor(resolve(staged, name), name)));
    const release = {
      schemaVersion: 1,
      releaseTag,
      targetCommit,
      githubRunId: verified.receipt.runId,
      sources: verified.manifest.sources,
      assets,
      legalEntries: legalNames.length,
      inputEntries: inputNames.length,
    };
    await writeFile(resolve(staged, "releaseAssets.json"), `${JSON.stringify(release, null, 2)}\n`);
    await rename(staged, output);
    return Object.freeze(release);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = (name) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const options = {
    verifiedDir: value("--verified-dir"),
    releaseTag: value("--tag"),
    targetCommit: value("--target-commit"),
    outputDir: value("--out"),
  };
  if (Object.values(options).some((entry) => !entry)) {
    throw new TypeError("usage: assembleV86Release.mjs --verified-dir <dir> --tag <tag> --target-commit <sha> --out <dir>");
  }
  console.log(JSON.stringify(await assembleV86Release(options), null, 2));
}
