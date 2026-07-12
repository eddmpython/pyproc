// pyProc.js - Layer 2: 브라우저 파이썬 프로세스 OS 커널.
// 메인스레드=커널. 프로세스 테이블 + 스냅샷-fork spawn + Pool.map 스케줄러.
// 검증조각 통합: bare 스냅샷 fork(콜드 대비 15.4배 spawn) + 워커풀 병렬(독립 GIL N개 = N코어).
// WASM dlopen 문제를 회피(각 워커가 자기 wasmTable/힙/글루 소유)하므로 오늘 가능한 최상단.
// worker.js는 반드시 이 파일과 같은 폴더에 둔다(new URL 상대경로 = 번들러 워커 emit 계약).
//
// RPC 계약(2026-07-12 수리): 요청마다 전역 고유 reqId를 붙이고, 워커당 상시 리스너 1개가
// pending 맵(reqId -> promise)으로 응답을 상관시킨다. 같은 인스턴스에서 map/fork/harvest가
// 겹쳐도 응답이 교차하지 않고, 워커가 죽으면(사고/kill) 그 워커의 대기 중 요청 전부가
// 즉시 명시적으로 reject된다(영원히 매달리는 Promise 금지).
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
    this.table = []; this._seq = 0; this._reqSeq = 0; this._snapshot = null;
  }

  // 살아있는 프로세스 풀(스케줄 대상).
  _pool() { return this.table.filter((t) => t.state === "ready"); }

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

  // 워커 사망 수렴: 대기 중인 요청 전부를 명시적으로 reject하고 테이블에서 dead로 남긴다.
  _fail(entry, err) {
    if (entry.state === "dead") return;
    entry.state = "dead";
    for (const p of entry.pending.values()) p.reject(err instanceof Error ? err : new Error(String(err)));
    entry.pending.clear();
  }

  // 요청 1건 발신(reqId 발급 + pending 등록). 취소가 필요한 호출자는 reqId로 등록을 지운다.
  _request(entry, msg, transfer = []) {
    const reqId = ++this._reqSeq;
    const promise = new Promise((resolve, reject) => {
      if (entry.state === "dead") return reject(new Error(`pid ${entry.pid}는 dead다`));
      entry.pending.set(reqId, { resolve, reject });
      entry.worker.postMessage({ ...msg, id: entry.pid, reqId }, transfer);
    });
    return { reqId, promise };
  }

  // 단발 왕복(harvest/applyDelta 등). 에러 응답은 reject로 귀결된다.
  _call(entry, msg, transfer = []) { return this._request(entry, msg, transfer).promise; }

  // 워커 1개 생성 + 부팅 시작. ready는 bootMs로 resolve, 부팅 실패/크래시는 reject.
  _spawn(useSnapshot) {
    const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    const pid = ++this._seq;
    // SIGINT 채널: 커널이 이 SAB에 2를 쓰면 워커의 CPython eval 루프가 KeyboardInterrupt를 던진다.
    const interruptSab = new SharedArrayBuffer(1);
    const entry = { pid, worker: w, state: "booting", parentPid: 0, interrupt: new Uint8Array(interruptSab), pending: new Map() };
    this.table.push(entry);
    // 상시 라우터: 응답의 reqId로 pending을 찾는다. 모르는 응답(취소된 요청의 늦은 응답)은 버린다.
    w.addEventListener("message", (e) => {
      const p = entry.pending.get(e.data.reqId);
      if (!p) return;
      entry.pending.delete(e.data.reqId);
      if (e.data.type === "error") p.reject(new Error(e.data.error)); else p.resolve(e.data);
    });
    w.addEventListener("error", (e) => this._fail(entry, new Error(`워커 pid ${pid} 크래시: ${e.message || "unknown"}`)));
    w.addEventListener("messageerror", () => this._fail(entry, new Error(`워커 pid ${pid} 메시지 역직렬화 실패`)));
    const ready = this._call(entry, {
      type: "boot", indexURL: this.indexURL, snapshot: useSnapshot ? this._snapshot : null,
      interruptSab, packages: this.packages, setup: this.setup, replay: this.replay,
    }).then(
      (d) => { entry.state = "ready"; entry.interrupts = !!d.interrupts; return d.bootMs; },
      (err) => { this._fail(entry, err); throw new Error(`워커 pid ${pid} 부팅 실패: ${err.message}`); },
    );
    return { entry, ready };
  }

  // fork(2) 등가: 살아있는 프로세스 src의 현재 상태를 프로세스 dst에 복제한다.
  // 스냅샷-fork(bare 이미지 복제)와 다르다: 부모가 만든 변수·배열·계산 결과가 자식에 실린다.
  // 전제: 두 프로세스 모두 같은 replay 매니페스트로 부팅했을 것(바이트 동일한 경계 = 델타 유효).
  // 자식은 정확히 "경계 + 부모 델타"가 된다(더러운 dst 정화 + 힙 성장 동반, 게이트 상시 검증).
  async fork(srcPid, dstPid) {
    if (!this.replay) throw new Error("fork: replay 매니페스트로 부팅한 풀에서만 가능하다(new PyProc({ replay }))");
    const src = this.table.find((t) => t.pid === srcPid), dst = this.table.find((t) => t.pid === dstPid);
    if (!src || src.state !== "ready") throw new Error(`fork: src pid ${srcPid} 준비되지 않음`);
    if (!dst || dst.state !== "ready") throw new Error(`fork: dst pid ${dstPid} 준비되지 않음`);
    const h = await this._call(src, { type: "harvest" });
    const applied = await this._call(dst, { type: "applyDelta", bin: h.bin, pages: h.pages, sp: h.sp, heapLen: h.heapLen }, [h.bin]);
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
    for (let i = 0; i < n; i++) spawns.push(this._spawn(useSnapshot).ready);
    const bootMsArr = await Promise.all(spawns);
    return { workers: n, avgBootMs: Math.round(bootMsArr.reduce((a, b) => a + b, 0) / n), forked: useSnapshot };
  }

  // 프로세스 강제 종료(커널 주도, SIGKILL 등가). 테이블에는 dead로 남긴다(이력 조회용).
  // 그 프로세스에 대기 중이던 요청은 전부 명시적으로 reject된다.
  kill(pid) {
    const entry = this.table.find((t) => t.pid === pid);
    if (!entry || entry.state === "dead") return false;
    entry.worker.terminate();
    this._fail(entry, new Error(`pid ${pid} killed`));
    return true;
  }

  // 죽은/행 프로세스 자리를 스냅샷 respawn으로 채운다(풀 크기 유지).
  // 실측(attempts/processLifecycle): respawn 302ms, 행 감지는 이벤트가 없어 타임아웃만 가능.
  async _replace(entry) {
    if (entry.state !== "dead") { entry.worker.terminate(); this._fail(entry, new Error(`pid ${entry.pid} 교체(행 수렴)`)); }
    const s = this._spawn(!!this._snapshot);
    await s.ready;
    return s.entry;
  }

  // Pool.map: 파이썬 함수 소스 fnSrc(def _fn(arg): ...)를 args 리스트에 병렬 적용.
  // 워커들이 동시에 태스크 큐를 소진 = 진짜 병렬(독립 인터프리터).
  // opts.taskTimeoutMs: 태스크별 타임아웃. 초과 시 해당 태스크는 {error}로 수렴하고,
  // 행 워커는 회수 불가(협조적 취소 없음)라 kill + 스냅샷 respawn으로 레인을 복구한다.
  // 워커가 도중에 죽어도 해당 태스크는 {error}로 수렴하고 레인은 respawn으로 계속된다.
  async map(fnSrc, args, opts = {}) {
    const timeoutMs = opts.taskTimeoutMs || 0;
    const results = new Array(args.length);
    let next = 0;
    const lane = async (entry) => {
      while (next < args.length) {
        const i = next++;
        const { reqId, promise } = this._request(entry, { type: "task", fnSrc, arg: args[i] });
        let timer = null;
        const outcome = await Promise.race([
          promise.then((d) => ({ ok: d.result }), (err) => ({ err })),
          ...(timeoutMs ? [new Promise((res) => { timer = setTimeout(() => res({ timeout: true }), timeoutMs); })] : []),
        ]);
        if (timer) clearTimeout(timer);
        if (outcome.timeout) {
          entry.pending.delete(reqId); // 늦은 응답은 라우터가 버린다
          results[i] = { error: `timeout: ${timeoutMs}ms 초과` };
          try { entry = await this._replace(entry); } catch (e) { return; } // respawn 실패 = 레인 종료
        } else if (outcome.err) {
          results[i] = { error: String(outcome.err.message || outcome.err) };
          if (entry.state === "dead") {
            try { entry = await this._replace(entry); } catch (e) { return; }
          }
        } else {
          results[i] = outcome.ok;
        }
      }
    };
    await Promise.all(this._pool().map(lane));
    return results;
  }

  // 큰 TypedArray를 조각내 워커들에 numpy 배열로 병렬 적용(샤딩 map).
  // 실측(attempts/runtimeParity/shardMapProbe): 32MB sort+sum 4워커, 단일 전량 sort 대비 5.28배
  // (샤딩 배속: 조각 정렬은 전역 정렬보다 총 연산량이 적다. same-work 병렬은 게이트 map 수치).
  // 데이터는 SAB로 공유되고 각 워커 안에서 1회 복사로 numpy화된다(memcpy 1회는 불가피).
  // fnSrc: "def _fn(a): ..." (a = 해당 조각의 numpy 1차원 배열). 워커에 numpy가 필요하므로
  // new PyProc({ packages: ["numpy"], setup: "import numpy" })로 부팅하라.
  async mapArray(fnSrc, typed, opts = {}) {
    const parts = opts.parts || this._pool().length;
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
    const entry = this._pool()[0];
    const results = new Array(args.length);
    for (let i = 0; i < args.length; i++) {
      results[i] = await this._call(entry, { type: "task", fnSrc, arg: args[i] }).then((d) => d.result, (err) => ({ error: String(err.message || err) }));
    }
    return results;
  }

  // 프로세스 테이블 스냅샷(pid/state 조회).
  ps() { return this.table.map(({ pid, state, parentPid }) => ({ pid, state, parentPid })); }

  terminate() {
    for (const t of this.table) {
      if (t.state !== "dead") { t.worker.terminate(); this._fail(t, new Error("terminate")); }
    }
    this.table = []; this._seq = 0;
  }
}
