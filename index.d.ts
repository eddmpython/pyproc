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
  /** 이 노드의 부모(= 만들 당시의 live 노드). 과거로 복원한 뒤 체크포인트하면 분기가 된다. */
  parent?: number;
}

export interface CheckpointNode {
  index: number;
  parent: number;
  children: number[];
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
  /** true면 requests 계열을 배선한다(pyodide-http patch_all. 절대 URL만). */
  requests?: boolean;
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
  /**
   * 리플레이 매니페스트: 주면 워커들이 결정적 리플레이로 부팅해 바이트 동일한 힙에 선다.
   * fork(살아있는 상태 복제)의 전제다. 프로세스 간 대칭이라야 델타가 유효하다.
   */
  replay?: { env?: Record<string, string>; packages?: string[]; setup?: string };
}

/** 시그널 번호(POSIX). SAB 채널로 워커의 CPython eval 루프에 전달된다. */
export const SIGNAL: { INT: 2; USR1: 10; USR2: 12; TERM: 15 };

export interface ForkInfo {
  pages: number;
  mb: number;
  /** 자식(dst)의 델타 밖 드리프트를 리플레이 경계로 되돌린 페이지 수. fork는 정확히 "경계 + 부모 델타"를 만든다. */
  reverted: number;
  harvestMs: number;
  applyMs: number;
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

/**
 * 복원 기반 리액티브: 완전 해시 체크포인트 **나무** + 라이브-차분 복원 + 시간여행/분기.
 * 과거 노드로 복원한 뒤 checkpoint()하면 그 노드를 부모로 하는 분기가 생긴다(머신의 git).
 * 델타 해석은 부모 체인을 따르므로 형제 분기의 페이지가 새지 않는다.
 */
export class ReactiveController {
  /** 체크포인트 나무: 각 노드의 부모/자식. */
  tree(): CheckpointNode[];
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
  /** 응답 바디의 utf-8 텍스트 뷰(JSON/HTML용). */
  body: string;
  /** 응답 바디의 원시 바이트(바이너리 응답의 정본). requests의 .text/.content 등가. */
  bodyBytes: Uint8Array;
}

/**
 * 커널 안 ASGI 서버: FastAPI/Starlette를 소켓 0으로 dispatch. 엔드포인트는 async def 강제.
 * body는 텍스트 또는 바이트 버퍼, headers는 [k, v] 배열(content-type 미지정 시 json 기본).
 * 헬퍼가 매 요청 앱 전역을 다시 읽으므로 전역 재대입 = 핫스왑(dev loop). lifespan은 발화하지 않는다.
 */
export class AsgiServer {
  install(): Promise<{ app: string; transport: string }>;
  serve(method: string, path: string, body?: string | Uint8Array | null, query?: string, headers?: [string, string][] | null): Promise<AsgiResponse>;
}

/**
 * 파이썬 서버를 진짜 URL로: pyprocSw.js(같은 폴더 자산)를 소비자 오리진에 등록하면
 * (navigator.serviceWorker.register(".../pyprocSw.js?asgi=/pyproc/")), 그 접두 fetch가
 * 이 배선을 거쳐 AsgiServer로 응답된다. 실측 왕복 3.4ms(SW 오버헤드 0).
 * bind()는 SW에 커널을 등록(hello)하므로 가상 오리진에서 서빙된 문서(iframe/딴 탭)의
 * fetch도 커널로 라우팅된다. 커널 무응답은 SW가 504로 끊는다(?asgiTimeout= 조정).
 * 벽: SW 합성 응답의 Set-Cookie는 스트립됨(쿠키 세션 불가, 토큰 방식 사용), WebSocket 미가로채기.
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

export interface WasiManifest {
  /** WASI CPython wasm 배포 URL. 미지정 시 기본 WLR 3.12(COOP/COEP 하에선 셀프 호스팅 권장). */
  wasmURL?: string;
  /** true면 엔트로피/시간을 고정해 결정적으로 부팅한다(리플레이/시간여행의 전제). */
  deterministic?: boolean;
}

/**
 * Pyodide가 아닌 CPython(WASI)으로 도는 세션. Pyodide는 메인 스레드 동기지만 WASI는 워커 안
 * 비동기라, 동기 Runtime과 별개의 async 표면으로 둔다(소비자 무영향). 엔진 무관 실증:
 * 반복 실행 + 값 다리 + **완전 시간여행**(체크포인트/복원/재개/분기)이 Pyodide 내부 없이 성립.
 * 값 다리는 JSON 직렬화 한정(WASI엔 FFI가 없어 함수/numpy/live 객체는 못 넘긴다).
 * 네이티브 확장 불가(정적 링크). 코드 채널/신호 프로토콜은 내부 캡슐화(소비자는 모른다).
 */
export class WasiSession {
  /** 코드 실행(async). stdout 문자열 반환. 파이썬 예외는 던진다. */
  run(code: string): Promise<string>;
  /** 파이썬 전역 값 회수(JSON 역직렬화). */
  get(name: string): Promise<unknown>;
  /** JS 값을 파이썬 전역에 주입(JSON 직렬화). */
  set(name: string, value: unknown): Promise<void>;
  /** 지금 상태를 체크포인트(경계 힙 스냅샷). */
  checkpoint(): Promise<{ idx: number; mb: number }>;
  /** 시간여행: 체크포인트 idx로 복원한다. 복원 후 파이썬이 그 시점 상태로 재개(분기 가능). */
  timeTravel(idx: number): Promise<void>;
  terminate(): void;
}

/** non-Pyodide CPython(WASI) 세션을 부팅한다. Chromium/Edge 전용(SAB + crossOriginIsolated). */
export function bootWasi(manifest?: WasiManifest): Promise<WasiSession>;

export interface TerminalConfig {
  /** 완결 문장마다 자동 체크포인트를 닫고 "%undo"로 직전 상태에 시간여행한다. */
  timeTravel?: boolean;
}

export interface DeviceProvider {
  /** open 시점에 호출되어 파일 내용을 확정한다(동기). */
  read?: () => string;
  /** 파이썬 write의 바이트를 받는다(동기). */
  write?: (bytes: Uint8Array) => void;
}

export interface DeviceFsConfig {
  /** 추가 장치: { "/dev/이름": { read, write } }. */
  devices?: Record<string, DeviceProvider>;
  /** /proc/ps 내용 제공자(예: () => pyProc.ps()). */
  ps?: () => unknown;
}

/**
 * 모든 것은 파일(Plan 9): 브라우저 능력을 파이썬 open()으로 노출한다.
 * 내장: /proc/meminfo, /dev/clipboard(쓰기 즉시 반영 시도, 읽기는 캐시 + refreshClipboard()).
 * 장치 read는 동기 계약이다(비동기 소스는 캐시가 정직한 계약).
 */
export class DeviceFs {
  install(): { installed: string[] };
  /** 시스템 클립보드를 읽기 캐시로 끌어온다(권한 필요할 수 있음). */
  refreshClipboard(): Promise<string>;
}

export interface InitConfig {
  /** 부팅 시 1회 실행할 파일(기본 /home/web/boot.py). 없으면 no-op. */
  bootPath?: string;
  /** 주기 실행할 파일(기본 /home/web/cron.py). 없으면 no-op. */
  cronPath?: string;
  /** 크론 간격 ms(기본 60000). */
  cronMs?: number;
}

/** OS의 init(rc.local + cron): 마운트된 디스크의 파일이 머신을 스스로 움직이게 한다. */
export class Init {
  install(): { boot: boolean; cron: boolean };
  stop(): void;
}

export interface JournalConfig {
  /** 저널을 둘 디렉터리(OPFS 등). 소비자가 제공한다. */
  dir: FileSystemDirectoryHandle;
  /** cp0이 리플레이 경계인 컨트롤러(bootSession의 reactive). 부활의 전제. */
  reactive: ReactiveController;
  /** 유휴 판정 ms(기본 2000). 이 시간 동안 상태 변이가 없으면 커밋한다. */
  idleMs?: number;
}

/**
 * WAL(write-ahead log): 강제종료 내성. 유휴마다 변경 페이지를 content-addressed로 저장하고,
 * 다음 부팅이 `recover()`로 마지막 커밋에서 부활한다(hibernate 훅이 실패해도 산다).
 * 커밋 단위가 문장이 아니라 **유휴**인 이유: 실측상 no-op 문장조차 ~95페이지를 더럽히므로
 * (CPython eval/GC의 고정 scratch) 문장마다 쓰면 쓰기량이 폭증한다. 유휴 배치가 88% 절감.
 * 계약: 크래시 시 잃는 것은 "마지막 커밋 이후"다(경계 일관성이지 문장 단위 내구성이 아니다).
 */
export class MachineJournal {
  readonly commits: number;
  readonly pagesWritten: number;
  /** 유휴 감시 시작(실행 중에는 끼어들지 않는다). */
  start(): MachineJournal;
  stop(): void;
  /** 지금 상태를 커밋(수동 경계). 반환: 변경 페이지 수와 실제 쓴 양(dedupe 후). */
  commit(): Promise<{ pages: number; wrote: number; mb: number } | null>;
  /** 마지막 커밋으로 부활. 저널이 없으면 null(첫 부팅). */
  recover(): Promise<{ pages: number; mb: number } | null>;
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
  /**
   * EngineContract 또는 **로드된 Pyodide 인스턴스**를 받는다. 후자를 주면 감싸므로, 워커에서
   * 자체 부팅한 Pyodide를 `new Runtime(py)`로 채택할 수 있다(dartlab 라이브 소비 패턴).
   */
  constructor(engineOrPyodide: unknown, indexURL?: string);
  readonly memory: MemoryCapability;
  /** 이 커널이 부팅된 엔진 배포 지점. 자식 워커(subprocess)가 같은 지점을 쓴다. */
  readonly indexURL: string;
  run(code: string): unknown;
  runAsync(code: string): Promise<unknown>;
  setGlobal(name: string, value: unknown): void;
  /** 엔진 프록시(Pyodide면 PyProxy)를 그대로 반환한다. call/toJs로 값 회수, destroy로 파기(재사용 캐시). */
  getGlobal(name: string): unknown;
  /** 인터럽트 SAB: [0]에 시그널 번호(2=SIGINT)를 쓰면 실행 중 파이썬이 반응한다. 미지원 엔진은 false. */
  setInterruptBuffer(sab: SharedArrayBuffer): boolean;
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
  enableDeviceFs(cfg?: DeviceFsConfig): DeviceFs;
  enableInit(cfg?: InitConfig): Init;
  enableJournal(cfg: JournalConfig): MachineJournal;
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
  /**
   * 시그널 전달(유닉스 시그널 표). 실행 중 파이썬의 signal 핸들러가 발화한다.
   * SIGINT(2)=KeyboardInterrupt 기본, SIGTERM(15)/SIGUSR1(10) 등은 파이썬이 signal.signal로 건 핸들러가 받는다.
   * 워커는 살아남아 재사용된다(협조적 종료 실측 264ms). 미지원 워커면 false.
   */
  signal(pid: number, signum?: number): boolean;
  /** SIGINT 별칭(기존 계약). */
  interrupt(pid: number): boolean;
  /**
   * fork(2) 등가: 살아있는 프로세스 src의 현재 상태(변수·배열·계산 결과)를 dst에 복제한다.
   * replay 매니페스트로 부팅한 풀에서만 가능(바이트 동일한 경계가 델타의 전제).
   * 자식은 독립 주소공간이다(자식의 변이는 부모에 새지 않는다).
   */
  fork(srcPid: number, dstPid: number): Promise<ForkInfo>;
  terminate(): void;
}
