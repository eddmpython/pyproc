// Browser screenshot product primitive probe. 정식 제품 코드는 이 파일을 import하지 않는다.
// 결과: 2026-08-11, Chrome과 Edge 각각 7/7 통과.
// 결론: viewport, full-page, clip과 PNG, JPEG, WebP CDP primitive가 두 브라우저에서 성립한다.
// 다음: product launcher, artifact store, ordered screenshot action과 installed CLI gate로 승격한다.
import { Buffer } from "node:buffer";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticServer } from "../../../scripts/staticServer.mjs";
import { readDevToolsEndpoint } from "../../../scripts/browserControl/browserControlBroker.mjs";
import { CdpConnection } from "../../../scripts/browserControl/cdpConnection.mjs";
import { launchBrowser } from "../../browser/harness.mjs";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const server = createStaticServer(null, { root: ROOT });
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const origin = `http://127.0.0.1:${server.address().port}`;
const pageUrl = `${origin}/tests/attempts/browserAutomationProduct/probeTarget.html`;
const browser = launchBrowser(pageUrl, {
  prefix: "pyprocBrowserScreenshotProbe-",
  extraArgs: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", "--window-size=900,700"],
});
const checks = [];
const check = (name, pass, detail = "") => checks.push({ name, pass: !!pass, detail });
const isPng = (bytes) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
const isJpeg = (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
const isWebp = (bytes) => bytes.subarray(0, 4).toString("ascii") === "RIFF"
  && bytes.subarray(8, 12).toString("ascii") === "WEBP";
let connection;

try {
  connection = await CdpConnection.connect(await readDevToolsEndpoint(browser.profile), { timeoutMs: 30000 });
  const deadline = Date.now() + 30000;
  let target;
  while (Date.now() < deadline && !target) {
    const result = await connection.send("Target.getTargets");
    target = result.targetInfos?.find((entry) => entry.type === "page" && entry.url === pageUrl);
    if (!target) await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  if (!target) throw new Error("screenshot probe target did not become ready");
  const { sessionId } = await connection.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  await connection.send("Page.enable", {}, sessionId);
  await connection.send("Runtime.enable", {}, sessionId);
  const readyDeadline = Date.now() + 30000;
  let readyState = "";
  while (Date.now() < readyDeadline) {
    const ready = await connection.send("Runtime.evaluate", {
      expression: "document.readyState", returnByValue: true,
    }, sessionId);
    readyState = ready.result?.value || "";
    if (readyState === "complete") break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  if (readyState !== "complete") throw new Error(`screenshot probe page did not load: ${readyState}`);
  const layout = await connection.send("Page.getLayoutMetrics", {}, sessionId);
  const content = layout.contentSize;
  const viewport = layout.cssVisualViewport || layout.visualViewport;
  check("layout metrics expose a taller bounded document", content?.height > viewport?.clientHeight,
    `${content?.width}x${content?.height} content, ${viewport?.clientWidth}x${viewport?.clientHeight} viewport`);

  const capture = async (params) => {
    const result = await connection.send("Page.captureScreenshot", {
      fromSurface: true, ...params,
    }, sessionId);
    return Buffer.from(result.data || "", "base64");
  };
  const viewportPng = await capture({ format: "png", captureBeyondViewport: false });
  const fullPng = await capture({
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: content.width, height: content.height, scale: 1 },
  });
  const clipPng = await capture({
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 32, y: 520, width: 520, height: 480, scale: 1 },
  });
  const jpeg = await capture({ format: "jpeg", quality: 80, captureBeyondViewport: false });
  const webp = await capture({ format: "webp", quality: 80, captureBeyondViewport: false });

  check("viewport PNG signature", viewportPng.byteLength > 8 && isPng(viewportPng), `${viewportPng.byteLength} bytes`);
  check("full-page PNG signature and larger payload", isPng(fullPng) && fullPng.byteLength > viewportPng.byteLength,
    `${fullPng.byteLength} bytes`);
  check("clip PNG signature", clipPng.byteLength > 8 && isPng(clipPng), `${clipPng.byteLength} bytes`);
  check("JPEG signature", jpeg.byteLength > 3 && isJpeg(jpeg), `${jpeg.byteLength} bytes`);
  check("WebP signature", webp.byteLength > 12 && isWebp(webp), `${webp.byteLength} bytes`);
  check("base64 capture reconstructs non-empty bytes", [viewportPng, fullPng, clipPng, jpeg, webp].every((bytes) => bytes.byteLength > 0));
} catch (error) {
  check("probe exception absent", false, String(error?.stack || error).slice(0, 500));
} finally {
  try { connection?.close(); } catch (error) {}
  try { browser.close(); } catch (error) {}
  await new Promise((resolveClose) => server.close(resolveClose));
}

for (const result of checks) console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}${result.detail ? ` (${result.detail})` : ""}`);
const passed = checks.filter((entry) => entry.pass).length;
console.log(`browser screenshot product probe: ${passed === checks.length ? "GREEN" : "RED"} (${passed}/${checks.length})`);
process.exit(passed === checks.length ? 0 : 1);
