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
// 수리(2026-07-12, 외부 평가 반영): .pymachine 포맷 v2 = 봉투 전체(헤더+델타) 해시 인증
//   (v1은 델타만 해시라 헤더의 manifest/setup 변조가 통과했다), 입력 검증 상한, 결정적
//   부팅 구간의 전역 패치 직렬화(동시 bootSession 경쟁 제거), 복제 고유성(재시드).
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

// 결정적 부팅 구간은 전역(엔트로피/시간)을 패치하므로 한 번에 하나만 진입한다.
// 두 bootSession이 겹치면 먼저 끝난 쪽이 다른 쪽의 패치를 복원해 결정성이 조용히 깨진다.
let bootChain = Promise.resolve();
function runExclusive(fn) {
  const run = bootChain.then(fn, fn);
  bootChain = run.then(() => undefined, () => undefined);
  return run;
}

// 결정적 리플레이 부팅: 매니페스트(indexURL/env/packages/setup)가 곧 환경 선언이다.
export function bootSession(manifest = {}) {
  return runExclusive(async () => {
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
    // 복제 고유성: 리플레이 커널들은 random 모듈 상태까지 같게 태어난다(스텁 엔트로피로 시드).
    // cp0 확정 뒤 실제 엔트로피로 재시드해 새 머신들을 갈라놓는다. 부활(load/openMachine)은
    // _applyMeta가 경계로 되감고 저장된 상태(그 머신의 random 포함)를 덮으므로 충실성이 유지된다.
    rt.run("import random as _pyprocR\n_pyprocR.seed()\ndel _pyprocR");
    return new Session(rt, reactive, manifest);
  });
}

// .pymachine 단일 파일 포맷 v2: MAGIC + 봉투해시(hex 64B) + u32(헤더 길이) + 헤더 JSON + 델타.
// 봉투해시 = SHA-256(u32 || 헤더 || 델타) = 파일 전체 인증. v1은 델타만 해시라 헤더(manifest/
// setup = 부팅 시 실행되는 코드)의 변조가 검증을 통과했다(외부 평가 적발). v1은 지원 종료.
// 머신 파일은 "살아있는 상태"라서 실행 파일과 동급 위험이다: openMachine은 { trust: true }
// 명시 승인 없이는 열지 않는다(해시는 무결성이지 출처 인증이 아니다).
const MACHINE_MAGIC = "PYMACHINE2\n";
const MACHINE_MAGIC_V1 = "PYMACHINE1\n";
const HEAD_MAX_BYTES = 1024 * 1024;        // 헤더 JSON 상한(비정상 파일의 메모리 폭식 차단)
const SETUP_MAX_BYTES = 256 * 1024;        // manifest.setup 상한
const HEAP_MAX_BYTES = 4 * 1024 * 1024 * 1024; // wasm32 주소공간 상한(출처: 선형 메모리 4GB)

async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 저장 메타(헤더/세션 파일 공용)의 형식 검증: 손상·변조 파일이 예외가 아니라
// 과대 할당·부분 복원으로 새는 것을 막는다. 위반은 전부 명시적 예외.
function validateMeta(meta, binLen) {
  if (typeof meta !== "object" || meta === null) throw new Error("machine: 메타가 객체가 아니다");
  if (meta.version !== 1 && meta.version !== 2) throw new Error(`machine: 지원하지 않는 메타 버전(${meta.version})`);
  if (typeof meta.manifest !== "string" || meta.manifest.length > HEAD_MAX_BYTES) throw new Error("machine: manifest 형식 위반");
  if (!Number.isInteger(meta.heapLen) || meta.heapLen <= 0 || meta.heapLen > HEAP_MAX_BYTES) throw new Error(`machine: heapLen 범위 위반(${meta.heapLen})`);
  if (meta.sp !== null && (!Number.isInteger(meta.sp) || meta.sp < 0 || meta.sp > meta.heapLen)) throw new Error(`machine: sp 범위 위반(${meta.sp})`);
  if (!Array.isArray(meta.pages)) throw new Error("machine: pages가 배열이 아니다");
  if (meta.pages.length * PAGE_SIZE !== binLen) throw new Error(`machine: 페이지 수(${meta.pages.length})와 델타 크기(${binLen})가 불일치`);
  const maxPage = Math.ceil(meta.heapLen / PAGE_SIZE);
  const seen = new Set();
  for (const p of meta.pages) {
    if (!Number.isInteger(p) || p < 0 || p >= maxPage) throw new Error(`machine: 페이지 번호 범위 위반(${p})`);
    if (seen.has(p)) throw new Error(`machine: 페이지 번호 중복(${p})`);
    seen.add(p);
  }
}

// 머신 헤더의 매니페스트 형식 검증(키 화이트리스트 + 타입 + 크기).
// setup 실행 자체는 trust 게이트가 승인하는 위험이고, 여기서는 형식만 가른다.
function validateManifest(m) {
  if (typeof m !== "object" || m === null || Array.isArray(m)) throw new Error("openMachine: 매니페스트가 객체가 아니다");
  const allowed = new Set(["indexURL", "env", "packages", "setup"]);
  for (const k of Object.keys(m)) if (!allowed.has(k)) throw new Error(`openMachine: 매니페스트에 허용되지 않은 키(${k})`);
  if (m.indexURL != null && typeof m.indexURL !== "string") throw new Error("openMachine: indexURL 형식 위반");
  if (m.env != null) {
    if (typeof m.env !== "object" || Array.isArray(m.env)) throw new Error("openMachine: env 형식 위반");
    for (const [k, v] of Object.entries(m.env)) if (typeof k !== "string" || typeof v !== "string") throw new Error("openMachine: env 값 형식 위반");
  }
  if (m.packages != null) {
    if (!Array.isArray(m.packages) || m.packages.length > 256) throw new Error("openMachine: packages 형식 위반");
    for (const p of m.packages) if (typeof p !== "string" || p.length > 200) throw new Error("openMachine: 패키지명 형식 위반");
  }
  if (m.setup != null && (typeof m.setup !== "string" || m.setup.length > SETUP_MAX_BYTES)) throw new Error("openMachine: setup 형식 위반");
  return m;
}

// .pymachine 파일로 같은 컴퓨터를 부팅한다(매니페스트가 파일 안에 있다).
export async function openMachine(blob, opts = {}) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const magic = new TextDecoder().decode(buf.subarray(0, MACHINE_MAGIC.length));
  if (magic === MACHINE_MAGIC_V1) {
    throw new Error("openMachine: 포맷 v1은 헤더(manifest/setup)가 무인증이라 지원을 종료했다. 원본 머신에서 다시 내보내라(v2).");
  }
  if (magic !== MACHINE_MAGIC) throw new Error("openMachine: .pymachine 파일이 아니다(매직 불일치)");
  const hashStart = MACHINE_MAGIC.length;
  const envelope = new TextDecoder().decode(buf.subarray(hashStart, hashStart + 64));
  const body = buf.subarray(hashStart + 64); // u32 + 헤더 + 델타 = 인증 대상 전체
  const actual = await sha256Hex(body);
  if (actual !== envelope) throw new Error("openMachine: 봉투 무결성 검증 실패(파일 손상 또는 변조)");
  if (body.length < 4) throw new Error("openMachine: 파일이 너무 짧다");
  const hl = new DataView(body.buffer, body.byteOffset, 4).getUint32(0);
  if (hl > HEAD_MAX_BYTES || 4 + hl > body.length) throw new Error("openMachine: 헤더 길이 위반");
  const meta = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + hl)));
  const bin = body.subarray(4 + hl);
  validateMeta(meta, bin.length);
  const manifest = validateManifest(JSON.parse(meta.manifest));
  if (opts.trust !== true) {
    throw new Error(`openMachine: 머신 파일은 임의 코드 실행과 동급 위험이다. 출처를 신뢰하면 { trust: true }로 여시라. sha256=${envelope.slice(0, 16)}...`);
  }
  const session = await bootSession(manifest);
  await session._applyMeta(meta, bin);
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
    const meta = { version: 2, manifest: this._manifest, pages, sp: r.stackSave(), heapLen: mem.byteLength() };
    return { bin, meta };
  }

  // cp0(리플레이 경계) 해시 배열의 다이제스트. 델타는 "같은 cp0 힙" 위에서만 유효하므로,
  // 엔진 버전/엔트로피 변화로 리플레이가 달라진 커널에 델타를 덮는 조용한 오염을
  // load 시점의 명시적 예외로 바꾸는 근거다.
  async _cp0Digest() {
    const h = this.reactive.hashes[0];
    return sha256Hex(new Uint8Array(h.buffer, h.byteOffset, h.byteLength));
  }

  // 사용자 상태만 OPFS에 저장. base는 리플레이가 대체하므로 저장하지 않는다.
  async save(dir, name) {
    const { bin, meta } = this._collectDelta();
    meta.h0 = await this._cp0Digest();
    const mf = await dir.getFileHandle(name + ".json", { create: true });
    let w = await mf.createWritable(); await w.write(JSON.stringify(meta)); await w.close();
    const bf = await dir.getFileHandle(name + ".bin", { create: true });
    w = await bf.createWritable(); await w.write(bin); await w.close();
    return { pages: meta.pages.length, mb: +(bin.length / 1048576).toFixed(1) };
  }

  // 이 컴퓨터 전체를 .pymachine 파일 하나로 내보낸다(봉투 전체 무결성 해시 포함).
  async exportImage() {
    const { bin, meta } = this._collectDelta();
    meta.h0 = await this._cp0Digest();
    meta.sha256 = await sha256Hex(bin); // 델타 자체 다이제스트(식별/디버깅용. 인증은 봉투해시)
    const head = new TextEncoder().encode(JSON.stringify(meta));
    const lenBuf = new Uint8Array(4);
    new DataView(lenBuf.buffer).setUint32(0, head.length);
    const body = new Uint8Array(4 + head.length + bin.length);
    body.set(lenBuf, 0); body.set(head, 4); body.set(bin, 4 + head.length);
    const envelope = await sha256Hex(body); // u32 || 헤더 || 델타 전체를 인증
    return new Blob([MACHINE_MAGIC, envelope, body], { type: "application/x-pymachine" });
  }

  // 같은 매니페스트로 리플레이된 커널에서 저장분을 적용해 세션을 부활시킨다.
  async load(dir, name) {
    const meta = JSON.parse(await (await (await dir.getFileHandle(name + ".json")).getFile()).text());
    if (meta.manifest !== this._manifest) {
      throw new Error("session.load: 매니페스트 불일치. 저장 당시와 같은 packages/setup/env로 bootSession해야 부활이 성립한다.");
    }
    const bin = new Uint8Array(await (await (await dir.getFileHandle(name + ".bin")).getFile()).arrayBuffer());
    validateMeta(meta, bin.length);
    return this._applyMeta(meta, bin);
  }

  // 저장분 적용(성장 + 경계 되감기 + 페이지 쓰기). load/openMachine 공용.
  async _applyMeta(meta, bin) {
    // 리플레이 결정성 대조: 저장 당시 cp0과 지금 cp0이 다르면(엔진 버전/엔트로피 변화)
    // 델타를 덮는 순간 조용한 오염이 된다. 구버전 저장물(h0 없음)은 검사 없이 통과.
    if (meta.h0) {
      const cur = await this._cp0Digest();
      if (cur !== meta.h0) {
        throw new Error(`session.load: 리플레이 결정성 불일치(cp0 ${cur.slice(0, 12)}.. != 저장 당시 ${meta.h0.slice(0, 12)}..). 엔진 버전이나 매니페스트가 저장 당시와 다르다.`);
      }
    }
    const mem = this.rt.memory;
    // 성장 세션: JS에서 Memory.grow를 직접 하면 Emscripten 글루의 클로저 뷰가 안 갱신되어
    // 런타임이 깨진다(실측). 파이썬 할당으로 정상 성장 경로를 태운다. 초과 성장은 무해하다:
    // 델타가 복원하는 저장 시점의 할당자 상태가 힙 끝을 결정하고, 잉여 페이지는 미사용으로 남는다.
    if (meta.heapLen > mem.byteLength()) {
      this.rt.setGlobal("_pyprocTargetLen", meta.heapLen);
      this.rt.setGlobal("_pyprocHeapLen", () => mem.byteLength());
      this.rt.run(
        "import gc as _pyprocGc\n" +
        "_pyprocHold = []\n" +
        "while _pyprocHeapLen() < _pyprocTargetLen:\n" +
        "    _pyprocHold.append(bytearray(8 * 1024 * 1024))\n" +
        "del _pyprocHold, _pyprocTargetLen, _pyprocHeapLen\n" +
        "_pyprocGc.collect()"
      );
      if (meta.heapLen > mem.byteLength()) {
        throw new Error(`session.load: 힙 성장 실패(목표 ${meta.heapLen}, 현재 ${mem.byteLength()})`);
      }
    }
    // 경계 되감기(무조건): 부팅 이후의 모든 드리프트(재시드, 성장 루프, 소비자 실행 흔적)를
    // cp0으로 지운 위에 델타를 덮는다 -> 결과는 정확히 저장 시점 상태(fork의 정화와 같은 원리).
    this.reactive.restore(0, meta.sp);
    meta.pages.forEach((p, i) => mem.writePage(p, bin.subarray(i * PAGE_SIZE, (i + 1) * PAGE_SIZE)));
    mem.stackRestore(meta.sp);
    this.reactive.checkpoint(); // 부활 상태를 새 경계로
    return { pages: meta.pages.length, mb: +(bin.length / 1048576).toFixed(1) };
  }
}
