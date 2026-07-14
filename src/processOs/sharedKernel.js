// sharedKernel.js - Layer 2: 탭 밖에서 사는 공유 커널의 클라이언트.
// SharedWorker에 커널을 올리면 여러 탭이 같은 파이썬 상태를 보고, 탭 하나가 닫혀도
// 다른 연결이 남아 있는 한 커널은 계속 돈다(OS의 데몬 등가). 원격 커널이므로 모든
// 호출이 Promise다(동기 run 없음). sharedKernelHost.js는 같은 폴더 고정(경로 계약).
import { DEFAULT_INDEX } from "../runtime/runtime.js";
import { verifyPyProcAssetIntegrity } from "../runtime/assets.js";

export class SharedKernel {
  constructor(opts = {}) {
    this.indexURL = opts.indexURL || DEFAULT_INDEX;
    this.name = opts.name || "pyprocSharedKernel"; // 같은 name = 같은 커널(브라우저가 보장)
    this._port = null; this._seq = 0; this._pending = new Map();
    this._assetIntegrity = opts.assetIntegrity || null;
    this._connectPromise = null;
    this._connectError = null;
  }

  // 커널에 연결한다(첫 연결이 부팅을 시작하고, 이후 연결은 같은 커널을 공유).
  connect() {
    if (this._port) return this;
    this._connectPromise ||= this._connectNow().catch((e) => { this._connectError = e; return null; });
    return this;
  }

  async _connectNow() {
    if (this._assetIntegrity) await verifyPyProcAssetIntegrity(this._assetIntegrity, { roles: ["sharedKernelHost"] });
    const url = new URL("./sharedKernelHost.js", import.meta.url);
    url.searchParams.set("index", this.indexURL);
    const w = new SharedWorker(url, { type: "module", name: this.name });
    this._port = w.port;
    this._port.onmessage = (e) => {
      const p = this._pending.get(e.data.id);
      if (!p) return;
      this._pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.result);
      else p.reject(new Error(e.data.error));
    };
    this._port.start();
    return this;
  }

  async _ensureConnected() {
    if (this._port) return;
    if (this._connectError) throw this._connectError;
    this._connectPromise ||= this._connectNow().catch((e) => { this._connectError = e; return null; });
    await this._connectPromise;
    if (this._connectError) throw this._connectError;
  }

  async _call(msg) {
    await this._ensureConnected();
    const id = ++this._seq;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this._port.postMessage({ id, ...msg });
    });
  }

  run(code) { return this._call({ type: "run", code }); }
  runAsync(code) { return this._call({ type: "runAsync", code }); }
  setGlobal(name, value) { return this._call({ type: "setGlobal", name, value }); }
  // { bootMs, connections, jspi, crossOriginIsolated }. COI=false = SAB 불가(호스트 주석 참조).
  status() { return this._call({ type: "status" }); }
}
