// state/index.js - pyproc/history subpath의 배럴(plumbing 표면).
//
// porcelain(루트 boot/open의 머신 핸들)이 "역사를 가진 브라우저 컴퓨터"라는 모델을 동사로
// 말한다면, 여기는 그 모델의 계약 자체다: 오브젝트 문법(blob/tree/commit), 커밋·부활
// 프로토콜과 store 계약, 서명 tag, 이동 bundle 포맷, store 드라이버 실물. 소비 제품이
// 자기 저장소를 커널 backend로 꽂는 지점이 이 표면이다.
export {
  canonicalStateJson,
  decodeStateObject,
  encodeStateObject,
  makePageTableTree,
  makePayloadTree,
  makeStateCommit,
  stateAddressOf,
  validateStateCommit,
  validateStateTree,
} from "./objectModel.js";
export { commitState, openState } from "./refProtocol.js";
export {
  STATE_TAG_ALG,
  canonicalStateJwk,
  createStateKeyPair,
  exportStatePublicKey,
  fingerprintStatePublicKey,
  importStatePublicKey,
  makeStateTag,
  signStateDigest,
  signStateTag,
  verifyStateDigest,
  verifyStateTag,
} from "./signedTag.js";
export {
  STATE_BUNDLE_HEAD_MAX_BYTES,
  STATE_BUNDLE_MAGIC,
  STATE_BUNDLE_VERSION,
  decodeStateBundle,
  encodeStateBundle,
  isStateBundle,
  readStateBundleHeader,
  stateBundleHeaderDigest,
} from "./bundleFormat.js";
export { MemoryStateStore } from "./memoryStateStore.js";
export { OpfsStateStore } from "./opfsStateStore.js";
export { SHA256_ADDRESS_RE, parseSha256Address, sha256Address, sha256AddressWith, sha256HexWith, verifySha256, verifySha256With } from "../runtime/contentDigest.js";
export { PAGE_SIZE } from "../runtime/memoryLayout.js";
