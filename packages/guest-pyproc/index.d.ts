import type { GuestAdapterFactory } from "@web-machine/core";

export interface PyprocFileSystem {
  exists(path: string): boolean;
  mkdirTree(path: string): void;
  readdir(path: string): string[];
  stat(path: string): { isDir: boolean; isFile: boolean };
  readFile(path: string): Uint8Array;
  writeFile(path: string, value: ArrayBuffer | ArrayBufferView): void;
  unlink(path: string): void;
  rmdir(path: string): void;
}

export interface PyprocGuestSession {
  rt: {
    fs: PyprocFileSystem;
    memory: { byteLength(): number };
    run(code: string): unknown;
  };
  exportImage(options: { includeHome: boolean }): Promise<Blob>;
}

export function createPyprocGuestFactory(options: {
  bootSession: (options: Record<string, unknown>) => Promise<PyprocGuestSession>;
  openMachine: (image: Blob, options: { trust: true }) => Promise<PyprocGuestSession>;
  blockDeviceName?: string | null;
}): GuestAdapterFactory;
