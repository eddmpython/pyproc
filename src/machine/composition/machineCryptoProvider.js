// machineCryptoProvider.js - machine 층에 상태 커널의 암호 법을 배달하는 조립 지점.
//
// machine 내부(persistence/image)는 경계상 커널을 import하지 못한다(밖 import는 composition
// 한 점). 그래서 커널이 machine을 아는 게 아니라, composition이 커널의 함수 조각(digest,
// ECDSA 서명·검증, 키 생성)을 provider로 묶어 machine 생성자에 꽂는다. 이로써
// generationIntegrity와 webMachineTrust의 자체 암호 구현이 소멸하고 법은 코어 한 벌이 된다.
// 직렬화 규약(canonical manifest, machine 지문의 JWK 정렬)은 machine 도메인의 형식 법이라
// machine에 남는다: 지문은 소비자가 박아두는 공개 값이라 규약 변경 = 신뢰 목록 무효화다.
import { sha256AddressWith } from "../../runtime/contentDigest.js";
import {
  createStateKeyPair,
  exportStatePublicKey,
  makeStateTag,
  signStateDigest,
  verifyStateDigest,
  verifyStateTag,
} from "../../state/signedTag.js";
import {
  decodeStateBundle,
  encodeStateBundle,
  readStateBundleHeader,
  stateBundleHeaderDigest,
} from "../../state/bundleFormat.js";
import {
  decodeStateObject,
  encodeStateObject,
  makePayloadTree,
  makeStateCommit,
  validateStateCommit,
  validateStateTree,
} from "../../state/objectModel.js";

export function createMachineCryptoProvider(cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.subtle) throw new TypeError("createMachineCryptoProvider: cryptoProvider.subtle이 필요하다");
  const randomUUID = typeof cryptoProvider.randomUUID === "function" ? cryptoProvider.randomUUID.bind(cryptoProvider) : undefined;
  return Object.freeze({
    subtle: cryptoProvider.subtle,
    ...(randomUUID ? { randomUUID } : {}),
    digestBytes: (bytes) => sha256AddressWith(cryptoProvider, bytes),
    signDigest: (privateKey, target) => signStateDigest(cryptoProvider, privateKey, target),
    verifyDigest: async (publicKeyOrJwk, target, signatureBytes) => {
      try { return await verifyStateDigest(cryptoProvider, publicKeyOrJwk, target, signatureBytes); }
      catch (e) { return false; } // 임포트 불가/형식 위반 키는 "검증 실패"다(적대 입력의 정상 결말)
    },
    generateSigningKeyPair: () => createStateKeyPair(cryptoProvider),
    exportPublicJwk: (publicKey) => exportStatePublicKey(cryptoProvider, publicKey),
    // 커널 문법의 함수 조각: machine generation이 커널 오브젝트(blob/tree/commit)로 저장되도록,
    // .webmachine 봉투가 단일 bundle wire 포맷(PYBUNDLE1)으로 인코딩되도록 coordinator/image가
    // 소비한다. machine은 커널을 import하지 못하므로(경계) 문법과 코덱을 여기로 배달한다.
    state: Object.freeze({
      encodeObject: encodeStateObject,
      decodeObject: decodeStateObject,
      makePayloadTree,
      makeStateCommit,
      validateStateCommit,
      validateStateTree,
      // 이동 봉투(.webmachine) 코덱: bundleFormat 정본을 그대로 배달한다(machine 자기 포맷 소멸).
      encodeBundle: (input) => encodeStateBundle(cryptoProvider, input),
      decodeBundle: (buf) => decodeStateBundle(cryptoProvider, buf),
      readBundleHeader: (source) => readStateBundleHeader(cryptoProvider, source),
      bundleHeaderDigest: (input) => stateBundleHeaderDigest(cryptoProvider, input),
      // header-target 서명(출처): tag.target = 헤더 다이제스트. 조기 거부의 근거.
      makeTag: (privateKey, publicKeyJwk, target) => makeStateTag(cryptoProvider, privateKey, publicKeyJwk, target),
      verifyTag: (tag, expectedTarget, opts) => verifyStateTag(cryptoProvider, tag, expectedTarget, opts),
    }),
  });
}
