// processOS.js - Layer 2: 브라우저 파이썬 프로세스 OS 커널.
// 메인스레드=커널. 프로세스 테이블 + 스냅샷-fork spawn + Pool.map 스케줄러.
// 검증조각 통합: bare 스냅샷 fork(콜드 대비 15.4배 spawn) + 워커풀 병렬(독립 GIL N개 = N코어).
// WASM dlopen 문제를 회피(각 워커가 자기 wasmTable/힙/글루 소유)하므로 오늘 가능한 최상단.
const DEFAULT_INDEX = "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/";

export class PyProc {
  constructor(opts = {}) {
    this.indexURL = opts.indexURL || DEFAULT_INDEX;
    this.workers = []; this.table = []; this._seq = 0; this._snapshot = null;
  }

  // 부모 하나 부팅해 bare 스냅샷(프로세스 이미지)을 만들고, SAB에 실어 워커가 공유하게.
  async _makeSnapshot() {
    if (!globalThis.loadPyodide) {
      await new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = this.indexURL + "pyodide.js"; s.onload = res;
        s.onerror = () => rej(new Error("pyodide.js 로드 실패")); document.head.appendChild(s);
      });
    }
    const parent = await loadPyodide({ indexURL: this.indexURL, _makeSnapshot: true });
    const snap = parent.makeMemorySnapshot();
    const sab = new SharedArrayBuffer(snap.byteLength);  // 모든 워커가 detach 없이 공유(N번 복사 회피)
    new Uint8Array(sab).set(snap);
    this._snapshot = sab;
    return sab.byteLength;
  }

  // N개 프로세스 spawn: 스냅샷으로 부팅(fast fork). useSnapshot=false면 콜드 대조.
  async boot(n, useSnapshot = true) {
    if (useSnapshot && !this._snapshot) await this._makeSnapshot();
    const boots = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      const pid = ++this._seq;
      this.table.push({ pid, worker: w, state: "booting", parentPid: 0 });
      this.workers.push(w);
      const idx = this.table.length - 1;
      boots.push(new Promise((resolve) => {
        const onMsg = (e) => {
          if (e.data.type === "ready" && e.data.id === pid) {
            w.removeEventListener("message", onMsg); this.table[idx].state = "ready"; resolve(e.data.bootMs);
          }
        };
        w.addEventListener("message", onMsg);
        w.postMessage({ type: "boot", id: pid, indexURL: this.indexURL, snapshot: useSnapshot ? this._snapshot : null });
      }));
    }
    const bootMsArr = await Promise.all(boots);
    return { workers: n, avgBootMs: Math.round(bootMsArr.reduce((a, b) => a + b, 0) / n), forked: useSnapshot };
  }

  // Pool.map: 파이썬 함수 소스 fnSrc(def _fn(arg): ...)를 args 리스트에 병렬 적용.
  // 워커들이 동시에 태스크 큐를 소진 = 진짜 병렬(독립 인터프리터).
  async map(fnSrc, args) {
    const results = new Array(args.length);
    let next = 0;
    const runOn = (w) => new Promise((resolve) => {
      const step = () => {
        if (next >= args.length) return resolve();
        const taskId = next++;
        const onMsg = (e) => {
          if ((e.data.type === "result" || e.data.type === "error") && e.data.taskId === taskId) {
            w.removeEventListener("message", onMsg);
            results[taskId] = e.data.type === "result" ? e.data.result : { error: e.data.error };
            step();
          }
        };
        w.addEventListener("message", onMsg);
        w.postMessage({ type: "task", taskId, fnSrc, arg: args[taskId] });
      };
      step();
    });
    await Promise.all(this.workers.map(runOn));
    return results;
  }

  // 직렬 대조(벤치 baseline): 모든 태스크를 워커 1개에서 순차 실행.
  async mapSerial(fnSrc, args) {
    const w = this.workers[0]; const results = new Array(args.length);
    for (let taskId = 0; taskId < args.length; taskId++) {
      results[taskId] = await new Promise((resolve) => {
        const onMsg = (e) => {
          if ((e.data.type === "result" || e.data.type === "error") && e.data.taskId === taskId) {
            w.removeEventListener("message", onMsg);
            resolve(e.data.type === "result" ? e.data.result : { error: e.data.error });
          }
        };
        w.addEventListener("message", onMsg);
        w.postMessage({ type: "task", taskId, fnSrc, arg: args[taskId] });
      });
    }
    return results;
  }

  // 프로세스 테이블 스냅샷(pid/state 조회).
  ps() { return this.table.map(({ pid, state, parentPid }) => ({ pid, state, parentPid })); }

  terminate() { for (const w of this.workers) w.terminate(); this.workers = []; this.table = []; this._seq = 0; }
}
