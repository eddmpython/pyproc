// wheelInstaller.js - Layer 0: bounded pure Python wheel validation and immutable tree preparation.
import { base64FromBytes, parseSha256Address, sha256Address, sha256Hex } from "./contentDigest.js";
import { PyProcError } from "./errors.js";
import { canonicalPackageJson, canonicalRequiresPython, normalizePackageName } from "./packageCanonical.js";
import { unzipWheel } from "./engines/wasi/wheelUnzip.js";
import { compareNames } from "./memoryLayout.js";

export const DEFAULT_WHEEL_LIMITS = Object.freeze({
  maxArchiveBytes: 64 * 1024 * 1024,
  maxFiles: 4096,
  maxFileBytes: 16 * 1024 * 1024,
  maxUnpackedBytes: 128 * 1024 * 1024,
  maxCompressionRatio: 100,
});

const decoder = new TextDecoder("utf-8", { fatal: true });
const binaryExtension = /\.(?:so|pyd|dll|dylib|wasm)$/iu;
const reservedSegment = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

function packageIntegrity(message, context = undefined) {
  return new PyProcError("PYPROC_PACKAGE_INTEGRITY", message, context ? { context } : {});
}

function acceptedBytes(input) {
  if (input instanceof Uint8Array) return input.slice();
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice();
  }
  throw new PyProcError("PYPROC_INPUT_INVALID", "Wheel must be bytes");
}

function acceptedLimits(overrides) {
  if (overrides !== undefined && (!overrides || typeof overrides !== "object" || Array.isArray(overrides))) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "Wheel limits must be an object");
  }
  const limits = { ...DEFAULT_WHEEL_LIMITS, ...(overrides || {}) };
  const byteLimits = ["maxArchiveBytes", "maxFiles", "maxFileBytes", "maxUnpackedBytes"];
  if (byteLimits.some((key) => !Number.isSafeInteger(limits[key]) || limits[key] < 1)
    || !Number.isFinite(limits.maxCompressionRatio) || limits.maxCompressionRatio < 1) {
    throw new PyProcError("PYPROC_INPUT_INVALID", "Wheel limits must be finite positive values");
  }
  return Object.freeze(limits);
}

function u16(view, offset, label) {
  if (offset < 0 || offset + 2 > view.byteLength) throw packageIntegrity(`Wheel ${label} is out of bounds`);
  return view.getUint16(offset, true);
}

function u32(view, offset, label) {
  if (offset < 0 || offset + 4 > view.byteLength) throw packageIntegrity(`Wheel ${label} is out of bounds`);
  return view.getUint32(offset, true);
}

function safePath(rawPath) {
  if (!rawPath || rawPath.includes("\\") || rawPath.includes("\0") || rawPath.startsWith("/")
    || /^[A-Za-z]:/u.test(rawPath)) throw packageIntegrity(`Wheel path is unsafe: ${rawPath}`);
  const directory = rawPath.endsWith("/");
  const parts = rawPath.split("/");
  if (directory) parts.pop();
  if (!parts.length || parts.some((part) => !part || part === "." || part === ".."
    || reservedSegment.test(part))) throw packageIntegrity(`Wheel path is unsafe: ${rawPath}`);
  return Object.freeze({ path: parts.join("/") + (directory ? "/" : ""), directory });
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function centralDirectory(bytes, limits) {
  if (bytes.byteLength < 22 || bytes.byteLength > limits.maxArchiveBytes) {
    throw packageIntegrity("Wheel archive size is outside policy");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const floor = Math.max(0, bytes.byteLength - 22 - 65535);
  let endOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= floor; offset -= 1) {
    if (u32(view, offset, "end signature") === 0x06054b50) { endOffset = offset; break; }
  }
  if (endOffset < 0) throw packageIntegrity("Wheel has no ZIP end record");
  const disk = u16(view, endOffset + 4, "disk");
  const centralDisk = u16(view, endOffset + 6, "central disk");
  const diskEntries = u16(view, endOffset + 8, "disk entry count");
  const entryCount = u16(view, endOffset + 10, "entry count");
  const centralSize = u32(view, endOffset + 12, "central size");
  const centralOffset = u32(view, endOffset + 16, "central offset");
  const commentLength = u16(view, endOffset + 20, "comment length");
  if (disk || centralDisk || diskEntries !== entryCount || entryCount === 0xffff
    || centralOffset === 0xffffffff || centralSize === 0xffffffff) {
    throw packageIntegrity("Wheel must be a single-disk non-ZIP64 archive");
  }
  if (entryCount < 1 || entryCount > limits.maxFiles || endOffset + 22 + commentLength !== bytes.byteLength
    || centralOffset + centralSize !== endOffset) throw packageIntegrity("Wheel central directory is inconsistent");
  const entries = [];
  const exactPaths = new Set();
  const foldedPaths = new Set();
  let unpackedBytes = 0;
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (u32(view, offset, "central signature") !== 0x02014b50) {
      throw packageIntegrity("Wheel central directory header is corrupt");
    }
    const madeBy = u16(view, offset + 4, "creator");
    const flags = u16(view, offset + 8, "flags");
    const method = u16(view, offset + 10, "compression method");
    const checksum = u32(view, offset + 16, "CRC-32");
    const compressedBytes = u32(view, offset + 20, "compressed size");
    const uncompressedBytes = u32(view, offset + 24, "uncompressed size");
    const nameLength = u16(view, offset + 28, "name length");
    const extraLength = u16(view, offset + 30, "extra length");
    const commentBytes = u16(view, offset + 32, "entry comment length");
    const externalAttributes = u32(view, offset + 38, "external attributes");
    const localOffset = u32(view, offset + 42, "local offset");
    const entryEnd = offset + 46 + nameLength + extraLength + commentBytes;
    if (entryEnd > endOffset || flags & ~(0x0800 | 0x0008) || ![0, 8].includes(method)) {
      throw packageIntegrity("Wheel contains an unsupported or encrypted ZIP entry");
    }
    let decodedName;
    try { decodedName = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); }
    catch (error) { throw packageIntegrity("Wheel path is not valid UTF-8"); }
    const acceptedPath = safePath(decodedName);
    const folded = acceptedPath.path.toLocaleLowerCase("en-US");
    if (exactPaths.has(acceptedPath.path) || foldedPaths.has(folded)) {
      throw packageIntegrity(`Wheel contains a duplicate or case-colliding path: ${acceptedPath.path}`);
    }
    exactPaths.add(acceptedPath.path);
    foldedPaths.add(folded);
    const unixMode = madeBy >> 8 === 3 ? externalAttributes >>> 16 : 0;
    if ((unixMode & 0xf000) === 0xa000) throw packageIntegrity(`Wheel contains a symbolic link: ${acceptedPath.path}`);
    if (!acceptedPath.directory && binaryExtension.test(acceptedPath.path)) {
      throw new PyProcError("PYPROC_PACKAGE_ABI_UNSUPPORTED",
        `Wheel contains a native binary that is not part of the engine profile: ${acceptedPath.path}`);
    }
    unpackedBytes += uncompressedBytes;
    if (uncompressedBytes > limits.maxFileBytes || unpackedBytes > limits.maxUnpackedBytes
      || compressedBytes === 0 && uncompressedBytes > 0
      || compressedBytes > 0 && uncompressedBytes / compressedBytes > limits.maxCompressionRatio) {
      throw packageIntegrity(`Wheel entry exceeds archive limits: ${acceptedPath.path}`);
    }
    if (u32(view, localOffset, "local signature") !== 0x04034b50) {
      throw packageIntegrity(`Wheel local header is corrupt: ${acceptedPath.path}`);
    }
    const localNameLength = u16(view, localOffset + 26, "local name length");
    const localExtraLength = u16(view, localOffset + 28, "local extra length");
    const localFlags = u16(view, localOffset + 6, "local flags");
    const localMethod = u16(view, localOffset + 8, "local compression method");
    let localName;
    try { localName = decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)); }
    catch (error) { throw packageIntegrity("Wheel local path is not valid UTF-8"); }
    if (localName !== decodedName || localFlags !== flags || localMethod !== method) {
      throw packageIntegrity(`Wheel local and central headers differ: ${acceptedPath.path}`);
    }
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedBytes > centralOffset) {
      throw packageIntegrity(`Wheel entry data is out of bounds: ${acceptedPath.path}`);
    }
    entries.push(Object.freeze({ path: acceptedPath.path, directory: acceptedPath.directory,
      checksum, compressedBytes, uncompressedBytes }));
    offset = entryEnd;
  }
  if (offset !== endOffset) throw packageIntegrity("Wheel central directory length changed while reading");
  return Object.freeze(entries);
}

function metadataHeaders(bytes, label) {
  let text;
  try { text = decoder.decode(bytes); }
  catch (error) { throw packageIntegrity(`${label} is not valid UTF-8`); }
  const headers = new Map();
  let current = null;
  for (const rawLine of text.replaceAll("\r\n", "\n").split("\n")) {
    if (!rawLine) break;
    if (/^[ \t]/u.test(rawLine)) {
      if (!current) throw packageIntegrity(`${label} contains an orphan continuation line`);
      const values = headers.get(current);
      values[values.length - 1] += ` ${rawLine.trim()}`;
      continue;
    }
    const separator = rawLine.indexOf(":");
    if (separator < 1) throw packageIntegrity(`${label} contains a malformed header`);
    current = rawLine.slice(0, separator).toLowerCase();
    const values = headers.get(current) || [];
    values.push(rawLine.slice(separator + 1).trim());
    headers.set(current, values);
  }
  return headers;
}

function csvRows(bytes) {
  let text;
  try { text = decoder.decode(bytes); }
  catch (error) { throw packageIntegrity("Wheel RECORD is not valid UTF-8"); }
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index <= text.length; index += 1) {
    const char = index === text.length ? "\n" : text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && !field) quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") {
      row.push(field.replace(/\r$/u, ""));
      if (row.some((value) => value)) rows.push(row);
      row = []; field = "";
    } else field += char;
  }
  if (quoted) throw packageIntegrity("Wheel RECORD has an unterminated quoted field");
  return rows;
}

function hexBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function recordDigest(hex) {
  return base64FromBytes(hexBytes(hex)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function parseWheelFilename(filename) {
  if (typeof filename !== "string" || !filename.endsWith(".whl")) {
    throw packageIntegrity("Wheel filename must end with .whl");
  }
  const parts = filename.slice(0, -4).split("-");
  if (parts.length < 5) throw packageIntegrity("Wheel filename does not contain compatibility tags");
  const platform = parts.pop();
  const abi = parts.pop();
  const python = parts.pop();
  return Object.freeze({ distribution: parts[0], version: parts[1], python, abi, platform,
    tags: Object.freeze(python.split(".").flatMap((pythonTag) => abi.split(".").flatMap((abiTag) =>
      platform.split(".").map((platformTag) => `${pythonTag}-${abiTag}-${platformTag}`)))) });
}

export async function inspectPurePythonWheel(input, options = {}) {
  const bytes = acceptedBytes(input);
  const limits = acceptedLimits(options.limits);
  const archiveEntries = centralDirectory(bytes, limits);
  let unpacked;
  try { unpacked = await unzipWheel(bytes); }
  catch (error) { throw packageIntegrity(`Wheel decompression failed: ${error?.message || error}`); }
  const files = new Map(unpacked.map(([path, content]) => [path, acceptedBytes(content)]));
  const declaredFiles = archiveEntries.filter((entry) => !entry.directory);
  if (files.size !== declaredFiles.length) throw packageIntegrity("Wheel extracted file count differs from its directory");
  for (const entry of declaredFiles) {
    const content = files.get(entry.path);
    if (!content || content.byteLength !== entry.uncompressedBytes || crc32(content) !== entry.checksum) {
      throw packageIntegrity(`Wheel entry size or CRC-32 mismatch: ${entry.path}`);
    }
  }
  const metadataPaths = [...files.keys()].filter((path) => /\.dist-info\/METADATA$/u.test(path));
  const wheelPaths = [...files.keys()].filter((path) => /\.dist-info\/WHEEL$/u.test(path));
  const recordPaths = [...files.keys()].filter((path) => /\.dist-info\/RECORD$/u.test(path));
  if (metadataPaths.length !== 1 || wheelPaths.length !== 1 || recordPaths.length !== 1) {
    throw packageIntegrity("Wheel must contain exactly one METADATA, WHEEL, and RECORD file");
  }
  const distInfo = metadataPaths[0].slice(0, -"METADATA".length);
  if (!wheelPaths[0].startsWith(distInfo) || !recordPaths[0].startsWith(distInfo)) {
    throw packageIntegrity("Wheel metadata files do not share one dist-info directory");
  }
  const metadata = metadataHeaders(files.get(metadataPaths[0]), "Wheel METADATA");
  const wheel = metadataHeaders(files.get(wheelPaths[0]), "Wheel WHEEL");
  const name = metadata.get("name")?.[0];
  const version = metadata.get("version")?.[0];
  if (!name || !version || wheel.get("root-is-purelib")?.[0]?.toLowerCase() !== "true") {
    throw packageIntegrity("Wheel metadata does not declare a pure package name and version");
  }
  const filename = parseWheelFilename(options.filename || `${name}-${version}-py3-none-any.whl`);
  if (normalizePackageName(filename.distribution) !== normalizePackageName(name)
    || filename.version !== version
    || options.expectedName && normalizePackageName(options.expectedName) !== normalizePackageName(name)
    || options.expectedVersion && options.expectedVersion !== version) {
    throw packageIntegrity("Wheel filename and METADATA identity differ");
  }
  if (filename.abi.split(".").some((tag) => tag !== "none")
    || filename.platform.split(".").some((tag) => tag !== "any")) {
    throw new PyProcError("PYPROC_PACKAGE_ABI_UNSUPPORTED", `Wheel tag is not pure Python: ${options.filename}`);
  }
  const declaredTags = new Set(wheel.get("tag") || []);
  if (!filename.tags.some((tag) => declaredTags.has(tag))) throw packageIntegrity("Wheel filename tag is absent from WHEEL metadata");
  if (Array.isArray(options.allowedTags) && !filename.tags.some((tag) => options.allowedTags.includes(tag))) {
    throw new PyProcError("PYPROC_PACKAGE_ABI_UNSUPPORTED", `Wheel tags are not allowed by this environment: ${filename.tags.join(",")}`);
  }
  const record = new Map();
  for (const row of csvRows(files.get(recordPaths[0]))) {
    if (row.length !== 3 || record.has(row[0])) throw packageIntegrity("Wheel RECORD contains a malformed or duplicate row");
    record.set(row[0], { hash: row[1], size: row[2] });
  }
  for (const [path, content] of files) {
    if (/\.data\/scripts\//u.test(path)) {
      throw packageIntegrity(`Wheel executable scripts are outside the package environment contract: ${path}`);
    }
    const item = record.get(path);
    if (!item) throw packageIntegrity(`Wheel RECORD omits an installed file: ${path}`);
    if (path === recordPaths[0]) {
      if (item.hash || item.size) throw packageIntegrity("Wheel RECORD row for RECORD must omit hash and size");
      continue;
    }
    const hex = await sha256Hex(content);
    if (item.hash !== `sha256=${recordDigest(hex)}` || item.size !== String(content.byteLength)) {
      throw packageIntegrity(`Wheel RECORD hash or size mismatch: ${path}`);
    }
  }
  if (record.size !== files.size) throw packageIntegrity("Wheel RECORD names files absent from the archive");
  const wheelDigest = await sha256Address(bytes);
  if (options.expectedSha256 && parseSha256Address(options.expectedSha256) !== wheelDigest.slice(7)) {
    throw packageIntegrity("Wheel artifact hash differs from the locked hash");
  }
  const fileReceipts = [];
  const installedPaths = new Set();
  for (const [path, content] of [...files].sort(([left], [right]) => compareNames(left, right))) {
    if (/\.data\/platlib\//u.test(path)) {
      throw new PyProcError("PYPROC_PACKAGE_ABI_UNSUPPORTED",
        `Wheel platlib content is outside the pure Python engine profile: ${path}`);
    }
    const installedPath = /^[^/]+\.data\/purelib\/(.+)$/u.exec(path)?.[1] || path;
    const foldedInstalledPath = installedPath.toLocaleLowerCase("en-US");
    if (installedPaths.has(foldedInstalledPath)) {
      throw packageIntegrity(`Wheel contains colliding installed paths: ${installedPath}`);
    }
    installedPaths.add(foldedInstalledPath);
    fileReceipts.push(Object.freeze({ path, byteLength: content.byteLength, sha256: await sha256Address(content) }));
  }
  const treeDigest = await sha256Address(canonicalPackageJson(fileReceipts));
  return Object.freeze({ protocol: "pyproc.pure-wheel-tree", version: 1, name: normalizePackageName(name),
    displayName: name, packageVersion: version, filename: options.filename || `${name}-${version}-py3-none-any.whl`,
    wheelDigest, treeDigest,
    requiresPython: canonicalRequiresPython(metadata.get("requires-python")?.[0] || null),
    dependencies: Object.freeze([...(metadata.get("requires-dist") || [])]),
    files: Object.freeze([...files].sort(([left], [right]) => compareNames(left, right))
      .map(([path, content]) => Object.freeze([path, content.slice()]))),
    fileReceipts: Object.freeze(fileReceipts), unpackedBytes: fileReceipts.reduce((sum, file) => sum + file.byteLength, 0) });
}
