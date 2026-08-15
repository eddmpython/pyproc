// bundleFormat.js - Layer 1(state): 이동 가능한 서명 오브젝트 묶음(단일 봉투 포맷)의 정본.
//
// 서버 없는 런타임의 라이브러리다운 강함은 상태가 "들고 다닐 수 있는 서명된 오브젝트"라는
// 것이다. 이 포맷이 .pymachine v2/v3과 .webmachine을 대체하는 단일 writer 계약이다(구 포맷은
// 각 소비자의 감지형 reader가 읽기만 지원). 신뢰 도메인 차이는 검증 정책의 차이지 포맷의
// 차이가 아니다: 파서 2벌 = 취약면 2배(구 .pymachine v1 헤더 변조 적발 전과가 실증).
//
// 바이트 레이아웃(버전 있는 공개 계약, skills/reference-pyproc-api/references/bundle-format.md와 게이트로 대조):
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
// commit은 선택형(null 가능): 세션 bundle은 커널 commit 주소를 싣고 machine envelope는 안 싣는다.
// 두 소비자가 같은 wire 포맷(헤더 서명 + 조기 거부 + verify-on-read)을 공유하고 meta로만 갈린다.
function serializeHeader({ commit = null, meta, index, tag }) {
  return textEncoder.encode(JSON.stringify({ version: STATE_BUNDLE_VERSION, commit, meta, objects: index, tag }));
}

function encodeBody(headBytes, objectChunks, totalObjectBytes) {
  if (headBytes.length > STATE_BUNDLE_HEAD_MAX_BYTES) throw formatError("bundle: header exceeds its size limit");
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
    if (!SHA256_ADDRESS_RE.test(address)) throw new PyProcError("PYPROC_INPUT_INVALID", `bundle: object address has the wrong form (${address})`);
    const isBytes = payload instanceof Uint8Array;
    const length = isBytes ? payload.length : payload;
    if (!Number.isInteger(length) || length < 0) throw new PyProcError("PYPROC_INPUT_INVALID", `bundle: object has the wrong type (${address})`);
    index.push([address, length]);
    if (isBytes) { chunks.push(payload); totalObjectBytes += length; }
  }
  return { index, chunks, totalObjectBytes, hasBytes: chunks.length === index.length };
}

// objects: Map(address -> bytes) 또는 [address, bytes] 배열. 배치 순서는 입력 순서를 따른다.
// commit: 세션 bundle이 커널 commit 주소를 싣는다(null이면 machine envelope 등 non-commit bundle).
export async function encodeStateBundle(cryptoProvider, { commit = null, meta = null, objects, tag = null }) {
  if (commit !== null && !SHA256_ADDRESS_RE.test(commit)) throw new PyProcError("PYPROC_INPUT_INVALID", `bundle: commit address has the wrong form (${commit})`);
  const { index, chunks, totalObjectBytes, hasBytes } = toIndex(objects);
  if (!hasBytes) throw new PyProcError("PYPROC_INPUT_INVALID", "bundle: encode needs an object list");
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
export async function stateBundleHeaderDigest(cryptoProvider, { commit = null, meta = null, objects }) {
  const { index } = toIndex(objects);
  return sha256AddressWith(cryptoProvider, serializeHeader({ commit, meta, index, tag: null }));
}

export function isStateBundle(buf) {
  return textDecoder.decode(buf.subarray(0, STATE_BUNDLE_MAGIC.length)) === STATE_BUNDLE_MAGIC;
}

// 헤더 JSON의 구조 판정 한 벌. 전량 디코드와 접두 판독(신뢰 게이트)이 같은 판정을 쓴다.
// 사본이 둘일 때의 위험은 방향이 있었다: 접두 판독이 더 약하면 조기 거부가 통과시킨 것을 나중
// 디코드가 잡는데, 그때는 이미 payload를 만진 뒤다. 조기 거부의 존재 이유가 무너지는 지점이라
// 판정을 한 함수로 모은다(검증을 조이면 양쪽에 함께 조여진다).
function parseBundleHeader(headBytes) {
  let header;
  try { header = JSON.parse(textDecoder.decode(headBytes)); }
  catch (e) { throw formatError("bundle: header JSON is corrupt"); }
  if (header.version !== STATE_BUNDLE_VERSION) throw formatError(`bundle: unsupported version (${header.version})`);
  const commit = header.commit ?? null;
  if (commit !== null && !SHA256_ADDRESS_RE.test(commit)) throw formatError("bundle: malformed commit address");
  if (!Array.isArray(header.objects)) throw formatError("bundle: objects index has the wrong shape");
  for (const entry of header.objects) {
    if (!Array.isArray(entry) || entry.length !== 2) throw formatError("bundle: objects index entry is invalid");
    const [address, length] = entry;
    if (!SHA256_ADDRESS_RE.test(address)) throw formatError(`bundle: malformed object address (${address})`);
    if (!Number.isInteger(length) || length < 0) throw formatError(`bundle: object length is invalid (${address})`);
  }
  return { commit, meta: header.meta ?? null, index: header.objects, tag: header.tag ?? null };
}

// 디코드 + 전량 검증. 반환 { commit, meta, objects: Map, tag, envelope, headerDigest }.
export async function decodeStateBundle(cryptoProvider, buf) {
  if (!isStateBundle(buf)) throw formatError("bundle: magic mismatch");
  const hashStart = STATE_BUNDLE_MAGIC.length;
  const envelope = textDecoder.decode(buf.subarray(hashStart, hashStart + 64));
  const body = buf.subarray(hashStart + 64);
  const actual = await sha256HexWith(cryptoProvider, body);
  if (actual !== envelope) throw new PyProcError("PYPROC_MACHINE_INTEGRITY", "bundle: header integrity check failed (corrupted after write, or tampered)");
  if (body.length < 4) throw formatError("bundle: file is too short");
  const headLen = new DataView(body.buffer, body.byteOffset, 4).getUint32(0);
  if (headLen > STATE_BUNDLE_HEAD_MAX_BYTES || 4 + headLen > body.length) throw formatError("bundle: header length is invalid");
  const header = parseBundleHeader(body.subarray(4, 4 + headLen));
  const _commit = header.commit;
  const objects = new Map();
  let offset = 4 + headLen;
  for (const entry of header.index) {
    const [address, length] = entry;
    // 오프셋 의존 판정만 여기 남는다(공용 파서는 바이트 배치를 모른다).
    if (offset + length > body.length) throw formatError(`bundle: object length is invalid (${address})`);
    if (objects.has(address)) throw formatError(`bundle: duplicate object address (${address})`);
    const bytes = body.subarray(offset, offset + length);
    const verdict = await verifySha256With(cryptoProvider, bytes, address);
    if (!verdict.ok) throw new PyProcError("PYPROC_MACHINE_INTEGRITY", `bundle: object failed verify-on-read (${address.slice(0, 20)}..)`);
    objects.set(address, bytes);
    offset += length;
  }
  if (offset !== body.length) throw formatError("bundle: trailing bytes outside the index");
  if (_commit !== null && !objects.has(_commit)) throw formatError("bundle: the commit object is not in the index");
  const headerDigest = await sha256AddressWith(cryptoProvider, serializeHeader({ commit: _commit, meta: header.meta, index: header.index, tag: null }));
  return { commit: _commit, meta: header.meta, objects, tag: header.tag, envelope, headerDigest };
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
  if (!read) throw new PyProcError("PYPROC_INPUT_INVALID", "readStateBundleHeader: needs a Uint8Array, Blob, or { read } source");
  const prefixLength = STATE_BUNDLE_MAGIC.length + 64 + 4;
  const prefix = await read(0, prefixLength);
  if (prefix.length < prefixLength) throw formatError("bundle: file is too short");
  if (textDecoder.decode(prefix.subarray(0, STATE_BUNDLE_MAGIC.length)) !== STATE_BUNDLE_MAGIC) throw formatError("bundle: magic mismatch");
  const envelope = textDecoder.decode(prefix.subarray(STATE_BUNDLE_MAGIC.length, STATE_BUNDLE_MAGIC.length + 64));
  const headLen = new DataView(prefix.buffer, prefix.byteOffset + STATE_BUNDLE_MAGIC.length + 64, 4).getUint32(0);
  if (headLen > STATE_BUNDLE_HEAD_MAX_BYTES) throw formatError("bundle: header length is invalid");
  const headBytes = await read(prefixLength, prefixLength + headLen);
  if (headBytes.length !== headLen) throw formatError("bundle: header is truncated");
  const header = parseBundleHeader(headBytes);
  const _commit = header.commit;
  const headerDigest = await sha256AddressWith(cryptoProvider, serializeHeader({ commit: _commit, meta: header.meta, index: header.index, tag: null }));
  if (header.tag && header.tag.target !== headerDigest) {
    throw new PyProcError("PYPROC_MACHINE_INTEGRITY", "bundle: header digest mismatch (the signed tag covers a different header)");
  }
  return {
    commit: _commit,
    meta: header.meta,
    objects: header.index,
    tag: header.tag,
    envelope,
    headerDigest,
    objectsOffset: prefixLength + headLen,
  };
}
