// pyProc.js - Layer 2: 브라우저 파이썬 프로세스 OS 커널.
// 메인스레드=커널. 프로세스 테이블 + 스냅샷-fork spawn + Pool.map 스케줄러.
// 검증조각 통합: bare 스냅샷 fork(콜드 대비 15.4배 spawn) + 워커풀 병렬(독립 GIL N개 = N코어).
// WASM dlopen 문제를 회피(각 워커가 자기 wasmTable/힙/글루 소유)하므로 오늘 가능한 최상단.
// worker.js는 반드시 이 파일과 같은 폴더에 둔다(new URL 상대경로 = 번들러 워커 emit 계약).
import { DEFAULT_INDEX, ensureEngineScript } from "../runtime/runtime.js";

// 시그널 번호(POSIX 관례. 외부 기술 명칭이라 번호는 원어 규격 그대로).
// 워커의 SAB 채널에 쓰면 CPython eval 루프가 해당 핸들러를 부른다(signalTableProbe 실측).
export const SIGNAL = { INT: 2, USR1: 10, USR2: 12, TERM: 15 };

export class PyProc {
  constructor(opts = {}) {
    this.indexURL = opts.indexURL || DEFAULT_INDEX;
    this.packages = opts.packages || []; // 각 프로세스가 부팅 시 로드할 패키지(numpy 등)
    this.setup = opts.setup || null;     // 부팅 시 실행할 파이썬(예: "import numpy" 예열)
    // 리플레이 매니페스트({env, packages, setup}): 주면 워커들이 결정적 리플레이로 부팅해
    // 바이트 동일한 힙에 선다 = fork(살아있는 상태 복제)가 가능한 대칭 풀.
    this.replay = opts.replay || null;
    this.workers = []; this.table = []; this._seq = 0; this._snapshot = null;
  }

  // 부모 하나 부팅해 bare 스냅샷(프로세스 이미지)을 만들고, SAB에 실어 워커가 공유하게.
  async _makeSnapshot() {
    await ensureEngineScript(this.indexURL);
    const parent = await loadPyodide({ indexURL: this.indexURL, _makeSnapshot: true });
    const snap = parent.makeMemorySnapshot();
    const sab = new SharedArrayBuffer(snap.byteLength);  // 모든 워커가 detach 없이 공유(N번 복사 회피)
    new Uint8Array(sab).set(snap);
    this._snapshot = sab;
    return sab.byteLength;
  }

  // 워커 1개 생성 + 부팅 시작. ready는 bootMs로 resolve, 부팅 실패는 reject.
  // 부팅 실패를 조용히 삼키면 boot()가 영원히 pending이다. 에러도 반드시 귀결시킨다.
  _spawn(useSnapshot) {
    const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    const pid = ++this._seq;
    // SIGINT 채널: 커널이 이 SAB에 2를 쓰면 워커의 CPython eval 루프가 KeyboardInterrupt를 던진다.
    const interruptSab = new SharedArrayBuffer(1);
    const entry = { pid, worker: w, state: "booting", parentPid: 0, interrupt: new Uint8Array(interruptSab) };
    this.table.push(entry);
    const ready = new Promise((resolve, reject) => {
      const onMsg = (e) => {
        if (e.data.id !== pid) return;
        if (e.data.type === "ready") {
          w.removeEventListener("message", onMsg); entry.state = "ready"; entry.interrupts = !!e.data.interrupts; resolve(e.data.bootMs);
        } else if (e.data.type === "error" && e.data.taskId === undefined) {
          w.removeEventListener("message", onMsg); entry.state = "dead";
          reject(new Error(`워커 pid ${pid} 부팅 실패: ${e.data.error}`));
        }
      };
      w.addEventListener("message", onMsg);
      w.addEventListener("error", (e) => { entry.state = "dead"; reject(new Error(`워커 pid ${pid} 크래시: ${e.message}`)); }, { once: true });
      w.postMessage({ type: "boot", id: pid, indexURL: this.indexURL, snapshot: useSnapshot ? this._snapshot : null, interruptSab, packages: this.packages, setup: this.setup, replay: this.replay });
    });
    return { worker: w, entry, ready };
  }

  // 워커 1개와의 요청/응답 왕복(harvest/applyDelta 같은 단발 프로토콜).
  _call(entry, msg, transfer = []) {
    return new Promise((resolve, reject) => {
      const onMsg = (e) => {
        if (e.data.id !== entry.pid) return;
        entry.worker.removeEventListener("message", onMsg);
        if (e.data.type === "error") reject(new Error(e.data.error)); else resolve(e.data);
      };
      entry.worker.addEventListener("message", onMsg);
      entry.worker.postMessage({ ...msg, id: entry.pid }, transfer);
    });
  }

  // fork(2) 등가: 살아있는 프로세스 src의 현재 상태를 프로세스 dst에 복제한다.
  // 스냅샷-fork(bare 이미지 복제)와 다르다: 부모가 만든 변수·배열·계산 결과가 자식에 실린다.
  // 전제: 두 프로세스 모두 같은 replay 매니페스트로 부팅했을 것(바이트 동일한 경계 = 델타 유효).
  // 실측(pythonMachine/forkLiveProbe 8/8): 델타 10.3MB 수확 43.6ms, 적용 1.4ms, 왕복 4ms,
  // 부모 상태 전부 생존, 자식 변이는 부모에 새지 않음(독립 주소공간).
  async fork(srcPid, dstPid) {
    if (!this.replay) throw new Error("fork: replay 매니페스트로 부팅한 풀에서만 가능하다(new PyProc({ replay }))");
    const src = this.table.find((t) => t.pid === srcPid), dst = this.table.find((t) => t.pid === dstPid);
    if (!src || src.state !== "ready") throw new Error(`fork: src pid ${srcPid} 준비되지 않음`);
    if (!dst || dst.state !== "ready") throw new Error(`fork: dst pid ${dstPid} 준비되지 않음`);
    const h = await this._call(src, { type: "harvest" });
    const applied = await this._call(dst, { type: "applyDelta", bin: h.bin, pages: h.pages, sp: h.sp }, [h.bin]);
    dst.parentPid = srcPid; // 계보 기록: fork된 프로세스의 부모(ps()에 노출)
    return {
      pages: h.pages.length,
      mb: +(h.pages.length * 65536 / 1048576).toFixed(1),
      reverted: applied.reverted, // dst의 델타 밖 드리프트를 cp0으로 되돌린 페이지 수(정화 증거)
      harvestMs: h.ms,
      applyMs: applied.ms,
    };
  }

  // 시그널 전달(유닉스 시그널 표). 워커를 죽이지 않고 실행 중인 파이썬의 eval 루프에
  // 시그널을 올린다 = 인터프리터 상태 보존 + respawn 비용 0.
  // 실측(runtimeParity/signalTableProbe 6/6): SAB에 signum을 쓰면 CPython이 그 번호의
  // 핸들러를 부른다. SIGINT(2)=KeyboardInterrupt(기본), SIGTERM(15)/SIGUSR1(10) 등은
  // 파이썬이 signal.signal로 건 핸들러가 발화한다(핸들러 없으면 기본 동작).
  // 협조적 종료 실측 264ms, 종료 후 같은 워커 재사용 가능. 행이 계속되면 kill이 최후 수단.
  signal(pid, signum = SIGNAL.INT) {
    const entry = this.table.find((t) => t.pid === pid);
    // 워커가 setInterruptBuffer 미지원이면 SAB에 써봤자 무시된다(무증상 no-op).
    // ready 응답의 interrupts 플래그를 소비해 정직하게 false를 돌려준다.
    if (!entry || entry.state !== "ready" || !entry.interrupts) return false;
    entry.interrupt[0] = signum;
    return true;
  }
  // SIGINT 별칭(기존 계약 유지).
  interrupt(pid) { return this.signal(pid, SIGNAL.INT); }

  // N개 프로세스 spawn: 스냅샷으로 부팅(fast fork). useSnapshot=false면 콜드 대조.
  async boot(n, useSnapshot = true) {
    if (useSnapshot && !this._snapshot) await this._makeSnapshot();
    const spawns = [];
    for (let i = 0; i < n; i++) {
      const s = this._spawn(useSnapshot);
      this.workers.push(s.worker);
      spawns.push(s.ready);
    }
    const bootMsArr = await Promise.all(spawns);
    return { workers: n, avgBootMs: Math.round(bootMsArr.reduce((a, b) => a + b, 0) / n), forked: useSnapshot };
  }

  // 프로세스 강제 종료(커널 주도, SIGKILL 등가). 테이블에는 dead로 남긴다(이력 조회용).
  kill(pid) {
    const entry = this.table.find((t) => t.pid === pid);
    if (!entry || entry.state === "dead") return false;
    entry.worker.terminate(); entry.state = "dead";
    const idx = this.workers.indexOf(entry.worker);
    if (idx >= 0) this.workers.splice(idx, 1);
    return true;
  }

  // 행/죽은 워커를 kill하고 스냅샷에서 대체 프로세스를 respawn(풀 자리 유지).
  // 실측(attempts/processLifecycle): respawn 302ms, 행 감지는 이벤트가 없어 타임아웃만 가능.
  async _replace(oldW) {
    const entry = this.table.find((t) => t.worker === oldW);
    oldW.terminate(); if (entry) entry.state = "dead";
    const s = this._spawn(!!this._snapshot);
    await s.ready;
    const idx = this.workers.indexOf(oldW);
    if (idx >= 0) this.workers[idx] = s.worker; else this.workers.push(s.worker);
    return s.worker;
  }

  // Pool.map: 파이썬 함수 소스 fnSrc(def _fn(arg): ...)를 args 리스트에 병렬 적용.
  // 워커들이 동시에 태스크 큐를 소진 = 진짜 병렬(독립 인터프리터).
  // opts.taskTimeoutMs: 태스크별 타임아웃. 초과 시 해당 태스크는 {error}로 수렴하고,
  // 행 워커는 회수 불가(협조적 취소 없음)라 kill + 스냅샷 respawn으로 레인을 복구한다.
  async map(fnSrc, args, opts = {}) {
    const timeoutMs = opts.taskTimeoutMs || 0;
    const results = new Array(args.length);
    let next = 0;
    const lane = (initialW) => new Promise((resolve) => {
      let w = initialW;
      const step = () => {
        if (next >= args.length) return resolve();
        const taskId = next++;
        let timer = null;
        const onMsg = (e) => {
          if ((e.data.type === "result" || e.data.type === "error") && e.data.taskId === taskId) {
            if (timer) clearTimeout(timer);
            w.removeEventListener("message", onMsg);
            results[taskId] = e.data.type === "result" ? e.data.result : { error: e.data.error };
            step();
          }
        };
        if (timeoutMs) timer = setTimeout(() => {
          w.removeEventListener("message", onMsg);
          results[taskId] = { error: `timeout: ${timeoutMs}ms 초과` };
          this._replace(w).then((nw) => { w = nw; step(); });
        }, timeoutMs);
        w.addEventListener("message", onMsg);
        w.postMessage({ type: "task", taskId, fnSrc, arg: args[taskId] });
      };
      step();
    });
    await Promise.all(this.workers.map(lane));
    return results;
  }

  // 큰 TypedArray를 조각내 워커들에 numpy 배열로 병렬 적용(샤딩 map).
  // 실측(attempts/runtimeParity/shardMapProbe): 32MB sort+sum 4워커 5.28배.
  // 데이터는 SAB로 공유되고 각 워커 안에서 1회 복사로 numpy화된다(memcpy 1회는 불가피).
  // fnSrc: "def _fn(a): ..." (a = 해당 조각의 numpy 1차원 배열). 워커에 numpy가 필요하므로
  // new PyProc({ packages: ["numpy"], setup: "import numpy" })로 부팅하라.
  async mapArray(fnSrc, typed, opts = {}) {
    const parts = opts.parts || this.workers.length;
    const dtypeMap = {
      Float64Array: "float64", Float32Array: "float32", Int32Array: "int32", Uint32Array: "uint32",
      Int16Array: "int16", Uint16Array: "uint16", Int8Array: "int8", Uint8Array: "uint8",
    };
    const dtype = dtypeMap[typed.constructor.name];
    if (!dtype) throw new Error(`mapArray: 지원하지 않는 TypedArray(${typed.constructor.name})`);
    let sab = typed.buffer, base = typed.byteOffset;
    if (!(sab instanceof SharedArrayBuffer)) { // SAB가 아니면 1회 복사로 전 워커 공유화
      sab = new SharedArrayBuffer(typed.byteLength);
      new Uint8Array(sab).set(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength));
      base = 0;
    }
    const bpe = typed.BYTES_PER_ELEMENT, per = Math.floor(typed.length / parts);
    const metas = Array.from({ length: parts }, (_, i) => {
      const start = i * per, count = i === parts - 1 ? typed.length - start : per;
      return { sab, off: base + start * bpe, len: count * bpe, dtype };
    });
    const harness = fnSrc.replace("def _fn(", "def _pyprocUser(") + "\n"
      + "def _fn(meta):\n"
      + "    import js, numpy\n"
      + "    _u8 = js.Uint8Array.new(meta.sab, meta.off, meta.len).slice()\n"
      + "    return _pyprocUser(numpy.frombuffer(_u8.to_py(), dtype=meta.dtype))\n";
    return this.map(harness, metas, opts);
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
