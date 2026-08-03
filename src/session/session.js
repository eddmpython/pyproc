// session.js - Layer 4: 세션 부활(불멸 커널) = 결정적 리플레이 + 사용자 델타.
// 조립된 런타임을 부팅해서 쓴다(boot + rt.enableReactive). 즉 registry 설치 뒤에만 성립하므로
// 능력(Layer 4)이 아니라 합성 루트 위에 산다.
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
import { DETERMINISTIC_RESEED_SOURCE, runWithGlobalPatch, stubDeterministicBootSources } from "../runtime/globalPatch.js";
import { PAGE_SIZE, bytesToMb } from "../runtime/memoryLayout.js";
import { unpackPages } from "../runtime/heapDelta.js";
import { sha256Hex } from "../runtime/contentDigest.js";
import { validateManifest, validateMeta } from "./machineImage.js";
import { machineSigningMaterial } from "./machineSignature.js";
import { MemoryStateStore } from "../state/memoryStateStore.js";
import { commitState, openState } from "../state/refProtocol.js";
import { STATE_TAG_ALG, makeStateTag, verifyStateTag } from "../state/signedTag.js";
import { decodeStateBundle, encodeStateBundle, isStateBundle, stateBundleHeaderDigest } from "../state/bundleFormat.js";

// 서명 API는 이 모듈의 공개 표면이다(index.js가 여기서 가져간다). 구현은 machineSignature가 소유한다.
export { createMachineKeyPair, exportMachinePublicKey, fingerprintMachinePublicKey } from "./machineSignature.js";
import { WheelCache } from "../capabilities/wheelCache.js";
import { materializeHeapGeneration } from "../capabilities/heapMaterialize.js";
import { requirePortableHeap } from "../capabilities/imagePortability.js";
import { DEFAULT_MACHINE_HOME_PATH, collectMachineHome } from "../capabilities/machineHome.js";

// 결정적 부팅 구간은 전역(엔트로피/시간)을 패치하므로 전역 패치 체인에서 하나만 진입한다.
// 두 bootSession(또는 boot 코어 캐시/wheel 캐시의 fetch 스왑)이 겹치면 먼저 끝난 쪽이
// 다른 쪽의 패치를 복원해 전역이 꼬인다. 내부 패처에는 reenter 스코프를 넘긴다(중첩 안전).

// 결정적 리플레이 부팅: 매니페스트(indexURL/env/packages/setup)가 곧 환경 선언이다.
export function bootSession(manifest = {}) {
  return runWithGlobalPatch(async (reenterPatch) => {
    const restore = stubDeterministicBootSources();
    let rt;
    try {
      rt = await boot({
        indexURL: manifest.indexURL,
        env: { PYTHONHASHSEED: "0", ...(manifest.env || {}) },
        assetIntegrity: manifest.assetIntegrity,
        engineScriptIntegrity: manifest.engineScriptIntegrity,
        coreIntegrity: manifest.coreIntegrity,
        coreCacheDir: manifest.coreCacheDir,
        // 워커 호스팅의 열쇠: 워커에는 document가 없어 엔진 스크립트를 태그로 심을 수 없다.
        // 런타임은 이미 이 옵션으로 그 경로를 열어놨고(runtime.js doLoad) porcelain boot의
        // 옵션 허용 목록도 loadPyodide를 받는데, 결정적 부팅만 그것을 조용히 떨어뜨렸다.
        // 결과는 메인 스레드에서 무증상(전역 엔진이 대신 로드된다)이고 워커에서 즉사였다.
        // 리플레이 신원(_manifest)은 indexURL/env/packages/setup만 세므로 이 전달은 결정성을
        // 건드리지 않는다: 워커 커널과 메인 커널의 cp0 바이트 동일성이 게이트로 남는다.
        loadPyodide: manifest.loadPyodide,
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
    rt.run(DETERMINISTIC_RESEED_SOURCE);
    return new Session(rt, reactive, manifest);
  });
}

// 부활 경로의 매니페스트는 파일에서 온 JSON이라 함수를 담을 수 없다(validateManifest도 4키만
// 허용한다). 그래서 워커 호스팅의 엔진 로더는 매니페스트가 아니라 호출 옵션으로 오고, 여기서
// 합친다. 환경 선언(파일)과 호스트 능력(호출자)의 출처가 다르다는 사실을 한 곳에 적는다.
const withHostLoader = (manifest, opts) => (opts.loadPyodide ? { ...manifest, loadPyodide: opts.loadPyodide } : manifest);

// 머신 파일은 "살아있는 상태"라서 실행 파일과 동급 위험이다: { trust: true } 또는 신뢰
// 공개키 없이는 열지 않는다(해시는 무결성이지 출처가 아니다). 이 게이트는 포맷과 무관한
// 신뢰 정책이라 한 곳에 산다.
function requireTrust(signature, envelope, opts) {
  if (opts.requireSignature === true && !signature.trusted) {
    throw new PyProcError("PYPROC_MACHINE_UNTRUSTED", "open: a signature verifiable by a trusted public key is required");
  }
  if (opts.trust !== true && !signature.trusted) {
    const hint = signature.present ? "신뢰된 공개키가 없거나 일치하지 않는다" : "서명이 없다";
    throw new PyProcError("PYPROC_MACHINE_UNTRUSTED", `open: a machine file carries the same risk as running arbitrary code. ${hint}. Accept the publisher with { trust: true }, or verify it with { trustedPublicKeys: [...] }. sha256=${envelope.slice(0, 16)}...`);
  }
}

// 신 봉투(state bundle) 경로: 디코드가 전량 verify-on-read를 끝낸 오브젝트를 커널 store에
// 실어 openState로 물질화한다. 리플레이 결정성 대조(h0)는 커널 계약 그대로다.
async function openBundleMachine(buf, opts) {
  const decoded = await decodeStateBundle(globalThis.crypto, buf);
  let signature = { present: false, trusted: false };
  if (decoded.tag) {
    if (decoded.tag.alg !== STATE_TAG_ALG || decoded.tag.target !== decoded.headerDigest) {
      throw new PyProcError("PYPROC_MACHINE_INTEGRITY", "open: signature target mismatch (the file content does not match the signed tag target)");
    }
    const trustedKeys = [];
    if (opts.trustedPublicKey) trustedKeys.push(opts.trustedPublicKey);
    if (Array.isArray(opts.trustedPublicKeys)) trustedKeys.push(...opts.trustedPublicKeys);
    const verdict = await verifyStateTag(globalThis.crypto, decoded.tag, decoded.headerDigest, { trustedPublicKeys: trustedKeys });
    if (!verdict.valid) throw new PyProcError("PYPROC_MACHINE_INTEGRITY", "open: signature verification failed");
    signature = { present: true, trusted: verdict.trusted };
  }
  requireTrust(signature, decoded.envelope, opts);
  if (typeof decoded.meta?.manifest !== "string") throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "open: bundle meta has no manifest. A .webmachine file is not a session bundle; open it through the Web Computer surface");
  const manifest = validateManifest(JSON.parse(decoded.meta.manifest));
  const session = await bootSession(withHostLoader(manifest, opts));
  const store = new MemoryStateStore();
  for (const [address, bytes] of decoded.objects) await store.writeObject(address, bytes);
  await store.writeRef("HEAD", { commit: decoded.commit });
  const opened = await openState(globalThis.crypto, store, { expectH0: await session._cp0Digest() });
  session._applyKernelState(opened);
  return session;
}

// .pymachine/bundle 파일로 같은 컴퓨터를 부팅한다(매니페스트가 파일 안에 있다).
// 포맷은 하나다: state bundle. 구 봉투(PYMACHINE2 v2/v3)의 감지형 reader는 일몰했다.
//
// 왜 지금인가: 두 포맷을 읽는 동안 "디스크 위 포맷은 하나"라는 계약이 참이 아니었고, 그 둘째
// 포맷은 writer가 없는 읽기 전용이었다(2026-07-15 이후 아무도 만들지 않는다). 읽기만 남은
// 포맷은 계약이 아니라 부채다: 모든 부활 경로가 두 갈래를 계속 감당하고, 그 갈래는 게이트도
// 두 벌을 요구한다. 거부는 조용하지 않다 - 무엇이었고 무엇을 해야 하는지 코드와 함께 말한다.
export async function openMachine(blob, opts = {}) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (isStateBundle(buf)) return openBundleMachine(buf, opts);
  throw new PyProcError(
    "PYPROC_MACHINE_FORMAT_INVALID",
    "open: this is not a state bundle. The 0.0.9-era PYMACHINE2 envelope was retired, so it has to be "
    + "re-exported by the version that wrote it (open it there, then "
    + "history.export() again) before this version can read it.",
  );
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
  async save(dir, name, opts = {}) {
    requirePortableHeap(this.rt, "save", opts);
    const { bin, meta } = this._collectDelta();
    meta.h0 = await this._cp0Digest();
    const mf = await dir.getFileHandle(name + ".json", { create: true });
    let w = await mf.createWritable(); await w.write(JSON.stringify(meta)); await w.close();
    const bf = await dir.getFileHandle(name + ".bin", { create: true });
    w = await bf.createWritable(); await w.write(bin); await w.close();
    return { pages: meta.pages.length, mb: bytesToMb(bin.length) };
  }

  // 이 컴퓨터 전체를 서명 가능한 bundle 파일 하나로 내보낸다(단일 writer).
  // 내부 표현 = base commit(h0 루트) 위의 커널 커밋: 페이지 blob + /home file 엔트리 +
  // 환경 지문 commit이 내용주소 오브젝트로 실리고, 봉투 무결성(다이제스트)과 출처(tag)가
  // 분리된다. 구 .pymachine v2/v3 writer는 폐지됐다(reader만 잔존).
  async exportImage(opts = {}) {
    requirePortableHeap(this.rt, "exportImage", opts);
    const r = this.reactive;
    r.checkpoint(); // 경계 닫기(사용자 상태 확정)
    const { pages, sp, heapLen } = r.collectDelta(0, r.liveIdx, { pack: false });
    const mem = this.rt.memory;
    const includeHome = opts.includeHome !== false;
    const home = includeHome ? this._collectHome(opts.homePath || DEFAULT_MACHINE_HOME_PATH, opts.includeHome === true) : null;
    const files = home && home.bin.length ? [{ id: "home", bytes: home.bin, meta: home.meta }] : [];
    const store = new MemoryStateStore();
    const committed = await commitState(globalThis.crypto, store, {
      // 페이지 사본은 커밋이 그것을 쓸 때 만든다(전량 동시 상주 대신 한 장씩).
      pages: pages.map((p) => [p, () => mem.slicePage(p)]),
      pageSize: PAGE_SIZE, heapLen, sp, files,
      env: { h0: await this._cp0Digest(), deterministic: true },
    });
    const meta = { manifest: this._manifest };
    const objects = store.entries();
    let tag = null;
    const keys = await machineSigningMaterial(opts);
    if (keys) {
      const unsigned = await stateBundleHeaderDigest(globalThis.crypto, { commit: committed.commitAddress, meta, objects });
      tag = await makeStateTag(globalThis.crypto, keys.privateKey, keys.publicKey, unsigned);
    }
    const bytes = await encodeStateBundle(globalThis.crypto, { commit: committed.commitAddress, meta, objects, tag });
    return new Blob([bytes], { type: "application/x-pymachine" });
  }

  // 같은 매니페스트로 리플레이된 커널에서 저장분을 적용해 세션을 부활시킨다.
  async load(dir, name) {
    const meta = JSON.parse(await (await (await dir.getFileHandle(name + ".json")).getFile()).text());
    if (meta.manifest !== this._manifest) {
      throw new PyProcError("PYPROC_REPLAY_MISMATCH", "open({ dir, name }): manifest mismatch. Revival needs the same packages/setup/env that saved it, passed as { manifest }");
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
        throw new PyProcError("PYPROC_REPLAY_MISMATCH", `open({ dir, name }): replay determinism mismatch (cp0 ${cur.slice(0, 12)}.. != saved ${meta.h0.slice(0, 12)}..). The engine version or the manifest differs from the one that saved this state.`);
      }
    }
    // 물질화 순서(성장 -> 경계 되감기 -> 페이지 -> 스택 -> 새 경계)는 heapMaterialize가 정본이다.
    const staged = [];
    unpackPages((p, page) => staged.push([p, page]), bin, meta.pages, PAGE_SIZE);
    const applied = materializeHeapGeneration({
      rt: this.rt, reactive: this.reactive, label: "session.load",
      heapLen: meta.heapLen, sp: meta.sp, pages: staged,
    });
    return { pages: applied.pages, mb: applied.mb };
  }

  // 커널 세대(openState 결과) 적용: 검증(verify-on-read, h0 대조)은 커널이 끝냈고, 여기는
  // 힙 성장 + 경계 되감기 + 페이지/홈 적용만 한다(_applyMeta의 커널 물질화판).
  _applyKernelState(opened) {
    const { tree, pages, files } = opened;
    const applied = materializeHeapGeneration({
      rt: this.rt, reactive: this.reactive, label: "openMachine",
      heapLen: tree.heapLen, sp: tree.sp, pages,
      home: (files && files.get("home")) || null,
      // 층마다 오류 어휘가 다르다: 세션 부활의 파손은 머신 포맷 계약 위반으로 말한다.
      wrapHomeError: (e) => new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `open: home meta is corrupt (${String(e.message || e).slice(-160)})`, { cause: e }),
    });
    return { pages: applied.pages, mb: applied.mb };
  }
}
