import type { HostCapabilityBroker, HostcallRequest } from "./hostCapabilityBroker.js";

export interface ProductHostAdapter {
  readonly [method: string]: ((...args: any[]) => unknown) | undefined;
}

export interface ProductHostCapabilityAdapters {
  http?: ProductHostAdapter | null;
  socket?: ProductHostAdapter | null;
  process?: ProductHostAdapter | null;
  gpu?: ProductHostAdapter | null;
  clipboard?: ProductHostAdapter | null;
  framebuffer?: ProductHostAdapter | null;
  asgi?: ProductHostAdapter | null;
}

export class ProductHostCapabilityPort {
  constructor(adapters?: ProductHostCapabilityAdapters);
  readonly adapters: Readonly<ProductHostCapabilityAdapters>;
  install(broker: HostCapabilityBroker): this;
  inspectCheckpointBoundary(): Readonly<{ acceptedHostcalls: 0; activeTransactions: 0;
    outputDrained: true; openResources: readonly Readonly<Record<string, unknown>>[]; vfsRootDigest: null }>;
  close(reason?: string): Promise<void>;
}

export function createFetchHostAdapter(fetchImpl?: typeof fetch): ProductHostAdapter;
export function createBrowserClipboardHostAdapter(clipboard?: Pick<Clipboard, "readText" | "writeText">): ProductHostAdapter;
export function createFramebufferHostAdapter(publish: (frame: Readonly<Record<string, unknown>>,
  context?: Readonly<Record<string, unknown>>) => unknown | Promise<unknown>): ProductHostAdapter;
export function createAsgiHostAdapter(server: { serve(method: string, path: string, body?: unknown,
  query?: string, headers?: unknown): Promise<unknown> }, options: { kernelRef: string }): ProductHostAdapter;
export function createGpuComputeHostAdapter(gpu: { array(...args: any[]): any }): ProductHostAdapter;
export function createKernelProcessHostAdapter(kernelFactory: { open(manifest?: unknown): Promise<any> }): ProductHostAdapter;
export function createSocketRelayHostAdapter(options: { relayURL: string; WebSocketImpl?: typeof WebSocket }): ProductHostAdapter;

export type { HostcallRequest };
