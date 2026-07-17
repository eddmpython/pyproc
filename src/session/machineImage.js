// machineImage.js - Layer 3: .pymachine 봉투 포맷과 그 입력 검증.
//
// 포맷 v2: MAGIC + 봉투해시(hex 64B) + u32(헤더 길이) + 헤더 JSON + payload.
// payload는 메타 v2에서 델타뿐이고, 메타 v3에서 델타 + homePack이다. 봉투해시 =
// SHA-256(u32 || 헤더 || payload)라 힙 델타와 /home 파일 바이트를 함께 인증한다.
// v1은 델타만 해시라 헤더(manifest/setup = 부팅 시 실행되는 코드)의 변조가 검증을 통과했다
// (외부 평가 적발). v1은 지원 종료.
//
// 왜 session.js에서 나왔나: 포맷은 "바이트를 어떻게 담는가"이고 session은 "머신을 어떻게
// 살리는가"다. 포맷 상수/인코딩/검증이 결정적 부팅과 한 파일에 있으면 둘이 같은 이유로
// 바뀌는 척을 한다. 검증은 특히 조용히 새면 안 되는 층이라 따로 읽혀야 한다.
import { PyProcError } from "../runtime/errors.js";
import { PAGE_SIZE } from "../runtime/memoryLayout.js";
import { sha256Hex } from "../runtime/contentDigest.js";

export const MACHINE_MAGIC = "PYMACHINE2\n";
export const MACHINE_MAGIC_V1 = "PYMACHINE1\n";
export const HEAD_MAX_BYTES = 1024 * 1024;        // 헤더 JSON 상한(비정상 파일의 메모리 폭식 차단)
export const SETUP_MAX_BYTES = 256 * 1024;        // manifest.setup 상한
export const HEAP_MAX_BYTES = 4 * 1024 * 1024 * 1024; // wasm32 주소공간 상한(출처: 선형 메모리 4GB)

// 봉투 본문: u32(헤더 길이) || 헤더 JSON || 델타 || homePack. 해시와 서명이 모두 이 바이트열을 본다.
export function toBytesWithHead(meta, bin, homeBin = new Uint8Array(0)) {
  const head = new TextEncoder().encode(JSON.stringify(meta));
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, head.length);
  const body = new Uint8Array(4 + head.length + bin.length + homeBin.length);
  body.set(lenBuf, 0); body.set(head, 4); body.set(bin, 4 + head.length);
  body.set(homeBin, 4 + head.length + bin.length);
  return body;
}

export function unsignedMeta(meta) {
  const out = { ...meta };
  delete out.signature;
  return out;
}

// 서명 대상 해시. signature 자체는 빼고 계산하므로 무결성(봉투해시)과 출처(서명)가 분리된다.
export async function unsignedEnvelope(meta, bin, homeBin) {
  return sha256Hex(toBytesWithHead(unsignedMeta(meta), bin, homeBin));
}

// 저장 메타(헤더/세션 파일 공용)의 형식 검증: 손상·변조 파일이 예외가 아니라
// 과대 할당·부분 복원으로 새는 것을 막는다. 위반은 전부 명시적 예외.
export function validateMeta(meta, binLen) {
  if (typeof meta !== "object" || meta === null) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: 메타가 객체가 아니다");
  if (meta.version !== 1 && meta.version !== 2 && meta.version !== 3) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `machine: 지원하지 않는 메타 버전(${meta.version})`);
  if (typeof meta.manifest !== "string" || meta.manifest.length > HEAD_MAX_BYTES) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: manifest 형식 위반");
  if (!Number.isInteger(meta.heapLen) || meta.heapLen <= 0 || meta.heapLen > HEAP_MAX_BYTES) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `machine: heapLen 범위 위반(${meta.heapLen})`);
  if (meta.sp !== null && (!Number.isInteger(meta.sp) || meta.sp < 0 || meta.sp > meta.heapLen)) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `machine: sp 범위 위반(${meta.sp})`);
  if (!Array.isArray(meta.pages)) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: pages가 배열이 아니다");
  if (meta.pages.length * PAGE_SIZE !== binLen) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `machine: 페이지 수(${meta.pages.length})와 델타 크기(${binLen})가 불일치`);
  if (meta.version === 3 && meta.deltaBytes !== binLen) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "machine: deltaBytes와 델타 크기가 불일치");
  const maxPage = Math.ceil(meta.heapLen / PAGE_SIZE);
  const seen = new Set();
  for (const p of meta.pages) {
    if (!Number.isInteger(p) || p < 0 || p >= maxPage) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `machine: 페이지 번호 범위 위반(${p})`);
    if (seen.has(p)) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `machine: 페이지 번호 중복(${p})`);
    seen.add(p);
  }
}

// 머신 헤더의 매니페스트 형식 검증(키 화이트리스트 + 타입 + 크기).
// setup 실행 자체는 trust 게이트가 승인하는 위험이고, 여기서는 형식만 가른다.
export function validateManifest(m) {
  if (typeof m !== "object" || m === null || Array.isArray(m)) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "openMachine: 매니페스트가 객체가 아니다");
  const allowed = new Set(["indexURL", "env", "packages", "setup"]);
  for (const k of Object.keys(m)) if (!allowed.has(k)) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", `openMachine: 매니페스트에 허용되지 않은 키(${k})`);
  if (m.indexURL != null && typeof m.indexURL !== "string") throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "openMachine: indexURL 형식 위반");
  if (m.env != null) {
    if (typeof m.env !== "object" || Array.isArray(m.env)) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "openMachine: env 형식 위반");
    for (const [k, v] of Object.entries(m.env)) if (typeof k !== "string" || typeof v !== "string") throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "openMachine: env 값 형식 위반");
  }
  if (m.packages != null) {
    if (!Array.isArray(m.packages) || m.packages.length > 256) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "openMachine: packages 형식 위반");
    for (const p of m.packages) if (typeof p !== "string" || p.length > 200) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "openMachine: 패키지명 형식 위반");
  }
  if (m.setup != null && (typeof m.setup !== "string" || m.setup.length > SETUP_MAX_BYTES)) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "openMachine: setup 형식 위반");
  return m;
}

// 봉투를 열어 인증하고 조각으로 가른다: 매직 -> 봉투해시 대조 -> 헤더 -> 델타/homePack 분리.
// 여기까지가 "바이트가 온전한가"이고, 출처(서명)와 부팅은 호출자 몫이다.
export async function decodeMachineEnvelope(buf) {
  const magic = new TextDecoder().decode(buf.subarray(0, MACHINE_MAGIC.length));
  if (magic === MACHINE_MAGIC_V1) {
    throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "openMachine: 포맷 v1은 헤더(manifest/setup)가 무인증이라 지원을 종료했다. 원본 머신에서 다시 내보내라(v2).");
  }
  if (magic !== MACHINE_MAGIC) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "openMachine: .pymachine 파일이 아니다(매직 불일치)");
  const hashStart = MACHINE_MAGIC.length;
  const envelope = new TextDecoder().decode(buf.subarray(hashStart, hashStart + 64));
  const body = buf.subarray(hashStart + 64); // u32 + 헤더 + 델타 = 인증 대상 전체
  const actual = await sha256Hex(body);
  if (actual !== envelope) throw new PyProcError("PYPROC_MACHINE_INTEGRITY", "openMachine: 봉투 무결성 검증 실패(파일 손상 또는 변조)");
  if (body.length < 4) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "openMachine: 파일이 너무 짧다");
  const hl = new DataView(body.buffer, body.byteOffset, 4).getUint32(0);
  if (hl > HEAD_MAX_BYTES || 4 + hl > body.length) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "openMachine: 헤더 길이 위반");
  const meta = JSON.parse(new TextDecoder().decode(body.subarray(4, 4 + hl)));
  let bin, homeBin = null;
  if (meta.version === 3) {
    if (!Number.isInteger(meta.deltaBytes) || meta.deltaBytes < 0 || 4 + hl + meta.deltaBytes > body.length) throw new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", "openMachine: deltaBytes 범위 위반");
    bin = body.subarray(4 + hl, 4 + hl + meta.deltaBytes);
    homeBin = body.subarray(4 + hl + meta.deltaBytes);
  } else {
    bin = body.subarray(4 + hl);
  }
  validateMeta(meta, bin.length);
  return { envelope, meta, bin, homeBin };
}
