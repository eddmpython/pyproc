// kernelElection.js - Layer 2: 커널 선출(P2). OS가 자기 하드웨어(탭)의 죽음에서 생존한다.
// 여러 탭이 Web Locks로 리더 하나를 뽑고, 리더만 커널(bootSession + 저널)을 부팅한다. 나머지
// 탭은 BroadcastChannel로 리더에 RPC하는 뷰다(= 여러 탭 = 한 파이썬 상태). 리더 탭이 죽으면
// (닫힘/크래시) 락이 자동 해제되고, 대기 중이던 팔로워가 락을 얻어 새 리더가 된다. 새 리더는
// **저널에서 resume**하므로 죽기 전 마지막 커밋 이후만 잃는다. SharedWorker(COI=false = SAB 불가)의
// 약속을 SAB 포기 없이 달성한다: 리더의 커널은 자기 문서(COI 상속)에 살아 SAB 전능력을 유지한다.
// 실측: tests/attempts/pythonMachine/kernelElectionProbe.html(iframe N개 = 탭 N개, 리더 iframe
// 제거 = 탭 죽음). bootSession/MachineJournal은 Layer 1이라 이 파일이 위에서 조립한다.
import { bootSession } from "../capabilities/session.js";
import { MachineJournal } from "../capabilities/machineJournal.js";

export class KernelElection {
  constructor(opts = {}) {
    this.name = opts.name || "pyprocKernel";
    this.manifest = opts.manifest || {};
    this._journalDir = opts.journalDir || null; // 저널 디렉터리(OPFS). 없으면 failover 상태 소실(경고).
    this._lockName = "pyprocKernelLeader/" + this.name;
    this._chanName = "pyprocKernelRpc/" + this.name;
    this._role = "idle"; // idle | pending | leader | follower
    this._session = null; this._journal = null;
    this._chan = null; this._seq = 0; this._pending = new Map();
    this._releaseLeader = null;
    this._onLeader = opts.onLeader || null; // 리더가 됐을 때(초기 or failover) 콜백(recovered 여부 전달)
  }

  // 선출에 참여한다. 락을 얻으면 리더(커널 부팅), 못 얻으면 팔로워(RPC 뷰). 리더가 죽으면
  // 대기하던 이 참여자가 승격될 수 있다(navigator.locks가 큐를 관리).
  join() {
    this._chan = new BroadcastChannel(this._chanName);
    this._chan.onmessage = (e) => this._onChannel(e.data);
    this._role = "pending";
    // 락 요청: 콜백이 실행되는 동안 = 내가 리더. 콜백 promise가 pending인 한 락을 쥔다.
    // 페이지 언로드/컨텍스트 파괴 시 브라우저가 자동 해제 = failover 트리거.
    navigator.locks.request(this._lockName, async () => {
      await this._becomeLeader();
      await new Promise((resolve) => { this._releaseLeader = resolve; });
    }).catch(() => {});
    return this;
  }

  async _becomeLeader() {
    this._role = "leader";
    this._session = await bootSession(this.manifest);
    let recovered = false;
    if (this._journalDir) {
      this._journal = new MachineJournal(this._session.rt, { dir: this._journalDir, reactive: this._session.reactive });
      const rec = await this._journal.recover(); // 이전 리더의 마지막 커밋에서 부활
      recovered = !!rec;
      this._journal.start();
    }
    // 리더는 이제 채널의 RPC를 커널에서 실행해 응답한다(팔로워 뷰들에게 서빙).
    this._servingLeader = true;
    if (this._onLeader) this._onLeader({ recovered });
  }

  _onChannel(msg) {
    if (msg.type === "rpcReq" && this._role === "leader" && this._servingLeader) {
      // 리더만 응답한다. 커널에서 실행하고 결과를 방송(reqId로 상관).
      this._serve(msg);
    } else if (msg.type === "rpcRes") {
      const p = this._pending.get(msg.reqId);
      if (p) { this._pending.delete(msg.reqId); msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result); }
    }
  }

  async _serve(msg) {
    try {
      const r = msg.async ? await this._session.rt.runAsync(msg.code) : this._session.rt.run(msg.code);
      const result = r && r.toJs ? r.toJs() : (r === undefined ? null : r);
      if (r && r.destroy) r.destroy();
      this._chan.postMessage({ type: "rpcRes", reqId: msg.reqId, result });
    } catch (err) {
      this._chan.postMessage({ type: "rpcRes", reqId: msg.reqId, error: String(err).slice(-300) });
    }
  }

  // 코드 실행. 리더면 자기 커널에서, 팔로워면 리더에 RPC. 리더 부재(failover 중)면
  // 재선출을 기다렸다가 재시도한다(timeoutMs 안에서). 반환: 결과 값.
  async run(code, opts = {}) {
    const async_ = !!opts.async;
    if (this._role === "leader" && this._servingLeader) {
      const r = async_ ? await this._session.rt.runAsync(code) : this._session.rt.run(code);
      const v = r && r.toJs ? r.toJs() : (r === undefined ? null : r);
      if (r && r.destroy) r.destroy();
      return v;
    }
    // 팔로워: 채널로 RPC. 리더가 없으면(failover 창) 재시도.
    const timeoutMs = opts.timeoutMs || 8000;
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      try {
        return await this._rpc(code, async_, Math.max(500, deadline - performance.now()));
      } catch (e) {
        if (performance.now() >= deadline) throw e;
        await new Promise((r) => setTimeout(r, 200)); // 리더 재선출 대기
      }
    }
  }

  _rpc(code, async_, waitMs) {
    const reqId = this.name + "/" + (++this._seq) + "/" + Math.floor(waitMs); // 컨텍스트별 고유(waitMs로 지문)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this._pending.delete(reqId); reject(new Error("kernelElection: RPC 타임아웃(리더 부재?)")); }, waitMs);
      this._pending.set(reqId, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this._chan.postMessage({ type: "rpcReq", reqId, code, async: async_ });
    });
  }

  // 저널 커밋(상태를 디스크에 확정 = failover 생존 경계). 리더만 유효.
  async commit() { return this._journal ? this._journal.commit() : null; }

  role() { return this._role; }

  // 이 참여자를 선출에서 뺀다(탭 닫힘 시뮬레이션). 리더면 락을 놓아 failover를 튼다.
  leave() {
    if (this._journal) this._journal.stop();
    if (this._releaseLeader) { this._releaseLeader(); this._releaseLeader = null; }
    this._servingLeader = false;
    if (this._chan) this._chan.close();
    this._role = "idle";
  }
}
