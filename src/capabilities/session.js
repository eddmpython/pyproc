// session.js - Layer 1 능력: 세션 부활(불멸 커널) = 결정적 리플레이 + 사용자 델타.
// 원리(실측: bootDeterminismProbe, replayForkProbe 2026-07-11):
//   부팅 비결정의 주범은 엔트로피(해시 시드·getentropy·시간)다. PYTHONHASHSEED=0 +
//   부팅 구간 엔트로피/시간 고정이면 같은 매니페스트(packages/setup/env)의 부팅이
//   바이트 단위로 동일한 힙을 재현한다(무조치 180p 상이 -> 0p). 따라서 사용자 상태는
//   "리플레이 경계와 다른 페이지"만 저장하면 되고(10MB급), 새 커널(새 탭·새 세션)에서
//   같은 리플레이 후 그 델타를 적용(1.5ms 실측)하면 이전 파이썬 상태가 부활한다.
//   Pyodide 스냅샷의 hiwire 벽(패키지 로드 후 이미지화 불가)을 upstream 수정 없이 우회한다.
// 한계(v1): 부활은 같은 매니페스트 + 같은 Pyodide 버전 + 같은 힙 크기(성장 세션은 v2)를
//   전제하며, load()가 전부 명시적 예외로 검사한다.
import { boot } from "../runtime/runtime.js";
import { PAGE_SIZE } from "../runtime/memoryCapability.js";

// 부팅 구간의 비결정 소스를 고정한다(복원 보장). 리플레이 결정성의 필요조건.
function stubEntropy() {
  const o = { grv: crypto.getRandomValues.bind(crypto), dn: Date.now, pn: performance.now.bind(performance) };
  crypto.getRandomValues = (a) => { new Uint8Array(a.buffer, a.byteOffset, a.byteLength).fill(0x42); return a; };
  Date.now = () => 1750000000000;
  performance.now = () => 12345;
  return () => { crypto.getRandomValues = o.grv; Date.now = o.dn; performance.now = o.pn; };
}

// 결정적 리플레이 부팅: 매니페스트(indexURL/env/packages/setup)가 곧 환경 선언이다.
export async function bootSession(manifest = {}) {
  const restore = stubEntropy();
  let rt;
  try {
    rt = await boot({ indexURL: manifest.indexURL, env: { PYTHONHASHSEED: "0", ...(manifest.env || {}) } });
    if (manifest.packages && manifest.packages.length) await rt.loadPackages(manifest.packages);
    if (manifest.setup) rt.run(manifest.setup);
  } finally { restore(); }
  const reactive = rt.enableReactive();
  reactive.checkpoint(); // cp0 = 리플레이 경계. 이 시점과의 차이가 곧 "사용자 상태"다.
  return new Session(rt, reactive, manifest);
}

export class Session {
  constructor(rt, reactive, manifest) {
    this.rt = rt; this.reactive = reactive;
    this._manifest = JSON.stringify({
      indexURL: manifest.indexURL || null, env: manifest.env || null,
      packages: manifest.packages || [], setup: manifest.setup || null,
    });
  }

  // 사용자 상태(리플레이 경계와 다른 페이지)만 OPFS에 저장. base는 리플레이가 대체하므로 저장하지 않는다.
  async save(dir, name) {
    const r = this.reactive, mem = this.rt.memory;
    r.checkpoint(); // 경계 닫기(사용자 상태 확정)
    const h0 = r.hashes[0], hl = r.hashes[r.liveIdx];
    const n = Math.min(h0.length, hl.length) / 2;
    const pages = [];
    for (let p = 0; p < n; p++) if (hl[2 * p] !== h0[2 * p] || hl[2 * p + 1] !== h0[2 * p + 1]) pages.push(p);
    for (let p = h0.length / 2; p < hl.length / 2; p++) pages.push(p); // 성장분
    const bin = new Uint8Array(pages.length * PAGE_SIZE);
    pages.forEach((p, i) => bin.set(mem.slicePage(p), i * PAGE_SIZE));
    const meta = { version: 1, manifest: this._manifest, pages, sp: r.stackSave(), heapLen: mem.byteLength() };
    const mf = await dir.getFileHandle(name + ".json", { create: true });
    let w = await mf.createWritable(); await w.write(JSON.stringify(meta)); await w.close();
    const bf = await dir.getFileHandle(name + ".bin", { create: true });
    w = await bf.createWritable(); await w.write(bin); await w.close();
    return { pages: pages.length, mb: +(bin.length / 1048576).toFixed(1) };
  }

  // 같은 매니페스트로 리플레이된 커널에서 저장분을 적용해 세션을 부활시킨다.
  async load(dir, name) {
    const meta = JSON.parse(await (await (await dir.getFileHandle(name + ".json")).getFile()).text());
    if (meta.manifest !== this._manifest) {
      throw new Error("session.load: 매니페스트 불일치. 저장 당시와 같은 packages/setup/env로 bootSession해야 부활이 성립한다.");
    }
    const mem = this.rt.memory;
    if (meta.heapLen !== mem.byteLength()) {
      throw new Error(`session.load: 힙 크기 불일치(저장 ${meta.heapLen} vs 현재 ${mem.byteLength()}). 성장 세션 부활은 v2 과제.`);
    }
    const bin = new Uint8Array(await (await (await dir.getFileHandle(name + ".bin")).getFile()).arrayBuffer());
    meta.pages.forEach((p, i) => mem.writePage(p, bin.subarray(i * PAGE_SIZE, (i + 1) * PAGE_SIZE)));
    mem.stackRestore(meta.sp);
    this.reactive.checkpoint(); // 부활 상태를 새 경계로
    return { pages: meta.pages.length, mb: +(bin.length / 1048576).toFixed(1) };
  }
}
