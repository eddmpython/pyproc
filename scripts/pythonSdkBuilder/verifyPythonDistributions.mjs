#!/usr/bin/env node
// 서로 다른 host에서 같은 commit으로 만든 platform wheel이 byte 단위로 같은지 대조한다.
// sdist와 순수 wheel은 setuptools와 build host의 zlib이 만들므로 재현 주장 범위에 넣지 않는다.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST = "python-distributions-manifest.json";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function hostWheelsOf(manifest) {
  const wheels = (manifest?.distributions || []).filter((item) => item.kind === "hostWheel");
  if (manifest?.schemaVersion !== 1 || manifest?.recipe !== "pyproc-python-distributions-v1"
    || !/^[0-9a-f]{40}$/u.test(manifest.source?.commit || "") || !wheels.length
    || wheels.some((item) => !/^pyproc_control-\d+\.\d+\.\d+-py3-none-[a-z0-9_]+\.whl$/u.test(item.filename || "")
      || !/^[0-9a-f]{64}$/u.test(item.sha256 || ""))) {
    throw new Error("Python distribution manifest is incomplete");
  }
  return wheels;
}

async function wheelBytes(directory, item) {
  const bytes = await readFile(resolve(directory, item.filename));
  if (bytes.byteLength !== item.byteLength || sha256(bytes) !== item.sha256) {
    throw new Error(`platform wheel integrity mismatch: ${item.filename}`);
  }
  return bytes;
}

export async function verifyPythonDistributions({ leftDir, rightDir, leftOs, rightOs, receiptPath }) {
  const left = resolve(leftDir);
  const right = resolve(rightDir);
  if (left === right || !leftOs || !rightOs || leftOs === rightOs) {
    throw new Error("Python distribution verification requires two distinct hosts");
  }
  const leftManifest = JSON.parse(await readFile(resolve(left, MANIFEST), "utf8"));
  const rightManifest = JSON.parse(await readFile(resolve(right, MANIFEST), "utf8"));
  const leftWheels = hostWheelsOf(leftManifest);
  const rightWheels = hostWheelsOf(rightManifest);
  for (const field of ["source", "hostPackage", "hostNode", "nativeHosts"]) {
    if (JSON.stringify(leftManifest[field]) !== JSON.stringify(rightManifest[field])) {
      throw new Error(`Python distribution ${field} differs between hosts`);
    }
  }
  if (JSON.stringify(leftWheels) !== JSON.stringify(rightWheels)) throw new Error("platform wheel manifests differ");
  for (const item of leftWheels) {
    const [leftBytes, rightBytes] = await Promise.all([wheelBytes(left, item), wheelBytes(right, item)]);
    if (!leftBytes.equals(rightBytes)) throw new Error(`platform wheel bytes differ: ${item.filename}`);
  }
  const receipt = {
    schemaVersion: 1,
    recipe: leftManifest.recipe,
    source: leftManifest.source,
    hostPackage: leftManifest.hostPackage,
    operatingSystems: [leftOs, rightOs],
    byteIdentical: true,
    wheels: leftWheels.map(({ filename, platform, byteLength, sha256: digest }) =>
      ({ filename, platform, byteLength, sha256: digest })),
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
    throw new TypeError("usage: verifyPythonDistributions.mjs --left <dir> --right <dir> --left-os <os> "
      + "--right-os <os> [--receipt <path>]");
  }
  console.log(JSON.stringify(await verifyPythonDistributions(options), null, 2));
}
