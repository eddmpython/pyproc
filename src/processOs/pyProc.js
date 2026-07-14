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
import { requireCoi } from "../runtime/preflight.js";
import { verifyPyProcAssetIntegrity } from "../runtime/assets.js";
import { createPipe, createLock, createSemaphore, createShm, pipeWriteAsync, pipeReadAsync, pipeClose } from "./ipc.js";

// 시그널 번호(POSIX 관례. 외부 기술 명칭이라 번호는 원어 규격 그대로).
// 워커의 SAB 채널에 쓰면 CPython eval 루프가 해당 핸들러를 부른다(signalTableProbe 실측).
export const SIGNAL = { INT: 2, USR1: 10, USR2: 12, TERM: 15 };

// TypedArray를 SharedArrayBuffer로 1회 복사(제로카피 불가 = memcpy 1회 계약). matmul 입력 공유용.
function _toSab(typed) {
  const sab = new SharedArrayBuffer(typed.byteLength);
  new Uint8Array(sab).set(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength));
  return sab;
}

// matmul 워커 파이썬: arg의 SAB에서 A블록(mp x k)과 전체 B(k x n)를 numpy로 재구성해 C_p = A_p @ B를
// 계산하고, 공유 출력 SAB의 자기 행블록 위치(outOff)에 바이트로 쓴다. SAB는 to_py/frombuffer가
// 직접 못 쓰므로 입력은 .slice()로 워커 로컬 복사, 출력은 pyodide TypedArray.assign(파이썬 버퍼)로
// 공유 뷰에 직접 복사(assign은 파이썬 bytes/memoryview를 버퍼 프로토콜로 받는다).
const MATMUL_FN = [
  "def _fn(arg):",
  "    import js, numpy",
  "    mp = arg.mp; k = arg.k; n = arg.n",
  "    a = numpy.frombuffer(js.Uint8Array.new(arg.aSab, arg.aOff, mp * k * 8).slice().to_py(), dtype='float64').reshape(mp, k)",
  "    b = numpy.frombuffer(js.Uint8Array.new(arg.bSab, 0, k * n * 8).slice().to_py(), dtype='float64').reshape(k, n)",
  "    c = numpy.ascontiguousarray(a @ b)",
  "    js.Uint8Array.new(arg.outSab, arg.outOff, mp * n * 8).assign(c.view(numpy.uint8).reshape(-1))",
  "    return 1",
].join("\n");

export class PyProc {
  constructor(opts = {}) {
    this.indexURL = opts.indexURL || DEFAULT_INDEX;
    this.packages = opts.packages || []; // 각 프로세스가 부팅 시 로드할 패키지(numpy 등)
    this.setup = opts.setup || null;     // 부팅 시 실행할 파이썬(예: "import numpy" 예열)
    this.assetIntegrity = opts.assetIntegrity || null; // pyproc-assets CLI 산출물. Worker spawn 전 graph를 SRI 검증.
    this._assetIntegrityCheck = null;
    // 리플레이 매니페스트({env, packages, setup}): 주면 워커들이 결정적 리플레이로 부팅해
    // 바이트 동일한 힙에 선다 = fork(살아있는 상태 복제)가 가능한 대칭 풀.
    this.replay = opts.replay || null;
    this.table = []; this._seq = 0; this._reqSeq = 0; this._snapshot = null;
  }

  // 살아있는 프로세스 풀(스케줄 대상).
  _pool() { return this.table.filter((t) => t.state === "ready"); }

  async _verifyWorkerAssets() {
    if (!this.assetIntegrity) return null;
    this._assetIntegrityCheck ||= verifyPyProcAssetIntegrity(this.assetIntegrity, { roles: ["processWorker"] });
    return this._assetIntegrityCheck;
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

  // 특정 프로세스 지정 실행. map(풀 스케줄)과 달리 "어느 프로세스에서 도는가"가 의미인
  // 소비자(IPC 생산자/소비자, 잡 컨트롤의 잡 본체)의 프리미티브다. 반환 = 태스크 결과 Promise.
  exec(pid, fnSrc, arg = null) {
    const entry = this.table.find((t) => t.pid === pid);
    if (!entry || entry.state !== "ready") return Promise.reject(new Error(`exec: pid ${pid} 준비되지 않음`));
    return this._call(entry, { type: "task", fnSrc, arg }).then((d) => d.result);
  }

  // REPL 실행: 자유 문장 + stdout 캡처 + 마지막 식 값(jobControl/터미널 본체). 전역 상태 누적.
  // 반환: { out, value }(value = 식의 repr 또는 null). exec와 달리 함수 래핑 없이 raw 실행.
  repl(pid, code) {
    const entry = this.table.find((t) => t.pid === pid);
    if (!entry || entry.state !== "ready") return Promise.reject(new Error(`repl: pid ${pid} 준비되지 않음`));
    return this._call(entry, { type: "repl", code }).then((d) => ({ out: d.out, value: d.value }));
  }

  // ---- IPC 팩토리(파이프/락/세마포어/공유메모리): 커널이 만들고 bind로 프로세스에 배선한다.
  // SAB라 배선은 참조 공유(복사 0)다. 프로세스 안 파이썬은 pyprocIpc 모듈로 만진다.
  // 커널(메인)측 엔드포인트는 read/write(Atomics.waitAsync) = 커널도 파이프의 한쪽이 될 수 있다.
  _bindIpc(pid, item) {
    const entry = this.table.find((t) => t.pid === pid);
    if (!entry || entry.state !== "ready") return Promise.reject(new Error(`bindIpc: pid ${pid} 준비되지 않음`));
    return this._call(entry, {
      type: "bindIpc",
      items: [{ kind: item.kind, name: item.name, sab: item.sab, cap: item.cap || 0, mode: item.mode || null }],
    }).then(() => true);
  }
  pipe(capacity = 1 << 20) {
    const p = createPipe(capacity);
    return {
      ...p,
      bindReader: (pid, name) => this._bindIpc(pid, { ...p, name, mode: "r" }),
      bindWriter: (pid, name) => this._bindIpc(pid, { ...p, name, mode: "w" }),
      write: (bytes) => pipeWriteAsync(p, bytes),
      read: (max = 65536) => pipeReadAsync(p, max),
      close: () => pipeClose(p),
    };
  }
  lock() { const l = createLock(); return { ...l, bind: (pid, name) => this._bindIpc(pid, { ...l, name }) }; }
  semaphore(count = 1) { const s = createSemaphore(count); return { ...s, bind: (pid, name) => this._bindIpc(pid, { ...s, name }) }; }
  shm(byteLength) {
    const s = createShm(byteLength);
    return { ...s, u8: new Uint8Array(s.sab), bind: (pid, name) => this._bindIpc(pid, { ...s, name }) };
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
    // 프로세스 OS는 SAB(crossOriginIsolated)를 요구한다. 헤더 누락 시 여기서 실행 가능한 에러를
    // 던진다(워커 안에서 SharedArrayBuffer is not defined로 죽는 암호 실패를 대신한다).
    requireCoi("PyProc(프로세스 OS)");
    await this._verifyWorkerAssets();
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

  // 샤딩 matmul: C = A@B를 A의 행블록으로 P(워커수)분할, 워커 p가 C_p = A_p @ B를 계산해
  // 공유 출력 SAB에 자기 행블록으로 쓴다(B는 워커당 memcpy 1회 복제). compute-bound(N^3)이라
  // near-linear 배속: 실측(numericShard/shardMatmulProbe) 4워커 3.67배(92% 효율), 전송 오버헤드
  // 무시 가능(14ms). numpy 필요: new PyProc({ packages: ["numpy"], setup: "import numpy" }).
  // a/b = { data: Float64Array, rows, cols }. 반환 { data: Float64Array, rows: a.rows, cols: b.cols }.
  // 정직: 이 배속은 compute-bound 커널의 것이다. memory-bound op(리덕션/값싼 원소별)는 mapArray로
  // 돌리되 배속은 modest하고(전송 O(n)=연산 O(n)), 작은 배열은 전송비로 진다(shardOpsProbe 실측).
  // opts.parts: 샤딩할 워커 수 상한(기본 = 풀 전체). parts:1이면 단일워커 대조(같은 코드 경로 =
  // 공정한 배속 비교의 baseline). 그 외 소비자는 생략(전 코어 활용).
  async matmul(a, b, opts = {}) {
    if (!a || !b || !a.data || !b.data) throw new Error("matmul: a/b는 { data: Float64Array, rows, cols }");
    if (!(a.data instanceof Float64Array) || !(b.data instanceof Float64Array)) throw new Error("matmul: data는 Float64Array(f64 = numpy 기본)");
    if (a.cols !== b.rows) throw new Error(`matmul: 차원 불일치 (${a.rows}x${a.cols}) @ (${b.rows}x${b.cols})`);
    if (a.data.length !== a.rows * a.cols || b.data.length !== b.rows * b.cols) throw new Error("matmul: data 길이가 rows*cols와 불일치");
    const pool = this._pool();
    if (!pool.length) throw new Error("matmul: 준비된 워커 없음(boot 먼저)");
    const M = a.rows, K = a.cols, N = b.cols, P = Math.max(1, Math.min(opts.parts || pool.length, pool.length, M));
    // A, B, 출력 C를 SAB로(공유). A/B 입력은 memcpy 1회로 SAB화(계약: 제로카피 불가).
    const aSab = _toSab(a.data), bSab = _toSab(b.data), outSab = new SharedArrayBuffer(M * N * 8);
    const per = Math.floor(M / P);
    const metas = Array.from({ length: P }, (_, i) => {
      const startRow = i * per, rows = i === P - 1 ? M - startRow : per;
      return { aSab, aOff: startRow * K * 8, mp: rows, k: K, n: N, bSab, outSab, outOff: startRow * N * 8 };
    }).filter((m) => m.mp > 0);
    const res = await this.map(MATMUL_FN, metas);
    const bad = res.find((r) => r && r.error);
    if (bad) throw new Error("matmul: 워커 실패 " + bad.error);
    return { data: new Float64Array(outSab), rows: M, cols: N };
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
