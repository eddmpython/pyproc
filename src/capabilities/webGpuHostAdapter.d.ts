export interface WebGpuAdapterInfo {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  readonly isFallbackAdapter: boolean | null;
  readonly class: "hardware" | "software" | "unknown";
}

export interface WebGpuHostAdapterInspection {
  readonly protocol: "pyproc.webgpu-host-adapter";
  readonly version: 1;
  readonly state: "ready" | "closed" | "lost";
  readonly adapter: WebGpuAdapterInfo;
  readonly operations: readonly ["solidRgba8", "vectorAdd"];
  readonly limits: Readonly<{ maxVectorElements: number; maxPixelBytes: number }>;
  readonly loss?: Readonly<{ reason: string; message: string }>;
}

export type WebGpuDispatchInput = Readonly<
  { operation: "vectorAdd"; leftBase64: string; rightBase64: string }
  | { operation: "solidRgba8"; width: number; height: number; color: readonly [number, number, number, number] }
>;

export interface WebGpuHostAdapter {
  inspect(): WebGpuHostAdapterInspection;
  dispatch(input: WebGpuDispatchInput, options?: { signal?: AbortSignal }): Promise<Uint8Array>;
  close(): void;
}

export interface WebGpuHostAdapterOptions {
  gpu?: { requestAdapter(options?: Record<string, unknown>): Promise<any> };
  powerPreference?: "high-performance" | "low-power";
  forceFallbackAdapter?: boolean;
  requireHardware?: boolean;
}

export function createWebGpuHostAdapter(options?: WebGpuHostAdapterOptions): Promise<WebGpuHostAdapter>;
