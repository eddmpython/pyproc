// memoryCapability.js - Layer 0 능력 계약: WASM 메모리 접근 격리.
// 교차 관심사(HEAPU8 접근·스택 포인터)를 이 계약 뒤에 캡슐화한다. 소비자와 상위 능력은
// 깨끗한 메서드만 쓰고 엔진 내부를 직접 만지지 않는다.
// 완전 해시(Uint32 워드 전수)는 soundness의 열쇠 - 샘플링 금지(불완전 델타 -> 복원 크래시).
// 페이지당 독립 32비트 해시 2개(실효 64비트)로 충돌 누락 확률을 ~2^-64로 억제한다.
// 실측(attempts/reactiveSoundness, 2026-07-11): 단일 대비 1.54배, 30MB 힙 14.3ms.

export const PAGE_SIZE = 65536;

export class MemoryCapability {
  constructor(py) { this._py = py; }
  heap() { return this._py._module.HEAPU8; }              // 항상 최신 뷰(성장 후 detach 대응)
  byteLength() { return this._py._module.HEAPU8.length; }
  stackSave() { const M = this._py._module; return M._emscripten_stack_get_current ? M._emscripten_stack_get_current() : null; }
  stackRestore(sp) { const M = this._py._module; if (sp != null && M._emscripten_stack_restore) { try { M._emscripten_stack_restore(sp); } catch (e) {} } }
  // 페이지당 [2p]=FNV-1a, [2p+1]=독립 믹서를 interleave로 반환(길이 = 2 * 페이지 수).
  pageHashes() {
    const buf = this.heap().buffer, len = this.byteLength();
    const words = new Uint32Array(buf, 0, (len - (len % 4)) / 4);
    const wpp = PAGE_SIZE / 4, n = Math.ceil(len / PAGE_SIZE), digs = new Uint32Array(2 * n);
    for (let p = 0; p < n; p++) {
      let a = 2166136261 >>> 0, b = 2654435761 >>> 0;
      const s = p * wpp, e = Math.min(s + wpp, words.length);
      for (let i = s; i < e; i++) {
        const w = words[i];
        a = (a ^ w) >>> 0; a = Math.imul(a, 16777619) >>> 0;
        b = (b + w) >>> 0; b = Math.imul(b ^ (b >>> 15), 2246822519) >>> 0;
      }
      digs[2 * p] = a; digs[2 * p + 1] = b;
    }
    return digs;
  }
  slicePage(p) { const h = this.heap(); return h.slice(p * PAGE_SIZE, Math.min((p + 1) * PAGE_SIZE, h.length)); }
  sliceAll() { const h = this.heap(); return h.slice(0, h.length); }
  writePage(p, bytes) { this.heap().set(bytes, p * PAGE_SIZE); }
  writeBase(base) { const h = this.heap(); h.set(base.subarray(0, Math.min(base.length, h.length))); }
  // 주의: JS에서 wasm Memory.grow를 직접 호출하지 말 것. Emscripten 글루의 클로저 뷰가
  // 갱신되지 않아 런타임이 파손된다(실측: sessionGrowProbe). 성장은 파이썬 할당 경로로만.
}
