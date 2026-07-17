// boundaryChallenge.js - 경계의 동일성 반경 측정기.
//
// `guix challenge`가 파일에 하는 것을 부팅 후 힙에 한다: 매니페스트를 주면 누구든 부팅해서
// 다이제스트를 내놓고, 서로 hex 하나를 비교한다. 같으면 경계가 같고, 다르면 어느 페이지인지
// 뽑는다. **경계 자체(수십 MB)는 한 번도 전송하지 않는다.** 벡터는 페이지당 8바이트다.
//
// 설계 정본: mainPlan/boundary-radius. 이 파일은 그 1단계다.
//
// 왜 이게 필요한가: 논지가 "상태 = 다시부팅(매니페스트) + 페이지 델타"인데, 뺄셈이 성립하려면
// 빼는 쪽과 빼일 쪽의 경계가 같아야 한다. 그 "같음"의 반경이 한 번도 측정된 적이 없다.
// 우리 자신의 실측은 반대를 가리킨다(src/processOs/worker.js:10: 메인과 워커는 바이트가 다르다).

/** 힙 페이지 크기. 정본은 src/runtime/memoryLayout.js이고 여기선 벡터 헤더에 싣기만 한다. */
export const CHALLENGE_PAGE_SIZE = 65536;

/**
 * "같은 조건"의 정의. 이 객체가 같으면 경계가 같아야 한다는 것이 검증 대상 주장이다.
 * 지금 저장소 어디에도 이 정의가 없다. 그래서 "같은 매니페스트"라는 말이 검증 불가능했다.
 *
 * 매니페스트에 들어가는 것 = 경계를 결정한다고 **주장**하는 입력 전부.
 * 매니페스트에 없는데 경계를 바꾸는 것이 있으면, 그게 바로 이 캠페인이 찾는 발산 출처다.
 */
export const defaultManifest = Object.freeze({
  engine: "pyodide",
  // 정본은 src/runtime/runtime.js의 DEFAULT_INDEX. probe가 실제 값을 주입한다.
  indexUrl: null,
  packages: [],
  imports: [],
  env: { PYTHONHASHSEED: "0" },
  // 부팅 구간 엔트로피 고정. 실측(pythonMachine/bootDeterminismProbe)이 지목한 비결정의 주범.
  // 주의: 이건 결정성의 순진한 절반이다. V8은 고정 + 역직렬화 때 rehash로 hash flooding
  // 내성을 되찾는데 CPython엔 그 설비가 없다(mainPlan/boundary-radius 6단계).
  entropy: { getRandomValues: "fill:0x42", dateNow: 1750000000000, performanceNow: 12345 },
});

/** 매니페스트를 키 순서 무관하게 같은 문자열로 만든다(다이제스트가 키 순서에 안 흔들리도록). */
export const canonicalJson = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
};

/**
 * 부팅 구간의 엔트로피·시간을 매니페스트가 시킨 대로 고정한다. 되돌리는 함수를 준다.
 * 반드시 finally로 되돌린다: 안 되돌리면 이후 모든 측정이 오염된다.
 */
export const stubEntropy = (manifest = defaultManifest) => {
  const spec = manifest.entropy;
  if (!spec) return () => {};
  const saved = {
    getRandomValues: crypto.getRandomValues.bind(crypto),
    dateNow: Date.now,
    performanceNow: performance.now.bind(performance),
  };
  const fill = Number.parseInt(String(spec.getRandomValues).replace("fill:", ""), 16);
  crypto.getRandomValues = (array) => {
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(fill);
    return array;
  };
  Date.now = () => spec.dateNow;
  performance.now = () => spec.performanceNow;
  return () => {
    crypto.getRandomValues = saved.getRandomValues;
    Date.now = saved.dateNow;
    performance.now = saved.performanceNow;
  };
};

/**
 * 매니페스트대로 부팅해서 경계 벡터를 낸다.
 * boot는 호출자가 주입한다(캠페인이 index.js 공개 표면만 쓰도록: attempts는 소비자다).
 */
export const captureVector = async (boot, manifest = defaultManifest) => {
  const restore = stubEntropy(manifest);
  let session;
  try {
    session = await boot({ ...(manifest.indexUrl ? { indexURL: manifest.indexUrl } : {}), env: { ...manifest.env } });
    if (manifest.packages.length) await session.loadPackages([...manifest.packages]);
    for (const statement of manifest.imports) session.run(statement);
    const hashes = session.memory.pageHashes();
    return Object.freeze({
      manifest,
      pageSize: CHALLENGE_PAGE_SIZE,
      heapBytes: session.memory.byteLength(),
      pageCount: hashes.length / 2, // 페이지당 2워드 interleave(실효 64비트)
      vector: hashes,
    });
  } finally {
    restore();
  }
};

/** 벡터를 이동 가능한 hex 문자열로. 페이지당 16자(64비트). 40MB 힙 -> 약 10KB. */
export const encodeVector = (vector) => {
  let out = "";
  for (let i = 0; i < vector.length; i++) out += vector[i].toString(16).padStart(8, "0");
  return out;
};

export const decodeVector = (hex) => {
  const words = new Uint32Array(hex.length / 8);
  for (let i = 0; i < words.length; i++) words[i] = Number.parseInt(hex.slice(i * 8, i * 8 + 8), 16);
  return words;
};

/**
 * **경계의 content address.** 매니페스트와 벡터를 함께 해싱하므로, 다이제스트가 같다는 것은
 * "같은 조건으로 부팅해 같은 힙에 도달했다"는 뜻이다. 참가자는 이 hex 하나만 주고받는다.
 *
 * 조사가 지목한 자리가 정확히 여기다: 아무도 머신 상태에 결정론적 content address를 안 붙였다.
 * v86/CheerpX/nanokrnl/env86/PCjs 전부 0건이고, Podman OCI digest는 저장 바이트의 해시이지
 * 머신 상태의 정준 해시가 아니다.
 */
export const boundaryDigest = async (capture) => {
  const header = canonicalJson({
    manifest: capture.manifest,
    pageSize: capture.pageSize,
    heapBytes: capture.heapBytes,
    pageCount: capture.pageCount,
  });
  const headerBytes = new TextEncoder().encode(header);
  const vectorBytes = new Uint8Array(capture.vector.buffer, capture.vector.byteOffset, capture.vector.byteLength);
  const payload = new Uint8Array(headerBytes.length + vectorBytes.length);
  payload.set(headerBytes, 0);
  payload.set(vectorBytes, headerBytes.length);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/**
 * 벡터 둘 -> 상이 페이지. 길이가 다르면 페이지 비교 자체가 무의미하므로 먼저 길이를 본다.
 * 실측 근거: 메인 대 워커는 "힙 길이는 같아도 바이트가 다르다"(worker.js:10). 즉 길이 동일이
 * 경계 동일을 뜻하지 않는다. 반대로 길이가 다르면 애초에 같은 경계가 아니다.
 */
export const compareVectors = (left, right, maxIndices = 32) => {
  const lengthMatch = left.length === right.length;
  const pages = Math.min(left.length, right.length) / 2;
  const diffIndices = [];
  let diffPages = 0;
  for (let p = 0; p < pages; p++) {
    if (left[2 * p] === right[2 * p] && left[2 * p + 1] === right[2 * p + 1]) continue;
    diffPages++;
    if (diffIndices.length < maxIndices) diffIndices.push(p);
  }
  return Object.freeze({
    lengthMatch,
    comparedPages: pages,
    diffPages,
    diffIndices,
    identical: lengthMatch && diffPages === 0,
  });
};

/** 커밋 가능한 챌린지 기록. CI가 이걸 읽어 재계산하고 대조한다. */
export const toChallengeRecord = async (capture) => ({
  manifest: capture.manifest,
  pageSize: capture.pageSize,
  heapBytes: capture.heapBytes,
  pageCount: capture.pageCount,
  digest: await boundaryDigest(capture),
  vector: encodeVector(capture.vector),
});
