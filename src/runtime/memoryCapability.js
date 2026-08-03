// memoryCapability.js - Layer 0 능력 계약: WASM 메모리 접근 격리.
// 교차 관심사(HEAPU8 접근·스택 포인터)를 이 계약 뒤에 캡슐화한다. 소비자와 상위 능력은
// 깨끗한 메서드만 쓰고 엔진 내부를 직접 만지지 않는다.
// 완전 해시(Uint32 워드 전수)는 soundness의 열쇠 - 샘플링 금지(불완전 델타 -> 복원 크래시).
// 페이지당 독립 32비트 해시 2개(실효 64비트)로 충돌 누락 확률을 ~2^-64로 억제한다.
// 실측(attempts/reactiveSoundness, 2026-07-11): 단일 대비 1.54배, 30MB 힙 14.3ms.
import { PAGE_SIZE } from "./memoryLayout.js";

export { PAGE_SIZE } from "./memoryLayout.js";

// 믹서 상수. a레인은 FNV-1a, b레인은 murmur3 fmix 계열이다.
const FNV_OFFSET = 2166136261, FNV_PRIME = 16777619;
const MIX_SEED = 2654435761, MIX_PRIME = 2246822519;
// 부분 누산기의 두 번째 씨앗. 자기 소수로 한 번 섞은 값이라 첫 사슬과 겹치지 않는다
// (같은 값에서 출발하면 두 사슬이 대칭이라 워드 자리를 맞바꾼 힙에서 서로를 상쇄한다).
const FNV_OFFSET_2 = Math.imul(FNV_OFFSET, FNV_PRIME) | 0;
const MIX_SEED_2 = Math.imul(MIX_SEED, MIX_PRIME) | 0;
// 변경 통보를 원하지 않는 호출자의 자리. 호출마다 인자 모양이 갈리지 않게 값으로 채운다.
const NO_PAGE_SINK = () => {};
const NO_PREV_HASHES = new Uint32Array(0);

export class MemoryCapability {
  // engine: EngineContract. 선형 메모리·스택 접근을 계약 뒤에서 받는다(엔진 내부 직접 접근 0).
  // 이 격리가 엔진 독립의 축이다: 엔진이 바뀌어도 heapU8()만 제공하면 아래 알고리즘이 그대로 산다.
  constructor(engine) { this._e = engine; }
  heap() { return this._e.heapU8(); }                    // 항상 최신 뷰(성장 후 detach 대응)
  byteLength() { return this._e.heapU8().length; }
  stackSave() { return this._e.stackSave(); }
  stackRestore(sp) { this._e.stackRestore(sp); }
  // 페이지당 [2p]=FNV-1a, [2p+1]=독립 믹서를 interleave로 반환(길이 = 2 * 페이지 수).
  //
  // 레인마다 부분 누산기가 둘이다. 모든 워드가 여전히 같은 비선형 단계(b레인의 >>>15)를
  // 거치므로 완전성은 그대로이고, 바뀌는 것은 의존 사슬 길이뿐이다: 워드마다 imul 지연이
  // 직렬로 쌓이던 것을 둘로 갈라 겹친다.
  //
  // 실측(node, 64MB 힙, 2026-08-03): 옛 사슬 하나 24-26ms(안정), 사슬 둘 15-16ms.
  // **정직하게**: 사슬 둘은 이봉분포다. 워밍업 40회에서 8분의 7이 15.5ms대이고 나머지 하나가
  // 27.6ms대로 떨어진다(옛 형태보다 느린 쪽). 오래 도는 세션은 호출 수가 많아 빠른 쪽으로
  // 수렴하지만, 어느 프로세스가 어느 쪽을 잡는지는 이 코드가 정하지 못한다.
  //
  // 왜 더 싼 믹서를 쓰지 않는가(같은 실측에서 기각한 후보들): 누적합 계열(Fletcher/Adler)은
  // 워드당 2연산이라 1.5배 빠르지만 Z_2^32-선형이다. MSB(2^31)만 뒤집는 변경은 자리올림이 없어
  // 델타가 2^31*(L_i+L_j)이고, 두 워드가 같은 패리티 자리에 있으면 정확히 0이 된다. FNV 레인도
  // xor->imul이라 MSB 차이가 MSB로만 전파돼 같은 쌍에서 상쇄된다. b레인의 우시프트가 그 전파를
  // 깨는 유일한 장치라서 워드당 비선형은 흥정 대상이 아니다([해시 soundness] MSB 쌍 판정이 문다).
  //
  // prev를 주면 같은 순회에서 "바뀐 페이지"까지 판정해 onChanged(p)로 낸다. 방금 읽어 캐시에
  // 남아 있는 페이지를 그 자리에서 복사할 수 있다(전수 주사를 끝낸 뒤 변경분을 다시 도는 두 벌
  // 대신). 판정 법은 heapDelta.hashDiffPages와 같아야 하고, 게이트가 그 동치를 문다.
  pageHashes(prev = null, onChanged = null) {
    const buf = this.heap().buffer, len = this.byteLength();
    const words = new Uint32Array(buf, 0, (len - (len % 4)) / 4);
    const wpp = PAGE_SIZE / 4, n = Math.ceil(len / PAGE_SIZE), digs = new Uint32Array(2 * n);
    const seen = prev || NO_PREV_HASHES, sink = onChanged || NO_PAGE_SINK;
    const nPrev = prev ? prev.length / 2 : 0;
    for (let p = 0; p < n; p++) {
      let a0 = FNV_OFFSET | 0, a1 = FNV_OFFSET_2, b0 = MIX_SEED | 0, b1 = MIX_SEED_2, t = 0;
      const s = p * wpp, e = Math.min(s + wpp, words.length);
      let i = s;
      // 4워드 언롤. 사슬은 둘이고 언롤은 그 둘을 두 번씩 펼쳐 루프 부담을 없앤다
      // (실측: 언롤만 하고 사슬이 하나면 이득이 0이다. 이득의 출처는 사슬 분리다).
      for (; i + 4 <= e; i += 4) {
        let w = words[i];
        a0 = Math.imul(a0 ^ w, FNV_PRIME); t = (b0 + w) | 0; b0 = Math.imul(t ^ (t >>> 15), MIX_PRIME);
        w = words[i + 1];
        a1 = Math.imul(a1 ^ w, FNV_PRIME); t = (b1 + w) | 0; b1 = Math.imul(t ^ (t >>> 15), MIX_PRIME);
        w = words[i + 2];
        a0 = Math.imul(a0 ^ w, FNV_PRIME); t = (b0 + w) | 0; b0 = Math.imul(t ^ (t >>> 15), MIX_PRIME);
        w = words[i + 3];
        a1 = Math.imul(a1 ^ w, FNV_PRIME); t = (b1 + w) | 0; b1 = Math.imul(t ^ (t >>> 15), MIX_PRIME);
      }
      // 꼬리는 전부 첫 사슬로 보낸다. 실힙은 PAGE_SIZE 배수라 마지막 부분 페이지에서만 도는
      // 자리이고, 어느 사슬이 먹는지는 결정적이기만 하면 된다.
      for (; i < e; i++) {
        const w = words[i];
        a0 = Math.imul(a0 ^ w, FNV_PRIME); t = (b0 + w) | 0; b0 = Math.imul(t ^ (t >>> 15), MIX_PRIME);
      }
      // 두 사슬을 비대칭으로 접는다. 한쪽만 곱하므로 사슬이 뒤바뀐 힙도 다른 값이 된다.
      const a = (a0 ^ Math.imul(a1, FNV_PRIME)) >>> 0;
      const b = (b0 ^ Math.imul(b1, MIX_PRIME)) >>> 0;
      digs[2 * p] = a; digs[2 * p + 1] = b;
      // nPrev 밖은 성장분이라 무조건 변경이다(hashDiffPages의 성장 갈래와 같은 법).
      if (p >= nPrev || seen[2 * p] !== a || seen[2 * p + 1] !== b) sink(p);
    }
    return digs;
  }
  slicePage(p) { const h = this.heap(); return h.slice(p * PAGE_SIZE, Math.min((p + 1) * PAGE_SIZE, h.length)); }
  // 복사 없는 페이지 뷰. **즉시 소비 전용**이다: 힙이 자라면 detach되고 파이썬이 돌면 내용이
  // 바뀐다. 보관하려면 slicePage를 써야 한다. 이 구분이 없을 때 packPages가 복사본을 받아
  // 다시 복사해서 델타 바이트마다 사본이 두 벌 생겼다.
  viewPageUnsafe(p) { const h = this.heap(); return h.subarray(p * PAGE_SIZE, Math.min((p + 1) * PAGE_SIZE, h.length)); }
  sliceAll() { const h = this.heap(); return h.slice(0, h.length); }
  writePage(p, bytes) { this.heap().set(bytes, p * PAGE_SIZE); }
  writeBase(base) { const h = this.heap(); h.set(base.subarray(0, Math.min(base.length, h.length))); }
  // 주의: JS에서 wasm Memory.grow를 직접 호출하지 말 것. Emscripten 글루의 클로저 뷰가
  // 갱신되지 않아 런타임이 파손된다(실측: sessionGrowProbe). 성장은 파이썬 할당 경로로만.
}
