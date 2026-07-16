import type { GuestAdapterFactory } from "@web-machine/core";

export interface V86Constructor {
  new(options: Record<string, unknown>): unknown;
}

export interface V86GuestFactoryOptions {
  V86: V86Constructor;
  adapterVersion?: string;
  blockDeviceName?: string | null;
  blockMode?: "drive" | "9p" | null;
  packetDeviceName?: string | null;
  displayDeviceName?: string | null;
  inputDeviceName?: string | null;
  framebufferDeviceName?: string | null;
  framebufferSource?: unknown;
  pointerDeviceName?: string | null;
  clockDeviceName?: string | null;
  entropyDeviceName?: string | null;
  instantiateWasm?: ((...args: unknown[]) => unknown) | null;
}

export function createV86GuestFactory(options: V86GuestFactoryOptions): GuestAdapterFactory;
