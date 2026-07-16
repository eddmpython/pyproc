// machineContainer.js - Layer 2 능력: 머신 안의 머신(P5 machineContainers).
// 도커의 3요소가 브라우저에 완성된다: 이미지(.pymachine + SHA-256 + trust, session.js) +
// 레지스트리(OPFS) + **실행(이 능력 = 컨테이너 커널을 워커에 띄운다)**. 각 컨테이너는 자기
// 매니페스트(자기 패키지 세트)로 부팅한 독립 커널이고, 부모 파이썬에 값(m)으로 노출된다.
// 중첩(깊이 임의): 컨테이너가 자기 자식 컨테이너를 spawn하고 경로 라우터(route)가 층을 내려간다.
// 내부 kill은 그 워커만 죽인다 = 외부 무영향(주소공간 독립). machineWorker.js는 같은 폴더 고정.
//
// 파이썬 표면: pyprocMachine.spawn(manifest?) -> 컨테이너 객체(run/spawn/kill/heapLen).
// run은 async RPC라 파이썬은 run_sync(JSPI)로 서스펜드해 결과를 동기처럼 받는다(rt.runAsync 경로).
// 브리지는 pyodide 전역 객체(_pyprocMachineBridge)로 준다(socketBridge와 같은 패턴 = js 모듈이
// 아니라 전역 이름으로 접근). 반환 프록시(Promise)는 run_sync가 서스펜드해 값으로 만든다.
import { verifyPyProcAssetIntegrity } from "../runtime/assets.js";
import { PyProcError } from "../runtime/errors.js";
import { createRpcPort } from "./rpcChannel.js";

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
    this._containers = new Map(); // cid -> { worker, port }
    this._seq = 0; // cid 발급 전용(요청 상관은 rpcChannel의 자기 카운터가 소유)
    this._snapshot = null; // bare 스냅샷(1회 제조, 모든 컨테이너가 fast fork로 공유)
    this._assetIntegrity = cfg.assetIntegrity || rt.assetIntegrity || null;
    this._assetIntegrityCheck = null;
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
    // RPC 상관과 크래시 수렴은 rpcChannel이 소유한다. 크래시한 컨테이너로의 이후 호출은
    // 영원히 매달리지 않고 즉시 reject된다(pyProc과 같은 계약).
    const port = createRpcPort(worker, { label: `컨테이너 ${cid}` });
    this._containers.set(cid, { worker, port });
    return cid;
  }

  async _verifyWorkerAssets() {
    if (!this._assetIntegrity) return null;
    this._assetIntegrityCheck ||= verifyPyProcAssetIntegrity(this._assetIntegrity, { roles: ["machineWorker"] });
    return this._assetIntegrityCheck;
  }

  _call(cid, msg) {
    const c = this._containers.get(cid);
    if (!c) return Promise.reject(new PyProcError("PYPROC_PROCESS_UNAVAILABLE", `machineContainer: ${cid} 없음(killed?)`));
    return c.port.call(msg);
  }

  // 중첩 cid("m1/c2/c1")를 최상위 워커의 경로 라우터로 보낸다. 경로의 각 층이 다음 세그먼트의
  // 자식에게 op를 재귀 전달하고 응답은 층을 거슬러 올라온다(깊이 임의).
  _callPath(cid, op) {
    const [top, ...path] = String(cid).split("/");
    if (!path.length) return this._call(top, op);
    return this._call(top, { type: "route", path, op });
  }

  // JS API: 컨테이너 부팅. manifest = { env, packages, setup }(컨테이너의 자기 패키지 세트).
  async spawn(manifest = {}) {
    await this._verifyWorkerAssets();
    if (!this._snapshot) await this._makeSnapshot(); // 첫 컨테이너에서 스냅샷 제조(이후 fast fork)
    const cid = this._spawnWorker();
    const booted = await this._call(cid, { type: "boot", indexURL: this._indexURL, snapshot: this._snapshot, manifest });
    return {
      cid,
      bootMs: booted.bootMs,
      run: (code) => this._callPath(cid, { type: "run", code }).then((r) => r.result),
      heapLen: () => this._callPath(cid, { type: "heap" }).then((r) => r.heapLen),
      kill: () => this.kill(cid),
    };
  }

  // 종료: 최상위는 커널이 직접 terminate + 대기 전건 즉시 reject. 중첩 cid는 대상의
  // 부모 층으로 killChild를 라우팅한다(반환은 Promise<boolean>).
  kill(cid) {
    const segments = String(cid).split("/");
    if (segments.length === 1) {
      const c = this._containers.get(cid);
      if (!c) return false;
      c.worker.terminate();
      c.port.fail(new PyProcError("PYPROC_PROCESS_UNAVAILABLE", `컨테이너 ${cid} killed`));
      this._containers.delete(cid);
      return true;
    }
    const parentPath = segments.slice(1, -1);
    const op = { type: "killChild", childCid: segments[segments.length - 1] };
    return this._call(segments[0], parentPath.length ? { type: "route", path: parentPath, op } : op).then(() => true);
  }

  // 파이썬 표면 배선: pyprocMachine.spawn()이 파이썬 값을 돌려준다. 블로킹 = JSPI(rt.runAsync 경로).
  // cid 규칙: 최상위는 "m3", 중첩은 "m3/c1/c2"(각 층이 자기 자식 소유). "/" 경로는 route로 재귀 라우팅(깊이 임의).
  install() {
    const bridge = {
      spawn: async (manifestJson) => (await this.spawn(JSON.parse(manifestJson))).cid,
      run: (cid, code) => this._callPath(cid, { type: "run", code }).then((r) => r.result),
      spawnChild: async (parentCid, manifestJson) => {
        const r = await this._callPath(parentCid, { type: "spawnChild", indexURL: this._indexURL, manifest: JSON.parse(manifestJson) });
        return parentCid + "/" + r.childCid;
      },
      heap: (cid) => this._callPath(cid, { type: "heap" }).then((r) => r.heapLen),
      kill: (cid) => this.kill(cid),
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
