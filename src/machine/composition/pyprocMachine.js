// pyprocMachine.js - porcelain 머신 핸들: 표면이 내부 구조가 아니라 모델을 말한다.
//
// pyproc의 한 명사는 "역사를 가진 브라우저 컴퓨터"다. 진입 동사는 둘뿐이고(boot = 첫 guest
// 고속 경로, createWebComputer = 컴퓨터), 둘 다 핸들을 돌려준다. 핸들의 네임스페이스가 모델을
// 어휘로 가른다: run(실행), fs(파일), term(터미널), proc(프로세스 = fork/map/shard),
// history(두 구역의 역사 - checkpoint/restore는 휘발, commit/recover/export는 내구).
// 능력 상세(syscall, asgi, deviceFs, journal 옵션 등)는 runtime 탈출구로 그대로 연다:
// porcelain은 요약이지 감옥이 아니다.
//
// 결정적 리플레이 부팅은 opt-in이다({ deterministic: true }): PYTHONHASHSEED=0 + 엔트로피
// 스텁은 게스트 가시 의미론을 바꾸므로 기본화하지 않는다(state-kernel 기각 4). 내보내기
// (history.export)는 리플레이 보증이 있는 결정 부팅에서만 성립하고, 비결정 머신에서는
// 명시적 예외다(조용한 보증 소실 금지).
import { PyProcError } from "../../runtime/errors.js";
import { boot as bootRuntime } from "../../composition/runtimeApi.js";
import { bootSession, openMachine } from "../../session/session.js";
import { openPersistentMachine } from "../../session/kernelElection.js";

const DEFAULT_PROC_LANES = 2; // 워커 2개 = 대부분의 기기에서 안전한 기본값(코어 수와 무관하게 시작)
// boot가 받는 키 전수. 미지의 키를 조용히 버리면 오타 하나(`determinstic`)가 무증상 비결정
// 부팅이 되고, 실패는 훨씬 뒤 history.export에서 나타난다(30분 잃는 경로). 그래서 입구에서 막는다.
// 목록의 정본은 index.d.ts의 BootMachineOptions이고 tests/run.mjs가 둘의 일치를 대조한다.
const BOOT_MACHINE_OPTION_KEYS = Object.freeze([
  "deterministic", "setup", "wheelDir",
  "indexURL", "stdout", "stderr", "packages", "env", "coreCacheDir",
  "engineScriptIntegrity", "coreIntegrity", "assetIntegrity", "lockFileURL", "loadPyodide",
]);

// 오타를 침묵으로 만들지 않는다. 받은 키 이름을 그대로 돌려주고 가까운 후보를 제시한다.
function assertKnownOptions(options, allowed, verb) {
  if (!options || typeof options !== "object") return;
  const unknown = Object.keys(options).filter((key) => !allowed.includes(key));
  if (!unknown.length) return;
  const near = (key) => allowed.find((candidate) => candidate.toLowerCase().startsWith(key.slice(0, 4).toLowerCase()));
  const hints = unknown.map((key) => (near(key) ? `${key} (did you mean ${near(key)}?)` : key));
  throw new PyProcError("PYPROC_INPUT_INVALID",
    `${verb}: unknown option(s): ${hints.join(", ")}. Known options: ${allowed.join(", ")}.`);
}

class PyprocHistory {
  constructor(machine) {
    this._machine = machine;
    this._journals = new Map(); // dir 핸들 -> MachineJournal (dir당 하나)
  }
  get _reactive() { return this._machine._reactive; }

  // ---- 휘발 구역: 체크포인트 나무(시간여행·분기·%undo·fork의 기반) ----
  checkpoint() { return this._reactive.checkpoint(); }
  restore(target, opts = {}) {
    const index = typeof target === "number" ? target : target?.index;
    if (!Number.isInteger(index)) throw new PyProcError("PYPROC_INPUT_INVALID", "history.restore: needs a checkpoint handle or an integer index");
    return this._reactive.restoreLive(index, null, opts);
  }
  tree() { return this._reactive.tree(); }
  prune(target) {
    const index = target == null ? this._reactive.liveIdx : (typeof target === "number" ? target : target?.index);
    return this._reactive.pruneTo(index);
  }
  stats() { return this._reactive.stats(); }
  setRetentionPolicy(policy) { return this._reactive.setRetentionPolicy(policy); }

  // ---- 내구 구역: 커널 커밋(저널)과 이동 bundle. sha256 승격은 여기서만 일어난다 ----
  _journal(opts = {}) {
    if (!opts.dir) throw new PyProcError("PYPROC_INPUT_INVALID", "history: needs { dir } (a FileSystemDirectoryHandle). Get one with navigator.storage.getDirectory()");
    let journal = this._journals.get(opts.dir);
    if (!journal) {
      journal = this._machine._rt.enableJournal({ reactive: this._reactive, ...opts });
      this._journals.set(opts.dir, journal);
    }
    return journal;
  }
  commit(opts) { return this._journal(opts).commit(); }
  recover(opts) { return this._journal(opts).recover(); }
  // 유휴 감시(WAL): durable 주장의 실패는 onStatus로 관측 가능하다.
  watch(opts) { return this._journal(opts).start(); }
  pack(opts) { return this._journal(opts).pack(); }

  // 이동 가능한 서명 bundle. 결정 부팅 전용: 비결정 출신 커밋에는 리플레이 보증이 없다.
  export(opts = {}) {
    const session = this._machine._session;
    if (!session) {
      throw new PyProcError("PYPROC_INPUT_INVALID",
        "history.export: only a deterministic-replay machine can be exported. Boot with boot({ deterministic: true }); state from a non-deterministic boot carries no replay guarantee, and this refuses rather than lose that guarantee silently.");
    }
    return session.exportImage(opts);
  }
  save(dir, name) {
    const session = this._machine._session;
    if (!session) throw new PyProcError("PYPROC_INPUT_INVALID", "history.save: only a deterministic-replay machine can be saved. Revival is replay plus delta, so boot with boot({ deterministic: true }).");
    return session.save(dir, name);
  }
}

export class PyprocMachine {
  constructor({ rt, reactive, session = null }) {
    this._rt = rt;
    this._reactive = reactive;
    this._session = session;
    this.history = new PyprocHistory(this);
  }
  // 탈출구(고급): 조립된 Runtime. 능력 상세(enableSyscallBridge, enableAsgiServer,
  // enableDeviceFs, loadPackages, install...)는 여기로 연다.
  get runtime() { return this._rt; }
  get deterministic() { return this._session !== null; }
  run(code) { return this._rt.run(code); }
  runAsync(code) { return this._rt.runAsync(code); }
  get fs() { return this._rt.fs; }
  term(cfg) { return this._rt.enableTerminal(cfg); }
  // 프로세스 풀(워커 = 프로세스, 독립 GIL): fork/forkMany/map/mapArray/matmul은 풀의 동사다.
  // 같은 머신에 풀은 하나로 유지한다. 호출마다 새 풀을 만들면 컴포넌트 재마운트가 워커를
  // 쌓아 올리고(레인마다 독립 인터프리터 = 수백 MB), 원인이 pyproc이라는 단서가 남지 않는다.
  // enableReactive가 memoize되는 것을 본 소비자는 proc도 그럴 것이라 합리적으로 기대한다.
  async proc(opts = {}) {
    if (this._procPending) return this._procPending;
    this._procPending = (async () => {
      const { PyProc } = await import("../../processOs/pyProc.js");
      const { lanes = DEFAULT_PROC_LANES, useSnapshot = true, ...procOpts } = opts;
      const pool = new PyProc({ indexURL: this._rt.indexURL, assetIntegrity: this._rt.assetIntegrity, ...procOpts });
      await pool.boot(lanes, useSnapshot);
      this._proc = pool;
      return pool;
    })();
    try { return await this._procPending; } catch (error) { this._procPending = null; throw error; }
  }
  // 회수 동사. 풀 핸들을 잃으면 워커를 되돌릴 방법이 없어서 머신 자신이 회수구를 갖는다.
  async dispose() {
    const pool = this._proc;
    this._proc = null;
    this._procPending = null;
    if (pool) await pool.terminate();
    this._reactive.dispose();
  }
}

// 첫 guest 고속 경로: 파이썬 머신 하나를 부팅해 핸들을 돌려준다.
// deterministic: true면 결정적 리플레이 부팅(manifest = env/packages/setup/wheelDir...)이고,
// 그 선택은 이후 모든 내구 커밋의 환경 지문(deterministic 플래그)에 기록된다.
export async function boot(options = {}) {
  assertKnownOptions(options, BOOT_MACHINE_OPTION_KEYS, "boot");
  const { deterministic = false, ...rest } = options;
  if (deterministic) {
    const session = await bootSession(rest);
    return new PyprocMachine({ rt: session.rt, reactive: session.reactive, session });
  }
  const rt = await bootRuntime(rest);
  const reactive = rt.enableReactive();
  reactive.checkpoint(); // cp0: history의 기준 경계
  return new PyprocMachine({ rt, reactive });
}

// 부활 통합 동사: 어디서 왔는가에 따라 신뢰 계약이 갈라진다(의미론 평탄화 금지).
// - Blob/bytes(외부 bundle): 힙 접촉 전 봉투 무결성 + 서명 검증. trust 게이트 필수.
// - { dir, name }(자기 OPFS 세션 저장): 같은 매니페스트 리플레이 + h0 대조 후 델타 적용.
// - { persistent }(멀티탭 영속 머신): Web Locks 선출 + 저널 부활(KernelElection 핸들 반환).
export async function open(source, opts = {}) {
  if (source instanceof Blob || source instanceof Uint8Array || source instanceof ArrayBuffer) {
    const blob = source instanceof Blob ? source : new Blob([source]);
    const session = await openMachine(blob, opts);
    return new PyprocMachine({ rt: session.rt, reactive: session.reactive, session });
  }
  if (source && typeof source === "object" && source.persistent) {
    return openPersistentMachine(source.persistent === true ? opts : { ...source.persistent, ...opts });
  }
  if (source && typeof source === "object" && source.dir && source.name) {
    const session = await bootSession(opts.manifest || {});
    await session.load(source.dir, source.name);
    return new PyprocMachine({ rt: session.rt, reactive: session.reactive, session });
  }
  throw new PyProcError("PYPROC_INPUT_INVALID", "open: needs one of a Blob/bytes bundle, { dir, name } (a saved session), or { persistent } (the multi-tab machine)");
}
