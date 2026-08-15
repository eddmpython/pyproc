export { createGpuComputeHostAdapter } from "../capabilities/productHostCapabilities.js";
export * from "../capabilities/webGpuHostAdapter.js";

export const GPU_ORACLE_PROTOCOL: "pyproc.hardwareVisualOracle";
export const GPU_ORACLE_VERSION: 1;

export interface HardwareVisualOracleReceipt {
  readonly protocol: "pyproc.hardwareVisualOracle";
  readonly version: 1;
  readonly state: "verified";
  readonly adapter: import("../capabilities/webGpuHostAdapter.js").WebGpuAdapterInfo;
  readonly compute: Readonly<{
    operation: "vectorAdd";
    elementCount: 4;
    expectedSha256: `sha256:${string}`;
    actualSha256: `sha256:${string}`;
    maxAbsError: number;
    tolerance: 0;
  }>;
  readonly pixel: Readonly<{
    operation: "solidRgba8";
    format: "rgba8unorm";
    width: 2;
    height: 2;
    expectedSha256: `sha256:${string}`;
    actualSha256: `sha256:${string}`;
    maxChannelError: number;
    tolerance: 1;
  }>;
}

export function runHardwareVisualOracle(provider: Pick<
  import("../capabilities/webGpuHostAdapter.js").WebGpuHostAdapter, "dispatch" | "inspect"
>, options?: { signal?: AbortSignal; requireHardware?: boolean }): Promise<HardwareVisualOracleReceipt>;
