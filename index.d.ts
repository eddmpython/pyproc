// pyproc 공개 표면 타입 선언. 소스는 순수 ESM .js이고 이 파일이 소비자(TypeScript)에게
// 계약을 제공한다. 빌드 단계 없이 손으로 유지한다(소스와 함께 갱신).

export const PAGE_SIZE: number;

export interface BootOptions {
  /** Pyodide 배포 URL. 기본 jsdelivr v314.0.2. */
  indexURL?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** 부팅 시 미리 로드할 패키지. */
  packages?: string[];
}

export interface CheckpointInfo {
  index: number;
  changedPages: number;
  deltaBytes: number;
  kind: "base" | "delta";
}

export interface RestoreInfo {
  pagesWritten: number;
  mbWritten: number;
}

export interface SyscallInstallInfo {
  installed: string[];
  proxyUrl: string | null;
}

export interface PyProcOptions {
  indexURL?: string;
}

export interface PyProcBootInfo {
  workers: number;
  avgBootMs: number;
  forked: boolean;
}

export interface PyProcEntry {
  pid: number;
  state: string;
  parentPid: number;
}

/** WASM 힙 접근을 캡슐화한 능력 계약. 소비자는 HEAPU8를 직접 만지지 않는다. */
export class MemoryCapability {
  heap(): Uint8Array;
  byteLength(): number;
  stackSave(): number | null;
  stackRestore(sp: number | null): void;
  pageHashes(): Uint32Array;
  slicePage(p: number): Uint8Array;
  sliceAll(): Uint8Array;
  writePage(p: number, bytes: Uint8Array): void;
  writeBase(base: Uint8Array): void;
}

/** 복원 기반 리액티브: 완전 해시 체크포인트 체인 + 라이브-차분 복원 + 시간여행. */
export class ReactiveController {
  checkpoint(): CheckpointInfo;
  restore(j: number, savedSP: number | null): void;
  restoreLive(j: number, savedSP: number | null): RestoreInfo;
  timeTravel(j: number, savedSP: number | null): RestoreInfo;
  stackSave(): number | null;
  storageMB(): number;
}

/** socket/subprocess/input을 빌려주는 능력 계약. 소비 제품이 엔드포인트를 채운다. */
export class SyscallBridge {
  install(): Promise<SyscallInstallInfo>;
}

/** Pyodide 런타임 래퍼. run/install + 능력 등록(enableReactive/enableSyscallBridge). */
export class Runtime {
  readonly memory: MemoryCapability;
  run(code: string): unknown;
  runAsync(code: string): Promise<unknown>;
  setGlobal(name: string, value: unknown): void;
  getGlobal(name: string): unknown;
  install(pkg: string): Promise<void>;
  loadPackages(pkgs: string | string[]): Promise<void>;
  enableReactive(): ReactiveController;
  enableSyscallBridge(cfg?: { proxyUrl?: string }): SyscallBridge;
  /** 탈출구(권장 안 함): 내부 Pyodide 인스턴스. */
  readonly raw: unknown;
}

/** Pyodide 런타임을 부팅한다. Chromium/Edge 전용. */
export function boot(opts?: BootOptions): Promise<Runtime>;

/** 브라우저 파이썬 프로세스 OS 커널: 스냅샷-fork spawn + map 병렬. */
export class PyProc {
  constructor(opts?: PyProcOptions);
  boot(n: number, useSnapshot?: boolean): Promise<PyProcBootInfo>;
  map(fnSrc: string, args: unknown[]): Promise<unknown[]>;
  mapSerial(fnSrc: string, args: unknown[]): Promise<unknown[]>;
  ps(): PyProcEntry[];
  terminate(): void;
}
