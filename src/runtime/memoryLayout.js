// memoryLayout.js - WASM 선형 메모리 layout 상수와 단위 변환.
// MemoryCapability 구현과 상위 능력이 공유하는 작은 계약이다.
export const PAGE_SIZE = 65536;
const BYTES_PER_MB = 1048576;

// 바이트 -> MB 반올림. 상태 동사들의 비용 영수증이 같은 반올림을 쓰게 하는 한 곳이다.
// digits를 인자로 두는 이유: 복원/커밋 계열은 1자리, reactive 통계는 2자리가 공개 계약이고
// (docs/reference/api.md의 mbWritten/freedMB), 그 차이는 정밀도 계약이지 사본이 아니다.
export function bytesToMb(bytes, digits = 1) { return +(bytes / BYTES_PER_MB).toFixed(digits); }
export function mbToBytes(mb) { return mb * BYTES_PER_MB; }
