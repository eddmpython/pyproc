// downloadReceipt.mjs - contract of the download receipt: how a download's type is decided from its bytes and what the
// server declared, which file names may leave pyproc and how, the one interception a download may set, and how the
// manifest and the Machine Entrance carry the export root.
import { strict as assert } from "node:assert";
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bareMimeType,
  dataUrlMimeType,
  downloadMimeType,
  exportNameFrom,
  exportNameProblem,
  signatureMimeType,
} from "../../scripts/browserControl/downloadReceipt.js";
import { DOWNLOAD_RESPONSE_PATTERNS, exportDownload } from "../../scripts/browserControl/browserDownload.js";
import { BrowserControlPolicy } from "../../scripts/browserControl/browserControlPolicy.js";
import { validateBrowserAutomationActions } from "../../scripts/browserControl/browserAutomationCatalog.js";
import { validateMcpProductConfig } from "../../scripts/mcpProductConfig.mjs";
import { compileMachineProfile } from "../../scripts/machineEntrance/machineProfile.js";

function errorOf(operation) {
  try { operation(); return null; } catch (error) { return error; }
}

const hex = (text) => Buffer.from(text, "hex");
const zipWith = (names) => {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const name of names) {
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBytes, end]);
};
const storedMimetypeZip = (type) => {
  const name = Buffer.from("mimetype");
  const body = Buffer.from(type);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(name.length, 26);
  return Buffer.concat([local, name, body]);
};

export async function assertDownloadReceipt() {
  // Declared types: the bare type of a Content-Type, and a data: URL's own.
  assert.equal(bareMimeType("Text/CSV; charset=euc-kr"), "text/csv");
  assert.equal(bareMimeType("not a type"), "");
  assert.equal(dataUrlMimeType("data:text/csv,a%2Cb"), "text/csv");
  assert.equal(dataUrlMimeType("data:;base64,AAAA"), "text/plain");
  assert.equal(dataUrlMimeType("https://example.test/a.csv"), "");

  // Signatures name the type outright; containers say what they hold.
  const signed = {
    "89504e470d0a1a0a0000": "image/png", "ffd8ffe000": "image/jpeg", "474946383961": "image/gif",
    "255044462d312e37": "application/pdf", "1f8b0800": "application/gzip", "377abcaf271c": "application/x-7z-compressed",
    "52494646000000005745425056503820": "image/webp", "52494646000000005741564566": "audio/wav",
    "000000186674797069736f6d": "video/mp4", "00000018667479704d344120": "audio/mp4",
    "0000001c6674797068656963": "image/heic", "1a45dfa3a34286817765626d": "video/webm", "774f4632": "font/woff2",
    "53514c69746520666f726d6174203300": "application/vnd.sqlite3", "7b5c72746631": "application/rtf",
  };
  for (const [bytes, type] of Object.entries(signed)) assert.equal(signatureMimeType(hex(bytes)), type, bytes);
  assert.equal(signatureMimeType(hex("d0cf11e0a1b11ae1")), "cfb");
  assert.equal(signatureMimeType(Buffer.from("MZ not a program")), "", "MZ alone is not a program");
  assert.equal(signatureMimeType(Buffer.from("BM is text")), "", "BM alone is not a bitmap");
  assert.equal(signatureMimeType(zipWith(["[Content_Types].xml", "xl/workbook.xml"])),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.equal(signatureMimeType(zipWith(["[Content_Types].xml", "ppt/presentation.xml"])),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  assert.equal(signatureMimeType(zipWith(["META-INF/MANIFEST.MF"])), "application/java-archive");
  assert.equal(signatureMimeType(zipWith(["a.txt"])), "application/zip");
  assert.equal(signatureMimeType(storedMimetypeZip("application/hwp+zip")), "application/hwp+zip");
  assert.equal(signatureMimeType(storedMimetypeZip("application/epub+zip")), "application/epub+zip");

  // The decision: bytes first, the declared type beside it, never a contradicted declaration.
  const decide = (bytes, declared = "", fileName = "") => downloadMimeType({ bytes, declared, fileName });
  assert.deepEqual(decide(hex("89504e470d0a1a0a00"), "image/png"),
    { mimeType: "image/png", mimeEvidence: "signature", declaredMimeType: "image/png" });
  assert.deepEqual(decide(hex("89504e470d0a1a0a00"), "application/octet-stream"),
    { mimeType: "image/png", mimeEvidence: "signature", declaredMimeType: "application/octet-stream" });
  assert.deepEqual(decide(Buffer.from([0xb0, 0xa1, 0x2c, 0x31, 0x0a]), "text/csv; charset=euc-kr"),
    { mimeType: "text/csv", mimeEvidence: "text", declaredMimeType: "text/csv; charset=euc-kr" });
  assert.deepEqual(decide(Buffer.from("a,b\n"), "application/octet-stream", "rows.csv"),
    { mimeType: "text/csv", mimeEvidence: "text", declaredMimeType: "application/octet-stream" });
  assert.deepEqual(decide(Buffer.from("plain words"), "image/png"),
    { mimeType: "text/plain", mimeEvidence: "text", declaredMimeType: "image/png" });
  assert.deepEqual(decide(hex("0001020304"), "image/png"),
    { mimeType: "application/octet-stream", mimeEvidence: "none", declaredMimeType: "image/png" });
  assert.deepEqual(decide(hex("0001020304"), "text/csv"),
    { mimeType: "application/octet-stream", mimeEvidence: "none", declaredMimeType: "text/csv" });
  assert.deepEqual(decide(hex("0001020304"), "application/x-custom"),
    { mimeType: "application/x-custom", mimeEvidence: "declared", declaredMimeType: "application/x-custom" });
  assert.deepEqual(decide(hex("0001020304")), { mimeType: "application/octet-stream", mimeEvidence: "none" });
  assert.deepEqual(decide(Buffer.alloc(0), "text/csv"),
    { mimeType: "text/csv", mimeEvidence: "declared", declaredMimeType: "text/csv" });
  assert.deepEqual(decide(hex("fffe41004200"), "", "notes.txt"), { mimeType: "text/plain", mimeEvidence: "text" });
  assert.equal(decide(hex("d0cf11e0a1b11ae100"), "application/x-hwp").mimeType, "application/x-hwp");
  assert.equal(decide(hex("d0cf11e0a1b11ae100"), "", "report.xls").mimeType, "application/vnd.ms-excel");
  assert.equal(decide(hex("d0cf11e0a1b11ae100"), "image/png").mimeType, "application/x-ole-storage");
  assert.equal(decide(Buffer.from("OggS\0\0"), "audio/ogg").mimeType, "audio/ogg");
  assert.equal(decide(Buffer.from("OggS\0\0"), "image/png").mimeType, "application/ogg");
  assert.equal(decide(zipWith(["doc.kml"]), "application/vnd.google-earth.kmz").mimeType,
    "application/vnd.google-earth.kmz");
  assert.equal(decide(zipWith(["a.txt"]), "application/x-zip-compressed").mimeType, "application/zip");
  assert.equal(decide(zipWith(["a.txt"]), "application/pdf").mimeType, "application/zip");
  // A ZIP names only a format that is a ZIP inside: not a picture or a program a server calls it.
  for (const declared of ["image/jpg", "application/x-pdf", "font/ttf", "application/x-msdos-program", "text/html"]) {
    assert.deepEqual(decide(zipWith(["a.txt"]), declared), { mimeType: "application/zip", mimeEvidence: "signature",
      declaredMimeType: declared }, declared);
  }
  for (const entry of ["text/html", "image/png", "application/pdf"]) {
    assert.equal(signatureMimeType(storedMimetypeZip(entry)), "application/zip", `mimetype entry ${entry}`);
  }
  // A usual other name of a signed type is contradicted by bytes without its signature.
  for (const declared of ["image/jpg", "image/x-png", "application/x-pdf", "application/x-zip-compressed",
    "audio/x-wav", "application/x-msdownload"]) {
    assert.deepEqual(decide(hex("0001020304"), declared), { mimeType: "application/octet-stream", mimeEvidence: "none",
      declaredMimeType: declared }, declared);
  }
  assert.equal(decide(hex("ffd8ffe000"), "image/jpg").mimeType, "image/jpeg");
  // After a UTF-16 byte order mark the rest must be UTF-16 text.
  assert.equal(decide(hex("fffe41004200"), "text/csv").mimeType, "text/csv");
  assert.equal(decide(hex("fffe00d80102"), "text/csv").mimeType, "application/octet-stream");
  assert.equal(decide(hex("fffe01000200"), "text/csv").mimeType, "application/octet-stream");
  assert.equal(decide(hex("89504e470d0a1a0a"), "x".repeat(300) + "/y").declaredMimeType, undefined);

  // Names: a caller's must already be one plain file name; a server's is reduced to one.
  for (const name of ["", "..", ".", "../x.pdf", "a/b.pdf", "a\\b.pdf", "C:x.pdf", "a:stream", "x\u0001.pdf", "a\uD800.txt",
    "trailing.", "trailing ", " leading", "CON", "con.txt", "LPT1.log", "COM¹", "x".repeat(201)]) {
    assert.ok(exportNameProblem(name), `refused ${JSON.stringify(name)}`);
  }
  for (const name of ["report.pdf", "보고서 2026.xlsx", ".profile", "a..b.csv", "CONTOSO.txt"]) {
    assert.equal(exportNameProblem(name), "", `accepted ${JSON.stringify(name)}`);
  }
  assert.equal(exportNameFrom("../../evil.csv"), "evil.csv");
  assert.equal(exportNameFrom("C:\\Windows\\system.ini"), "system.ini");
  assert.equal(exportNameFrom("a:b?.txt"), "a_b_.txt");
  assert.equal(exportNameFrom("CON"), "_CON");
  assert.equal(exportNameFrom("..."), "download");
  assert.equal(exportNameFrom(""), "download");
  assert.equal(exportNameFrom(`${"x".repeat(300)}.pdf`).length, 200);
  assert.equal(exportNameFrom("b\uD800.txt"), "b\uFFFD.txt");
  assert.ok(exportNameFrom(`${"x".repeat(300)}.pdf`).endsWith(".pdf"));
  for (const suggested of ["../../evil.csv", "a:b?.txt", "CON", "...", `${"y".repeat(300)}.pdf`, " x. "]) {
    assert.equal(exportNameProblem(exportNameFrom(suggested)), "", `reduced ${JSON.stringify(suggested)}`);
  }

  // Writing: a new file directly in the root, never replacing one, through a linked root to its real folder.
  const work = await mkdtemp(join(tmpdir(), "pyproc-download-receipt-contract-"));
  try {
    const root = join(work, "exports");
    const first = await exportDownload(root, "report.pdf", Buffer.from("one"));
    const second = await exportDownload(root, "report.pdf", Buffer.from("two"));
    assert.equal(first.name, "report.pdf");
    assert.equal(second.name, "report (1).pdf");
    assert.equal(await readFile(join(root, "report.pdf"), "utf8"), "one");
    assert.equal(await readFile(join(root, "report (1).pdf"), "utf8"), "two");
    await assert.rejects(exportDownload(root, "../escape.pdf", Buffer.from("x")), /download file name/);
    assert.deepEqual((await readdir(work)).sort(), ["exports"]);
    let linked = null;
    try {
      await symlink(root, join(work, "linked"), "junction");
      linked = join(work, "linked");
    } catch { /* A host that cannot make a link skips this part. */ }
    if (linked) {
      const through = await exportDownload(linked, "via.txt", Buffer.from("via"));
      assert.equal(through.path, join(await (await import("node:fs/promises")).realpath(root), "via.txt"));
    }
    // A link that points nowhere holds its name: it is never followed, and nothing appears where it points.
    let dangling = null;
    try {
      await symlink(join(work, "outside", "planted"), join(root, "data.csv"), "junction");
      dangling = join(work, "outside", "planted");
    } catch { /* A host that cannot make a junction skips this part. */ }
    if (dangling) {
      const beside = await exportDownload(root, "data.csv", Buffer.from("rows"));
      assert.equal(beside.name, "data (1).csv");
      assert.equal(await readdir(join(work, "outside")).then(() => true, () => false), false,
        "the export created something where a dangling link points");
    }
    const marked = await exportDownload(root, "marked.txt", Buffer.from("m"), { sourceUrl: "https://a.example/x?token=1" });
    if (process.platform === "win32") {
      assert.equal(marked.markOfTheWeb, true);
      const zone = await readFile(`${marked.path}:Zone.Identifier`, "utf8");
      assert.match(zone, /ZoneId=3/);
      assert.match(zone, /HostUrl=https:\/\/a\.example\/x\r\n/);
      assert.equal(zone.includes("token"), false);
    } else {
      assert.equal(marked.markOfTheWeb, false);
    }
    await writeFile(join(root, "taken.txt"), "keep");
    for (let index = 1; index < 100; index += 1) await writeFile(join(root, `taken (${index}).txt`), "keep");
    await assert.rejects(exportDownload(root, "taken.txt", Buffer.from("x")), /already holds 100 files/);
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  // The one interception a download may set: document responses, paused at the response stage, nothing else.
  const policy = new BrowserControlPolicy({ targetOrigins: ["http://allowed.test"],
    methods: ["Fetch.enable", "Fetch.disable", "Fetch.continueRequest"], maxRisk: "externalEffect" });
  const target = { type: "page", url: "http://allowed.test/app" };
  assert.equal(policy.authorizeCommand(target, "Fetch.enable", { patterns: DOWNLOAD_RESPONSE_PATTERNS }), "externalEffect");
  for (const params of [{ patterns: [{ urlPattern: "*" }] }, { patterns: DOWNLOAD_RESPONSE_PATTERNS, handleAuthRequests: true },
    { patterns: [{ urlPattern: "*", requestStage: "Request" }] }, {}]) {
    assert.match(String(errorOf(() => policy.authorizeCommand(target, "Fetch.enable", params))?.message),
      /outside permission/, JSON.stringify(params));
  }
  assert.equal(policy.authorizeCommand(target, "Fetch.disable", {}), "externalEffect");
  // Letting go of interception is judged by method and parameters only, never by the surface.
  assert.equal(policy.authorizeRelease("Fetch.continueRequest", { requestId: "r" }), "externalEffect");
  assert.match(String(errorOf(() => policy.authorizeRelease("Fetch.continueRequest", { requestId: "r",
    url: "http://denied.test/" }))?.message), /outside permission/);
  assert.match(String(errorOf(() => new BrowserControlPolicy({ targetOrigins: ["http://allowed.test"], methods: [],
    maxRisk: "externalEffect" }).authorizeRelease("Fetch.disable", {}))?.message), /outside permission/);

  // The action: saveAs only with a declared download, and only a plain file name.
  const click = (extra) => ({ kind: "click", selector: "#a", expectedRisk: "externalEffect", ...extra });
  assert.equal(validateBrowserAutomationActions([click({ download: true, saveAs: "보고서.pdf" })])[0].saveAs, "보고서.pdf");
  assert.match(String(errorOf(() => validateBrowserAutomationActions([click({ saveAs: "a.pdf" })]))?.message),
    /needs download: true/);
  assert.match(String(errorOf(() => validateBrowserAutomationActions([click({ download: true, saveAs: "../a.pdf" })]))
    ?.message), /click.saveAs must be one file name/);

  // The manifest: an absolute folder, only for a provider that downloads, carried to the host by name.
  const base = { schemaVersion: 1, engine: { enabled: false }, browser: { enabled: true,
    allowedOrigins: ["https://work.example"], maxRisk: "externalEffect", externalEffects: "acknowledged",
    purpose: "download", actions: ["click"] } };
  const withBrowser = (browser) => ({ ...base, browser: { ...base.browser, ...browser } });
  const folder = join(tmpdir(), "pyproc-exports");
  const exported = validateMcpProductConfig(withBrowser({ exportRoot: folder }));
  assert.equal(exported.env.PYPROC_BROWSER_EXPORT_ROOT, folder);
  assert.equal(exported.browserControl.exportRoot, folder);
  assert.equal(validateMcpProductConfig(base).env.PYPROC_BROWSER_EXPORT_ROOT, undefined);
  assert.equal(validateMcpProductConfig(base, { baseEnv: { PYPROC_BROWSER_EXPORT_ROOT: folder } })
    .env.PYPROC_BROWSER_EXPORT_ROOT, undefined, "the environment never names the export root");
  assert.match(String(errorOf(() => validateMcpProductConfig(withBrowser({ exportRoot: "relative" })))?.message),
    /absolute folder/);
  assert.match(String(errorOf(() => validateMcpProductConfig(withBrowser({ exportRoot: 7 })))?.message), /absolute folder/);

  // The Machine Entrance: authorizedBrowser carries it; observeLocal, which never downloads, refuses it.
  const engineRoot = await mkdtemp(join(tmpdir(), "pyproc-download-receipt-engine-"));
  try {
    for (const file of ["python.wasm", "python314-stdlib.zip"]) await writeFile(join(engineRoot, file), "fixture");
    await writeFile(join(engineRoot, "engine-build-manifest.json"), "{}");
    const recipe = { engineRoot, allowedOrigins: ["https://work.example"], externalEffects: "acknowledged",
      exportRoot: folder };
    const profile = compileMachineProfile({ ...recipe, recipe: "authorizedBrowser", actions: ["click"],
      maxRisk: "externalEffect", purpose: "download" }, { baseEnv: {} });
    assert.equal(profile.browser.exportRoot, folder);
    assert.match(String(errorOf(() => compileMachineProfile({ ...recipe, recipe: "observeLocal", purpose: "look" },
      { baseEnv: {} }))?.message), /observeLocal does not accept exportRoot/);
  } finally {
    await rm(engineRoot, { recursive: true, force: true });
  }
}
