// jobControl.js - Layer 2: 셸의 잡 컨트롤(P3). 브라우저 파이썬에 job control이 존재한 적 없다.
// `expr &`는 지금 대화형 네임스페이스를 **살아있는 채로 fork(2)**해 딴 코어에서 돌린다(forkLive).
// 프롬프트는 즉시 돌아오고(< 100ms), 잡은 백그라운드 레인에서 완주한다. %jobs/%fg/%kill이 잡을
// 조종한다(%kill = SIGTERM). fork(2)는 워커끼리만 대칭이므로(메인 vs 워커 리플레이는 바이트가
// 다르다 - forkLiveProbe 벽) 대화형 REPL도 워커 레인에서 돈다: PyProc replay 풀 위에 선다.
// 레인 0 = 대화형(상태 누적), 레인 1..N = 잡 슬롯. 실측: tests/attempts/pythonMachine/jobControlProbe.
import { PyProc, SIGNAL } from "./pyProc.js";
import { PyProcError } from "../runtime/errors.js";

export class JobControl {
  constructor(opts = {}) {
    this._workers = opts.workers || 3; // 대화형 1 + 잡 슬롯 N-1
    this._os = new PyProc({ replay: opts.replay || {}, indexURL: opts.indexURL, assetIntegrity: opts.assetIntegrity || null });
    this._interactivePid = null;
    this._free = [];   // 자유 잡 레인 pid 큐
    this._jobs = new Map(); // jobId -> { pid, code, state, promise, result }
    this._jobSeq = 0;
  }

  // 풀 부팅(리플레이 = fork 대칭). 레인 0을 대화형으로, 나머지를 잡 슬롯으로 배정한다.
  async boot() {
    await this._os.boot(this._workers, false); // 리플레이 부팅(스냅샷 아님 = 바이트 동일 경계)
    const pids = this._os.ps().map((p) => p.pid);
    this._interactivePid = pids[0];
    this._free = pids.slice(1);
    return { workers: this._workers, interactivePid: this._interactivePid, jobSlots: this._free.length };
  }

  // 한 줄 입력. `&`로 끝나면 잡(백그라운드), 아니면 대화형 실행.
  // 반환: 대화형이면 { out, value }, 잡이면 { job: jobId, pid }.
  async push(line) {
    const trimmed = line.replace(/\s+$/, "");
    if (trimmed.endsWith("&")) return this._spawnJob(trimmed.slice(0, -1).trim());
    return this._os.repl(this._interactivePid, line);
  }

  // 잡 생성: 대화형 레인을 자유 잡 레인에 fork(살아있는 네임스페이스 복제) 후 그 레인에서 실행.
  // 프롬프트는 즉시 돌아온다(잡 promise는 백그라운드). 자유 레인이 없으면 명시적 예외.
  async _spawnJob(code) {
    if (!this._free.length) throw new PyProcError("PYPROC_POOL_EXHAUSTED", "jobControl: 자유 잡 레인 없음(모든 슬롯 사용 중)", { retryable: true });
    const pid = this._free.shift();
    const jobId = ++this._jobSeq;
    await this._os.fork(this._interactivePid, pid); // 대화형 상태를 잡 레인으로 복제(43ms급)
    const job = { pid, code, state: "running", result: null };
    this._jobs.set(jobId, job);
    // 백그라운드 실행: 완료/실패/시그널 종료를 잡 상태에 기록하고 레인을 회수한다.
    job.promise = this._os.repl(pid, code).then(
      (r) => { job.state = "done"; job.result = r; return r; },
      (e) => {
        if (job.state === "killed") return job.result; // killHard가 이미 종결(레인 교체됨)
        // 시그널 종료 판정은 문자열이 아니라 워커 경계를 건너온 파이썬 예외 타입으로 한다.
        const pyExcType = (e && e.context && e.context.pyExcType) || "";
        job.state = (pyExcType === "KeyboardInterrupt" || pyExcType === "SystemExit") ? "killed" : "error";
        job.result = { error: String((e && e.message) || e).slice(-200) };
        return job.result;
      },
    ).finally(() => { if (!job.laneReplaced) this._free.push(pid); }); // 레인 회수(killHard가 교체했으면 새 pid가 이미 큐에 있다)
    return { job: jobId, pid };
  }

  // 잡 테이블(/proc/jobs 등가): { jobId, pid, state, code }.
  jobs() {
    return [...this._jobs.entries()].map(([jobId, j]) => ({ jobId, pid: j.pid, state: j.state, code: j.code }));
  }

  // 잡을 포그라운드로: 완료를 기다려 결과({ out, value } 또는 { error })를 반환한다.
  async fg(jobId) {
    const job = this._jobs.get(jobId);
    if (!job) throw new PyProcError("PYPROC_INPUT_INVALID", `fg: 잡 ${jobId} 없음`);
    return job.promise;
  }

  // 잡에 시그널(기본 SIGINT = 협조 불요 하드 인터럽트, 실행 중 잡을 확실히 회수한다). SIGTERM 등
  // 다른 번호는 잡이 signal.signal로 건 핸들러가 있을 때 발화한다. 워커는 생존·재사용.
  kill(jobId, signum = SIGNAL.INT) {
    const job = this._jobs.get(jobId);
    if (!job) return false;
    return this._os.signal(job.pid, signum);
  }

  // 협조 시그널이 통하지 않는 잡(인터럽트 미지원 워커, KeyboardInterrupt를 삼키는 루프)의
  // 최후 수단: 워커를 강제 종료하고 같은 replay 매니페스트로 레인을 재부팅해 회수한다
  // (fork 대칭 유지 = 새 레인도 잡 슬롯으로 계속 쓸 수 있다). 잡 상태는 "killed"로 종결된다.
  async killHard(jobId) {
    const job = this._jobs.get(jobId);
    if (!job || job.state !== "running") return false;
    job.state = "killed";
    job.result = { error: "killHard: 워커 강제 종료 후 레인 재부팅" };
    job.laneReplaced = true; // finally의 구 pid 회수를 봉인(죽은 pid가 자유 큐에 남지 않게)
    const { pid } = await this._os.respawn(job.pid);
    this._free.push(pid);
    return true;
  }

  terminate() { this._os.terminate(); this._jobs.clear(); }
}
