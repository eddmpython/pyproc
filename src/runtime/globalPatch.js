// globalPatch.js - Layer 0: 전역(fetch/엔트로피/시간) 패치 창의 단일 직렬화 지점.
// 전역을 스왑하는 구간(결정적 부팅의 엔트로피 스텁, 부팅 코어 캐시의 fetch 랩,
// wheel 캐시의 fetch 스왑)이 동시에 겹치면 먼저 끝난 쪽이 다른 쪽의 패치를 원본인 줄
// 알고 복원해 전역이 꼬인다. 한 체인에서 창 하나씩만 열면 이 계열의 경쟁이 사라진다.
//
// 중첩 계약: 한 창 안에서 다른 패처를 부르는 조립(bootSession -> boot 코어 캐시,
// bootSession -> WheelCache)은 대기하면 자기 창을 기다리는 데드락이다. 그래서 창을
// 연 쪽이 fn(reenter)의 reenter를 받아 내부 패처에 patchScope로 넘긴다. 엄격한
// LIFO 중첩(안쪽이 바깥의 패치 위에 얹고 자기 것만 되돌림)은 안전하다.
// (창이 탭 전역이라는 사실 자체는 계약으로 남는다: SECURITY.md 결정적 부팅 창 절.)
let patchChain = Promise.resolve();

const reenter = (fn) => fn();

export function runWithGlobalPatch(fn) {
  const exec = () => fn(reenter);
  const run = patchChain.then(exec, exec);
  patchChain = run.then(() => undefined, () => undefined);
  return run;
}
