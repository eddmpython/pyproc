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
//            tag: <signedTag> | null }          // tag.target = 헤더 다이제스트(아래)
//   헤더 다이제스트 = sha256Address(tag를 null로 둔 canonical 헤더 JSON 바이트).
//   무결성(봉투 다이제스트 = 전신)과 출처(tag = 헤더 서명)가 분리되고, 색인이 오브젝트
//   주소를 박제하므로 헤더 서명만으로 신뢰 판정이 접두 판독에서 끝난다(조기 거부).
//
// 적대 입력 규율: decode는 상한(헤더 1MB)과 형식 검증 후 모든 오브젝트를 verify-on-read로
// 재대조한다. 통과 못 한 바이트는 어떤 소비자에게도 닿지 않는다.
import { PyProcError } from "../runtime/errors.js";
import { SHA256_ADDRESS_RE, sha256AddressWith, sha256HexWith, verifySha256With } from "../runtime/contentDigest.js";

export const STATE_BUNDLE_MAGIC = "PYBUNDLE1\n";
export const STATE_BUNDLE_VERSION = 1;
export const STATE_BUNDLE_HEAD_MAX_BYTES = 1024 * 1024;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function formatError(message) {
  return new PyProcError("PYPROC_MACHINE_FORMAT_INVALID", message);
}

// 헤더 직렬화의 유일 지점: encode/decode/서명 대상 계산이 전부 이 리터럴 키 순서를 공유해야
// "서명한 것"과 "실린 것"이 바이트 단위로 같다(JSON.parse는 원문 키 순서를 보존한다).
function serializeHeader({ commit, meta, index, tag }) {
  return textEncoder.encode(JSON.stringify({ version: STATE_BUNDLE_VERSION, commit, meta, objects: index, tag }));
}

function encodeBody(headBytes, objectChunks, totalObjectBytes) {
  if (headBytes.length > STATE_BUNDLE_HEAD_MAX_BYTES) throw formatError("bundle: 헤더 상한 초과");
  const body = new Uint8Array(4 + headBytes.length + totalObjectBytes);
  new DataView(body.buffer).setUint32(0, headBytes.length);
  body.set(headBytes, 4);
  let offset = 4 + headBytes.length;
  for (const chunk of objectChunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}

function toIndex(objects) {
  const entries = objects instanceof Map ? [...objects.entries()] : [...objects];
  const index = [];
  const chunks = [];
  let totalObjectBytes = 0;
  for (const [address, payload] of entries) {
    if (!SHA256_ADDRESS_RE.test(address)) throw new PyProcError("PYPROC_INPUT_INVALID", `bundle: 오브젝트 주소 형식 위반(${address})`);
    const isBytes = payload instanceof Uint8Array;
    const length = isBytes ? payload.length : payload;
    if (!Number.isInteger(length) || length < 0) throw new PyProcError("PYPROC_INPUT_INVALID", `bundle: 오브젝트 길이 위반(${address})`);
    index.push([address, length]);
    if (isBytes) { chunks.push(payload); totalObjectBytes += length; }
  }
  return { index, chunks, totalObjectBytes, hasBytes: chunks.length === index.length };
}

// objects: Map(address -> bytes) 또는 [address, bytes] 배열. 배치 순서는 입력 순서를 따른다.
export async function encodeStateBundle(cryptoProvider, { commit, meta = null, objects, tag = null }) {
  if (!SHA256_ADDRESS_RE.test(commit)) throw new PyProcError("PYPROC_INPUT_INVALID", `bundle: commit 주소 형식 위반(${commit})`);
  const { index, chunks, totalObjectBytes, hasBytes } = toIndex(objects);
  if (!hasBytes) throw new PyProcError("PYPROC_INPUT_INVALID", "bundle: encode에는 오브젝트 바이트가 필요하다");
  const body = encodeBody(serializeHeader({ commit, meta, index, tag }), chunks, totalObjectBytes);
  const envelope = await sha256HexWith(cryptoProvider, body);
  const out = new Uint8Array(STATE_BUNDLE_MAGIC.length + 64 + body.length);
  out.set(textEncoder.encode(STATE_BUNDLE_MAGIC), 0);
  out.set(textEncoder.encode(envelope), STATE_BUNDLE_MAGIC.length);
  out.set(body, STATE_BUNDLE_MAGIC.length + 64);
  return out;
}

// 서명 대상 = canonical 헤더(tag=null, 오브젝트 주소·길이 색인 포함)의 다이제스트.
// 내용주소가 오브젝트를 개별 봉인하므로 헤더 서명으로 충분하고(git tag 동형), 신뢰 판정이
// 접두 판독만으로 끝난다(headerTagProbe 실측: 미신뢰 거부 slice 2회, payload 접촉 0.
// 치환은 verify-on-read가, 색인 조작은 서명 대상 불일치가, tag 변조는 검증 실패가 잡는다).
// objects는 바이트 없이 색인([address, length])만으로도 계산할 수 있다.
export async function stateBundleHeaderDigest(cryptoProvider, { commit, meta = null, objects }) {
  const { index } = toIndex(objects);
  return sha256AddressWith(cryptoProvider, serializeHeader({ commit, meta, index, tag: null }));
}

export function isStateBundle(buf) {
  return textDecoder.decode(buf.subarray(0, STATE_BUNDLE_MAGIC.length)) === STATE_BUNDLE_MAGIC;
}

// 디코드 + 전량 검증. 반환 { commit, meta, objects: Map, tag, envelope, headerDigest }.
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
  const headerDigest = await sha256AddressWith(cryptoProvider, serializeHeader({ commit: header.commit, meta: header.meta ?? null, index: header.objects, tag: null }));
  return { commit: header.commit, meta: header.meta ?? null, objects, tag: header.tag ?? null, envelope, headerDigest };
}

// 접두만 읽는 헤더 판독(신뢰 preflight의 프리미티브). source는 Uint8Array, Blob,
// 또는 { read(start, end) } 소스다. 오브젝트 바이트는 한 조각도 읽지 않는다:
// 신뢰 거부가 payload 접촉 전에 끝나는 계약의 근거다(조기 거부는 headerTagProbe 실측).
// 봉투 다이제스트(전신 무결성) 검증은 여기서 하지 않는다 - 오브젝트는 추출 시
// verify-on-read로 개별 검증되고, 색인은 서명 대상에 박제되어 있다.
export async function readStateBundleHeader(cryptoProvider, source) {
  const read = source instanceof Uint8Array
    ? async (start, end) => source.subarray(start, end)
    : typeof source?.read === "function"
      ? (start, end) => source.read(start, end)
      : typeof source?.slice === "function"
        ? async (start, end) => new Uint8Array(await source.slice(start, end).arrayBuffer())
        : null;
  if (!read) throw new PyProcError("PYPROC_INPUT_INVALID", "readStateBundleHeader: Uint8Array/Blob/{read} 소스가 필요하다");
  const prefixLength = STATE_BUNDLE_MAGIC.length + 64 + 4;
  const prefix = await read(0, prefixLength);
  if (prefix.length < prefixLength) throw formatError("bundle: 파일이 너무 짧다");
  if (textDecoder.decode(prefix.subarray(0, STATE_BUNDLE_MAGIC.length)) !== STATE_BUNDLE_MAGIC) throw formatError("bundle: 매직 불일치");
  const envelope = textDecoder.decode(prefix.subarray(STATE_BUNDLE_MAGIC.length, STATE_BUNDLE_MAGIC.length + 64));
  const headLen = new DataView(prefix.buffer, prefix.byteOffset + STATE_BUNDLE_MAGIC.length + 64, 4).getUint32(0);
  if (headLen > STATE_BUNDLE_HEAD_MAX_BYTES) throw formatError("bundle: 헤더 길이 위반");
  const headBytes = await read(prefixLength, prefixLength + headLen);
  if (headBytes.length !== headLen) throw formatError("bundle: 헤더 절단");
  let header;
  try { header = JSON.parse(textDecoder.decode(headBytes)); }
  catch (e) { throw formatError("bundle: 헤더 JSON 파손"); }
  if (header.version !== STATE_BUNDLE_VERSION) throw formatError(`bundle: 지원하지 않는 버전(${header.version})`);
  if (!SHA256_ADDRESS_RE.test(header.commit)) throw formatError("bundle: commit 주소 형식 위반");
  if (!Array.isArray(header.objects)) throw formatError("bundle: objects 색인 형식 위반");
  for (const entry of header.objects) {
    if (!Array.isArray(entry) || entry.length !== 2 || !SHA256_ADDRESS_RE.test(entry[0]) || !Number.isInteger(entry[1]) || entry[1] < 0) {
      throw formatError("bundle: objects 색인 엔트리 위반");
    }
  }
  const headerDigest = await sha256AddressWith(cryptoProvider, serializeHeader({ commit: header.commit, meta: header.meta ?? null, index: header.objects, tag: null }));
  if (header.tag && header.tag.target !== headerDigest) {
    throw new PyProcError("PYPROC_MACHINE_INTEGRITY", "bundle: 서명 대상 불일치(헤더가 tag와 다르다)");
  }
  return {
    commit: header.commit,
    meta: header.meta ?? null,
    objects: header.objects,
    tag: header.tag ?? null,
    envelope,
    headerDigest,
    objectsOffset: prefixLength + headLen,
  };
}
