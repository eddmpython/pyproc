// init.js - Layer 1 능력: OS의 init(rc.local + cron + resume). 전부 파일 주도라 배선 코드가 0이다.
// 실측(pythonMachine/initProbe 5/5): 부팅 시 /home/web/boot.py 1회 실행(4ms),
// /home/web/cron.py 주기 틱, 상태는 /home(OPFS)으로 다음 부팅에 계승, 파일 없으면 no-op.
// resume.py는 Session.load/MachineJournal.recover/openMachine 뒤에 소비자가 명시 호출하는 hook이다.
// 힙 델타는 열린 fd/socket/DB connection 같은 프로세스 자원을 보장하지 않으므로 이 hook에서 재개설한다.
// 전제: 실행 전에 디스크가 마운트되어 있어야 한다(Runtime.mountHome 등).
export class Init {
  constructor(rt, cfg = {}) {
    this._rt = rt;
    this._bootPath = cfg.bootPath || "/home/web/boot.py";
    this._resumePath = cfg.resumePath || "/home/web/resume.py";
    this._cronPath = cfg.cronPath || "/home/web/cron.py";
    this._cronMs = cfg.cronMs || 60000;
    this._timer = null;
  }

  _exists(p) {
    this._rt.setGlobal("_pyprocInitPath", p);
    return this._rt.run("import os\nos.path.exists(_pyprocInitPath)") === true;
  }

  _runFile(p) {
    this._rt.setGlobal("_pyprocInitPath", p);
    this._rt.run("exec(open(_pyprocInitPath).read(), globals())");
  }

  // init 파일을 찾아 실행한다. 반환: { boot, resume, cron } (각각 실행/예약 여부).
  install() {
    const ran = { boot: false, resume: false, cron: false };
    if (this._exists(this._bootPath)) { this._runFile(this._bootPath); ran.boot = true; }
    if (this._exists(this._cronPath)) {
      ran.cron = true;
      // 크론 실패는 크론을 죽이지 않는다(OS 관례). 경고만 남기는 best-effort 자리.
      this._timer = setInterval(() => { try { this._runFile(this._cronPath); } catch (e) { console.warn("pyproc cron:", e); } }, this._cronMs);
    }
    return ran;
  }

  // 부활 직후 열린 fd/socket/DB connection 같은 프로세스 자원을 다시 연다. 파일 없으면 no-op.
  // reason은 resume.py가 분기할 수 있도록 전역 pyprocResumeReason으로 주입한다.
  resume(reason = "resume") {
    if (typeof reason !== "string" || reason.length === 0) throw new Error("init.resume: reason은 비어 있지 않은 문자열이어야 한다");
    const ran = { resume: false, reason };
    if (!this._exists(this._resumePath)) return ran;
    this._rt.setGlobal("pyprocResumeReason", reason);
    this._runFile(this._resumePath);
    ran.resume = true;
    return ran;
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }
}
