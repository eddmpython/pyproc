// downloadReceiptProduct.mjs - the download receipt through the public Control client, on a real browser. A declared
// click download reports the type its bytes prove (PNG, PDF, an Office Open XML file served as octet-stream), the
// server's declared type beside it (with its charset, after a redirect, or a `data:` URL's own), text typed by the
// declared type or the name when the server lies, and, with an export root, the file written inside that root under
// the caller's name or the next free one. A name that leaves the root is refused before the click; `saveAs` without an
// export root is refused; a read-only session still reads the declared type; and no interception outlives a download.
// A page that moves on to another page before its download starts, or holds a frame that keeps reloading, stays usable
// after the download. A blob download is not given another response's type; a fragment does not hide the download's
// own; a ZIP a server calls a picture is a ZIP; an empty file is a receipt too; a link that points nowhere in the export
// root is never followed; and on Windows the exported file carries the mark of a file from the internet. A frame that
// loads the same URL as another type does not speak for the download, and a permission narrowed while a download
// runs leaves the tab usable.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { ROOT } from "../packageHarness.mjs";
import { PyProcControlClient } from "../../scripts/controlProtocol/controlApi.js";

const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 120000);
const executable = process.env.PYPROC_BROWSER || undefined;
let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) { passed += 1; console.log(`  PASS ${name}${detail ? ` (${detail})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`); }
}

// A ZIP of stored entries, enough for an Office Open XML word document.
function storedZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201"
  + "c6f7b8b40000000049454e44ae426082", "hex");
const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n", "latin1");
const docx = storedZip([
  ["[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'],
  ["word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'],
]);
const eucKr = Buffer.from([0xb0, 0xa1, 0xb3, 0xaa, 0x2c, 0x31, 0x0a]);
const files = {
  "/png": { type: "image/png", disposition: "attachment; filename=pixel.png", body: png },
  "/pdf": { type: "application/pdf", disposition: "attachment; filename=report.pdf", body: pdf },
  "/docx": { type: "application/octet-stream", disposition: "attachment; filename=letter.docx", body: docx },
  "/lie": { type: "image/png", disposition: "attachment; filename=rows.csv", body: Buffer.from("name,count\nalpha,1\n") },
  "/euckr": { type: "text/csv; charset=euc-kr", disposition: "attachment; filename=korean.csv", body: eucKr },
  "/zipjpg": { type: "image/jpg", disposition: "attachment; filename=photo.jpg", body: storedZip([["a.txt", "x"]]) },
  "/empty": { type: "text/csv", disposition: "attachment; filename=empty.csv", body: Buffer.alloc(0) },
  "/csv": { type: "text/csv", disposition: "attachment; filename=report.csv", body: Buffer.from("a,b\n1,2\n") },
  "/linked": { type: "text/csv", disposition: "attachment; filename=linked.csv", body: Buffer.from("x,y\n") },
};
let ticks = 0;
const links = ["png", "pdf", "docx", "lie", "euckr", "zipjpg", "empty", "inter", "linked"]
  .map((name) => `<a id="${name}" href="/${name}">${name}</a>`).join("")
  + '<a id="redirect" href="/redirect" download>redirect</a>'
  + '<a id="inline" href="data:text/csv,a%2Cb%0A" download="inline.csv">inline</a>'
  + '<a id="slowlink" href="/slow">slow</a><a id="fragment" href="/euckr#part">fragment</a><a id="blob" download="note.txt">blob</a><iframe name="side"></iframe>'
  + '<script>const blob = document.getElementById("blob");'
  + 'blob.href = URL.createObjectURL(new Blob(["plain note"], { type: "text/plain" }));'
  + 'blob.addEventListener("click", () => { frames.side.location = "/ping"; });</script>';
const server = createServer((req, res) => {
  const file = files[req.url];
  if (file) {
    res.writeHead(200, { "Content-Type": file.type, "Content-Disposition": file.disposition, "Cache-Control": "no-store" });
    res.end(file.body);
    return;
  }
  if (req.url === "/redirect") { res.writeHead(302, { Location: "/png" }); res.end(); return; }
  if (req.url === "/second") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end("<!doctype html><title>second</title><p>second</p>");
    return;
  }
  if (req.url === "/ping") { res.writeHead(204, { "Content-Type": "text/html; charset=utf-8" }); res.end(); return; }
  if (req.url === "/inter") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end('<!doctype html><title>starting</title><p>Your download starts</p><script>setTimeout(() => { location.href = "/csv"; }, 300);</script>');
    return;
  }
  if (req.url === "/tick") {
    ticks += 1;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end("<!doctype html><p>tick</p><script>setTimeout(() => location.reload(), 200);</script>");
    return;
  }
  if (req.url === "/slow") {
    res.writeHead(200, { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=slow.csv",
      "Cache-Control": "no-store" });
    res.write("a,b\n");
    setTimeout(() => res.end("1,2\n"), 1500);
    return;
  }
  if (req.url === "/dual") {
    if (req.headers["sec-fetch-dest"] === "iframe") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end("<!doctype html><p>frame</p>");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=dual.csv",
      "Cache-Control": "no-store" });
    res.write("a,b\n");
    setTimeout(() => res.end("1,2\n"), 1500);
    return;
  }
  if (req.url === "/dualpage") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end('<!doctype html><title>dual</title><a id="dual" href="/dual">dual</a><script>'
      + 'document.getElementById("dual").addEventListener("click", () => setTimeout(() => {'
      + 'const frame = document.createElement("iframe"); frame.src = "/dual"; document.body.append(frame); }, 400));'
      + "</script>");
    return;
  }
  if (req.url === "/frames") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end('<!doctype html><title>frames</title><iframe src="/tick"></iframe><a id="slow" href="/slow">slow</a>');
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html><title>downloads</title><main>${links}</main>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const work = await mkdtemp(join(tmpdir(), "pyproc-download-receipt-"));
const exportRoot = join(work, "exports");
await mkdir(exportRoot, { recursive: true });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function startHost(name, browser) {
  const configPath = join(work, `${name}.json`);
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, engine: { enabled: false }, timeoutMs: TIMEOUT_MS,
    browser: { enabled: true, allowedOrigins: [origin], maxRisk: "externalEffect", externalEffects: "acknowledged",
      actions: ["snapshot", "click"], methods: [], purpose: "Verify the download receipt", artifacts: {},
      ...(executable ? { executable } : {}), ...browser } }, null, 2));
  const client = await PyProcControlClient.start(configPath, { command: [process.execPath, join(ROOT, "scripts",
    "pyprocControl.mjs")], cwd: ROOT, startupTimeoutMs: TIMEOUT_MS, shutdownTimeoutMs: 10000 });
  const target = (await client.openTarget(`${origin}/`, { expectedRisk: "externalEffect", waitUntil: "load" })).output;
  const session = (await client.attachSession(target.targetRef)).output;
  const download = async (selector, extra = {}) => {
    try {
      const result = await client.act(session, [{ kind: "click", selector, download: true, timeoutMs: 15000,
        expectedRisk: "externalEffect", ...extra }]);
      return { receipt: result.output.actions[0].result.download };
    } catch (error) {
      return { error };
    }
  };
  return { client, session, download };
}

const clients = [];
try {
  const exporting = await startHost("exporting", { exportRoot });
  clients.push(exporting.client);
  const realRoot = async () => realpath(exportRoot);

  const pixel = await exporting.download("#png");
  const pixelFile = pixel.receipt?.exportedFile;
  check("a PNG is typed by its signature beside the declared type",
    pixel.receipt?.mimeType === "image/png" && pixel.receipt.mimeEvidence === "signature"
      && pixel.receipt.declaredMimeType === "image/png" && pixel.receipt.sha256 === sha256(png),
    JSON.stringify(pixel.receipt || pixel.error?.message));
  check("a PNG is written inside the export root under the server's name",
    pixelFile?.name === "pixel.png" && pixelFile.path === join(await realRoot(), "pixel.png")
      && sha256(await readFile(pixelFile.path)) === sha256(png), JSON.stringify(pixelFile));

  const report = await exporting.download("#pdf", { saveAs: "보고서.pdf" });
  const again = await exporting.download("#pdf", { saveAs: "보고서.pdf" });
  check("a PDF is typed by its signature and saved under the caller's name",
    report.receipt?.mimeType === "application/pdf" && report.receipt.mimeEvidence === "signature"
      && report.receipt.exportedFile?.path === join(await realRoot(), "보고서.pdf")
      && sha256(await readFile(join(exportRoot, "보고서.pdf"))) === sha256(pdf),
    JSON.stringify(report.receipt?.exportedFile || report.error?.message));
  check("a taken name is never replaced; the next free name is used",
    again.receipt?.exportedFile?.name === "보고서 (1).pdf"
      && sha256(await readFile(join(exportRoot, "보고서 (1).pdf"))) === sha256(pdf),
    JSON.stringify(again.receipt?.exportedFile || again.error?.message));

  const letter = await exporting.download("#docx");
  check("an Office Open XML document served as octet-stream is typed by its entries",
    letter.receipt?.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      && letter.receipt.mimeEvidence === "signature" && letter.receipt.declaredMimeType === "application/octet-stream",
    JSON.stringify(letter.receipt || letter.error?.message));

  const lie = await exporting.download("#lie");
  check("text the server calls image/png is typed by its name, and the lie stays beside it",
    lie.receipt?.mimeType === "text/csv" && lie.receipt.mimeEvidence === "text"
      && lie.receipt.declaredMimeType === "image/png", JSON.stringify(lie.receipt || lie.error?.message));

  const korean = await exporting.download("#euckr");
  check("an EUC-KR CSV keeps the declared type and its charset",
    korean.receipt?.mimeType === "text/csv" && korean.receipt.mimeEvidence === "text"
      && korean.receipt.declaredMimeType === "text/csv; charset=euc-kr"
      && Buffer.compare(await readFile(korean.receipt.exportedFile.path), eucKr) === 0,
    JSON.stringify(korean.receipt || korean.error?.message));

  const redirected = await exporting.download("#redirect");
  check("after a redirect the declared type is the final response's",
    redirected.receipt?.mimeType === "image/png" && redirected.receipt.declaredMimeType === "image/png",
    JSON.stringify(redirected.receipt || redirected.error?.message));

  const inline = await exporting.download("#inline");
  check("a data: URL declares its own type",
    inline.receipt?.mimeType === "text/csv" && inline.receipt.declaredMimeType === "text/csv"
      && inline.receipt.exportedFile?.name === "inline.csv", JSON.stringify(inline.receipt || inline.error?.message));

  const zipped = await exporting.download("#zipjpg");
  check("a ZIP a server calls a JPEG picture is a ZIP", zipped.receipt?.mimeType === "application/zip"
    && zipped.receipt.declaredMimeType === "image/jpg", JSON.stringify(zipped.receipt || zipped.error?.message));

  const empty = await exporting.download("#empty");
  check("an empty file is a receipt and an exported file too", empty.receipt?.byteLength === 0
    && (await readFile(empty.receipt.exportedFile.path)).length === 0, JSON.stringify(empty.receipt || empty.error?.message));

  const fragment = await exporting.download("#fragment");
  check("a fragment in the link does not hide the download's own declared type",
    fragment.receipt?.declaredMimeType === "text/csv; charset=euc-kr", JSON.stringify(fragment.receipt || fragment.error?.message));

  const blobbed = await exporting.download("#blob");
  check("a blob download is never given another response's type", blobbed.receipt?.mimeType === "text/plain"
    && blobbed.receipt.declaredMimeType === undefined, JSON.stringify(blobbed.receipt || blobbed.error?.message));

  if (process.platform === "win32") {
    const zone = await readFile(`${pixelFile.path}:Zone.Identifier`, "utf8").catch(() => "");
    check("the exported file carries the mark of a file from the internet", pixelFile.markOfTheWeb === true
      && /ZoneId=3/.test(zone) && zone.includes(`HostUrl=${origin}/png`), zone.replace(/\r\n/g, " "));
    let planted = null;
    try {
      await symlink(join(work, "outside", "planted"), join(exportRoot, "linked.csv"), "junction");
      planted = join(work, "outside");
    } catch { /* A host that cannot make a junction skips this check. */ }
    if (planted) {
      const linked = await exporting.download("#linked");
      const outsideMade = await readdir(planted).then(() => true, () => false);
      check("a link that points nowhere in the export root is never followed", linked.receipt?.exportedFile?.name
        === "linked (1).csv" && !outsideMade, JSON.stringify({ file: linked.receipt?.exportedFile, outsideMade,
        error: linked.error?.message }));
    }
  }

  // A page that moves on before its download starts: the download is received and the page stays usable.
  const interTarget = (await exporting.client.openTarget(`${origin}/`, { expectedRisk: "externalEffect",
    waitUntil: "load" })).output;
  const interSession = (await exporting.client.attachSession(interTarget.targetRef)).output;
  let moved;
  try {
    moved = { receipt: (await exporting.client.act(interSession, [{ kind: "click", selector: "#inter", download: true,
      timeoutMs: 15000, expectedRisk: "externalEffect" }])).output.actions[0].result.download };
  } catch (error) {
    moved = { error };
  }
  const usable = await Promise.race([exporting.client.observe(interSession, { expectedRisk: "read" })
    .then(() => true, () => false), new Promise((resolve) => setTimeout(() => resolve(false), 10000))]);
  check("a page that moves on to another page before its download starts stays usable", moved.receipt?.mimeType
    === "text/csv" && moved.receipt.declaredMimeType === "text/csv" && usable,
  JSON.stringify({ receipt: moved.receipt && { mimeType: moved.receipt.mimeType, declared: moved.receipt.declaredMimeType },
    usable, error: moved.error?.message }));

  const before = (await readdir(exportRoot)).sort();
  const outside = [];
  for (const saveAs of ["../escape.pdf", "..", "sub/escape.pdf", "a:b.pdf", "CON.pdf", "trailing. ", "a\uD800.txt"]) {
    const refused = await exporting.download("#pdf", { saveAs });
    outside.push(`${saveAs}=${refused.error?.code || "accepted"}/${refused.error?.outcome || ""}`);
    check(`saveAs ${JSON.stringify(saveAs)} is refused before the click`,
      !!refused.error && refused.error.outcome === "notSent" && !refused.receipt, outside.at(-1));
  }
  check("nothing was written outside or inside the export root by a refused name",
    JSON.stringify((await readdir(exportRoot)).sort()) === JSON.stringify(before)
      && !(await readdir(work)).includes("escape.pdf"), JSON.stringify(outside));

  const snapshot = await exporting.client.observe(exporting.session, { expectedRisk: "read" }).then(() => true, () => false);
  const inspected = (await exporting.client.inspectSpace()).output;
  check("no interception or listener outlives the downloads", snapshot && inspected.resources?.lifecycleListeners === 0
    && inspected.automation?.download?.exported >= 12,
  JSON.stringify({ lifecycle: inspected.automation?.lifecycle, download: inspected.automation?.download }));

  // A page with a frame that keeps reloading: the download is received and the frame goes on reloading.
  const framesTarget = (await exporting.client.openTarget(`${origin}/frames`, { expectedRisk: "externalEffect",
    waitUntil: "load" })).output;
  const framesSession = (await exporting.client.attachSession(framesTarget.targetRef)).output;
  const ticksBefore = ticks;
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const reloadsBefore = ticks - ticksBefore;
  let slow;
  try {
    slow = (await exporting.client.act(framesSession, [{ kind: "click", selector: "#slow", download: true,
      timeoutMs: 15000, expectedRisk: "externalEffect" }])).output.actions[0].result.download;
  } catch (error) {
    slow = { error: error?.message };
  }
  const ticksAfter = ticks;
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const reloadsAfter = ticks - ticksAfter;
  check("a page whose frame keeps reloading receives its download and the frame goes on reloading",
    slow?.mimeType === "text/csv" && reloadsBefore > 3 && reloadsAfter > 3,
    JSON.stringify({ slow: slow?.mimeType || slow, reloadsBefore, reloadsAfter }));

  // A frame that loads the download's URL as a page does not speak for the download's own type.
  const dualTarget = (await exporting.client.openTarget(`${origin}/dualpage`, { expectedRisk: "externalEffect",
    waitUntil: "load" })).output;
  const dualSession = (await exporting.client.attachSession(dualTarget.targetRef)).output;
  let dual;
  try {
    dual = (await exporting.client.act(dualSession, [{ kind: "click", selector: "#dual", download: true,
      timeoutMs: 15000, expectedRisk: "externalEffect" }])).output.actions[0].result.download;
  } catch (error) {
    dual = { error: error?.message };
  }
  check("a frame loading the download's URL as a page does not speak for the download",
    dual?.mimeType === "text/csv" && dual.declaredMimeType === "text/csv",
    JSON.stringify({ mimeType: dual?.mimeType, declared: dual?.declaredMimeType, error: dual?.error }));

  // A permission narrowed while a download runs: the action ends, and the tab still works afterwards.
  const revising = await startHost("revising", { permissionRevision: "controller",
    actions: ["snapshot", "click", "navigate"] });
  clients.push(revising.client);
  const pending = revising.client.act(revising.session, [{ kind: "click", selector: "#slowlink", download: true,
    timeoutMs: 6000, expectedRisk: "externalEffect" }]).then(() => "finished", (error) => error?.code || "failed");
  await new Promise((resolve) => setTimeout(resolve, 800));
  await revising.client.revisePermission({ actions: ["snapshot", "navigate"] });
  const ended = await pending;
  const navigated = await Promise.race([revising.client.act(revising.session, [{ kind: "navigate",
    url: `${origin}/second`, expectedRisk: "externalEffect" }]).then(() => true, () => false),
  new Promise((resolve) => setTimeout(() => resolve(false), 15000))]);
  const readable = await Promise.race([revising.client.observe(revising.session, { expectedRisk: "read" })
    .then(() => true, () => false), new Promise((resolve) => setTimeout(() => resolve(false), 10000))]);
  check("a permission narrowed while a download runs leaves the tab usable", navigated && readable,
    JSON.stringify({ ended, navigated, readable }));

  const plain = await startHost("plain", {});
  clients.push(plain.client);
  const unexported = await plain.download("#png");
  const asked = await plain.download("#png", { saveAs: "pixel.png" });
  check("without an export root the receipt has no file and saveAs is refused before the click",
    unexported.receipt?.mimeType === "image/png" && unexported.receipt.exportedFile === undefined
      && asked.error?.code === "BROWSER_AUTOMATION_ACTION_DENIED" && asked.error.outcome === "notSent",
    `${JSON.stringify(unexported.receipt?.exportedFile)} ${asked.error?.code}/${asked.error?.outcome}`);

  const readOnly = await startHost("readOnly", { requests: "safe", exportRoot: join(work, "readOnlyExports") });
  clients.push(readOnly.client);
  const guarded = await readOnly.download("#euckr");
  const guardedSnapshot = await readOnly.client.observe(readOnly.session, { expectedRisk: "read" })
    .then(() => true, () => false);
  check("a read-only session still reads the declared type and keeps browsing",
    guarded.receipt?.declaredMimeType === "text/csv; charset=euc-kr" && guarded.receipt.exportedFile?.name === "korean.csv"
      && guardedSnapshot, JSON.stringify(guarded.receipt || guarded.error?.message));
} catch (error) {
  failed += 1;
  console.log(`  FAIL download receipt gate stopped: ${error?.stack || error}`);
} finally {
  for (const client of clients) await client.close().catch(() => {});
  server.close();
  await rm(work, { recursive: true, force: true }).catch(() => {});
}
console.log(`결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
