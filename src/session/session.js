// session.js - Layer 3: 세션 부활(불멸 커널) = 결정적 리플레이 + 사용자 델타.
// 조립된 런타임을 부팅해서 쓴다(boot + rt.enableReactive). 즉 registry 설치 뒤에만 성립하므로
// 능력(Layer 1)이 아니라 합성 루트 위에 산다.
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
// v3 payload(2026-07-15): 봉투 v2는 유지하고 payload에 /home pack을 추가해, 힙 상태와
//   /home/web 파일 트리를 한 .pymachine 안에서 함께 이동한다.
// 서명(2026-07-15): WebCrypto ECDSA P-256으로 unsigned body 해시를 서명한다. outer envelope는
//   signature까지 포함한 최종 body를 다시 해시하므로 무결성과 출처 검증이 분리된다.
import { PyProcError } from "../runtime/errors.js";
import { boot } from "../composition/runtimeApi.js";
import { runWithGlobalPatch } from "../runtime/globalPatch.js";
import { PAGE_SIZE } from "../runtime/memoryLayout.js";
import { unpackPages } from "../runtime/heapDelta.js";
import { growHeapTo } from "../runtime/heapGrow.js";
import { sha256Hex } from "../runtime/contentDigest.js";
import {
  MACHINE_MAGIC,
  decodeMachineEnvelope,
  toBytesWithHead,
  validateManifest,
  validateMeta,
} from "./machineImage.js";
import { signMachineMeta, verifyMachineSignature } from "./machineSignature.js";

// 서명 API는 이 모듈의 공개 표면이다(index.js가 여기서 가져간다). 구현은 machineSignature가 소유한다.
export { createMachineKeyPair, exportMachinePublicKey, fingerprintMachinePublicKey } from "./machineSignature.js";
import { WheelCache } from "../capabilities/wheelCache.js";
import {
  DEFAULT_MACHINE_HOME_PATH,
  applyMachineHome,
  collectMachineHome,
  validateMachineHomeMeta,
} from "../capabilities/machineHome.js";

// 부팅 구간의 비결정 소스를 고정한다(복원 보장). 리플레이 결정성의 필요조건.
function stubEntropy() {
  const o = { grv: crypto.getRandomValues.bind(crypto), dn: Date.now, pn: performance.now.bind(performance) };
  crypto.getRandomValues = (a) => { new Uint8Array(a.buffer, a.byteOffset, a.byteLength).fill(0x42); return a; };
  Date.now = () => 1750000000000;
  performance.now = () => 12345;
  return () => { crypto.getRandomValues = o.grv; Date.now = o.dn; performance.now = o.pn; };
}

// 결정적 부팅 구간은 전역(엔트로피/시간)을 패치하므로 전역 패치 체인에서 하나만 진입한다.
// 두 bootSession(또는 boot 코어 캐시/wheel 캐시의 fetch 스왑)이 겹치면 먼저 끝난 쪽이
// 다른 쪽의 패치를 복원해 전역이 꼬인다. 내부 패처에는 reenter 스코프를 넘긴다(중첩 안전).

// 결정적 리플레이 부팅: 매니페스트(indexURL/env/packages/setup)가 곧 환경 선언이다.
export function bootSession(manifest = {}) {
  return runWithGlobalPatch(async (reenterPatch) => {
    const restore = stubEntropy();
    let rt;
    try {
      rt = await boot({
        indexURL: manifest.indexURL,
        env: { PYTHONHASHSEED: "0", ...(manifest.env || {}) },
        assetIntegrity: manifest.assetIntegrity,
        engineScriptIntegrity: manifest.engineScriptIntegrity,
        coreIntegrity: manifest.coreIntegrity,
        coreCacheDir: manifest.coreCacheDir,
        patchScope: reenterPatch,
      });
      if (manifest.packages && manifest.packages.length) {
        // wheelDir을 주면 패키지 바이트가 OPFS 캐시를 경유한다: 두 번째부터 다운로드 0.
        if (manifest.wheelDir) await new WheelCache(rt, { dir: manifest.wheelDir, patchScope: reenterPatch }).loadPackages(manifest.packages);
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

// .pymachine 파일로 같은 컴퓨터를 부팅한다(매니페스트가 파일 안에 있다).
// 봉투 인증과 형식 검증은 machineImage가, 출처 인증은 machineSignature가 소유한다.
// 여기 남는 것은 신뢰 판정과 부팅이다: 머신 파일은 "살아있는 상태"라서 실행 파일과 동급
// 위험이고, { trust: true } 또는 신뢰 공개키 없이는 열지 않는다(해시는 무결성이지 출처가 아니다).
export async function openMachine(blob, opts = {}) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const { envelope, meta, bin, homeBin } = await decodeMachineEnvelope(buf);
  if (meta.home) validateMachineHomeMeta(meta.home, homeBin ? homeBin.length : 0);
  else if (homeBin && homeBin.length) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "openMachine: home 메타 없이 home payload가 있다");
  const manifest = validateManifest(JSON.parse(meta.manifest));
  const signature = await verifyMachineSignature(meta, bin, homeBin || new Uint8Array(0), opts);
  if (opts.requireSignature === true && !signature.trusted) {
    throw new PyProcError("PYPROC_MACHINE_UNTRUSTED", "openMachine: 신뢰된 공개키의 signature가 필요하다");
  }
  if (opts.trust !== true && !signature.trusted) {
    const hint = signature.present ? "신뢰된 공개키가 없거나 일치하지 않는다" : "서명이 없다";
    throw new PyProcError("PYPROC_MACHINE_UNTRUSTED", `openMachine: 머신 파일은 임의 코드 실행과 동급 위험이다. ${hint}. 출처를 신뢰하면 { trust: true }, 서명 출처를 신뢰하면 { trustedPublicKeys: [...] }로 여시라. sha256=${envelope.slice(0, 16)}...`);
  }
  const session = await bootSession(manifest);
  await session._applyMeta(meta, bin);
  if (meta.home) session._applyHome(meta.home, homeBin);
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
  // 델타 수집의 정본은 ReactiveController.collectDelta다(저널 커밋과 같은 프리미티브).
  _collectDelta() {
    const r = this.reactive;
    r.checkpoint(); // 경계 닫기(사용자 상태 확정)
    const { pages, bin, sp, heapLen } = r.collectDelta(0);
    const meta = { version: 2, manifest: this._manifest, pages, sp, heapLen };
    return { bin, meta };
  }

  _collectHome(path = DEFAULT_MACHINE_HOME_PATH, required = false) {
    return collectMachineHome(this.rt.fs, path, { required, errorPrefix: "session.exportImage" });
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
  async exportImage(opts = {}) {
    const { bin, meta } = this._collectDelta();
    meta.h0 = await this._cp0Digest();
    meta.sha256 = await sha256Hex(bin); // 델타 자체 다이제스트(식별/디버깅용. 인증은 봉투해시)
    const includeHome = opts.includeHome !== false;
    const home = includeHome ? this._collectHome(opts.homePath || DEFAULT_MACHINE_HOME_PATH, opts.includeHome === true) : null;
    if (home) {
      meta.version = 3;
      meta.deltaBytes = bin.length;
      meta.home = home.meta;
    }
    const homeBin = home ? home.bin : new Uint8Array(0);
    await signMachineMeta(meta, bin, homeBin, opts);
    const body = toBytesWithHead(meta, bin, homeBin);
    const envelope = await sha256Hex(body); // u32 || 헤더 || payload 전체를 인증
    return new Blob([MACHINE_MAGIC, envelope, body], { type: "application/x-pymachine" });
  }

  // 같은 매니페스트로 리플레이된 커널에서 저장분을 적용해 세션을 부활시킨다.
  async load(dir, name) {
    const meta = JSON.parse(await (await (await dir.getFileHandle(name + ".json")).getFile()).text());
    if (meta.manifest !== this._manifest) {
      throw new PyProcError("PYPROC_REPLAY_MISMATCH", "session.load: 매니페스트 불일치. 저장 당시와 같은 packages/setup/env로 bootSession해야 부활이 성립한다.");
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
        throw new PyProcError("PYPROC_REPLAY_MISMATCH", `session.load: 리플레이 결정성 불일치(cp0 ${cur.slice(0, 12)}.. != 저장 당시 ${meta.h0.slice(0, 12)}..). 엔진 버전이나 매니페스트가 저장 당시와 다르다.`);
      }
    }
    const mem = this.rt.memory;
    // 성장 세션: JS에서 Memory.grow를 직접 하면 Emscripten 글루의 클로저 뷰가 안 갱신되어
    // 런타임이 깨진다(실측). 파이썬 할당으로 정상 성장 경로를 태운다. 초과 성장은 무해하다:
    // 델타가 복원하는 저장 시점의 할당자 상태가 힙 끝을 결정하고, 잉여 페이지는 미사용으로 남는다.
    growHeapTo((code) => this.rt.run(code), () => mem.byteLength(), meta.heapLen, "session.load");
    // 경계 되감기(무조건): 부팅 이후의 모든 드리프트(재시드, 성장 루프, 소비자 실행 흔적)를
    // cp0으로 지운 위에 델타를 덮는다 -> 결과는 정확히 저장 시점 상태(fork의 정화와 같은 원리).
    this.reactive.restore(0, meta.sp);
    unpackPages((p, page) => mem.writePage(p, page), bin, meta.pages, PAGE_SIZE);
    mem.stackRestore(meta.sp);
    this.reactive.checkpoint(); // 부활 상태를 새 경계로
    return { pages: meta.pages.length, mb: +(bin.length / 1048576).toFixed(1) };
  }

  _applyHome(home, bin) {
    return applyMachineHome(this.rt.fs, home, bin);
  }
}


