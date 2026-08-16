#!/usr/bin/env node
// 서로 다른 host에서 만든 canonical package tarball과 manifest를 byte 단위로 대조한다.
import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sha256Pattern = /^[0-9a-f]{64}$/u;

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function assertManifest(manifest) {
  const pkg = manifest?.package;
  if (manifest?.schemaVersion !== 1 || manifest?.recipe !== "pyproc-canonical-npm-package-v1"
    || !/^[0-9a-f]{40}$/u.test(manifest.source?.commit || "")
    || !/^[0-9a-f]{40}$/u.test(manifest.source?.tree || "")
    || pkg?.name !== "pyproc" || !/^pyproc-\d+\.\d+\.\d+\.tgz$/u.test(pkg.filename || "")
    || !Number.isSafeInteger(pkg.byteLength) || pkg.byteLength < 1 || !sha256Pattern.test(pkg.sha256 || "")
    || !Array.isArray(pkg.files) || pkg.files.length !== pkg.fileCount) {
    throw new Error("canonical package manifest is incomplete");
  }
}

async function verifyOne(directory, manifest) {
  const names = (await readdir(directory)).sort();
  const expected = ["canonical-package-manifest.json", manifest.package.filename].sort();
  if (names.join("\n") !== expected.join("\n")) throw new Error("canonical package inventory drifted");
  const tarball = resolve(directory, manifest.package.filename);
  if ((await stat(tarball)).size !== manifest.package.byteLength || await sha256(tarball) !== manifest.package.sha256) {
    throw new Error("canonical package integrity mismatch");
  }
}

export async function verifyCanonicalPackages({ leftDir, rightDir, receiptPath, leftOs, rightOs }) {
  const left = resolve(leftDir);
  const right = resolve(rightDir);
  if (left === right || !leftOs || !rightOs || leftOs === rightOs) {
    throw new Error("canonical package verification requires two distinct hosts");
  }
  const leftManifest = await readFile(resolve(left, "canonical-package-manifest.json"));
  const rightManifest = await readFile(resolve(right, "canonical-package-manifest.json"));
  if (!leftManifest.equals(rightManifest)) throw new Error("canonical package manifests differ");
  const manifest = JSON.parse(leftManifest.toString("utf8"));
  assertManifest(manifest);
  await Promise.all([verifyOne(left, manifest), verifyOne(right, manifest)]);
  const leftTar = await readFile(resolve(left, manifest.package.filename));
  const rightTar = await readFile(resolve(right, manifest.package.filename));
  if (!leftTar.equals(rightTar)) throw new Error("canonical package bytes differ");
  const receipt = {
    schemaVersion: 1,
    recipe: manifest.recipe,
    source: manifest.source,
    operatingSystems: [leftOs, rightOs],
    byteIdentical: true,
    package: {
      filename: manifest.package.filename,
      byteLength: manifest.package.byteLength,
      sha256: manifest.package.sha256,
    },
  };
  if (receiptPath) await writeFile(resolve(receiptPath), `${JSON.stringify(receipt, null, 2)}\n`);
  return Object.freeze(receipt);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const value = (name) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
  };
  const options = {
    leftDir: value("--left"),
    rightDir: value("--right"),
    leftOs: value("--left-os"),
    rightOs: value("--right-os"),
    receiptPath: value("--receipt"),
  };
  if (!options.leftDir || !options.rightDir || !options.leftOs || !options.rightOs) {
    throw new TypeError("usage: verifyCanonicalPackage.mjs --left <dir> --right <dir> --left-os <os> --right-os <os> [--receipt <path>]");
  }
  console.log(JSON.stringify(await verifyCanonicalPackages(options), null, 2));
}
