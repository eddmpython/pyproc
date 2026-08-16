#!/usr/bin/env node
// 검증된 Buildroot 산출물과 전체 법무 자료를 project asset release 한 벌로 조립한다.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, cp, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..", "..");
const cacheRoot = resolve(root, ".cache");
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const MAX_SOURCE_BYTES = 256 * 1024 * 1024;
const MAX_ZIP32 = 0xffffffff;
const CRC_TABLE = new Uint32Array(256);
for (let value = 0; value < CRC_TABLE.length; value += 1) {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  CRC_TABLE[value] = crc >>> 0;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new TypeError("모든 인자는 --name value 쌍이어야 한다");
    if (values.has(key)) throw new TypeError(`중복 인자: ${key}`);
    values.set(key, value);
  }
  for (const key of ["--verified-dir", "--legal-dir", "--tag", "--target-commit", "--out"]) {
    if (!values.has(key)) throw new TypeError(`필수 인자 없음: ${key}`);
  }
  return Object.freeze({
    verifiedDir: resolve(values.get("--verified-dir")),
    legalDir: resolve(values.get("--legal-dir")),
    releaseTag: values.get("--tag"),
    targetCommit: values.get("--target-commit"),
    outputDir: resolve(values.get("--out")),
  });
}

function assertCacheOutput(path) {
  if (path === cacheRoot || !path.startsWith(`${cacheRoot}${sep}`)) {
    throw new TypeError("--out은 저장소 .cache의 하위 디렉터리여야 한다");
  }
}

function repositoryPath(path) {
  const absolute = resolve(root, String(path));
  if (absolute === root || !absolute.startsWith(`${root}${sep}`)) {
    throw new TypeError(`저장소 밖 config 경로: ${path}`);
  }
  return absolute;
}

export function resolveLegalInfoPath(directory, ...parts) {
  const boundary = resolve(directory);
  const absolute = resolve(boundary, ...parts.map(String));
  if (absolute === boundary || !absolute.startsWith(`${boundary}${sep}`)) {
    throw new TypeError(`legal-info 경로가 입력 디렉터리 밖을 가리킨다: ${parts.join("/")}`);
  }
  return absolute;
}

async function digestFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function assertFile(path, expected) {
  const info = await stat(path);
  const sha256 = await digestFile(path);
  if (expected?.byteLength !== undefined && expected.byteLength !== info.size) {
    throw new Error(`${basename(path)} byteLength 불일치`);
  }
  if (expected?.sha256 !== undefined && expected.sha256 !== sha256) {
    throw new Error(`${basename(path)} SHA-256 불일치`);
  }
  return Object.freeze({ name: basename(path), byteLength: info.size, sha256 });
}

function publicHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch (error) { return false; }
}

function assertBuildrootIdentity(manifest) {
  const source = manifest.buildroot;
  if (!source || !/^\d{4}\.\d{2}\.\d{1,2}$/.test(source.version || "")
    || !COMMIT_PATTERN.test(source.revision || "") || !COMMIT_PATTERN.test(source.commit || "")
    || !publicHttpsUrl(source.repository) || !publicHttpsUrl(source.sourceUrl)
    || !SHA256_PATTERN.test(source.sourceSha256 || "")
    || source.sourceDateEpoch !== manifest.sourceDateEpoch) {
    throw new Error("build manifest의 Buildroot source identity가 불완전하다");
  }
}

async function assertCycloneDx(path, manifest) {
  const sbom = JSON.parse(await readFile(path, "utf8"));
  const nodeComponent = sbom.components?.find((entry) => entry?.name === "nodejs-src");
  if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.6"
    || sbom.metadata?.component?.name !== "buildroot"
    || sbom.metadata?.component?.version !== manifest.buildroot.version
    || !Array.isArray(sbom.components) || !sbom.components.length
    || sbom.components.some((entry) => typeof entry?.name !== "string" || !entry.name
      || typeof entry?.type !== "string" || !entry.type)) {
    throw new Error("Buildroot CycloneDX SBOM이 source identity와 일치하지 않는다");
  }
  if (manifest.profile === "node" && nodeComponent?.version !== manifest.runtime?.version) {
    throw new Error("Buildroot CycloneDX SBOM에 exact Node runtime이 없다");
  }
}

async function listFiles(directory, prefix = "") {
  const found = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const child = join(prefix, entry.name);
    if (entry.isDirectory()) found.push(...await listFiles(directory, child));
    else if (entry.isFile()) found.push(child);
    else throw new Error(`legal-info에 일반 파일이 아닌 항목이 있다: ${child}`);
  }
  return found;
}

function sortPaths(paths) {
  return [...paths].sort((left, right) => Buffer.from(left.split(sep).join("/"), "utf8")
    .compare(Buffer.from(right.split(sep).join("/"), "utf8")));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (!quoted && character === ",") { row.push(field); field = ""; }
    else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("legal-info CSV의 quote가 닫히지 않았다");
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function assertPath(path, label) {
  try { return await stat(path); }
  catch (error) {
    if (error?.code === "ENOENT") throw new Error(`legal-info 누락: ${label}`);
    throw error;
  }
}

async function assertLegalCompleteness(legalDir) {
  const readme = await readFile(resolveLegalInfoPath(legalDir, "README"), "utf8");
  const warnings = readme.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("WARNING:"));
  if (warnings.join("\n") !== "WARNING: the Buildroot source code has not been saved") {
    throw new Error(`legal-info warning 불일치: ${warnings.join(" | ")}`);
  }
  await assertPath(resolveLegalInfoPath(legalDir, "buildroot.config"), "buildroot.config");
  for (const scope of ["", "host-"]) {
    const manifestName = `${scope}manifest.csv`;
    const rows = parseCsv(await readFile(resolveLegalInfoPath(legalDir, manifestName), "utf8"));
    if (rows.length < 2 || rows[0].slice(0, 6).join(",") !== "PACKAGE,VERSION,LICENSE,LICENSE FILES,SOURCE ARCHIVE,SOURCE SITE") {
      throw new Error(`${manifestName} header 또는 package row가 없다`);
    }
    for (const [name, version, _license, licenseFiles, sourceArchive] of rows.slice(1)) {
      const identity = scope === "host-" && name === "buildroot" ? "buildroot" : `${name}-${version}`;
      if (sourceArchive && sourceArchive !== "not saved") {
        await assertPath(resolveLegalInfoPath(legalDir, `${scope}sources`, identity, sourceArchive),
          `${scope}sources/${identity}/${sourceArchive}`);
      } else if (!(scope === "host-" && name === "buildroot" && sourceArchive === "not saved")) {
        throw new Error(`${manifestName}의 source archive가 저장되지 않았다: ${identity}`);
      }
      for (const licenseFile of String(licenseFiles || "").split(/\s+/).filter(Boolean)) {
        await assertPath(resolveLegalInfoPath(legalDir, `${scope}licenses`, identity, licenseFile),
          `${scope}licenses/${identity}/${licenseFile}`);
      }
    }
  }
}

async function sealLegalInfo(legalDir) {
  await assertLegalCompleteness(legalDir);
  const checksumName = "legal-info.sha256";
  await rm(join(legalDir, checksumName), { force: true });
  const files = sortPaths(await listFiles(legalDir));
  let verifiedBytes = 0;
  const rows = [];
  for (const path of files) {
    const absolute = join(legalDir, path);
    const info = await stat(absolute);
    verifiedBytes += info.size;
    rows.push(`${await digestFile(absolute)}  ${path.split(sep).join("/")}`);
  }
  await writeFile(join(legalDir, checksumName), `${rows.join("\n")}\n`);
  return Object.freeze({
    checksumRows: rows.length,
    files: files.length,
    verifiedBytes,
    missing: 0,
    extra: 0,
    duplicates: 0,
    checksumMismatches: 0,
  });
}

async function downloadSource(manifest, outputDir) {
  const source = manifest.buildroot;
  const name = `buildroot-${source.version}.tar.xz`;
  const target = join(outputDir, name);
  const temporary = `${target}.part`;
  const response = await fetch(source.sourceUrl, { redirect: "follow" });
  if (!response.ok) throw new Error(`Buildroot source download 실패(${response.status})`);
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) < 1 || Number(declared) > MAX_SOURCE_BYTES)) {
    throw new Error(`Buildroot source Content-Length 상한 불일치: ${declared}`);
  }
  if (!response.body) throw new Error("Buildroot source response stream이 없다");
  const handle = await open(temporary, "wx");
  const hash = createHash("sha256");
  let byteLength = 0;
  try {
    let position = 0;
    for await (const chunk of response.body) {
      const bytes = new Uint8Array(chunk);
      byteLength += bytes.byteLength;
      if (byteLength > MAX_SOURCE_BYTES) throw new Error("Buildroot source download 상한 초과");
      hash.update(bytes);
      position = await writeAt(handle, bytes, position);
    }
    await handle.close();
    if (byteLength < 1 || hash.digest("hex") !== source.sourceSha256) {
      throw new Error("Buildroot source SHA-256 불일치");
    }
    await rename(temporary, target);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true });
    throw error;
  }
  return target;
}

function dosDateTime(epochSeconds) {
  const date = new Date(epochSeconds * 1000);
  const year = date.getUTCFullYear();
  if (year < 1980 || year > 2107) throw new RangeError("sourceDateEpoch이 ZIP32 DOS timestamp 범위 밖이다");
  return Object.freeze({
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
  });
}

async function crc32File(path) {
  let crc = 0xffffffff;
  let byteLength = 0;
  for await (const chunk of createReadStream(path)) {
    byteLength += chunk.byteLength;
    for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  if (byteLength > MAX_ZIP32) throw new Error(`ZIP32 file size limit exceeded: ${path}`);
  return Object.freeze({ crc32: (crc ^ 0xffffffff) >>> 0, byteLength });
}

async function writeAt(handle, bytes, position) {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset, position + offset);
    if (!result.bytesWritten) throw new Error("ZIP write made no progress");
    offset += result.bytesWritten;
  }
  return position + offset;
}

export async function createDeterministicZip({ sourceDirectory, target, files, sourceDateEpoch }) {
  if (!Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch < 1) throw new TypeError("sourceDateEpoch 불일치");
  const relativePaths = files.map(String);
  if (!relativePaths.length || relativePaths.some((path) => !path || isAbsolute(path) || /[\r\n]/.test(path)
    || path.split(/[\\/]/).includes(".."))) {
    throw new TypeError("ZIP 입력은 source directory 안의 상대 파일이어야 한다");
  }
  const archivePaths = relativePaths.map((path) => path.replaceAll("\\", "/"))
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  if (archivePaths.length > 0xffff) throw new Error("ZIP32 entry count limit exceeded");
  if (new Set(archivePaths).size !== archivePaths.length) throw new TypeError("ZIP 입력 경로가 중복된다");
  const stamp = dosDateTime(sourceDateEpoch);
  const entries = [];
  for (const path of archivePaths) {
    if (Buffer.byteLength(path, "utf8") > 0xffff) throw new Error(`ZIP32 file name limit exceeded: ${path}`);
    const sourcePath = join(sourceDirectory, path);
    entries.push(Object.freeze({ path, sourcePath, ...await crc32File(sourcePath) }));
  }

  const handle = await open(target, "w");
  const centralParts = [];
  let position = 0;
  try {
    for (const entry of entries) {
      const name = Buffer.from(entry.path, "utf8");
      const localOffset = position;
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(0, 8);
      local.writeUInt16LE(stamp.time, 10);
      local.writeUInt16LE(stamp.date, 12);
      local.writeUInt32LE(entry.crc32, 14);
      local.writeUInt32LE(entry.byteLength, 18);
      local.writeUInt32LE(entry.byteLength, 22);
      local.writeUInt16LE(name.byteLength, 26);
      position = await writeAt(handle, local, position);
      position = await writeAt(handle, name, position);
      let writtenCrc = 0xffffffff;
      let writtenBytes = 0;
      for await (const chunk of createReadStream(entry.sourcePath)) {
        writtenBytes += chunk.byteLength;
        for (const byte of chunk) writtenCrc = CRC_TABLE[(writtenCrc ^ byte) & 0xff] ^ (writtenCrc >>> 8);
        position = await writeAt(handle, chunk, position);
      }
      if (writtenBytes !== entry.byteLength || ((writtenCrc ^ 0xffffffff) >>> 0) !== entry.crc32) {
        throw new Error(`ZIP source changed while assembling: ${entry.path}`);
      }

      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(0x0314, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0x0800, 8);
      central.writeUInt16LE(0, 10);
      central.writeUInt16LE(stamp.time, 12);
      central.writeUInt16LE(stamp.date, 14);
      central.writeUInt32LE(entry.crc32, 16);
      central.writeUInt32LE(entry.byteLength, 20);
      central.writeUInt32LE(entry.byteLength, 24);
      central.writeUInt16LE(name.byteLength, 28);
      central.writeUInt32LE(0x81a40000, 38);
      central.writeUInt32LE(localOffset, 42);
      centralParts.push(central, name);
      if (position > MAX_ZIP32) throw new Error("ZIP32 archive size limit exceeded");
    }
    const centralOffset = position;
    for (const part of centralParts) position = await writeAt(handle, part, position);
    const centralBytes = position - centralOffset;
    if (centralOffset > MAX_ZIP32 || centralBytes > MAX_ZIP32) {
      throw new Error("ZIP32 central directory limit exceeded");
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBytes, 12);
    end.writeUInt32LE(centralOffset, 16);
    await writeAt(handle, end, position);
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(target, { force: true });
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  assertCacheOutput(options.outputDir);
  if (!COMMIT_PATTERN.test(options.targetCommit)) throw new TypeError("--target-commit은 40자 Git SHA여야 한다");
  if (!/^buildroot-[a-z0-9.-]+$/.test(options.releaseTag)) throw new TypeError("--tag 형식이 올바르지 않다");

  const manifest = JSON.parse(await readFile(join(options.verifiedDir, "build-manifest.json"), "utf8"));
  const reproducibility = JSON.parse(await readFile(join(options.verifiedDir, "reproducibility-manifest.json"), "utf8"));
  assertBuildrootIdentity(manifest);
  if (manifest.schemaVersion !== 1 || reproducibility.schemaVersion !== 1
    || !Number.isSafeInteger(manifest.sourceDateEpoch) || manifest.sourceDateEpoch < 1
    || manifest.recipe !== reproducibility.recipe
    || reproducibility.headSha !== options.targetCommit
    || !/^\d+$/.test(reproducibility.githubRunId || "")
    || reproducibility.independentBuilds?.join(",") !== "a,b"
    || manifest.output?.name !== reproducibility.output?.name
    || manifest.output?.byteLength !== reproducibility.output?.byteLength
    || manifest.output?.sha256 !== reproducibility.output?.sha256
    || reproducibility.byteIdentical !== true
    || manifest.evidence?.legalWarnings?.length !== 0) {
    throw new Error("검증 build manifest와 재현 영수증이 일치하지 않는다");
  }
  if (manifest.profile === "node") {
    const runtime = manifest.runtime;
    const oracle = manifest.runtimeOracle;
    if (runtime?.name !== "node" || !/^\d+\.\d+\.\d+$/.test(runtime.version || "")
      || !COMMIT_PATTERN.test(runtime.revision || "") || !publicHttpsUrl(runtime.repository)
      || !publicHttpsUrl(runtime.sourceUrl) || !SHA256_PATTERN.test(runtime.sourceSha256 || "")
      || typeof runtime.oracle?.source !== "string" || !runtime.oracle.source || runtime.oracle.source.length > 1024
      || !SHA256_PATTERN.test(runtime.oracle?.sha256 || "")
      || oracle?.version !== `v${runtime.version}` || oracle?.sha256 !== runtime.oracle.sha256) {
      throw new Error("검증 Node runtime source와 실행 oracle이 불완전하다");
    }
  }

  await assertFile(join(options.verifiedDir, manifest.output.name), manifest.output);
  await assertCycloneDx(join(options.verifiedDir, "buildroot.cyclonedx.json"), manifest);
  await mkdir(dirname(options.outputDir), { recursive: true });
  const workspace = await mkdtemp(join(dirname(options.outputDir), ".buildrootRelease-"));
  const outputDir = join(workspace, "release");
  const legalDir = join(workspace, "legal");
  try {
    await mkdir(outputDir);
    await cp(options.legalDir, legalDir, { recursive: true, errorOnExist: true });
    for (const name of ["build-manifest.json", manifest.output.name, "buildroot.cyclonedx.json",
      "reproducibility-manifest.json"]) {
      await copyFile(join(options.verifiedDir, name), join(outputDir, name));
    }
    const sourceArchive = await downloadSource(manifest, outputDir);

    const configInputs = [
      { path: manifest.config?.path, sha256: manifest.config?.sha256 },
      ...(manifest.config?.profileFragments || []),
      manifest.config?.linuxFragment,
      manifest.config?.rootfsInit,
      manifest.config?.inittab,
    ];
    const occupiedNames = new Set(await listFiles(outputDir));
    for (const input of configInputs) {
      if (!input?.path || !SHA256_PATTERN.test(input.sha256 || "")) {
        throw new Error("build manifest의 config input이 불완전하다");
      }
      const source = repositoryPath(input.path);
      await assertFile(source, { sha256: input.sha256 });
      const outputName = basename(input.path);
      if (occupiedNames.has(outputName)) throw new Error(`release asset 이름 충돌: ${outputName}`);
      occupiedNames.add(outputName);
      await copyFile(source, join(outputDir, outputName));
    }

    const legalInfoInventory = await sealLegalInfo(legalDir);
    const legalZip = join(outputDir, "buildroot-legal-info-complete.zip");
    const legalFiles = sortPaths(await listFiles(legalDir));
    await createDeterministicZip({ sourceDirectory: legalDir, target: legalZip, files: legalFiles,
      sourceDateEpoch: manifest.sourceDateEpoch });
    await assertFile(sourceArchive, { sha256: manifest.buildroot.sourceSha256 });

    const assetNames = sortPaths(await listFiles(outputDir));
    const assets = [];
    for (const name of assetNames) assets.push(await assertFile(join(outputDir, name)));
    const releaseAssets = {
      schemaVersion: 1,
      releaseTag: options.releaseTag,
      targetCommit: options.targetCommit,
      assets,
      legalInfoInventory,
    };
    await writeFile(join(outputDir, "releaseAssets.json"), `${JSON.stringify(releaseAssets, null, 2)}\n`);
    await rm(options.outputDir, { recursive: true, force: true });
    await rename(outputDir, options.outputDir);
    console.log(JSON.stringify({ outputDir: options.outputDir, releaseAssets }, null, 2));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
