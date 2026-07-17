// gpuCompute.d.ts - pyproc/gpu subpath의 타입 계약.
// 이 파일이 gpuCompute.js 옆에 있어야 TypeScript가 subpath 타입을 찾는다. index.d.ts 안의
// declare module 블록은 그 자리를 대신하지 못했다: 모듈이 untyped .js로 해석되면 증강이
// 거부된다(TS2665). 타입체크 게이트가 붙기 전에는 이 사실이 드러날 곳이 없었다.

/**
 * GPU 잔류 배열 핸들(f32). matmul은 GPU에 남는 새 핸들을 돌려주므로 체이닝에 재업로드가 없다.
 * toArray로 CPU 회수(리드백 1복사). f64 없음(WGSL 한계) = f32만.
 */
export class GpuArray {
  readonly rows: number;
  readonly cols: number;
  /** 이 배열(M x K) @ other(K x N) = 새 잔류 핸들(M x N). 재업로드 0. */
  matmul(other: GpuArray): GpuArray;
  /** 원소별 변환(WGSL 표현식, x = 원소)을 적용한 새 잔류 핸들(같은 shape). 예: map("max(x, 0.0)"). matmul 뒤 활성화 체이닝. */
  map(expr: string): GpuArray;
  /** 이항 원소별(WGSL 표현식, a=이 원소/b=상대 원소): 같은 shape의 다른 잔류 배열과 합친 새 핸들. 예: binary(other, "a + b")(잔차), "a * b"(게이팅). */
  binary(other: GpuArray, expr: string): GpuArray;
  /** 전치: (rows x cols) -> (cols x rows) 새 잔류 핸들. A.T @ B 패턴(x.T @ dy, X.T @ X)을 리드백 없이. */
  transpose(): GpuArray;
  /** 전체 리덕션(sum|max|min): GPU에서 모든 원소를 스칼라로 줄인다(종단, 리드백 1). 잔류 체이닝의 종착(loss/norm). */
  reduce(op: "sum" | "max" | "min"): Promise<number>;
  /** GPU -> CPU 회수. 반환 { data: Float32Array, rows, cols }. */
  toArray(): Promise<{ data: Float32Array; rows: number; cols: number }>;
  destroy(): void;
}

/**
 * Python numpy -> GPU 직결. Runtime.enableGpu()로 얻고 install() 후 파이썬이 pyprocGpu.matmul(a, b)로
 * numpy 배열을 GPU에서 곱한다(블로킹 = JSPI, rt.runAsync 경로). 실 GPU + 창 모드 + numpy 필요.
 * f64는 f32로 강등(WGSL 한계, 정밀도 손실은 계약).
 */
export class GpuBridge {
  install(): Promise<{ installed: string; note: string }>;
  destroy(): void;
}

/**
 * WebGPU 컴퓨트로 f32 대규모 선형대수 가속(수치 성능 도약 Phase 2). numpy 대체가 아니라 좁은
 * 고피크 레인: matmul 실측 ~127배 vs WASM numpy(실 GPU, 타일드 커널). 잔류 핸들(업로드1/체이닝/다운로드1)이
 * 설계의 핵심(arithmetic intensity가 손익분기: 큰 matmul 압승, 작은 배열/값싼 op는 전송비로 짐).
 * f64는 WGSL 근본 부재 = f32만(암묵 강등 금지). WebGPU는 헤드리스에서 어댑터가 안 뜬다 =
 * 창 있는 브라우저 + 하드웨어 GPU 필요(create()가 어댑터 부재 시 실행 가능한 에러).
 */
export class GpuCompute {
  /** WebGPU 디바이스 확보(async). 어댑터 없으면 실행 가능한 에러. */
  static create(): Promise<GpuCompute>;
  /** f32 배열을 GPU에 올린다(잔류 시작). data.length === rows*cols. */
  array(data: Float32Array, rows: number, cols: number): GpuArray;
  destroy(): void;
}
