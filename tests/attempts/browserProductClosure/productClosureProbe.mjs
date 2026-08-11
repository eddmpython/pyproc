// productClosureProbe.mjs - 첫 navigation 전 viewport와 계측, 표시 상태, lazy hydration primitive 실측.
// 결과(2026-08-11, Edge headless, 로컬 정적 서버): GREEN 7/7. 390x844@3 적용,
// hidden overlay 구분, lazy asset 0 -> 1 request, hydration 6 scroll과 원위치 복원,
// navigation 전 계측 33 events, viewport PNG 14,079 bytes. 다섯 primitive 모두 승격 가능하다.
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createStaticServer } from "../../../scripts/staticServer.mjs";
import { launchBrowser } from "../../../scripts/browserControl/browserLauncher.mjs";
import { CdpConnection } from "../../../scripts/browserControl/cdpConnection.mjs";
import { readDevToolsEndpoint } from "../../../scripts/browserControl/browserControlBroker.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
const TIMEOUT_MS = Number(process.env.PYPROC_GATE_TIMEOUT || 60000);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let lazyRequests = 0;
const server = createStaticServer((req) => {
  if (req.url?.startsWith("/tests/attempts/browserProductClosure/lazy.svg")) lazyRequests += 1;
  return false;
}, { root: ROOT });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const url = `${origin}/tests/attempts/browserProductClosure/probeTarget.html?secret=must-redact`;

let passed = 0;
let failed = 0;
const check = (name, pass, info = "") => {
  if (pass) { passed += 1; console.log(`  PASS ${name}${info ? ` (${info})` : ""}`); }
  else { failed += 1; console.log(`  FAIL ${name}${info ? ` (${info})` : ""}`); }
};

const browser = launchBrowser("about:blank", {
  prefix: "pyprocBrowserProductClosure-",
  extraArgs: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"],
});
let connection = null;
console.log("browser product closure primitive probe");
try {
  const endpoint = await readDevToolsEndpoint(browser.profile, { timeoutMs: TIMEOUT_MS });
  connection = await CdpConnection.connect(endpoint, { timeoutMs: TIMEOUT_MS });
  const targets = await connection.send("Target.getTargets");
  const target = targets.targetInfos.find((entry) => entry.type === "page" && entry.url === "about:blank");
  if (!target) throw new Error("about:blank probe target unavailable");
  const { sessionId } = await connection.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const events = [];
  const unsubscribe = connection.subscribe((event) => {
    if (event.sessionId === sessionId) events.push(event);
  });
  await connection.send("Page.enable", {}, sessionId);
  await connection.send("Runtime.enable", {}, sessionId);
  await connection.send("Network.enable", {}, sessionId);
  await connection.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844,
  }, sessionId);
  const loaded = connection.once("Page.loadEventFired", (event) => event.sessionId === sessionId, TIMEOUT_MS);
  await connection.send("Page.navigate", { url }, sessionId);
  await loaded;

  const evaluated = await connection.send("Runtime.evaluate", {
    expression: `({
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      overlay: (() => {
        const node = document.querySelector("#overlay");
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return { attached: node.isConnected, visible: style.display !== "none" && style.visibility !== "hidden"
          && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0 };
      })()
    })`,
    returnByValue: true,
  }, sessionId);
  const state = evaluated.result?.value || {};
  check("declared mobile viewport와 DPR", state.width === 390 && state.height === 844 && state.dpr === 3,
    `${state.width}x${state.height}@${state.dpr}`);
  check("attached overlay를 hidden으로 구분", state.overlay?.attached === true && state.overlay?.visible === false,
    JSON.stringify(state.overlay));
  check("offscreen lazy asset은 scroll 전에 요청되지 않음", lazyRequests === 0, `${lazyRequests} requests`);

  const before = await connection.send("Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId);
  const beforeBytes = Buffer.from(before.data || "", "base64");
  check("screenshot bytes가 native image content로 전달 가능한 PNG", beforeBytes.subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${beforeBytes.byteLength} bytes`);

  const hydrated = await connection.send("Runtime.evaluate", {
    expression: `(async () => {
      const initial = { x: scrollX, y: scrollY };
      const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      let scrolls = 0;
      for (let y = 0; y <= maximum; y += Math.max(1, Math.floor(innerHeight * 0.8))) {
        scrollTo(0, Math.min(y, maximum));
        scrolls += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      scrollTo(0, maximum);
      await new Promise((resolve) => setTimeout(resolve, 100));
      scrollTo(initial.x, initial.y);
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { scrolls, restored: scrollX === initial.x && scrollY === initial.y };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  const hydrateResult = hydrated.result?.value || {};
  const lazyDeadline = Date.now() + TIMEOUT_MS;
  while (lazyRequests < 1 && Date.now() < lazyDeadline) await delay(20);
  check("bounded hydration이 lazy asset을 정확히 한 번 적재", lazyRequests === 1 && hydrateResult.scrolls <= 10,
    `${hydrateResult.scrolls} scrolls, ${lazyRequests} requests`);
  check("hydration 뒤 원래 scroll 위치 복원", hydrateResult.restored === true);

  const firstRequest = events.find((event) => event.method === "Network.requestWillBeSent"
    && event.params?.request?.url?.startsWith(`${origin}/tests/attempts/browserProductClosure/probeTarget.html`));
  const firstConsole = events.find((event) => event.method === "Runtime.consoleAPICalled"
    && event.params?.args?.some((arg) => arg.value === "startup-probe"));
  check("navigation 전 계측이 첫 document request와 초기 console을 보존", !!firstRequest && !!firstConsole,
    `${events.length} events`);
  unsubscribe();
  await connection.send("Target.detachFromTarget", { sessionId });
} catch (error) {
  check("probe 예외 없음", false, String(error?.stack || error).slice(0, 500));
} finally {
  connection?.close();
  browser.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log(`\n결과: ${failed === 0 ? "GREEN" : "RED"} (${passed}/${passed + failed})`);
process.exit(failed === 0 ? 0 : 1);
