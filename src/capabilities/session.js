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
// v3 payload(2026-07-15): 봉투 v2는 유지하고 payload에 /home pack을 추가해, 힙 상태와
//   /home/web 파일 트리를 한 .pymachine 안에서 함께 이동한다.
// 서명(2026-07-15): WebCrypto ECDSA P-256으로 unsigned body 해시를 서명한다. outer envelope는
//   signature까지 포함한 최종 body를 다시 해시하므로 무결성과 출처 검증이 분리된다.
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

// .pymachine 단일 파일 포맷 v2: MAGIC + 봉투해시(hex 64B) + u32(헤더 길이) + 헤더 JSON + payload.
// payload는 메타 v2에서 델타뿐이고, 메타 v3에서 델타 + homePack이다. 봉투해시 =
// SHA-256(u32 || 헤더 || payload)라 힙 델타와 /home 파일 바이트를 함께 인증한다.
// v1은 델타만 해시라 헤더(manifest/setup = 부팅 시 실행되는 코드)의 변조가 검증을 통과했다
// (외부 평가 적발). v1은 지원 종료.
// 머신 파일은 "살아있는 상태"라서 실행 파일과 동급 위험이다: openMachine은 { trust: true }
// 명시 승인 없이는 열지 않는다(해시는 무결성이지 출처 인증이 아니다).
const MACHINE_MAGIC = "PYMACHINE2\n";
const MACHINE_MAGIC_V1 = "PYMACHINE1\n";
const HEAD_MAX_BYTES = 1024 * 1024;        // 헤더 JSON 상한(비정상 파일의 메모리 폭식 차단)
const SETUP_MAX_BYTES = 256 * 1024;        // manifest.setup 상한
const HEAP_MAX_BYTES = 4 * 1024 * 1024 * 1024; // wasm32 주소공간 상한(출처: 선형 메모리 4GB)
const HOME_MAX_BYTES = 512 * 1024 * 1024;  // .pymachine에 직접 싣는 /home 스냅샷 방어 상한
const HOME_MAX_ENTRIES = 10000;
const PATH_MAX_BYTES = 4096;
const DEFAULT_HOME_PATH = "/home/web";
const MACHINE_SIGN_ALG = { name: "ECDSA", namedCurve: "P-256" };
const MACHINE_SIGN_PARAMS = { name: "ECDSA", hash: "SHA-256" };

async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]+$/.test(s)) throw new Error("machine: signature base64url 형식 위반");
  const padded = s.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function isCryptoKey(k) {
  return typeof CryptoKey !== "undefined" && k instanceof CryptoKey;
}

function toBytesWithHead(meta, bin, homeBin = new Uint8Array(0)) {
  const head = new TextEncoder().encode(JSON.stringify(meta));
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, head.length);
  const body = new Uint8Array(4 + head.length + bin.length + homeBin.length);
  body.set(lenBuf, 0); body.set(head, 4); body.set(bin, 4 + head.length);
  body.set(homeBin, 4 + head.length + bin.length);
  return body;
}

function unsignedMeta(meta) {
  const out = { ...meta };
  delete out.signature;
  return out;
}

async function unsignedEnvelope(meta, bin, homeBin) {
  return sha256Hex(toBytesWithHead(unsignedMeta(meta), bin, homeBin));
}

export async function createMachineKeyPair() {
  return crypto.subtle.generateKey(MACHINE_SIGN_ALG, true, ["sign", "verify"]);
}

export async function exportMachinePublicKey(key) {
  const publicKey = key && key.publicKey ? key.publicKey : key;
  if (publicKey && typeof publicKey === "object" && publicKey.kty) return publicKey;
  if (!isCryptoKey(publicKey)) throw new Error("machine: publicKey CryptoKey가 필요하다");
  return crypto.subtle.exportKey("jwk", publicKey);
}

async function importMachinePublicKey(key) {
  if (isCryptoKey(key)) return key;
  if (typeof key !== "object" || key === null) throw new Error("machine: publicKey 형식 위반");
  return crypto.subtle.importKey("jwk", key, MACHINE_SIGN_ALG, true, ["verify"]);
}

async function signingMaterial(opts) {
  const signingKey = opts.signingKey || null;
  if (!signingKey) return null;
  const privateKey = signingKey.privateKey || signingKey;
  const publicKey = opts.publicKey || signingKey.publicKey;
  if (!isCryptoKey(privateKey)) throw new Error("session.exportImage: signingKey private CryptoKey가 필요하다");
  if (!publicKey) throw new Error("session.exportImage: publicKey 또는 CryptoKeyPair가 필요하다");
  return { privateKey, publicKey: await exportMachinePublicKey(publicKey) };
}

async function signMachineMeta(meta, bin, homeBin, opts) {
  const keys = await signingMaterial(opts);
  if (!keys) return meta;
  const envelope = await unsignedEnvelope(meta, bin, homeBin);
  const signature = new Uint8Array(await crypto.subtle.sign(MACHINE_SIGN_PARAMS, keys.privateKey, new TextEncoder().encode(envelope)));
  meta.signature = {
    version: 1,
    algorithm: "ECDSA-P256-SHA256",
    envelope,
    publicKey: keys.publicKey,
    signature: bytesToBase64Url(signature),
  };
  return meta;
}

function readMachineSignature(meta) {
  const sig = meta.signature;
  if (sig == null) return null;
  if (typeof sig !== "object" || sig.version !== 1) throw new Error("openMachine: signature 형식 위반");
  if (sig.algorithm !== "ECDSA-P256-SHA256") throw new Error(`openMachine: 지원하지 않는 signature 알고리즘(${sig.algorithm})`);
  if (typeof sig.envelope !== "string" || !/^[0-9a-f]{64}$/.test(sig.envelope)) throw new Error("openMachine: signature envelope 형식 위반");
  if (typeof sig.publicKey !== "object" || sig.publicKey === null) throw new Error("openMachine: signature publicKey 형식 위반");
  return sig;
}

async function verifyMachineSignature(meta, bin, homeBin, opts) {
  const sig = readMachineSignature(meta);
  if (!sig) return { present: false, trusted: false };
  const actual = await unsignedEnvelope(meta, bin, homeBin);
  if (actual !== sig.envelope) throw new Error("openMachine: 서명 대상 불일치(파일 내용과 signature envelope가 맞지 않는다)");
  const signature = base64UrlToBytes(sig.signature);
  const data = new TextEncoder().encode(sig.envelope);
  const embeddedKey = await importMachinePublicKey(sig.publicKey);
  const validEmbedded = await crypto.subtle.verify(MACHINE_SIGN_PARAMS, embeddedKey, signature, data);
  if (!validEmbedded) throw new Error("openMachine: signature 검증 실패");
  const trusted = [];
  if (opts.trustedPublicKey) trusted.push(opts.trustedPublicKey);
  if (Array.isArray(opts.trustedPublicKeys)) trusted.push(...opts.trustedPublicKeys);
  for (const key of trusted) {
    const publicKey = await importMachinePublicKey(key);
    if (await crypto.subtle.verify(MACHINE_SIGN_PARAMS, publicKey, signature, data)) return { present: true, trusted: true };
  }
  return { present: true, trusted: false };
}

// 저장 메타(헤더/세션 파일 공용)의 형식 검증: 손상·변조 파일이 예외가 아니라
// 과대 할당·부분 복원으로 새는 것을 막는다. 위반은 전부 명시적 예외.
function validateMeta(meta, binLen) {
  if (typeof meta !== "object" || meta === null) throw new Error("machine: 메타가 객체가 아니다");
  if (meta.version !== 1 && meta.version !== 2 && meta.version !== 3) throw new Error(`machine: 지원하지 않는 메타 버전(${meta.version})`);
  if (typeof meta.manifest !== "string" || meta.manifest.length > HEAD_MAX_BYTES) throw new Error("machine: manifest 형식 위반");
  if (!Number.isInteger(meta.heapLen) || meta.heapLen <= 0 || meta.heapLen > HEAP_MAX_BYTES) throw new Error(`machine: heapLen 범위 위반(${meta.heapLen})`);
  if (meta.sp !== null && (!Number.isInteger(meta.sp) || meta.sp < 0 || meta.sp > meta.heapLen)) throw new Error(`machine: sp 범위 위반(${meta.sp})`);
  if (!Array.isArray(meta.pages)) throw new Error("machine: pages가 배열이 아니다");
  if (meta.pages.length * PAGE_SIZE !== binLen) throw new Error(`machine: 페이지 수(${meta.pages.length})와 델타 크기(${binLen})가 불일치`);
  if (meta.version === 3 && meta.deltaBytes !== binLen) throw new Error("machine: deltaBytes와 델타 크기가 불일치");
  const maxPage = Math.ceil(meta.heapLen / PAGE_SIZE);
  const seen = new Set();
  for (const p of meta.pages) {
    if (!Number.isInteger(p) || p < 0 || p >= maxPage) throw new Error(`machine: 페이지 번호 범위 위반(${p})`);
    if (seen.has(p)) throw new Error(`machine: 페이지 번호 중복(${p})`);
    seen.add(p);
  }
}

function normalizeFsRoot(path, label = "home path") {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0")) throw new Error(`machine: ${label} 형식 위반`);
  const trimmed = path.replace(/\/+$/, "") || "/";
  if (trimmed === "/") throw new Error(`machine: ${label}는 루트일 수 없다`);
  if (new TextEncoder().encode(trimmed).length > PATH_MAX_BYTES) throw new Error(`machine: ${label} 길이 초과`);
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.some((p) => p === "." || p === ".." || p === "")) throw new Error(`machine: ${label} 경로 성분 위반`);
  return trimmed;
}

function validateRelativeHomePath(path) {
  if (typeof path !== "string" || path === "" || path.startsWith("/") || path.includes("\0") || path.includes("\\")) {
    throw new Error("machine: home 엔트리 경로 형식 위반");
  }
  if (new TextEncoder().encode(path).length > PATH_MAX_BYTES) throw new Error("machine: home 엔트리 경로 길이 초과");
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) throw new Error("machine: home 엔트리 경로 성분 위반");
}

function validateHomeMeta(home, binLen) {
  if (typeof home !== "object" || home === null) throw new Error("machine: home 메타가 객체가 아니다");
  if (home.version !== 1) throw new Error(`machine: 지원하지 않는 home 버전(${home.version})`);
  normalizeFsRoot(home.path, "home path");
  if (!Number.isInteger(home.bytes) || home.bytes < 0 || home.bytes > HOME_MAX_BYTES || home.bytes !== binLen) throw new Error("machine: home bytes 범위 위반");
  if (!Array.isArray(home.entries) || home.entries.length > HOME_MAX_ENTRIES) throw new Error("machine: home entries 범위 위반");
  const seen = new Set();
  let nextOffset = 0;
  for (const e of home.entries) {
    if (typeof e !== "object" || e === null) throw new Error("machine: home 엔트리 형식 위반");
    validateRelativeHomePath(e.path);
    if (seen.has(e.path)) throw new Error(`machine: home 엔트리 중복(${e.path})`);
    seen.add(e.path);
    if (e.type === "dir") continue;
    if (e.type !== "file") throw new Error(`machine: home 엔트리 타입 위반(${e.type})`);
    if (!Number.isInteger(e.offset) || !Number.isInteger(e.size) || e.offset !== nextOffset || e.size < 0) throw new Error("machine: home 파일 오프셋 위반");
    nextOffset += e.size;
    if (nextOffset > binLen) throw new Error("machine: home 파일 범위 초과");
  }
  if (nextOffset !== binLen) throw new Error("machine: home pack 크기 불일치");
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

function concatBytes(parts, total) {
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function joinFsPath(base, name) {
  return `${base.replace(/\/+$/, "")}/${name}`;
}

function parentFsPath(path) {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
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
  let bin, homeBin = null;
  if (meta.version === 3) {
    if (!Number.isInteger(meta.deltaBytes) || meta.deltaBytes < 0 || 4 + hl + meta.deltaBytes > body.length) throw new Error("openMachine: deltaBytes 범위 위반");
    bin = body.subarray(4 + hl, 4 + hl + meta.deltaBytes);
    homeBin = body.subarray(4 + hl + meta.deltaBytes);
  } else {
    bin = body.subarray(4 + hl);
  }
  validateMeta(meta, bin.length);
  if (meta.home) validateHomeMeta(meta.home, homeBin ? homeBin.length : 0);
  else if (homeBin && homeBin.length) throw new Error("openMachine: home 메타 없이 home payload가 있다");
  const manifest = validateManifest(JSON.parse(meta.manifest));
  const signature = await verifyMachineSignature(meta, bin, homeBin || new Uint8Array(0), opts);
  if (opts.requireSignature === true && !signature.trusted) {
    throw new Error("openMachine: 신뢰된 공개키의 signature가 필요하다");
  }
  if (opts.trust !== true && !signature.trusted) {
    const hint = signature.present ? "신뢰된 공개키가 없거나 일치하지 않는다" : "서명이 없다";
    throw new Error(`openMachine: 머신 파일은 임의 코드 실행과 동급 위험이다. ${hint}. 출처를 신뢰하면 { trust: true }, 서명 출처를 신뢰하면 { trustedPublicKeys: [...] }로 여시라. sha256=${envelope.slice(0, 16)}...`);
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

  _collectHome(path = DEFAULT_HOME_PATH, required = false) {
    const root = normalizeFsRoot(path, "home path");
    const fs = this.rt.fs;
    if (!fs.exists(root)) {
      if (required) throw new Error(`session.exportImage: ${root} 경로가 없어 /home 스냅샷을 만들 수 없다`);
      return null;
    }
    const rootStat = fs.stat(root);
    if (!rootStat.isDir) throw new Error(`session.exportImage: ${root}는 디렉터리가 아니다`);
    const entries = [];
    const chunks = [];
    let total = 0;
    const visit = (dir, rel) => {
      const names = fs.readdir(dir).slice().sort();
      for (const name of names) {
        validateRelativeHomePath(name);
        const full = joinFsPath(dir, name);
        const childRel = rel ? `${rel}/${name}` : name;
        const st = fs.stat(full);
        if (st.isDir) {
          entries.push({ path: childRel, type: "dir" });
          visit(full, childRel);
        } else if (st.isFile) {
          const data = fs.readFile(full);
          if (!(data instanceof Uint8Array)) throw new Error(`session.exportImage: ${childRel} 읽기 형식 위반`);
          if (total + data.length > HOME_MAX_BYTES) throw new Error("session.exportImage: home 스냅샷이 상한을 넘었다");
          entries.push({ path: childRel, type: "file", offset: total, size: data.length });
          chunks.push(data);
          total += data.length;
        } else {
          throw new Error(`session.exportImage: ${childRel}는 파일/디렉터리가 아니다`);
        }
        if (entries.length > HOME_MAX_ENTRIES) throw new Error("session.exportImage: home 엔트리가 상한을 넘었다");
      }
    };
    visit(root, "");
    const home = { version: 1, path: root, entries, bytes: total };
    validateHomeMeta(home, total);
    return { meta: home, bin: concatBytes(chunks, total) };
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
    const home = includeHome ? this._collectHome(opts.homePath || DEFAULT_HOME_PATH, opts.includeHome === true) : null;
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

  _removeTree(path) {
    const fs = this.rt.fs;
    if (!fs.exists(path)) return;
    const st = fs.stat(path);
    if (st.isFile) { fs.unlink(path); return; }
    for (const name of fs.readdir(path)) this._removeTree(joinFsPath(path, name));
    fs.rmdir(path);
  }

  _applyHome(home, bin) {
    validateHomeMeta(home, bin.length);
    const fs = this.rt.fs;
    const root = normalizeFsRoot(home.path, "home path");
    this._removeTree(root);
    fs.mkdirTree(root);
    const dirs = home.entries.filter((e) => e.type === "dir").sort((a, b) => a.path.localeCompare(b.path));
    for (const e of dirs) fs.mkdirTree(joinFsPath(root, e.path));
    const files = home.entries.filter((e) => e.type === "file");
    for (const e of files) {
      fs.mkdirTree(parentFsPath(joinFsPath(root, e.path)));
      fs.writeFile(joinFsPath(root, e.path), bin.subarray(e.offset, e.offset + e.size));
    }
    return { files: files.length, dirs: dirs.length, mb: +(bin.length / 1048576).toFixed(1) };
  }
}
