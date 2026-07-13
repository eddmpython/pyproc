// serviceWorker.js - 픽스처 SW 셸. 실 src의 openBrowserControlHost를 import한다(SSOT: 사본이 아니라 승격 코드 검증).
// offscreen(런타임 호스트) 생성 + offscreen 게이트 결과를 백채널로 릴레이한다. 백채널 포트는 조립 시 config.js로 주입.
import { openBrowserControlHost } from "./src/capabilities/browserControlHost.js";
import { BACKCHANNEL_PORT } from "./config.js";

openBrowserControlHost(); // 실 src 영속 세션 호스트 등록

async function report(payload) {
  try {
    await fetch(`http://127.0.0.1:${BACKCHANNEL_PORT}/gateReport`, { method: "POST", body: JSON.stringify(payload) });
  } catch (e) { /* 백채널 실패는 러너 타임아웃으로 드러난다 */ }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "gateResult") {
    report(msg);
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

async function boot() {
  const url = `offscreen.html?port=${BACKCHANNEL_PORT}`;
  const existing = await chrome.offscreen.hasDocument?.();
  if (!existing) {
    try {
      await chrome.offscreen.createDocument({ url, reasons: ["WORKERS"], justification: "pyproc browserControl fixture 런타임" });
    } catch (e) {
      await report({ type: "gateResult", ok: false, fatal: `offscreen 생성 실패: ${String(e)}`, checks: [] });
    }
  }
}

chrome.runtime.onInstalled.addListener(boot);
boot();
