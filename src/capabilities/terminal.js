// terminal.js - Layer 1 능력: 서버리스 파이썬 터미널 (탭 = REPL).
// CPython 정식 REPL 기계(code.InteractiveConsole)를 커널 안에 세운다. 셸이 별도 발명이
// 아니라 파이썬 그 자체가 셸이다. 실측: tests/attempts/runtimeParity/terminalProbe.html
// (식 평가/다중행/상태 유지, REPL 안 input() 블로킹 재개 24ms).
// input() 블로킹은 syscallBridge의 inputAsync(JSPI run_sync)와 조합한다. push()가
// runAsync 경로인 이유가 그것이다(서스펜더 확보).
//
// timeTravel 옵션: 완결 문장마다 복원 리액티브 체크포인트를 자동으로 닫고,
// "%undo" 입력이 직전 상태로 시간여행한다(로컬 REPL에는 없는 능력).
const SETUP = `
import code as _pyproc_code, io as _pyproc_io, contextlib as _pyproc_ctx
_pyproc_con = _pyproc_code.InteractiveConsole()
def _pyproc_term_push(line):
    buf = _pyproc_io.StringIO()
    with _pyproc_ctx.redirect_stdout(buf), _pyproc_ctx.redirect_stderr(buf):
        more = _pyproc_con.push(line)
    return [bool(more), buf.getvalue()]
`;

export class Terminal {
  constructor(rt, cfg = {}) {
    this._rt = rt;
    this._tt = !!cfg.timeTravel;
    this._reactive = null; this._sp = null; this._marks = [];
  }

  async install() {
    this._rt.run(SETUP);
    if (this._tt) {
      this._reactive = this._rt.enableReactive();
      this._sp = this._reactive.stackSave();
      this._marks.push(this._reactive.checkpoint().index);
    }
    return { repl: "code.InteractiveConsole", timeTravel: this._tt };
  }

  // 한 줄 입력 -> { more: 연속행 대기 여부(... 프롬프트), out: stdout+stderr 출력 }.
  // timeTravel이면 "%undo"가 직전 완결 문장 이전 상태로 복원한다.
  async push(line) {
    if (this._tt && line.trim() === "%undo") {
      if (this._marks.length < 2) return { more: false, out: "%undo: 되돌릴 상태가 없다\n" };
      this._marks.pop();
      this._reactive.restoreLive(this._marks[this._marks.length - 1], this._sp);
      return { more: false, out: "" };
    }
    this._rt.setGlobal("_pyproc_term_line", line);
    const r = await this._rt.runAsync("_pyproc_term_push(_pyproc_term_line)");
    const [more, out] = r.toJs ? r.toJs() : r;
    if (this._tt && !more) this._marks.push(this._reactive.checkpoint().index); // 완결 문장 = 경계
    return { more, out };
  }
}
