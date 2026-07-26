// objectModel.js - Layer 1(state): 내구 구역 오브젝트 모델의 정본.
// 머신의 상태는 두 구역을 가진 단일 역사 저장소에 산다(mainPlan/_done/state-kernel). 여기는 그중
// 내구 구역의 문법이다: blob(내용주소 바이트) / tree(타입 있는 엔트리) / commit(부모 + 환경
// 지문 + fence). 휘발 구역(reactive 체크포인트 나무)은 이 모델을 모르고, 유일한 승격 관문은
// ReactiveController.collectDelta다(실행 경계에 암호 해시 금지, tests/run.mjs [digest 법] 가드).
//
// 순수 규율: 브라우저 전역 접근 0. digest는 contentDigest의 cryptoProvider 매개변수화 코어만
// 쓴다. 실측 원형은 tests/attempts/stateKernel(0단계 probe 3종 GREEN, 2026-07-18)이다.
import { PyProcError } from "../runtime/errors.js";
import { SHA256_ADDRESS_RE, sha256AddressWith } from "../runtime/contentDigest.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function inputError(message) {
  return new PyProcError("PYPROC_INPUT_INVALID", message);
}

// canonical JSON: 키 정렬 + finite 수만. 같은 값이면 어디서 인코딩해도 같은 주소가 나온다.
// machine의 generationIntegrity에 같은 법의 주입식 사본이 있고(경계상 import 불가),
// coordinator 커널 위임 단계에서 그쪽이 소멸한다.
export function canonicalStateJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw inputError("canonicalStateJson: only finite numbers are allowed");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalStateJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalStateJson(value[k])}`).join(",")}}`;
  }
  throw inputError(`canonicalStateJson: unsupported type (${typeof value})`);
}

export function encodeStateObject(value) { return textEncoder.encode(canonicalStateJson(value)); }

export function decodeStateObject(bytes) {
  try { return JSON.parse(textDecoder.decode(bytes)); }
  catch (e) { throw new PyProcError("PYPROC_STATE_CORRUPT", "state: object JSON is corrupt", { cause: e }); }
}

export async function stateAddressOf(cryptoProvider, bytes) {
  return sha256AddressWith(cryptoProvider, bytes);
}

// tree: 타입 있는 엔트리. 한 오브젝트 모델이지만 한 모양이 아니다:
//   pageTable = 힙 커밋 전용(균일 페이지 + heapLen/sp), payload = 불투명 바이트(machine
//   generation, guest 스냅샷). machine 층이 collectDelta를 소비하지 않는다는 실측이 근거다.
export function makePageTableTree({ pageSize, heapLen, sp, pages, files = [] }) {
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw inputError(`pageTable: invalid pageSize (${pageSize})`);
  if (!Number.isInteger(heapLen) || heapLen <= 0) throw inputError(`pageTable: invalid heapLen (${heapLen})`);
  if (sp !== null && (!Number.isInteger(sp) || sp < 0)) throw inputError(`pageTable: invalid sp (${sp})`);
  if (!Array.isArray(pages)) throw inputError("pageTable: a pages array is required");
  const seen = new Set();
  for (const entry of pages) {
    if (!Array.isArray(entry) || entry.length !== 2) throw inputError("pageTable: a [page, address] entry is required");
    const [p, address] = entry;
    if (!Number.isInteger(p) || p < 0) throw inputError(`pageTable: invalid page number (${p})`);
    if (seen.has(p)) throw inputError(`pageTable: duplicate page number (${p})`);
    seen.add(p);
    if (!SHA256_ADDRESS_RE.test(address)) throw inputError(`pageTable: malformed address (${address})`);
  }
  // file 엔트리: 힙 세대에 함께 묶이는 파일 페이로드(/home pack 등). meta는 소비자 소유의
  // 불투명 객체다(형식 판정은 적용하는 쪽 몫: applyMachineHome의 validateMachineHomeMeta 등).
  if (!Array.isArray(files)) throw inputError("pageTable: a files array is required");
  const fileIds = new Set();
  for (const e of files) {
    if (typeof e?.id !== "string" || !e.id) throw inputError("pageTable: invalid file.id");
    if (fileIds.has(e.id)) throw inputError(`pageTable: duplicate file.id (${e.id})`);
    fileIds.add(e.id);
    if (!SHA256_ADDRESS_RE.test(e.address)) throw inputError(`pageTable: malformed file address (${e.address})`);
    if (!Number.isInteger(e.byteLength) || e.byteLength < 0) throw inputError(`pageTable: invalid file.byteLength (${e.id})`);
    if (e.meta !== null && (typeof e.meta !== "object" || Array.isArray(e.meta))) throw inputError(`pageTable: invalid file.meta (${e.id})`);
  }
  const tree = { kind: "pageTable", pageSize, heapLen, sp, pages };
  if (files.length) tree.files = files.map((e) => ({ id: e.id, address: e.address, byteLength: e.byteLength, meta: e.meta ?? null }));
  return tree;
}

export function makePayloadTree({ entries }) {
  if (!Array.isArray(entries)) throw inputError("payload: an entries array is required");
  const seen = new Set();
  for (const e of entries) {
    if (typeof e?.id !== "string" || !e.id) throw inputError("payload: invalid entry.id");
    if (seen.has(e.id)) throw inputError(`payload: duplicate entry.id (${e.id})`);
    seen.add(e.id);
    if (!SHA256_ADDRESS_RE.test(e.address)) throw inputError(`payload: malformed address (${e.address})`);
    if (!Number.isInteger(e.byteLength) || e.byteLength < 0) throw inputError(`payload: invalid byteLength (${e.id})`);
    // meta는 소비자 소유의 불투명 도메인 기술이다(machine generation의 adapterId/장치 크기 등).
    if (e.meta !== undefined && e.meta !== null && (typeof e.meta !== "object" || Array.isArray(e.meta))) {
      throw inputError(`payload: invalid meta (${e.id})`);
    }
  }
  return { kind: "payload", entries: entries.map((e) => ({ id: e.id, address: e.address, byteLength: e.byteLength, meta: e.meta ?? null })) };
}

// 저장소에서 읽은(신뢰 불가) tree의 형식 판정. 위반은 손상이다(입력 오류가 아니라).
export function validateStateTree(tree) {
  try {
    if (tree?.kind === "pageTable") return makePageTableTree(tree);
    if (tree?.kind === "payload") return makePayloadTree(tree);
  } catch (e) {
    throw new PyProcError("PYPROC_STATE_CORRUPT", `state: tree shape is corrupt (${String(e.message || e).slice(-160)})`, { cause: e });
  }
  throw new PyProcError("PYPROC_STATE_CORRUPT", `state: unknown tree kind (${tree?.kind})`);
}

// commit: { parents[], tree, env, fence, createdAt }.
// env = 환경 지문 { h0, engineAssetDigest, deterministic }: fork·부활 결정성을 upstream 우연에서
// "헤더에 핀되고 열 때 대조되는 계약"으로 바꾼다(해결이 아니라 감지다). 스키마는 변경 페이지
// 집합만 가정하고 해시 배열의 존재를 가정하지 않는다(감지기는 MemoryCapability 뒤에서 교체 가능).
export function makeStateCommit({ parents = [], tree, env = {}, fence = null, createdAt = null }) {
  if (!Array.isArray(parents)) throw inputError("commit: a parents array is required");
  for (const p of parents) if (!SHA256_ADDRESS_RE.test(p)) throw inputError(`commit: malformed parent address (${p})`);
  if (!SHA256_ADDRESS_RE.test(tree)) throw inputError(`commit: malformed tree address (${tree})`);
  if (typeof env !== "object" || env === null || Array.isArray(env)) throw inputError("commit: an env object is required");
  const environment = {
    h0: env.h0 == null ? null : String(env.h0),
    engineAssetDigest: env.engineAssetDigest == null ? null : String(env.engineAssetDigest),
    deterministic: env.deterministic === true,
  };
  let commitFence = null;
  if (fence !== null) {
    if (typeof fence?.ownerId !== "string" || !fence.ownerId) throw inputError("commit: invalid fence.ownerId");
    if (!Number.isSafeInteger(fence.epoch) || fence.epoch < 1) throw inputError("commit: invalid fence.epoch");
    commitFence = { ownerId: fence.ownerId, epoch: fence.epoch };
  }
  if (createdAt !== null && typeof createdAt !== "string") throw inputError("commit: createdAt must be a string");
  return { parents: [...parents], tree, env: environment, fence: commitFence, createdAt };
}

export function validateStateCommit(commit) {
  try { return makeStateCommit(commit ?? {}); }
  catch (e) {
    throw new PyProcError("PYPROC_STATE_CORRUPT", `state: commit shape is corrupt (${String(e.message || e).slice(-160)})`, { cause: e });
  }
}
