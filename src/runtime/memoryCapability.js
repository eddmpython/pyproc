// memoryCapability.js - Layer 0 능력 계약: WASM 메모리 접근 격리.
// 교차 관심사(HEAPU8 접근·스택 포인터)를 이 계약 뒤에 캡슐화한다. 소비자와 상위 능력은
// 깨끗한 메서드만 쓰고 엔진 내부를 직접 만지지 않는다.
// 완전 해시(Uint32 워드 전수)는 soundness의 열쇠 - 샘플링 금지(불완전 델타 -> 복원 크래시).
// 정직한 한계: 페이지당 32비트 FNV-1a는 확률적이다(충돌 시 변경 누락). 체크포인트 체인이
// 길어지는 워크로드에서 강화가 필요하면 tests/attempts에서 64비트/이중 해시를 실측 후 승격한다.

export const PAGE_SIZE = 65536;

export class MemoryCapability {
  constructor(py) { this._py = py; }
  heap() { return this._py._module.HEAPU8; }              // 항상 최신 뷰(성장 후 detach 대응)
  byteLength() { return this._py._module.HEAPU8.length; }
  stackSave() { const M = this._py._module; return M._emscripten_stack_get_current ? M._emscripten_stack_get_current() : null; }
  stackRestore(sp) { const M = this._py._module; if (sp != null && M._emscripten_stack_restore) { try { M._emscripten_stack_restore(sp); } catch (e) {} } }
  pageHashes() {
    const buf = this.heap().buffer, len = this.byteLength();
    const words = new Uint32Array(buf, 0, (len - (len % 4)) / 4);
    const wpp = PAGE_SIZE / 4, n = Math.ceil(len / PAGE_SIZE), digs = new Uint32Array(n);
    for (let p = 0; p < n; p++) {
      let acc = 2166136261 >>> 0;
      const s = p * wpp, e = Math.min(s + wpp, words.length);
      for (let i = s; i < e; i++) { acc = (acc ^ words[i]) >>> 0; acc = Math.imul(acc, 16777619) >>> 0; }
      digs[p] = acc;
    }
    return digs;
  }
  slicePage(p) { const h = this.heap(); return h.slice(p * PAGE_SIZE, Math.min((p + 1) * PAGE_SIZE, h.length)); }
  sliceAll() { const h = this.heap(); return h.slice(0, h.length); }
  writePage(p, bytes) { this.heap().set(bytes, p * PAGE_SIZE); }
  writeBase(base) { const h = this.heap(); h.set(base.subarray(0, Math.min(base.length, h.length))); }
}
