// serviceWorker.js - browserControl 실측 확장의 배경 컨텍스트.
// 역할: (1) offscreen document(Pyodide 호스트)를 만든다. (2) offscreen이 chrome.runtime로
// 보낸 게이트 결과를 받아, 자신의 chrome.debugger 가시성(게이트 3 예비)을 덧붙여 로컬 러너로
// 백채널(fetch) 릴레이한다. offscreen은 chrome.debugger에 못 닿으므로(제한 API), 이 릴레이가 계약이다.
const PORT = new URL(chrome.runtime.getURL("/")).port; // 러너가 manifest host_permissions에 심은 포트는 아니고,
// 실제 포트는 아래 report가 offscreen에서 전달받은 값을 쓴다(러너가 offscreen URL 쿼리로 주입).

async function report(payload) {
  // 백채널 포트는 offscreen이 자기 URL 쿼리에서 읽어 함께 보낸다(SW는 URL 쿼리를 못 받으므로).
  const port = payload.backchannelPort;
  const body = JSON.stringify({
    ...payload,
    swChecks: [
      { name: "sw: chrome.debugger 존재", pass: typeof chrome.debugger === "object" && typeof chrome.debugger.attach === "function" },
      { name: "sw: chrome.tabs 존재", pass: typeof chrome.tabs === "object" },
    ],
  });
  try {
    await fetch(`http://127.0.0.1:${port}/gateReport`, { method: "POST", body });
  } catch (e) {
    // 백채널 실패는 러너 타임아웃으로 드러난다(여기선 삼킬 수밖에 없다: 보고 경로가 죽은 상황).
  }
}

async function ensureOffscreen(backchannelPort) {
  const url = `offscreen.html?port=${backchannelPort}`;
  const existing = await chrome.offscreen.hasDocument?.();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url,
      reasons: ["WORKERS"],
      justification: "Pyodide 런타임 호스트(SAB/워커 프로세스 OS 실측)",
    });
  }
}

// offscreen -> SW 결과 수신 -> 러너로 릴레이.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "gateResult") {
    report(msg);
    sendResponse({ ok: true });
  }
  return true;
});

// 러너는 확장 설치 직후 offscreen 부팅에 필요한 백채널 포트를 storage.session에 심는다.
// (SW는 URL 쿼리를 못 받으므로 storage로 건넨다.)
async function boot() {
  const { backchannelPort } = await chrome.storage.session.get("backchannelPort");
  if (!backchannelPort) {
    // 러너가 아직 안 심었으면 잠깐 뒤 재시도(설치 이벤트와 storage set 경합).
    setTimeout(boot, 200);
    return;
  }
  try {
    await ensureOffscreen(backchannelPort);
  } catch (e) {
    await report({ type: "gateResult", backchannelPort, fatal: `offscreen 생성 실패: ${String(e)}`, checks: [] });
  }
}

chrome.runtime.onInstalled.addListener(boot);
boot(); // 콜드 스타트(설치 이벤트를 놓친 재기동) 대비
