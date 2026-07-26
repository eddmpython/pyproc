// gpuCompute.d.ts - type contract of the pyproc/gpu subpath.
// This file must sit next to gpuCompute.js for TypeScript to find the subpath types. A
// declare module block inside index.d.ts could not stand in for it: augmentation is rejected
// once the module resolves as untyped .js (TS2665). Before the typecheck gate existed there
// was nowhere for that fact to surface.

/**
 * Handle to an array that stays resident on the GPU (f32). matmul returns a new resident
 * handle, so chaining never re-uploads. toArray pulls it back to the CPU (one readback copy).
 * There is no f64: WGSL does not have it, so f32 only.
 */
export class GpuArray {
  readonly rows: number;
  readonly cols: number;
  /** this (M x K) @ other (K x N) = a new resident handle (M x N), with no re-upload. */
  matmul(other: GpuArray): GpuArray;
  /** Elementwise transform (a WGSL expression where x is the element) as a new resident handle of the same shape, e.g. map("max(x, 0.0)") to chain an activation after matmul. */
  map(expr: string): GpuArray;
  /** Binary elementwise (a WGSL expression where a is this element and b is the other): combines with another resident array of the same shape, e.g. binary(other, "a + b") for a residual or "a * b" for gating. */
  binary(other: GpuArray, expr: string): GpuArray;
  /** Transpose: (rows x cols) -> (cols x rows) as a new resident handle, so A.T @ B patterns (x.T @ dy, X.T @ X) need no readback. */
  transpose(): GpuArray;
  /** Full reduction (sum|max|min): reduces every element to a scalar on the GPU (terminal, one readback). This is where a resident chain ends, e.g. a loss or a norm. */
  reduce(op: "sum" | "max" | "min"): Promise<number>;
  /** Pulls the array back to the CPU. Returns { data: Float32Array, rows, cols }. */
  toArray(): Promise<{ data: Float32Array; rows: number; cols: number }>;
  destroy(): void;
}

/**
 * Connects Python numpy straight to the GPU. Obtain it with Runtime.enableGpu(); after
 * install() Python calls pyprocGpu.matmul(a, b) to multiply numpy arrays on the GPU (blocking,
 * so it needs JSPI and the rt.runAsync path). Requires a real GPU, a windowed browser, and
 * numpy. f64 inputs are demoted to f32 (a WGSL limit; the precision loss is part of the contract).
 */
export class GpuBridge {
  install(): Promise<{ installed: string; note: string }>;
  destroy(): void;
}

/**
 * Large f32 linear algebra on WebGPU compute. Not a numpy replacement but a narrow high-peak
 * lane (tiled kernels, real GPU required). Resident handles are the core of the design: one
 * upload, chain on device, one download. Arithmetic intensity is the break-even - big matmuls
 * win, small arrays and cheap elementwise ops lose to transfer cost. WGSL has no f64 at all,
 * so f32 only and no implicit demotion. WebGPU exposes no adapter in headless mode, so this
 * needs a windowed browser with a hardware GPU (create() throws an actionable error when the
 * adapter is absent).
 */
export class GpuCompute {
  /** Acquires a WebGPU device (async). Throws an actionable error when no adapter exists. */
  static create(): Promise<GpuCompute>;
  /** Uploads an f32 array to the GPU, starting a resident chain. data.length === rows*cols. */
  array(data: Float32Array, rows: number, cols: number): GpuArray;
  destroy(): void;
}
