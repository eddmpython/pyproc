// downloadReceipt.js - what a downloaded file really is, and where it may be written.
//
// A download's type is decided from its bytes first. A known byte signature (PNG, PDF, ZIP-based Office, ...) names the
// type outright; text bytes take the type the server declared when it declared a text type, else the one the file
// name's extension names; bytes that neither prove nor contradict a declared type keep it. A declared type the bytes
// contradict (an `image/png` that is not a PNG, a text type on binary bytes) is never reported as the type: the file
// is `application/octet-stream` and the receipt keeps what the server said beside it.
//
// A file leaves pyproc only into the export root the manifest gave, under one file name: a caller's name must already
// be a plain file name (no folder, no `..`, no drive or stream, no reserved device name), and a server's suggested name
// is reduced to one. These are pure decisions; `browserDownload.js` writes the file.
import { extname, posix } from "node:path";

export const DOWNLOAD_MIME_EVIDENCE = Object.freeze(["signature", "text", "declared", "none"]);
export const DOWNLOAD_FILE_NAME_MAX = 200;
const OCTET_STREAM = "application/octet-stream";
const SAMPLE_BYTES = 8192;

const ascii = (text) => Buffer.from(text, "latin1");
const startsWith = (bytes, prefix, offset = 0) => bytes.length >= offset + prefix.length
  && bytes.subarray(offset, offset + prefix.length).equals(prefix);

// Types whose bytes always start with a signature below; one of them declared on bytes without it is contradicted.
const SIGNED_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/x-icon", "image/vnd.microsoft.icon",
  "image/tiff", "image/heic", "image/avif", "application/pdf", "application/zip", "application/gzip",
  "application/x-gzip", "application/x-7z-compressed", "application/vnd.rar", "application/x-rar-compressed",
  "application/vnd.sqlite3", "audio/wav", "audio/x-wav", "audio/flac", "audio/mpeg", "audio/ogg", "video/ogg",
  "application/ogg", "video/mp4", "audio/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/x-msvideo",
  "font/woff", "font/woff2", "font/otf", "application/rtf", "application/vnd.microsoft.portable-executable",
  "application/x-msdownload",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

// Compound File Binary (legacy Office, HWP 5, MSI, Outlook messages): the signature proves the container only, so a
// declared or named type of this family is taken, else the container itself.
const CFB_TYPES = new Set(["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
  "application/x-hwp", "application/haansofthwp", "application/vnd.hancom.hwp", "application/x-msi",
  "application/vnd.ms-outlook", "application/x-ole-storage"]);
const CFB = "application/x-ole-storage";
// Other containers whose signature names the container, not what it holds: a declared type of the same family is
// taken (an Ogg file declared `audio/ogg`), and a ZIP takes any declared type no signature names (a `.kmz`, say).
const CONTAINER_FAMILIES = Object.freeze({
  "application/zip": new Set(),
  "application/ogg": new Set(["audio/ogg", "video/ogg", "audio/opus"]),
  "video/webm": new Set(["audio/webm"]),
  "video/x-matroska": new Set(["audio/x-matroska"]),
});

const EXTENSION_TYPES = Object.freeze({
  ".csv": "text/csv", ".tsv": "text/tab-separated-values", ".txt": "text/plain", ".log": "text/plain",
  ".json": "application/json", ".ndjson": "application/x-ndjson", ".jsonl": "application/x-ndjson",
  ".xml": "application/xml", ".html": "text/html", ".htm": "text/html", ".md": "text/markdown",
  ".yaml": "application/yaml", ".yml": "application/yaml", ".ics": "text/calendar", ".svg": "image/svg+xml",
  ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".sql": "application/sql",
  ".eml": "message/rfc822", ".vtt": "text/vtt", ".srt": "application/x-subrip",
  ".doc": "application/msword", ".xls": "application/vnd.ms-excel", ".ppt": "application/vnd.ms-powerpoint",
  ".hwp": "application/x-hwp", ".msi": "application/x-msi", ".msg": "application/vnd.ms-outlook",
});

// The bare type of a Content-Type value (`text/csv; charset=euc-kr` is `text/csv`), or "" when it names none (each
// part at most 127 characters, RFC 6838).
export function bareMimeType(value) {
  const type = String(value || "").split(";")[0].trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/.test(type) ? type : "";
}

// The type a `data:` URL carries in itself (its text is the file), or "" for any other URL.
export function dataUrlMimeType(url) {
  const match = /^data:([^,]*),/i.exec(String(url || ""));
  if (!match) return "";
  return bareMimeType(match[1].split(";")[0]) || "text/plain";
}

function isTextType(type) {
  return type.startsWith("text/") || type === "application/json" || type.endsWith("+json")
    || type === "application/xml" || type.endsWith("+xml") || type === "application/javascript"
    || type === "application/ecmascript" || type === "application/x-ndjson" || type === "application/yaml"
    || type === "application/x-yaml" || type === "application/sql" || type === "application/x-subrip"
    || type === "application/csv" || type === "message/rfc822";
}

// Text is bytes without NUL or the control characters text never holds (tab, line breaks, form feed, and escape
// are text); legacy encodings such as EUC-KR are text too. A UTF-16 byte order mark marks UTF-16 text.
function isText(bytes) {
  if (startsWith(bytes, Buffer.from([0xff, 0xfe])) || startsWith(bytes, Buffer.from([0xfe, 0xff]))) return true;
  const sample = bytes.subarray(0, SAMPLE_BYTES);
  for (const byte of sample) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0b && byte !== 0x0c && byte !== 0x0d
      && byte !== 0x1b) return false;
    if (byte === 0x7f) return false;
  }
  return true;
}

// The names inside a ZIP, from its central directory (the end of the file names every entry, whatever its local
// headers left out).
function zipEntryNames(bytes) {
  const end = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const from = Math.max(0, bytes.length - 0xffff - 22);
  const at = bytes.lastIndexOf(end);
  if (at < from || at + 22 > bytes.length) return null;
  const count = bytes.readUInt16LE(at + 10);
  let offset = bytes.readUInt32LE(at + 16);
  const names = [];
  for (let index = 0; index < count && index < 4096; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) return null;
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    if (offset + 46 + nameLength > bytes.length) return null;
    names.push(bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

// A ZIP that says what it is: an OpenDocument, EPUB, or HWPX stores its type as a first `mimetype` entry; Office Open
// XML, Java, and Android packages are known by their entries.
function zipType(bytes) {
  if (bytes.length >= 30 && bytes.readUInt16LE(8) === 0) {
    const nameLength = bytes.readUInt16LE(26);
    const extraLength = bytes.readUInt16LE(28);
    const size = bytes.readUInt32LE(18);
    const start = 30 + nameLength + extraLength;
    if (bytes.subarray(30, 30 + nameLength).toString("latin1") === "mimetype" && size > 0 && size < 100
      && start + size <= bytes.length) {
      const declared = bareMimeType(bytes.subarray(start, start + size).toString("latin1"));
      if (declared) return declared;
    }
  }
  const names = zipEntryNames(bytes);
  if (!names) return "application/zip";
  const has = (prefix) => names.some((name) => name.startsWith(prefix));
  if (names.includes("[Content_Types].xml")) {
    if (has("word/")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (has("xl/")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (has("ppt/")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  }
  if (names.includes("AndroidManifest.xml") && names.includes("classes.dex")) {
    return "application/vnd.android.package-archive";
  }
  if (names.includes("META-INF/MANIFEST.MF")) return "application/java-archive";
  return "application/zip";
}

function isoMediaType(bytes) {
  const brand = bytes.subarray(8, 12).toString("latin1");
  if (brand === "M4A " || brand === "M4B ") return "audio/mp4";
  if (brand === "qt  ") return "video/quicktime";
  if (brand === "avif" || brand === "avis") return "image/avif";
  if (["heic", "heix", "heim", "heis", "mif1", "msf1"].includes(brand)) return "image/heic";
  return "video/mp4";
}

function portableExecutable(bytes) {
  if (bytes.length < 0x40) return false;
  const header = bytes.readUInt32LE(0x3c);
  return header + 4 <= bytes.length && startsWith(bytes, ascii("PE\0\0"), header);
}

// The type the bytes prove by their signature, "cfb" for a Compound File container, or "".
export function signatureMimeType(bytes) {
  if (startsWith(bytes, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (startsWith(bytes, Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) return "image/gif";
  if (startsWith(bytes, ascii("RIFF")) && bytes.length >= 12) {
    const form = bytes.subarray(8, 12).toString("latin1");
    if (form === "WEBP") return "image/webp";
    if (form === "WAVE") return "audio/wav";
    if (form === "AVI ") return "video/x-msvideo";
  }
  if (startsWith(bytes, ascii("BM")) && bytes.length >= 18 && [12, 40, 52, 56, 108, 124].includes(bytes.readUInt32LE(14))) {
    return "image/bmp";
  }
  if (startsWith(bytes, Buffer.from([0x00, 0x00, 0x01, 0x00])) && bytes.length >= 6 && bytes.readUInt16LE(4) > 0) {
    return "image/x-icon";
  }
  if (startsWith(bytes, ascii("II*\0")) || startsWith(bytes, ascii("MM\0*"))) return "image/tiff";
  if (startsWith(bytes, ascii("%PDF-"))) return "application/pdf";
  if (startsWith(bytes, ascii("PK\x03\x04"))) return zipType(bytes);
  if (startsWith(bytes, ascii("PK\x05\x06"))) return "application/zip";
  if (startsWith(bytes, Buffer.from([0x1f, 0x8b]))) return "application/gzip";
  if (startsWith(bytes, Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return "application/x-7z-compressed";
  if (startsWith(bytes, ascii("Rar!\x1a\x07"))) return "application/vnd.rar";
  if (startsWith(bytes, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return "cfb";
  if (startsWith(bytes, ascii("MZ")) && portableExecutable(bytes)) return "application/vnd.microsoft.portable-executable";
  if (startsWith(bytes, ascii("\x7fELF"))) return "application/x-elf";
  if (startsWith(bytes, ascii("SQLite format 3\0"))) return "application/vnd.sqlite3";
  if (startsWith(bytes, ascii("ID3")) || startsWith(bytes, Buffer.from([0xff, 0xfb]))) return "audio/mpeg";
  if (startsWith(bytes, ascii("OggS"))) return "application/ogg";
  if (startsWith(bytes, ascii("fLaC"))) return "audio/flac";
  if (startsWith(bytes, ascii("ftyp"), 4) && bytes.length >= 12) return isoMediaType(bytes);
  if (startsWith(bytes, Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return bytes.subarray(0, 64).includes(ascii("webm")) ? "video/webm" : "video/x-matroska";
  }
  if (startsWith(bytes, ascii("wOFF"))) return "font/woff";
  if (startsWith(bytes, ascii("wOF2"))) return "font/woff2";
  if (startsWith(bytes, ascii("OTTO"))) return "font/otf";
  if (startsWith(bytes, ascii("{\\rtf"))) return "application/rtf";
  return "";
}

// The type of a download's bytes, what the server declared (its Content-Type, with any charset), and how the type was
// decided: `signature` (the bytes prove it), `text` (text bytes, typed by the declared type or the name), `declared`
// (the bytes neither prove nor contradict it), or `none` (`application/octet-stream`).
export function downloadMimeType({ bytes, declared = "", fileName = "" }) {
  const declaredType = bareMimeType(declared);
  const named = EXTENSION_TYPES[extname(String(fileName || "")).toLowerCase()] || "";
  const result = (mimeType, mimeEvidence) => Object.freeze({ mimeType, mimeEvidence,
    ...(declaredType ? { declaredMimeType: String(declared).trim().slice(0, 200) } : {}) });
  const signed = signatureMimeType(bytes);
  if (signed === "cfb") {
    if (CFB_TYPES.has(declaredType)) return result(declaredType, "signature");
    return result(CFB_TYPES.has(named) ? named : CFB, "signature");
  }
  if (Object.hasOwn(CONTAINER_FAMILIES, signed)) {
    const refines = CONTAINER_FAMILIES[signed].has(declaredType) || (signed === "application/zip" && !!declaredType
      && declaredType !== OCTET_STREAM && !SIGNED_TYPES.has(declaredType) && !isTextType(declaredType)
      && !CFB_TYPES.has(declaredType) && !/zip-compressed$/.test(declaredType));
    return result(refines ? declaredType : signed, "signature");
  }
  if (signed) return result(signed, "signature");
  if (bytes.length === 0) {
    return declaredType && declaredType !== OCTET_STREAM ? result(declaredType, "declared") : result(OCTET_STREAM, "none");
  }
  if (isText(bytes)) {
    if (declaredType && isTextType(declaredType)) return result(declaredType, "text");
    if (named && isTextType(named)) return result(named, "text");
    return result("text/plain", "text");
  }
  if (!declaredType || declaredType === OCTET_STREAM || SIGNED_TYPES.has(declaredType) || isTextType(declaredType)
    || CFB_TYPES.has(declaredType)) return result(OCTET_STREAM, "none");
  return result(declaredType, "declared");
}

const RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i;
// Characters no file name may hold on Windows (and `/` anywhere): folder separators, a drive or stream `:`, wildcards,
// quotes, and control characters.
const FORBIDDEN_NAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f\u007f]/;

// Why a caller's file name is refused, or "" when it is one plain file name the export root can hold.
export function exportNameProblem(name) {
  if (typeof name !== "string" || !name) return "must be a non-empty string";
  if (name.length > DOWNLOAD_FILE_NAME_MAX) return `must be at most ${DOWNLOAD_FILE_NAME_MAX} characters`;
  if (name === "." || name === "..") return "must name a file, not a folder";
  if (FORBIDDEN_NAME_CHARACTERS.test(name)) return "must be one file name, without a folder, drive, stream, or control character";
  if (/[. ]$/.test(name) || /^ /.test(name)) return "must not start with a space or end with a dot or space";
  if (RESERVED_NAME.test(name)) return "must not be a reserved device name";
  return "";
}

// A server's suggested name reduced to one file name the export root can hold.
export function exportNameFrom(suggested) {
  // Folders of either kind are dropped first; a drive letter is not a folder here, so its `:` is replaced below.
  let name = posix.basename(String(suggested || "").replace(/\\/g, "/"))
    .replace(new RegExp(FORBIDDEN_NAME_CHARACTERS.source, "g"), "_")
    .replace(/^ +/, "").replace(/[. ]+$/, "");
  if (!name || name === "." || name === "..") name = "download";
  if (RESERVED_NAME.test(name)) name = `_${name}`;
  if (name.length > DOWNLOAD_FILE_NAME_MAX) {
    const extension = extname(name).slice(0, 20);
    name = `${name.slice(0, DOWNLOAD_FILE_NAME_MAX - extension.length)}${extension}`.replace(/[. ]+$/, "");
  }
  return name || "download";
}
