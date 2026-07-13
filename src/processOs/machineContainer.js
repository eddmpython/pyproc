// machineContainer.js - Layer 2 능력: 머신 안의 머신(P5 machineContainers).
// 도커의 3요소가 브라우저에 완성된다: 이미지(.pymachine + SHA-256 + trust, session.js) +
// 레지스트리(OPFS) + **실행(이 능력 = 컨테이너 커널을 워커에 띄운다)**. 각 컨테이너는 자기
// 매니페스트(자기 패키지 세트)로 부팅한 독립 커널이고, 부모 파이썬에 값(m)으로 노출된다.
// 중첩(깊이 2+): 컨테이너가 자기 자식 컨테이너를 spawn한다(machineWorker.js가 재귀적으로).
// 내부 kill은 그 워커만 죽인다 = 외부 무영향(주소공간 독립). machineWorker.js는 같은 폴더 고정.
//
// 파이썬 표면: pyprocMachine.spawn(manifest?) -> 컨테이너 객체(run/spawn/kill/heapLen).
// run은 async RPC라 파이썬은 run_sync(JSPI)로 서스펜드해 결과를 동기처럼 받는다(rt.runAsync 경로).
// 브리지는 pyodide 전역 객체(_pyprocMachineBridge)로 준다(socketBridge와 같은 패턴 = js 모듈이
// 아니라 전역 이름으로 접근). 반환 프록시(Promise)는 run_sync가 서스펜드해 값으로 만든다.
const BOOTSTRAP = `
import sys as _pyprocSys, types as _pyprocTypes, json as _pyprocJson
from pyodide.ffi import run_sync as _pyprocRunSync

_pyprocMachineMod = _pyprocTypes.ModuleType('pyprocMachine')

class _PyprocMachine:
    def __init__(self, cid):
        self.cid = cid
    def run(self, code):
        return _pyprocRunSync(_pyprocMachineBridge.run(self.cid, code))
    def spawn(self, manifest=None):
        childCid = _pyprocRunSync(_pyprocMachineBridge.spawnChild(self.cid, _pyprocJson.dumps(manifest or {})))
        return _PyprocMachine(childCid)
    def heapLen(self):
        return _pyprocRunSync(_pyprocMachineBridge.heap(self.cid))
    def kill(self):
        _pyprocMachineBridge.kill(self.cid)

def _pyprocSpawn(manifest=None):
    cid = _pyprocRunSync(_pyprocMachineBridge.spawn(_pyprocJson.dumps(manifest or {})))
    return _PyprocMachine(cid)

_pyprocMachineMod.spawn = _pyprocSpawn
_pyprocSys.modules['pyprocMachine'] = _pyprocMachineMod
`;

export class MachineContainer {
  constructor(rt, cfg = {}) {
    this._rt = rt;
    this._indexURL = cfg.indexURL || rt.indexURL;
    this._containers = new Map(); // cid -> { worker, pending, parentCid|null }
    this._seq = 0;
    this._snapshot = null; // bare 스냅샷(1회 제조, 모든 컨테이너가 fast fork로 공유)
  }

  // 컨테이너 fast fork용 bare 스냅샷을 1회 제조한다(PyProc._makeSnapshot과 같은 원리).
  async _makeSnapshot() {
    const mod = await import(this._indexURL + "pyodide.mjs");
    const parent = await mod.loadPyodide({ indexURL: this._indexURL, _makeSnapshot: true });
    const snap = parent.makeMemorySnapshot();
    const sab = new SharedArrayBuffer(snap.byteLength); // SAB = 중첩 자식까지 detach 없이 공유
    new Uint8Array(sab).set(snap);
    this._snapshot = sab;
  }

  _spawnWorker() {
    const cid = "m" + ++this._seq;
    const worker = new Worker(new URL("./machineWorker.js", import.meta.url), { type: "module" });
    const pending = new Map();
    worker.addEventListener("message", (e) => {
      const p = pending.get(e.data.reqId);
      if (!p) return;
      pending.delete(e.data.reqId);
      if (e.data.type === "error") p.reject(new Error(e.data.error)); else p.resolve(e.data);
    });
    worker.addEventListener("error", (e) => {
      for (const p of pending.values()) p.reject(new Error(`컨테이너 ${cid} 크래시: ${e.message || "unknown"}`));
      pending.clear();
    });
    this._containers.set(cid, { worker, pending });
    return cid;
  }

  _call(cid, msg) {
    const c = this._containers.get(cid);
    if (!c) return Promise.reject(new Error(`machineContainer: ${cid} 없음(killed?)`));
    const reqId = ++this._seq;
    return new Promise((resolve, reject) => {
      c.pending.set(reqId, { resolve, reject });
      c.worker.postMessage({ ...msg, reqId });
    });
  }

  // JS API: 컨테이너 부팅. manifest = { env, packages, setup }(컨테이너의 자기 패키지 세트).
  async spawn(manifest = {}) {
    if (!this._snapshot) await this._makeSnapshot(); // 첫 컨테이너에서 스냅샷 제조(이후 fast fork)
    const cid = this._spawnWorker();
    const booted = await this._call(cid, { type: "boot", indexURL: this._indexURL, snapshot: this._snapshot, manifest });
    return {
      cid,
      bootMs: booted.bootMs,
      run: (code) => this._call(cid, { type: "run", code }).then((r) => r.result),
      heapLen: () => this._call(cid, { type: "heap" }).then((r) => r.heapLen),
      kill: () => this.kill(cid),
    };
  }

  kill(cid) {
    const c = this._containers.get(cid);
    if (!c) return false;
    c.worker.terminate();
    for (const p of c.pending.values()) p.reject(new Error(`컨테이너 ${cid} killed`));
    this._containers.delete(cid);
    return true;
  }

  // 파이썬 표면 배선: pyprocMachine.spawn()이 파이썬 값을 돌려준다. 블로킹 = JSPI(rt.runAsync 경로).
  // cid 규칙: 최상위는 "m3", 중첩 자식은 "m3/c1"(부모워커 소유). "/"면 부모 워커에 callChild로 라우팅.
  install() {
    const bridge = {
      spawn: async (manifestJson) => (await this.spawn(JSON.parse(manifestJson))).cid,
      run: (cid, code) => cid.includes("/")
        ? this._call(cid.split("/")[0], { type: "callChild", childCid: cid.split("/")[1], code }).then((r) => r.result)
        : this._call(cid, { type: "run", code }).then((r) => r.result),
      spawnChild: async (parentCid, manifestJson) => {
        const r = await this._call(parentCid, { type: "spawnChild", indexURL: this._indexURL, manifest: JSON.parse(manifestJson) });
        return parentCid + "/" + r.childCid;
      },
      heap: (cid) => this._call(cid, { type: "heap" }).then((r) => r.heapLen),
      kill: (cid) => cid.includes("/")
        ? this._call(cid.split("/")[0], { type: "killChild", childCid: cid.split("/")[1] }).then(() => true)
        : this.kill(cid),
    };
    // 단일 브리지 객체를 pyodide 전역에 둔다(socketBridge 패턴). 파이썬은 _pyprocMachineBridge로 만진다.
    this._rt.setGlobal("_pyprocMachineBridge", bridge);
    this._rt.run(BOOTSTRAP);
    return { installed: "pyprocMachine" };
  }

  terminate() {
    for (const cid of [...this._containers.keys()]) this.kill(cid);
  }
}
