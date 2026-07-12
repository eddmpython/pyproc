// forkLiveWorker.js - probe 전용 워커: 결정적 리플레이를 "워커 컨텍스트"에서 재현한다.
// forkLive(살아있는 커널의 진짜 fork)의 관문: 두 커널의 cp0 힙이 바이트 동일해야 부모의
// 델타를 자식에 그대로 적용할 수 있다(replayFork의 크로스 컨텍스트판).
// session.js의 stubEntropy와 동일한 고정을 워커 전역에 적용한다(같은 3개 소스).
const INDEX = new URL(self.location.href).searchParams.get("index") || "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/";
const PAGE = 65536;

function stubEntropy() {
  const o = { grv: crypto.getRandomValues.bind(crypto), dn: Date.now, pn: performance.now.bind(performance) };
  crypto.getRandomValues = (a) => { new Uint8Array(a.buffer, a.byteOffset, a.byteLength).fill(0x42); return a; };
  Date.now = () => 1750000000000;
  performance.now = () => 12345;
  return () => { crypto.getRandomValues = o.grv; Date.now = o.dn; performance.now = o.pn; };
}

let py = null;
let cp0 = null; // 리플레이 경계의 힙 사본(델타 수확의 기준)
const heap = () => py._module.HEAPU8;
const hex = async (bytes) => {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === "replayBoot") {
      const restore = stubEntropy();
      try {
        const mod = await import(INDEX + "pyodide.mjs");
        py = await mod.loadPyodide({ indexURL: INDEX, env: { PYTHONHASHSEED: "0", ...(msg.env || {}) } });
        if (msg.packages && msg.packages.length) await py.loadPackage(msg.packages);
        if (msg.setup) py.runPython(msg.setup);
      } finally { restore(); }
      const h = heap();
      cp0 = h.slice(0, h.length); // 경계 사본(비교/수확 기준)
      postMessage({ type: "replayReady", id: msg.id, heapLen: h.length, digest: await hex(cp0) });
    } else if (msg.type === "run") {
      const r = py.runPython(msg.code);
      postMessage({ type: "ran", id: msg.id, result: r === undefined ? null : (r && r.toJs ? r.toJs() : r) });
    } else if (msg.type === "harvest") {
      // cp0 대비 바뀐 페이지 = "지금 이 커널의 사용자 상태"(부모측 fork 재료).
      const t0 = performance.now();
      const h = heap();
      const pages = [];
      const nCommon = Math.min(h.length, cp0.length) / PAGE;
      for (let p = 0; p < nCommon; p++) {
        const a = h.subarray(p * PAGE, (p + 1) * PAGE), b = cp0.subarray(p * PAGE, (p + 1) * PAGE);
        let same = true;
        for (let i = 0; i < PAGE; i += 8) { if (a[i] !== b[i]) { same = false; break; } } // 1차 성긴 비교
        if (same) { for (let i = 0; i < PAGE; i++) { if (a[i] !== b[i]) { same = false; break; } } } // 확정 비교
        if (!same) pages.push(p);
      }
      for (let p = cp0.length / PAGE; p < h.length / PAGE; p++) pages.push(p); // 성장분
      const bin = new Uint8Array(pages.length * PAGE);
      pages.forEach((p, i) => bin.set(h.subarray(p * PAGE, (p + 1) * PAGE), i * PAGE));
      const sp = py._module._emscripten_stack_get_current ? py._module._emscripten_stack_get_current() : null;
      postMessage({ type: "harvested", id: msg.id, pages, bin: bin.buffer, sp, ms: Math.round((performance.now() - t0) * 10) / 10 }, [bin.buffer]);
    } else if (msg.type === "applyDelta") {
      // 부모의 델타 페이지를 자식 힙에 적용 = 살아있는 상태의 fork.
      const t0 = performance.now();
      const bin = new Uint8Array(msg.bin);
      const h = heap();
      msg.pages.forEach((p, i) => h.set(bin.subarray(i * PAGE, (i + 1) * PAGE), p * PAGE));
      if (msg.sp !== null && py._module._emscripten_stack_restore) py._module._emscripten_stack_restore(msg.sp);
      const applyMs = Math.round((performance.now() - t0) * 10) / 10;
      let evaled = null, error = null;
      try { const r = py.runPython(msg.check); evaled = r && r.toJs ? r.toJs() : r; } catch (err) { error = String(err).slice(-200); }
      postMessage({ type: "applied", id: msg.id, applyMs, evaled, error });
    }
  } catch (err) {
    postMessage({ type: "error", id: msg.id, error: String(err).slice(-300) });
  }
};
