export interface HostcallRequest {
  requestKey: string;
  opcode: number;
  flags: number;
  payload: Uint8Array;
  responseCapacity: number;
  deadlineMs: number;
  authorityRef?: string;
  commandId?: string;
  kernelRef?: string;
  onChunk?: (chunk: Uint8Array) => void | Promise<void>;
}

export interface HostcallResult {
  readonly state: number;
  readonly errorCode: number;
  readonly bytes: Uint8Array;
  readonly provider?: string;
  readonly inputDigest?: string;
  readonly omittedBytes?: number;
}

export interface HostCapabilityProvider {
  opcode: number;
  name: string;
  authority?: string | null;
  effect?: boolean;
  explicitEffectBoundary?: boolean;
  handler(request: Readonly<HostcallRequest & { signal: AbortSignal; markSent(): void }>): unknown | Promise<unknown> | AsyncIterable<unknown>;
}

export class HostCapabilityBroker {
  constructor(options?: {
    authorize?: (request: Readonly<Record<string, unknown>>) => boolean | Promise<boolean>;
    terminal?: { write(payload: Uint8Array, request: Readonly<HostcallRequest>): unknown | Promise<unknown> } | null;
    clock?: () => number;
    entropy?: (bytes: Uint8Array) => Uint8Array;
    maxResponseBytes?: number;
  });
  readonly providers: Map<number, Readonly<HostCapabilityProvider>>;
  readonly receipts: Map<string, Readonly<Record<string, unknown>>>;
  readonly active: Map<string, Readonly<Record<string, unknown>>>;
  readonly closed: boolean;
  register(provider: HostCapabilityProvider): void;
  dispatch(request: HostcallRequest, options?: { signal?: AbortSignal }): Promise<HostcallResult>;
  cancel(requestKey: string, reason?: string): boolean;
  addCheckpointInspector(inspector: () => Readonly<Record<string, unknown>>): () => boolean;
  inspectCheckpointBoundary(): Readonly<{ acceptedHostcalls: number; activeTransactions: 0; outputDrained: true; openResources: readonly unknown[]; vfsRootDigest: null }>;
  close(reason?: string): void;
}
