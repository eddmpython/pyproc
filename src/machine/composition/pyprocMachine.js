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
    if (!Number.isInteger(index)) throw new PyProcError("PYPROC_INPUT_INVALID", "history.restore: 체크포인트 핸들 또는 인덱스가 필요하다");
    return this._reactive.restoreLive(index, null, opts);
  }
  tree() { return this._reactive.tree(); }
  prune(target) {
    const index = typeof target === "number" ? target : target?.index;
    return this._reactive.pruneTo(index);
  }

  // ---- 내구 구역: 커널 커밋(저널)과 이동 bundle. sha256 승격은 여기서만 일어난다 ----
  _journal(opts = {}) {
    if (!opts.dir) throw new PyProcError("PYPROC_INPUT_INVALID", "history: { dir }(FileSystemDirectoryHandle)가 필요하다");
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
        "history.export: 결정적 리플레이 부팅(boot({ deterministic: true }))에서만 내보낼 수 있다. 비결정 출신 상태에는 리플레이 보증이 없다(조용한 보증 소실 금지).");
    }
    return session.exportImage(opts);
  }
  save(dir, name) {
    const session = this._machine._session;
    if (!session) throw new PyProcError("PYPROC_INPUT_INVALID", "history.save: 결정적 리플레이 부팅에서만 저장할 수 있다(부활 = 리플레이 + 델타).");
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
  async proc(opts = {}) {
    const { PyProc } = await import("../../processOs/pyProc.js");
    const { lanes = 2, useSnapshot = true, ...procOpts } = opts;
    const pool = new PyProc({ indexURL: this._rt.indexURL, assetIntegrity: this._rt.assetIntegrity, ...procOpts });
    await pool.boot(lanes, useSnapshot);
    return pool;
  }
}

// 첫 guest 고속 경로: 파이썬 머신 하나를 부팅해 핸들을 돌려준다.
// deterministic: true면 결정적 리플레이 부팅(manifest = env/packages/setup/wheelDir...)이고,
// 그 선택은 이후 모든 내구 커밋의 환경 지문(deterministic 플래그)에 기록된다.
export async function boot(options = {}) {
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
  throw new PyProcError("PYPROC_INPUT_INVALID", "open: Blob/bytes(bundle), { dir, name }(세션 저장), { persistent }(멀티탭 영속) 중 하나가 필요하다");
}
