// baselineProbe.mjs - exact Playwright와 browser에서 강한 비교 기준선을 잠근다.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { PERCEPTION_FIXTURES } from "./oracle/fixtureCatalog.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const lock = JSON.parse(await readFile(new URL("./baselineLock.json", import.meta.url), "utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

if (lock.comparison.package !== "playwright" || lock.comparison.version !== "1.62.0"
  || lock.environment.platform !== process.platform || lock.environment.arch !== process.arch) {
  throw new Error("baseline package, platform, or architecture does not match the exact lock");
}
for (const fixture of PERCEPTION_FIXTURES) {
  const bytes = await readFile(join(here, "fixtures", fixture));
  if (sha256(bytes) !== lock.fixtureDigests[fixture]) throw new Error(`fixture digest mismatch: ${fixture}`);
}

const temp = await mkdtemp(join(tmpdir(), "pyprocPerceptionBaseline-"));
let browser = null;
let server = null;
try {
  await writeFile(join(temp, "package.json"), JSON.stringify({ private: true }));
  const npmArgs = ["install", `${lock.comparison.package}@${lock.comparison.version}`,
    "--save-exact", "--package-lock=true", "--ignore-scripts", "--no-audit", "--no-fund", "--silent"];
  const npmCommand = process.platform === "win32" ? process.execPath : "npm";
  if (process.platform === "win32") npmArgs.unshift(join(dirname(process.execPath),
    "node_modules", "npm", "bin", "npm-cli.js"));
  const installed = spawnSync(npmCommand, npmArgs, { cwd: temp, encoding: "utf8" });
  if (installed.status !== 0) throw new Error(`baseline install failed: ${installed.error?.message || installed.stderr}`);
  const packageLock = JSON.parse(await readFile(join(temp, "package-lock.json"), "utf8"));
  if (packageLock.packages["node_modules/playwright"].integrity !== lock.comparison.integrity) {
    throw new Error("installed Playwright integrity does not match the baseline lock");
  }
  const require = createRequire(join(temp, "baseline.cjs"));
  const { chromium } = require("playwright");
  server = createServer(async (request, response) => {
    const path = request.url === "/accepted" ? null : String(request.url || "/").replace(/^\//, "").split("?")[0];
    if (request.url === "/accepted") {
      response.writeHead(200, { "Content-Type": "application/json" }); response.end('{"accepted":true}'); return;
    }
    if (!PERCEPTION_FIXTURES.includes(path)) { response.writeHead(404); response.end("not found"); return; }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(await readFile(join(here, "fixtures", path)));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ executablePath: lock.environment.browserExecutable, headless: true });
  if (!browser.version().startsWith(lock.environment.browserVersion)) {
    throw new Error(`baseline browser version mismatch: ${browser.version()}`);
  }
  const context = await browser.newContext({ viewport: lock.environment.viewport,
    locale: lock.environment.locale, timezoneId: lock.environment.timezoneId,
    deviceScaleFactor: lock.environment.viewport.deviceScaleFactor });
  const page = await context.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${origin}/semanticForm.html`);
  const aria = await page.ariaSnapshot({ boxes: lock.capture.ariaSnapshot.boxes });
  const submit = page.getByRole("button", { name: "Submit order", exact: true });
  const status = page.getByRole("status");
  const box = await submit.boundingBox();
  const image = await submit.screenshot(lock.capture.elementScreenshot);
  await submit.click();
  const accepted = await status.textContent();
  await page.goto(`${origin}/ambiguity.html`);
  const ambiguousCount = await page.getByRole("button", { name: "Save", exact: true }).count();
  const result = { packageVersion: lock.comparison.version, browserVersion: browser.version(),
    ariaSha256: sha256(Buffer.from(aria)), ariaBytes: Buffer.byteLength(aria),
    box, screenshotSha256: sha256(image), screenshotBytes: image.byteLength,
    accepted, ambiguousCount, reach: { ariaSnapshot: true, roleLocator: true, boundingBox: !!box,
      screenshot: image.byteLength > 0, click: accepted === "Accepted" } };
  const digest = sha256(Buffer.from(JSON.stringify(result)));
  process.stdout.write(`${JSON.stringify({ ...result, resultArtifactSha256: digest }, null, 2)}\n`);
  if (!lock.resultArtifactSha256) throw new Error(`baseline result digest must be pinned to ${digest}`);
  if (lock.resultArtifactSha256 !== digest) throw new Error("baseline result artifact digest diverged");
  if (!Object.values(result.reach).every(Boolean) || ambiguousCount !== 2) {
    throw new Error("baseline did not retain the allowed observation and action reach");
  }
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
