// session.js - Layer 1 능력: 세션 부활(불멸 커널) = 결정적 리플레이 + 사용자 델타.
// 원리(실측: bootDeterminismProbe, replayForkProbe 2026-07-11):
//   부팅 비결정의 주범은 엔트로피(해시 시드·getentropy·시간)다. PYTHONHASHSEED=0 +
//   부팅 구간 엔트로피/시간 고정이면 같은 매니페스트(packages/setup/env)의 부팅이
//   바이트 단위로 동일한 힙을 재현한다(무조치 180p 상이 -> 0p). 따라서 사용자 상태는
//   "리플레이 경계와 다른 페이지"만 저장하면 되고(10MB급), 새 커널(새 탭·새 세션)에서
//   같은 리플레이 후 그 델타를 적용(1.5ms 실측)하면 이전 파이썬 상태가 부활한다.
//   Pyodide 스냅샷의 hiwire 벽(패키지 로드 후 이미지화 불가)을 upstream 수정 없이 우회한다.
// v2(2026-07-12): 힙이 자란 세션도 부활한다(파이썬 할당으로 성장 -> restore(0) 경계 되감기
//   -> 델타 적용). 매니페스트 wheelDir로 패키지 리플레이가 OPFS 캐시를 경유한다.
import { boot } from "../runtime/runtime.js";
import { PAGE_SIZE } from "../runtime/memoryCapability.js";
import { WheelCache } from "./wheelCache.js";

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
    if (manifest.packages && manifest.packages.length) {
      // wheelDir을 주면 패키지 바이트가 OPFS 캐시를 경유한다: 두 번째부터 다운로드 0.
      if (manifest.wheelDir) await new WheelCache(rt, { dir: manifest.wheelDir }).loadPackages(manifest.packages);
      else await rt.loadPackages(manifest.packages);
    }
    if (manifest.setup) rt.run(manifest.setup);
  } finally { restore(); }
  const reactive = rt.enableReactive();
  reactive.checkpoint(); // cp0 = 리플레이 경계. 이 시점과의 차이가 곧 "사용자 상태"다.
  return new Session(rt, reactive, manifest);
}

// .pymachine 단일 파일 포맷: MAGIC + u32(헤더 길이) + 헤더 JSON + 델타 바이너리.
// 헤더에 SHA-256(델타)을 넣어 무결성을 검증한다. 머신 파일은 "살아있는 상태"라서
// 실행 파일과 동급 위험이다: openMachine은 { trust: true } 명시 승인 없이는 열지 않는다.
const MACHINE_MAGIC = "PYMACHINE1\n";

async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// .pymachine 파일로 같은 컴퓨터를 부팅한다(매니페스트가 파일 안에 있다).
export async function openMachine(blob, opts = {}) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const magic = new TextDecoder().decode(buf.subarray(0, MACHINE_MAGIC.length));
  if (magic !== MACHINE_MAGIC) throw new Error("openMachine: .pymachine 파일이 아니다(매직 불일치)");
  const hl = new DataView(buf.buffer, buf.byteOffset + MACHINE_MAGIC.length, 4).getUint32(0);
  const headStart = MACHINE_MAGIC.length + 4;
  const meta = JSON.parse(new TextDecoder().decode(buf.subarray(headStart, headStart + hl)));
  const bin = buf.subarray(headStart + hl);
  const hash = await sha256Hex(bin);
  if (hash !== meta.sha256) throw new Error("openMachine: 무결성 검증 실패(파일 손상 또는 변조)");
  if (opts.trust !== true) {
    throw new Error(`openMachine: 머신 파일은 임의 코드 실행과 동급 위험이다. 출처를 신뢰하면 { trust: true }로 여시라. sha256=${hash.slice(0, 16)}...`);
  }
  const session = await bootSession(JSON.parse(meta.manifest));
  session._applyMeta(meta, bin);
  return session;
}

export class Session {
  constructor(rt, reactive, manifest) {
    this.rt = rt; this.reactive = reactive;
    this._manifest = JSON.stringify({
      indexURL: manifest.indexURL || null, env: manifest.env || null,
      packages: manifest.packages || [], setup: manifest.setup || null,
    });
  }

  // 사용자 상태(리플레이 경계와 다른 페이지) 수집. save/exportImage 공용.
  _collectDelta() {
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
    return { bin, meta };
  }

  // 사용자 상태만 OPFS에 저장. base는 리플레이가 대체하므로 저장하지 않는다.
  async save(dir, name) {
    const { bin, meta } = this._collectDelta();
    const mf = await dir.getFileHandle(name + ".json", { create: true });
    let w = await mf.createWritable(); await w.write(JSON.stringify(meta)); await w.close();
    const bf = await dir.getFileHandle(name + ".bin", { create: true });
    w = await bf.createWritable(); await w.write(bin); await w.close();
    return { pages: meta.pages.length, mb: +(bin.length / 1048576).toFixed(1) };
  }

  // 이 컴퓨터 전체를 .pymachine 파일 하나로 내보낸다(무결성 해시 포함).
  async exportImage() {
    const { bin, meta } = this._collectDelta();
    meta.sha256 = await sha256Hex(bin);
    const head = new TextEncoder().encode(JSON.stringify(meta));
    const lenBuf = new Uint8Array(4);
    new DataView(lenBuf.buffer).setUint32(0, head.length);
    return new Blob([MACHINE_MAGIC, lenBuf, head, bin], { type: "application/x-pymachine" });
  }

  // 같은 매니페스트로 리플레이된 커널에서 저장분을 적용해 세션을 부활시킨다.
  async load(dir, name) {
    const meta = JSON.parse(await (await (await dir.getFileHandle(name + ".json")).getFile()).text());
    if (meta.manifest !== this._manifest) {
      throw new Error("session.load: 매니페스트 불일치. 저장 당시와 같은 packages/setup/env로 bootSession해야 부활이 성립한다.");
    }
    const bin = new Uint8Array(await (await (await dir.getFileHandle(name + ".bin")).getFile()).arrayBuffer());
    return this._applyMeta(meta, bin);
  }

  // 저장분 적용(성장 + 경계 되감기 + 페이지 쓰기). load/openMachine 공용.
  _applyMeta(meta, bin) {
    const mem = this.rt.memory;
    // 성장 세션: JS에서 Memory.grow를 직접 하면 Emscripten 글루의 클로저 뷰가 안 갱신되어
    // 런타임이 깨진다(실측). 파이썬 할당으로 정상 성장 경로를 태운다. 초과 성장은 무해하다:
    // 델타가 복원하는 저장 시점의 할당자 상태가 힙 끝을 결정하고, 잉여 페이지는 미사용으로 남는다.
    const grewViaAlloc = meta.heapLen > mem.byteLength();
    if (grewViaAlloc) {
      this.rt.setGlobal("_pyproc_target_len", meta.heapLen);
      this.rt.setGlobal("_pyproc_heap_len", () => mem.byteLength());
      this.rt.run(
        "import gc as _pyproc_gc\n" +
        "_pyproc_hold = []\n" +
        "while _pyproc_heap_len() < _pyproc_target_len:\n" +
        "    _pyproc_hold.append(bytearray(8 * 1024 * 1024))\n" +
        "del _pyproc_hold, _pyproc_target_len, _pyproc_heap_len\n" +
        "_pyproc_gc.collect()"
      );
    }
    if (meta.heapLen > mem.byteLength()) {
      throw new Error(`session.load: 힙 성장 실패(목표 ${meta.heapLen}, 현재 ${mem.byteLength()})`);
    }
    if (grewViaAlloc) {
      // 성장 루프가 남긴 할당/GC 흔적을 리플레이 경계 상태로 되감는다. 경계 밖(성장 구간)은
      // 저장이 전량 포함하므로 아래 델타 적용이 그대로 덮는다 -> 결과는 정확히 저장 시점 상태.
      this.reactive.restore(0, meta.sp);
    }
    meta.pages.forEach((p, i) => mem.writePage(p, bin.subarray(i * PAGE_SIZE, (i + 1) * PAGE_SIZE)));
    mem.stackRestore(meta.sp);
    this.reactive.checkpoint(); // 부활 상태를 새 경계로
    return { pages: meta.pages.length, mb: +(bin.length / 1048576).toFixed(1) };
  }
}
