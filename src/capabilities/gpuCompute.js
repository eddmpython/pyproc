// gpuCompute.js - Layer 1 능력: WebGPU 컴퓨트로 f32 대규모 선형대수 가속(수치 성능 도약 Phase 2).
// numpy 대체가 아니라 좁은 고피크 레인: f32 matmul을 GPU 컴퓨트 셰이더로 오프로드해 WASM numpy
// 대비 10-100배(실측 gpuMatmulProbe: naive 타일드 커널로도 1024 f32 matmul 109.6배, maxErr 3.58e-7).
//
// 정답은 단발 오프로드가 아니라 **잔류 핸들**(gpuArray): 업로드 1회 -> GPU 위에서 연산 체이닝 ->
// 다운로드 1회. arithmetic intensity가 손익분기를 정한다(matmul O(n^3)/O(n^2) = 압승, 작은 배열/
// 값싼 op는 전송비가 삼킴). f64는 WGSL 근본 부재라 경성 벽 = f32/i32만(암묵 강등 금지, 소비자가
// 명시적 f32 캐스팅). 커널 자작 금지 원칙상 지금은 정확성 우선 naive 타일드(속도 최적화 = 후속,
// jax-js/WgPy 차용). process-OS 샤딩과 합성 안 됨(GPU는 물리 1개 = 단일 GPU 축, N워커 샤딩 아님).
//
// 실측 환경: WebGPU는 헤드리스에서 어댑터가 안 뜬다(gpuCapProbe). 창 있는 브라우저 + 하드웨어
// GPU에서만(소켓 릴레이와 같은 계급). create()가 어댑터 부재 시 실행 가능한 에러를 던진다.

// 정확성 우선 타일드 WGSL matmul(16x16 워크그룹). C[row,col] = sum_k A[row,k]*B[k,col].
// WGSL 키워드(read_write/global_invocation_id/workgroup_size 등)는 외부 기술 명칭이라 원어 유지.
const MATMUL_WGSL = `
struct Dims { m: u32, k: u32, n: u32, pad: u32 };
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read_write> c: array<f32>;
@group(0) @binding(3) var<uniform> d: Dims;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let row = gid.x; let col = gid.y;
  if (row >= d.m || col >= d.n) { return; }
  var sum = 0.0;
  for (var k = 0u; k < d.k; k = k + 1u) { sum = sum + a[row * d.k + k] * b[k * d.n + col]; }
  c[row * d.n + col] = sum;
}`;

// 원소별 WGSL 템플릿(EXPR = 소비자 표현식, x = 원소). matmul 뒤 활성화 등 잔류 체이닝용.
// 예: map("max(x, 0.0)")(relu), map("x * 2.0 + 1.0"), map("1.0 / (1.0 + exp(-x))")(sigmoid).
const ELEMENTWISE_WGSL = `
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read_write> c: array<f32>;
@group(0) @binding(2) var<uniform> len: u32;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= len) { return; }
  let x = a[i];
  c[i] = __EXPR__;
}`;

export class GpuCompute {
  constructor(device) { this._device = device; this._matmul = null; this._elementwise = new Map(); }

  // WebGPU 디바이스를 확보한다(async). 어댑터가 없으면(헤드리스) 실행 가능한 에러.
  static async create() {
    if (!(typeof navigator !== "undefined" && "gpu" in navigator)) {
      throw new Error("GpuCompute: WebGPU 미지원(navigator.gpu 없음). Chromium/Edge가 필요하다.");
    }
    let adapter = await navigator.gpu.requestAdapter();
    if (!adapter) adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
    if (!adapter) {
      throw new Error("GpuCompute: WebGPU 어댑터가 없다. 헤드리스 브라우저엔 GPU 어댑터가 안 뜬다 - 창 있는 브라우저 + 하드웨어 GPU가 필요하다(실측: 창 모드에서 확보).");
    }
    const device = await adapter.requestDevice();
    return new GpuCompute(device);
  }

  // matmul 파이프라인(셰이더 1회 컴파일 후 캐시).
  _matmulPipeline() {
    if (!this._matmul) {
      const module = this._device.createShaderModule({ code: MATMUL_WGSL });
      this._matmul = this._device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
    }
    return this._matmul;
  }

  // 원소별 파이프라인(표현식별 캐시). expr는 소비자 WGSL 표현식(x = 원소).
  _elementwisePipeline(expr) {
    let p = this._elementwise.get(expr);
    if (!p) {
      const module = this._device.createShaderModule({ code: ELEMENTWISE_WGSL.replace("__EXPR__", expr) });
      p = this._device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
      this._elementwise.set(expr, p);
    }
    return p;
  }

  // f32 배열을 GPU에 올린다(잔류 시작). data = Float32Array(길이 rows*cols). 반환 = 잔류 핸들.
  array(data, rows, cols) {
    if (!(data instanceof Float32Array)) throw new Error("gpuArray: data는 Float32Array다(WGSL은 f64 없음 = f32만).");
    if (data.length !== rows * cols) throw new Error(`gpuArray: data 길이(${data.length})가 rows*cols(${rows * cols})와 불일치`);
    const buf = this._device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, mappedAtCreation: true });
    new Float32Array(buf.getMappedRange()).set(data);
    buf.unmap();
    return new GpuArray(this, buf, rows, cols);
  }

  destroy() { if (this._device) this._device.destroy(); }
}

// GPU 잔류 배열 핸들. matmul은 GPU에 남는 새 핸들을 돌려주므로(재업로드 0) 체이닝의 이득이 산다.
export class GpuArray {
  constructor(gc, buffer, rows, cols) { this._gc = gc; this.buffer = buffer; this.rows = rows; this.cols = cols; }

  // 이 배열(M x K) @ other(K x N) = 새 잔류 핸들(M x N). 둘 다 GPU에 있으므로 재업로드 없음.
  matmul(other) {
    if (!(other instanceof GpuArray)) throw new Error("GpuArray.matmul: 인자는 GpuArray다");
    if (this.cols !== other.rows) throw new Error(`GpuArray.matmul: 차원 불일치 (${this.rows}x${this.cols}) @ (${other.rows}x${other.cols})`);
    const device = this._gc._device, M = this.rows, K = this.cols, N = other.cols;
    const cBuf = device.createBuffer({ size: M * N * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const dBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true });
    new Uint32Array(dBuf.getMappedRange()).set([M, K, N, 0]); dBuf.unmap();
    const pipeline = this._gc._matmulPipeline();
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.buffer } }, { binding: 1, resource: { buffer: other.buffer } },
      { binding: 2, resource: { buffer: cBuf } }, { binding: 3, resource: { buffer: dBuf } },
    ] });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(M / 16), Math.ceil(N / 16)); pass.end();
    device.queue.submit([enc.finish()]);
    dBuf.destroy();
    return new GpuArray(this._gc, cBuf, M, N);
  }

  // 원소별 변환: 각 원소 x에 WGSL 표현식 expr를 적용한 새 잔류 핸들(같은 shape). 재업로드 0.
  // 잔류 체이닝의 핵심: m.matmul(w).map("max(x, 0.0)")처럼 matmul 뒤 활성화를 리드백 없이 잇는다.
  map(expr) {
    if (typeof expr !== "string" || !expr.length) throw new Error("GpuArray.map: expr는 WGSL 표현식 문자열(x = 원소). 예: \"max(x, 0.0)\"");
    const device = this._gc._device, len = this.rows * this.cols;
    const cBuf = device.createBuffer({ size: len * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const nBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true });
    new Uint32Array(nBuf.getMappedRange()).set([len, 0, 0, 0]); nBuf.unmap();
    const pipeline = this._gc._elementwisePipeline(expr);
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.buffer } }, { binding: 1, resource: { buffer: cBuf } }, { binding: 2, resource: { buffer: nBuf } },
    ] });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(len / 64)); pass.end();
    device.queue.submit([enc.finish()]);
    nBuf.destroy();
    return new GpuArray(this._gc, cBuf, this.rows, this.cols);
  }

  // GPU -> CPU 회수(리드백 1복사). 반환 { data: Float32Array, rows, cols }.
  async toArray() {
    const device = this._gc._device, size = this.rows * this.cols * 4;
    const readBuf = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(this.buffer, 0, readBuf, 0, size);
    device.queue.submit([enc.finish()]);
    await readBuf.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(readBuf.getMappedRange().slice(0));
    readBuf.destroy();
    return { data, rows: this.rows, cols: this.cols };
  }

  destroy() { this.buffer.destroy(); }
}

// Python numpy -> GPU 직결(pyproc 정체성 완성). Runtime의 파이썬이 numpy 배열을 f32로 GPU에서
// matmul한다: pyprocGpu.matmul(a, b). 블로킹은 JSPI(run_sync)라 rt.runAsync 경로에서 동작한다
// (socketBridge/machineContainer와 같은 패턴). 실 GPU + 창 모드 필요(navigator.gpu는 메인 스레드).
// numpy 필요(rt.loadPackages(["numpy"])). f64는 f32로 강등(WGSL 한계) - 정밀도 손실은 계약이다.
const GPU_BOOTSTRAP = `
import sys as _pyprocSysG, types as _pyprocTypesG
import numpy as _pyprocNumpyG
from pyodide.ffi import to_js as _pyprocToJsG, run_sync as _pyprocRunSyncG

_pyprocGpuMod = _pyprocTypesG.ModuleType('pyprocGpu')

def _pyprocGpuMatmul(a, b):
    a = _pyprocNumpyG.ascontiguousarray(a, dtype=_pyprocNumpyG.float32)
    b = _pyprocNumpyG.ascontiguousarray(b, dtype=_pyprocNumpyG.float32)
    res = _pyprocRunSyncG(_pyprocGpuMatmulBridge(
        _pyprocToJsG(a.tobytes()), a.shape[0], a.shape[1],
        _pyprocToJsG(b.tobytes()), b.shape[0], b.shape[1]))
    return _pyprocNumpyG.frombuffer(bytes(res.to_py()), dtype=_pyprocNumpyG.float32).reshape(a.shape[0], b.shape[1])

_pyprocGpuMod.matmul = _pyprocGpuMatmul
_pyprocSysG.modules['pyprocGpu'] = _pyprocGpuMod
`;

export class GpuBridge {
  constructor(rt) { this._rt = rt; this._gc = null; }

  // GPU 디바이스 확보 + 파이썬 pyprocGpu 모듈 배선. 어댑터 부재(헤드리스) 시 실행 가능한 에러.
  async install() {
    this._gc = await GpuCompute.create();
    const gc = this._gc;
    // 파이썬이 부를 브리지(JSPI가 서스펜드하는 async): f32 바이트를 받아 GPU matmul 후 결과 바이트.
    const bridge = async (aU8, aRows, aCols, bU8, bRows, bCols) => {
      const A = new Float32Array(aU8.slice().buffer), B = new Float32Array(bU8.slice().buffer);
      const ga = gc.array(A, aRows, aCols), gb = gc.array(B, bRows, bCols), gout = ga.matmul(gb);
      const r = await gout.toArray();
      ga.destroy(); gb.destroy(); gout.destroy();
      return new Uint8Array(r.data.buffer);
    };
    this._rt.setGlobal("_pyprocGpuMatmulBridge", bridge);
    this._rt.run(GPU_BOOTSTRAP);
    return { installed: "pyprocGpu", note: "블로킹은 JSPI(run_sync)라 rt.runAsync 경로에서. numpy 필요" };
  }

  destroy() { if (this._gc) this._gc.destroy(); }
}
