// gpuKernels.js - Layer 1: WGSL 커널 소스의 단일 보관소.
//
// 왜 gpuCompute에서 나왔나: 셰이더는 GPU에서 도는 다른 언어의 프로그램이고, gpuCompute는
// 그걸 컴파일해 파이프라인으로 캐시하는 JS다. 커널 수식을 고치는 일과 파이프라인 수명주기를
// 고치는 일은 같은 이유가 아니다.
//
// WGSL 키워드와 식별자(read_write/global_invocation_id/workgroup_size/workgroupBarrier,
// 셰이더 안의 const 등)는 외부 기술 명칭이라 원어 유지한다.

// 공유메모리 타일드 WGSL matmul(16x16 블록). 각 워크그룹이 A/B의 16x16 타일을 공유메모리에
// 실어 전역 읽기를 재사용한다. C[row,col] = sum_k A[row,k]*B[k,col]. 경계는 0 패딩(배리어를
// 균일 제어 흐름에 두려고 early-return 대신 패딩). 실측(gpuTiledProbe): naive 대비 1.32-1.34배,
// 결과 동일(diff 0). 프로덕션 최적(jax-js/WgPy 차용)이 아니라 텍스트북 타일링(바운드 개선).
// WGSL 키워드(read_write/global_invocation_id/workgroup_size/workgroupBarrier 등)는 외부 기술 명칭이라 원어 유지.
export const MATMUL_WGSL = `
struct Dims { m: u32, k: u32, n: u32, pad: u32 };
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read_write> c: array<f32>;
@group(0) @binding(3) var<uniform> d: Dims;
const T: u32 = 16u;
var<workgroup> tileA: array<f32, 256>;
var<workgroup> tileB: array<f32, 256>;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let row = gid.x; let col = gid.y;
  let lr = lid.x; let lc = lid.y;
  var sum = 0.0;
  let tiles = (d.k + T - 1u) / T;
  for (var t = 0u; t < tiles; t = t + 1u) {
    let aCol = t * T + lc;
    if (row < d.m && aCol < d.k) { tileA[lr * T + lc] = a[row * d.k + aCol]; } else { tileA[lr * T + lc] = 0.0; }
    let bRow = t * T + lr;
    if (bRow < d.k && col < d.n) { tileB[lr * T + lc] = b[bRow * d.n + col]; } else { tileB[lr * T + lc] = 0.0; }
    workgroupBarrier();
    for (var kk = 0u; kk < T; kk = kk + 1u) { sum = sum + tileA[lr * T + kk] * tileB[kk * T + lc]; }
    workgroupBarrier();
  }
  if (row < d.m && col < d.n) { c[row * d.n + col] = sum; }
}`;

// 원소별 WGSL 템플릿(EXPR = 소비자 표현식, x = 원소). matmul 뒤 활성화 등 잔류 체이닝용.
// 예: map("max(x, 0.0)")(relu), map("x * 2.0 + 1.0"), map("1.0 / (1.0 + exp(-x))")(sigmoid).
export const ELEMENTWISE_WGSL = `
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

// 이항 원소별 WGSL 템플릿(EXPR = 소비자 표현식, a/b = 두 입력 원소). 같은 shape 두 잔류 배열을
// 원소별로 합친다. map(단항)이 못 잇던 잔차 a+b, 게이팅 a*b, 바이어스 같은 잔류 패턴을 잇는다.
// 예: binary(other, "a + b"), binary(other, "a * b"), binary(other, "max(a, b)").
export const BINARY_WGSL = `
@group(0) @binding(0) var<storage, read> inA: array<f32>;
@group(0) @binding(1) var<storage, read> inB: array<f32>;
@group(0) @binding(2) var<storage, read_write> outC: array<f32>;
@group(0) @binding(3) var<uniform> len: u32;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= len) { return; }
  let a = inA[i];
  let b = inB[i];
  outC[i] = __EXPR__;
}`;

// 전치 WGSL(naive). 입력(rows x cols)의 [r,c]를 출력(cols x rows)의 [c,r]로 옮긴다. A.T @ B
// (그래디언트 x.T @ dy, 그람행렬 X.T @ X) 같은 패턴을 리드백 없이 GPU에 남긴다. 정확성 우선
// naive(합체 접근 타일드 = 후속 최적화). 경계는 early-return(배리어 없어 균일 흐름 불필요).
export const TRANSPOSE_WGSL = `
struct Dims { rows: u32, cols: u32 };
@group(0) @binding(0) var<storage, read> inp: array<f32>;
@group(0) @binding(1) var<storage, read_write> outp: array<f32>;
@group(0) @binding(2) var<uniform> d: Dims;
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let r = gid.x;
  let c = gid.y;
  if (r >= d.rows || c >= d.cols) { return; }
  outp[c * d.rows + r] = inp[r * d.cols + c];
}`;

// 병렬 리덕션 WGSL(256 워크그룹 공유메모리 트리). __OP__(a,b)로 두 값을 합치고 __IDENTITY__로
// 범위 밖을 채운다. 워크그룹당 부분 결과 하나 -> 1개가 될 때까지 JS가 다단계 반복(reduce).
export const REDUCE_WGSL = `
@group(0) @binding(0) var<storage, read> inp: array<f32>;
@group(0) @binding(1) var<storage, read_write> outp: array<f32>;
@group(0) @binding(2) var<uniform> len: u32;
var<workgroup> sdata: array<f32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  var v = __IDENTITY__;
  if (gid.x < len) { v = inp[gid.x]; }
  sdata[lid.x] = v;
  workgroupBarrier();
  var stride = 128u;
  loop {
    if (stride == 0u) { break; }
    if (lid.x < stride) { let a = sdata[lid.x]; let b = sdata[lid.x + stride]; sdata[lid.x] = __OP__; }
    workgroupBarrier();
    stride = stride / 2u;
  }
  if (lid.x == 0u) { outp[wid.x] = sdata[0]; }
}`;
export const REDUCE_OPS = { sum: ["a + b", "0.0"], max: ["max(a, b)", "-3.4e38"], min: ["min(a, b)", "3.4e38"] };
