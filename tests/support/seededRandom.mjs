// seededRandom.mjs - property/fuzz 절이 공유하는 시드 고정 PRNG.
//
// 왜 공유하는가: fuzz 실패는 시드와 반복 인덱스로 재현 가능해야 하고, 그 재현성은 난수원이
// **같은 한 구현**일 때만 성립한다. 사본이 둘이면 "시드 7의 12번째 반복"이 절마다 다른 값을
// 가리키고, 그러면 실패 보고가 재현 지시가 아니게 된다. run.mjs 안에 두 벌이 있었다(2026-08-01).
//
// mulberry32: 32비트 상태의 작고 통계적으로 충분한 PRNG. 암호 용도가 아니다(테스트 난수원이다).
export const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
