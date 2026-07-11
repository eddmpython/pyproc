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
  /** CPython 초기화 전에 반영되는 환경변수(예: { PYTHONHASHSEED: "0" } = 결정적 부팅). */
  env?: Record<string, string>;
  /** 코어 자산(wasm/stdlib/lock)을 이 디렉터리에 캐시해 재부팅 시 fetch 계층 네트워크 0. */
  coreCacheDir?: FileSystemDirectoryHandle;
  /** 락 파일 교체(Runtime.freeze() 산출물 등): 같은 버전이 해석 0으로 재현된다. */
  lockFileURL?: string;
}

export interface EnvManifest {
  indexURL?: string;
  env?: Record<string, string>;
  /** 락 파일 URL(freeze 산출물). 환경 재현의 축. */
  lockFileURL?: string;
  /** 부팅 시 로드할 패키지(환경 선언). */
  packages?: string[];
  /** 부팅 직후 실행할 파이썬(예: "import numpy" 예열). */
  setup?: string;
}

export interface EnvDirs {
  /** bare 힙 스냅샷 캐시(엔진 버전당 1개). 2차 부팅이 설치 아닌 복원이 된다(부팅 197ms 실측). */
  snapshots?: FileSystemDirectoryHandle;
  /** .whl 캐시. 패키지 재다운로드 0. */
  wheels?: FileSystemDirectoryHandle;
}

export interface EnvBootStats {
  /** snapshot(웜) | coldFill(콜드 + 캐시 채움) | cold(캐시 미사용). */
  lane: "snapshot" | "coldFill" | "cold";
  bootMs: number;
  installMs: number;
  setupMs: number;
  totalMs: number;
  /** 스냅샷 캐시 채움 실패 시 사유(부팅은 계속된다). */
  cacheError?: string;
}

export interface RunScriptOutcome {
  /** 스크립트 마지막 표현식의 값(pyodide 변환 규칙). */
  result: unknown;
  /** PEP 723 블록에서 읽어 설치한 의존성. 블록이 없으면 []. */
  dependencies: string[];
  /** PEP 723 requires-python(참고용 반환, 강제하지 않음). */
  requiresPython: string | null;
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
  /** 이번 복원이 재해시 경로였는지. 경계 위반이 자동 감지되면 true. */
  rehashed: boolean;
}

export interface SyscallBridgeConfig {
  /** 동기 입력 핸들러. run()/runAsync() 어디서나 input()이 이 값을 받는다. */
  input?: (prompt: string) => string | null;
  /** 비동기 입력 핸들러(터미널용). runAsync(JSPI) 경로에서 input()이 블로킹으로 받는다. */
  inputAsync?: (prompt: string) => Promise<string | null>;
  /** HTTP 요청을 우회시킬 프록시 URL. 없으면 direct(CORS/same-origin 대상만). */
  proxyUrl?: string;
}

export interface SyscallInstallInfo {
  installed: string[];
  /** JSPI(WebAssembly.Suspending) 가용 여부. subprocess/비동기 input의 전제. */
  jspi: boolean;
  proxyUrl: string | null;
}

export interface PyProcOptions {
  indexURL?: string;
  /** 각 프로세스가 부팅 시 로드할 패키지(예: ["numpy"]). */
  packages?: string[];
  /** 부팅 시 실행할 파이썬 예열 코드(예: "import numpy"). */
  setup?: string;
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
  /** 경계 위반(마지막 checkpoint/restore 이후 실행·변이)은 자동 감지되어 재해시 경로로 복원된다. opts.rehash는 강제 재해시. */
  restoreLive(j: number, savedSP: number | null, opts?: { rehash?: boolean }): RestoreInfo;
  timeTravel(j: number, savedSP: number | null, opts?: { rehash?: boolean }): RestoreInfo;
  stackSave(): number | null;
  storageMB(): number;
  /** base(기준 힙)를 파일 핸들로 내보내 RAM 부담을 옮긴다. 핸들은 소비자가 준다. */
  saveBase(dir: FileSystemDirectoryHandle, name: string): Promise<{ bytes: number }>;
  loadBase(dir: FileSystemDirectoryHandle, name: string): Promise<{ bytes: number }>;
}

/** 빌린 시스템콜 v1: input()(동기/JSPI), urllib(동기 XHR, proxyUrl 옵션), subprocess(자식 워커). */
export class SyscallBridge {
  install(): Promise<SyscallInstallInfo>;
}

export interface AsgiServerConfig {
  /** 파이썬 전역의 ASGI 앱 변수명(기본 "app"). */
  app?: string;
}

export interface AsgiResponse {
  status: number;
  headers: [string, string][];
  body: string;
}

/** 커널 안 ASGI 서버: FastAPI/Starlette를 소켓 0으로 dispatch. 엔드포인트는 async def 강제. */
export class AsgiServer {
  install(): Promise<{ app: string; transport: string }>;
  serve(method: string, path: string, body?: string | null, query?: string): Promise<AsgiResponse>;
}

/**
 * 파이썬 서버를 진짜 URL로: pyprocSw.js(같은 폴더 자산)를 소비자 오리진에 등록하면
 * (navigator.serviceWorker.register(".../pyprocSw.js?asgi=/pyproc/")), 그 접두 fetch가
 * 이 배선을 거쳐 AsgiServer로 응답된다. 실측 왕복 3.4ms(SW 오버헤드 0).
 */
export class VirtualOrigin {
  constructor(asgi: AsgiServer);
  bind(): VirtualOrigin;
  unbind(): void;
}

export interface SharedKernelOptions {
  indexURL?: string;
  /** 커널 식별자. 같은 name으로 연결한 모든 탭이 같은 커널을 공유한다. */
  name?: string;
}

export interface SharedKernelStatus {
  bootMs: number;
  connections: number;
  jspi: boolean;
  /** SharedWorker는 현재 플랫폼 제약으로 false = SAB 불가(interrupt/fork는 이 커널에서 불가). */
  crossOriginIsolated: boolean;
}

/**
 * 탭 밖에서 사는 공유 커널(SharedWorker): 여러 탭 = 한 파이썬 상태, 탭 하나가 닫혀도
 * 연결이 남아 있는 한 커널은 계속 돈다. 원격 커널이므로 모든 호출이 Promise.
 */
export class SharedKernel {
  constructor(opts?: SharedKernelOptions);
  connect(): SharedKernel;
  run(code: string): Promise<unknown>;
  runAsync(code: string): Promise<unknown>;
  setGlobal(name: string, value: unknown): Promise<unknown>;
  status(): Promise<SharedKernelStatus>;
}

export interface TerminalConfig {
  /** 완결 문장마다 자동 체크포인트를 닫고 "%undo"로 직전 상태에 시간여행한다. */
  timeTravel?: boolean;
}

/** 서버리스 파이썬 터미널: code.InteractiveConsole 기반 REPL. input() 블로킹은 syscallBridge와 조합. */
export class Terminal {
  install(): Promise<{ repl: string; timeTravel: boolean }>;
  /** 한 줄 입력. more=연속행 대기(... 프롬프트), out=stdout+stderr. timeTravel이면 "%undo" 지원. */
  push(line: string): Promise<{ more: boolean; out: string }>;
}

export interface WheelCacheConfig {
  /** wheel 바이트를 저장할 디렉터리(OPFS 등). 소비자가 제공한다. */
  dir: FileSystemDirectoryHandle;
}

/** wheel OPFS 캐시: install/loadPackages 구간에서 .whl을 캐시에 저장/서빙(재다운로드 0). */
export class WheelCache {
  hits: number;
  misses: number;
  install(pkg: string): Promise<void>;
  loadPackages(pkgs: string | string[]): Promise<void>;
}

/** Pyodide 런타임 래퍼. run/install + 능력 등록(enableReactive/enableSyscallBridge/enableAsgiServer/enableTerminal/enableWheelCache). */
export class Runtime {
  readonly memory: MemoryCapability;
  run(code: string): unknown;
  runAsync(code: string): Promise<unknown>;
  setGlobal(name: string, value: unknown): void;
  getGlobal(name: string): unknown;
  install(pkg: string): Promise<void>;
  loadPackages(pkgs: string | string[]): Promise<void>;
  /** 현재 환경을 pyodide-lock 형식 락(JSON 문자열)으로 고정(uv lock 등가). boot({ lockFileURL })에 되먹인다. */
  freeze(): Promise<string>;
  /** bootEnv()로 부팅된 경우의 부팅 통계. */
  envBoot?: EnvBootStats;
  enableReactive(): ReactiveController;
  enableSyscallBridge(cfg?: SyscallBridgeConfig): SyscallBridge;
  enableAsgiServer(cfg?: AsgiServerConfig): AsgiServer;
  enableTerminal(cfg?: TerminalConfig): Terminal;
  enableWheelCache(cfg: WheelCacheConfig): WheelCache;
  /** 디렉터리 핸들(OPFS 등)을 파이썬 경로로 마운트(기본 /home/web). 반환된 sync()로 영속화. */
  mountHome(dirHandle: FileSystemDirectoryHandle, path?: string): Promise<{ path: string; sync: () => Promise<void> }>;
  /** 탈출구(권장 안 함): 내부 Pyodide 인스턴스. */
  readonly raw: unknown;
}

/** Pyodide 런타임을 부팅한다. Chromium/Edge 전용. */
export function boot(opts?: BootOptions): Promise<Runtime>;

/**
 * uv 레인 부팅: 환경 선언(manifest) + 캐시 디렉터리(dirs)로 웜 부팅한다.
 * bare 스냅샷(_loadSnapshot) + OPFS 휠 조합, 실측 콜드 5465ms -> 웜 1515ms(3.61배).
 * 패키지가 실린 힙 스냅샷은 Pyodide hiwire 벽으로 불가(envManager.js 주석의 실측 좌표).
 */
export function bootEnv(manifest?: EnvManifest, dirs?: EnvDirs): Promise<Runtime>;

/**
 * 브라우저판 uv run: PEP 723 인라인 메타데이터(# /// script)의 dependencies를
 * 자동 설치한 뒤 스크립트를 실행한다. opts.wheelDir로 휠 캐시 경유.
 */
export function runScript(rt: Runtime, src: string, opts?: { wheelDir?: FileSystemDirectoryHandle }): Promise<RunScriptOutcome>;

export interface SessionManifest {
  indexURL?: string;
  env?: Record<string, string>;
  /** 리플레이로 로드할 패키지(환경 선언의 일부). */
  packages?: string[];
  /** 리플레이 경계 직전에 실행할 파이썬(예: "import numpy"). */
  setup?: string;
}

export interface SessionIo {
  pages: number;
  mb: number;
}

/**
 * 세션 부활(불멸 커널): 결정적 리플레이 부팅 + 사용자 델타의 OPFS 영속.
 * 같은 매니페스트로 bootSession한 커널은 바이트 동일 힙을 재현하므로,
 * save()가 남긴 델타(수 MB)를 load()로 적용하면 이전 세션의 파이썬 상태가 부활한다.
 */
export function bootSession(manifest?: SessionManifest): Promise<Session>;

/** .pymachine 파일로 같은 컴퓨터를 부팅한다. 머신 파일은 실행 파일과 동급 위험이라 { trust: true } 명시 승인 필수, SHA-256 무결성 검증. */
export function openMachine(file: Blob, opts?: { trust?: boolean }): Promise<Session>;

export class Session {
  readonly rt: Runtime;
  readonly reactive: ReactiveController;
  /** 이 컴퓨터 전체를 .pymachine 단일 파일(무결성 해시 포함)로 내보낸다. */
  exportImage(): Promise<Blob>;
  /** 사용자 상태(리플레이 경계와의 차이 페이지)만 저장. base는 리플레이가 대체한다. */
  save(dir: FileSystemDirectoryHandle, name: string): Promise<SessionIo>;
  /** 같은 매니페스트·같은 힙 크기 전제(불일치는 명시적 예외). */
  load(dir: FileSystemDirectoryHandle, name: string): Promise<SessionIo>;
}

export interface PyProcMapOptions {
  /** 태스크별 타임아웃(ms). 초과 시 해당 태스크는 {error}로 수렴하고 행 워커는 kill + 스냅샷 respawn. */
  taskTimeoutMs?: number;
}

/** 브라우저 파이썬 프로세스 OS 커널: 스냅샷-fork spawn + map 병렬 + 수명주기(kill/respawn). */
export class PyProc {
  constructor(opts?: PyProcOptions);
  boot(n: number, useSnapshot?: boolean): Promise<PyProcBootInfo>;
  map(fnSrc: string, args: unknown[], opts?: PyProcMapOptions): Promise<unknown[]>;
  /** TypedArray를 조각내 워커들에 numpy 배열로 병렬 적용(샤딩). fnSrc: def _fn(a). 실측 4워커 5.28배. */
  mapArray(fnSrc: string, typed: ArrayBufferView, opts?: PyProcMapOptions & { parts?: number }): Promise<unknown[]>;
  mapSerial(fnSrc: string, args: unknown[]): Promise<unknown[]>;
  ps(): PyProcEntry[];
  /** 프로세스 강제 종료(SIGKILL 등가). 성공 시 true, 테이블에는 dead로 남는다. */
  kill(pid: number): boolean;
  /** 협조적 취소(SIGINT 등가). 실행 중 파이썬에 KeyboardInterrupt, 워커는 살아서 재사용된다. */
  interrupt(pid: number): boolean;
  terminate(): void;
}
