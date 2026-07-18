// bundleFormat.js - Layer 1(state): 이동 가능한 서명 오브젝트 묶음(단일 봉투 포맷)의 정본.
//
// 서버 없는 런타임의 라이브러리다운 강함은 상태가 "들고 다닐 수 있는 서명된 오브젝트"라는
// 것이다. 이 포맷이 .pymachine v2/v3과 .webmachine을 대체하는 단일 writer 계약이다(구 포맷은
// 각 소비자의 감지형 reader가 읽기만 지원). 신뢰 도메인 차이는 검증 정책의 차이지 포맷의
// 차이가 아니다: 파서 2벌 = 취약면 2배(구 .pymachine v1 헤더 변조 적발 전과가 실증).
//
// 바이트 레이아웃(버전 있는 공개 계약, docs/reference/bundleFormat.md와 게이트로 대조):
//   [0..10)   MAGIC "PYBUNDLE1\n" (ASCII 10바이트)
//   [10..74)  봉투 다이제스트: sha256(body)의 hex 64바이트 (ASCII)
//   [74..]    body = u32(BE, 헤더 길이) || 헤더 JSON(UTF-8) || 오브젝트 바이트 연속
//   헤더 = { version: 1, commit: <주소>, meta: <소비자 소유 JSON>,
//            objects: [[<주소>, <길이>], ...],  // 배열 순서 = body 배치 순서(offset은 누적 유도)
//            tag: <signedTag> | null }          // tag.target = unsigned 봉투 다이제스트
//   unsigned 봉투 다이제스트 = sha256(tag를 null로 둔 헤더로 다시 인코딩한 body).
//   무결성(봉투 다이제스트 = 바이트가 온전한가)과 출처(tag = 누가 만들었나)가 분리된다.
//
// 적대 입력 규율: decode는 상한(헤더 1MB)과 형식 검증 후 모든 오브젝트를 verify-on-read로
// 재대조한다. 통과 못 한 바이트는 어떤 소비자에게도 닿지 않는다.
import { PyProcError } from "../runtime/errors.js";
import { SHA256_ADDRESS_RE, sha256HexWith, verifySha256With } from "../runtime/contentDigest.js";

export const STATE_BUNDLE_MAGIC = "PYBUNDLE1\n";
export const STATE_BUNDLE_VERSION = 1;
export const STATE_BUNDLE_HEAD_MAX_BYTES = 1024 * 1024;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function formatError(message) {
  return new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", message);
}

function encodeBody(header, objectChunks, totalObjectBytes) {
  const headBytes = textEncoder.encode(JSON.stringify(header));
  if (headBytes.length > STATE_BUNDLE_HEAD_MAX_BYTES) throw formatError("bundle: 헤더 상한 초과");
  const body = new Uint8Array(4 + headBytes.length + totalObjectBytes);
  new DataView(body.buffer).setUint32(0, headBytes.length);
  body.set(headBytes, 4);
  let offset = 4 + headBytes.length;
  for (const chunk of objectChunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}

// objects: Map(address -> bytes) 또는 [address, bytes] 배열. 배치 순서는 입력 순서를 따른다.
export async function encodeStateBundle(cryptoProvider, { commit, meta = null, objects, tag = null }) {
  if (!SHA256_ADDRESS_RE.test(commit)) throw new PyProcError("PYPROC_INPUT_INVALID", `bundle: commit 주소 형식 위반(${commit})`);
  const entries = objects instanceof Map ? [...objects.entries()] : [...objects];
  const index = [];
  const chunks = [];
  let totalObjectBytes = 0;
  for (const [address, bytes] of entries) {
    if (!SHA256_ADDRESS_RE.test(address)) throw new PyProcError("PYPROC_INPUT_INVALID", `bundle: 오브젝트 주소 형식 위반(${address})`);
    index.push([address, bytes.length]);
    chunks.push(bytes);
    totalObjectBytes += bytes.length;
  }
  const header = { version: STATE_BUNDLE_VERSION, commit, meta, objects: index, tag };
  const body = encodeBody(header, chunks, totalObjectBytes);
  const envelope = await sha256HexWith(cryptoProvider, body);
  const out = new Uint8Array(STATE_BUNDLE_MAGIC.length + 64 + body.length);
  out.set(textEncoder.encode(STATE_BUNDLE_MAGIC), 0);
  out.set(textEncoder.encode(envelope), STATE_BUNDLE_MAGIC.length);
  out.set(body, STATE_BUNDLE_MAGIC.length + 64);
  return out;
}

// 서명 대상: tag를 뺀 같은 내용의 봉투 다이제스트. encode와 같은 인코딩 경로를 타므로
// "서명한 것"과 "실린 것"이 갈라질 표면이 없다.
export async function unsignedStateBundleDigest(cryptoProvider, { commit, meta = null, objects }) {
  const entries = objects instanceof Map ? [...objects.entries()] : [...objects];
  const index = [];
  const chunks = [];
  let totalObjectBytes = 0;
  for (const [address, bytes] of entries) {
    index.push([address, bytes.length]);
    chunks.push(bytes);
    totalObjectBytes += bytes.length;
  }
  const header = { version: STATE_BUNDLE_VERSION, commit, meta, objects: index, tag: null };
  return sha256HexWith(cryptoProvider, encodeBody(header, chunks, totalObjectBytes));
}

export function isStateBundle(buf) {
  return textDecoder.decode(buf.subarray(0, STATE_BUNDLE_MAGIC.length)) === STATE_BUNDLE_MAGIC;
}

// 디코드 + 전량 검증. 반환 { commit, meta, objects: Map, tag, envelope, unsignedDigest }.
export async function decodeStateBundle(cryptoProvider, buf) {
  if (!isStateBundle(buf)) throw formatError("bundle: 매직 불일치");
  const hashStart = STATE_BUNDLE_MAGIC.length;
  const envelope = textDecoder.decode(buf.subarray(hashStart, hashStart + 64));
  const body = buf.subarray(hashStart + 64);
  const actual = await sha256HexWith(cryptoProvider, body);
  if (actual !== envelope) throw new PyProcError("PYPROC_MACHINE_INTEGRITY", "bundle: 봉투 무결성 검증 실패(파일 손상 또는 변조)");
  if (body.length < 4) throw formatError("bundle: 파일이 너무 짧다");
  const headLen = new DataView(body.buffer, body.byteOffset, 4).getUint32(0);
  if (headLen > STATE_BUNDLE_HEAD_MAX_BYTES || 4 + headLen > body.length) throw formatError("bundle: 헤더 길이 위반");
  let header;
  try { header = JSON.parse(textDecoder.decode(body.subarray(4, 4 + headLen))); }
  catch (e) { throw formatError("bundle: 헤더 JSON 파손"); }
  if (header.version !== STATE_BUNDLE_VERSION) throw formatError(`bundle: 지원하지 않는 버전(${header.version})`);
  if (!SHA256_ADDRESS_RE.test(header.commit)) throw formatError("bundle: commit 주소 형식 위반");
  if (!Array.isArray(header.objects)) throw formatError("bundle: objects 색인 형식 위반");
  const objects = new Map();
  let offset = 4 + headLen;
  for (const entry of header.objects) {
    if (!Array.isArray(entry) || entry.length !== 2) throw formatError("bundle: objects 색인 엔트리 위반");
    const [address, length] = entry;
    if (!SHA256_ADDRESS_RE.test(address)) throw formatError(`bundle: 오브젝트 주소 형식 위반(${address})`);
    if (!Number.isInteger(length) || length < 0 || offset + length > body.length) throw formatError(`bundle: 오브젝트 길이 위반(${address})`);
    if (objects.has(address)) throw formatError(`bundle: 오브젝트 주소 중복(${address})`);
    const bytes = body.subarray(offset, offset + length);
    const verdict = await verifySha256With(cryptoProvider, bytes, address);
    if (!verdict.ok) throw new PyProcError("PYPROC_MACHINE_INTEGRITY", `bundle: 오브젝트 verify-on-read 불일치(${address.slice(0, 20)}..)`);
    objects.set(address, bytes);
    offset += length;
  }
  if (offset !== body.length) throw formatError("bundle: 색인 밖 잉여 바이트");
  if (!objects.has(header.commit)) throw formatError("bundle: commit 오브젝트가 색인에 없다");
  const unsignedDigest = await unsignedStateBundleDigest(cryptoProvider, { commit: header.commit, meta: header.meta ?? null, objects });
  return { commit: header.commit, meta: header.meta ?? null, objects, tag: header.tag ?? null, envelope, unsignedDigest };
}
