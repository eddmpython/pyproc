// pyproc 공개 표면 타입 선언. 소스는 순수 ESM .js이고 이 파일이 소비자(TypeScript)에게
// 계약을 제공한다. 빌드 단계 없이 손으로 유지한다(소스와 함께 갱신).

export const PAGE_SIZE: number;
export const PYPROC_ASSET_MANIFEST_VERSION: 1;

/** src의 모든 오류가 사용하는 단일 오류 계약의 코드. 카탈로그는 src/runtime/errors.js와 일치한다. */
export type PyProcErrorCode =
  | "PYPROC_ENV_UNSUPPORTED"
  | "PYPROC_INPUT_INVALID"
  | "PYPROC_BOOT_FAILED"
  | "PYPROC_ASSET_INTEGRITY"
  | "PYPROC_MACHINE_FORMAT_INVALID"
  | "PYPROC_MACHINE_INTEGRITY"
  | "PYPROC_MACHINE_UNTRUSTED"
  | "PYPROC_REPLAY_MISMATCH"
  | "PYPROC_HEAP_GROW_FAILED"
  | "PYPROC_CHECKPOINT_PRUNED"
  | "PYPROC_PROCESS_UNAVAILABLE"
  | "PYPROC_FORK_UNAVAILABLE"
  | "PYPROC_WORKER_CRASHED"
  | "PYPROC_WORKER_TASK_ERROR"
  | "PYPROC_TASK_TIMEOUT"
  | "PYPROC_POOL_EXHAUSTED"
  | "PYPROC_JOURNAL_CORRUPT"
  | "PYPROC_JOURNAL_IO"
  | "PYPROC_RPC_OUTCOME_UNKNOWN"
  | "PYPROC_LEADER_UNAVAILABLE"
  | "PYPROC_SPLIT_BRAIN"
  | "PYPROC_LEADER_LOCK_FAILED"
  | "PYPROC_RPC_ACTION_INVALID"
  | "PYPROC_PARTICIPANT_LEFT"
  | "PYPROC_KERNEL_EXECUTION_ERROR"
  | "PYPROC_GPU_UNAVAILABLE"
  | "PYPROC_INTERNAL";

export const PYPROC_ERROR_CODES: readonly PyProcErrorCode[];

/**
 * pyproc의 단일 오류 계약. 프로그램적 분기는 message가 아니라 code로 한다.
 * retryable = 재시도 가능성. 전송 후 결과 불명(PYPROC_RPC_OUTCOME_UNKNOWN)은 항상
 * retryable=false다(자동 재실행 금지 계약).
 * 워커 안 파이썬 예외는 context.pyExcType에 예외 클래스명(KeyboardInterrupt 등)이 실려
 * postMessage 경계를 건너온다.
 */
export class PyProcError extends Error {
  constructor(code: PyProcErrorCode, message: string, opts?: { retryable?: boolean; context?: Record<string, unknown>; cause?: unknown });
  readonly name: "PyProcError";
  code: PyProcErrorCode;
  retryable: boolean;
  context?: Record<string, unknown>;
}

export interface PyProcAssetEntry {
  role: "processWorker" | "machineWorker" | "wasiWorker" | "pyprocServiceWorker";
  /** 패키지 루트 기준 상대 경로. */
  path: string;
  kind: "module-worker" | "shared-worker" | "service-worker";
  sameOrigin: true;
  usedBy: string[];
  reason: string;
  /** baseURL 기준 절대 URL. */
  url: string;
}

export interface PyProcAssetManifest {
  version: 1;
  /** 이 manifest가 URL을 계산한 패키지 루트. */
  packageRoot: string;
  policy: {
    sameOriginRequired: true;
    preserveRelativeImports: true;
    runtimePreflight?: true;
    note: string;
  };
  assets: PyProcAssetEntry[];
}

export function getPyProcAssetManifest(opts?: { baseURL?: string | URL }): PyProcAssetManifest;

export interface PyProcAssetIntegrityFile {
  /** 패키지 루트 기준 상대 경로. */
  path: string;
  /** 배포된 실제 URL. root-relative URL 가능. */
  url: string;
  bytes: number;
  /** 표준 SRI 문자열(sha256-...). */
  integrity: string;
  /** 이 파일을 쓰는 entrypoint role 목록. */
  roles: PyProcAssetEntry["role"][];
}

export interface PyProcAssetEntrypoint extends PyProcAssetEntry {
  /** entrypoint에서 상대 import/importScripts로 닿는 로컬 파일 graph. */
  graph: string[];
  bytes: number;
  integrity: string;
}

export interface PyProcAssetIntegrityManifest extends Omit<PyProcAssetManifest, "assets"> {
  entrypoints: PyProcAssetEntrypoint[];
  files: PyProcAssetIntegrityFile[];
}

export interface PyProcAssetIntegrityVerifyOptions {
  /** 검증할 실행 자산 role. 생략하면 files 전체를 검증한다. */
  roles?: PyProcAssetEntry["role"][];
  /** role 대신 특정 상대 경로만 검증한다. */
  paths?: string[];
  /** 테스트나 특수 배포 환경용 fetch 대체. */
  fetch?: typeof fetch;
  cache?: RequestCache;
  credentials?: RequestCredentials;
  /** false면 선택 대상 없음이 예외가 아니라 verified 0이 된다. */
  required?: boolean;
}

export interface PyProcAssetIntegrityResult {
  verified: number;
  bytes: number;
  files: string[];
}

export function verifyPyProcAssetIntegrity(manifest: PyProcAssetIntegrityManifest, opts?: PyProcAssetIntegrityVerifyOptions): Promise<PyProcAssetIntegrityResult | null>;

export interface PyProcServiceWorkerRegisterOptions {
  /** 테스트나 특수 실행 환경용 navigator 대체. 생략하면 globalThis.navigator를 쓴다. */
  navigator?: Navigator;
  /** SRI preflight용 fetch 대체. */
  fetch?: typeof fetch;
  /** SRI preflight fetch cache 옵션. */
  verifyCache?: RequestCache;
  credentials?: RequestCredentials;
  /** pyprocSw.js ?cache=1. script/module/wasm/zip 캐시와 coreIntegrity 검증 경로를 켠다. */
  cache?: boolean;
  /** pyprocSw.js ?asgi=/prefix/. VirtualOrigin fetch 위임 접두 경로. */
  asgi?: string;
  /** pyprocSw.js ?coi=1. 헤더를 못 다는 호스팅에서 COOP/COEP를 주입한다. */
  coi?: boolean;
  /** pyprocSw.js ?cdn=<prefix>. cache/coreIntegrity 대상으로 볼 URL 접두. */
  cdn?: string;
  /** pyprocSw.js ?coreIntegrity=<url>. SW가 캐시 대상 바이트를 SRI로 검증할 manifest URL. */
  coreIntegrity?: string;
  /** false면 SW coreIntegrity manifest 누락을 통과시킨다. 기본은 strict. */
  coreRequired?: boolean;
  asgiTimeout?: number;
  /** 추가 pyprocSw.js query. true는 "1"로 직렬화한다. */
  query?: URLSearchParams | Record<string, string | number | boolean | null | undefined>;
  /** ServiceWorkerRegistrationOptions.scope. */
  scope?: string;
  updateViaCache?: ServiceWorkerUpdateViaCache;
}

export interface PyProcServiceWorkerRegisterResult {
  registration: ServiceWorkerRegistration;
  integrity: PyProcAssetIntegrityResult | null;
  /** 실제 register에 넘긴 URL. */
  url: string;
  /** 검증한 manifest 파일 경로. */
  file: string;
}

export function registerPyProcServiceWorker(
  manifest: PyProcAssetIntegrityManifest,
  opts?: PyProcServiceWorkerRegisterOptions,
): Promise<PyProcServiceWorkerRegisterResult>;

export interface EnvIssue {
  /** 기계 판별용 코드: "no-cross-origin-isolation" | "no-jspi". */
  code: string;
  /** 빠진 플랫폼 능력. */
  need: string;
  /** 왜 필요한가(어느 기능이 막히는가). */
  why: string;
  /** 어떻게 고치는가(복붙 가능한 조치). */
  fix: string;
}

export interface EnvReport {
  /** true면 프로세스 OS 포함 모든 능력 가능. false여도 기본 표면(boot/run/enableReactive)은 된다. */
  ok: boolean;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  jspi: boolean;
  /** 준비 안 된 능력과 조치. 기본 표면만 쓸 거면 무시해도 된다. */
  issues: EnvIssue[];
}

export type CoreIntegrityMap = Record<string, string>;

export interface CoreIntegrityPolicy {
  /** indexURL 상대 경로, URL pathname, 절대 URL, 파일명 중 하나를 키로 쓰고 값은 표준 SRI 문자열(sha256-...)이다. */
  files: CoreIntegrityMap;
  /** true(기본)면 fetch되는 indexURL 자산이 manifest에 없을 때 실패한다. */
  required?: boolean;
}

export interface CoreAssetStats {
  hits: number;
  misses: number;
  /** coreIntegrity로 SHA-256 검증을 통과한 자산 수. */
  verified: number;
  /** required manifest에서 누락되어 거부된 자산 수. */
  integrityMissing: number;
}

/**
 * 환경 진단. "그냥 import하면 되나?"의 정직한 답: 기본 표면(boot/run/enableReactive)은 준비 없이
 * Chromium에서 돌지만, PyProc(프로세스 OS)/IPC/소켓 블로킹은 crossOriginIsolated(COOP/COEP 헤더)와
 * JSPI를 요구한다. 이 함수가 무엇이 준비됐는지, 안 됐으면 무엇을 어떻게 고치는지 돌려준다.
 */
export function checkEnvironment(): EnvReport;

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
  /** pyproc이 삽입하는 pyodide.js script 태그의 브라우저 SRI 값(sha256-...). 첫 부팅 전에만 강제 가능. */
  engineScriptIntegrity?: string;
  /** fetch 경로의 indexURL 자산(wasm/stdlib/lock/휠 등)을 SRI로 검증한다. */
  coreIntegrity?: CoreIntegrityMap | CoreIntegrityPolicy;
  /** pyproc-assets CLI 산출물. Runtime에서 만든 worker 능력이 spawn 전 graph를 SRI 검증한다. */
  assetIntegrity?: PyProcAssetIntegrityManifest;
  /** 락 파일 교체(Runtime.freeze() 산출물 등): 같은 버전이 해석 0으로 재현된다. */
  lockFileURL?: string;
  /** 워커 소비자(document 없음)가 자체 import한 loadPyodide. 주면 script 로드를 건너뛴다(globalThis 무오염). */
  loadPyodide?: (cfg: unknown) => Promise<unknown>;
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
  /** 체크포인트 시점의 스택 포인터(노드에 저장됨). restore()가 자동으로 소비한다. */
  sp: number | null;
  /** 이 체크포인트로 복원한다(= restoreLive(index)). sp 운반이 필요 없는 복원의 정본. */
  restore(opts?: { rehash?: boolean }): RestoreInfo;
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
  /** subprocess child worker를 만들기 전에 processWorker graph를 검증한다. 생략하면 Runtime.assetIntegrity를 상속한다. */
  assetIntegrity?: PyProcAssetIntegrityManifest;
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
  /** worker pool spawn 전에 processWorker graph를 SRI 검증한다. */
  assetIntegrity?: PyProcAssetIntegrityManifest;
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
  /**
   * 현재 힙을 체크포인트로 저장하고 복원 핸들을 돌려준다. cp.restore() 한 호출이
   * 복원의 정본이다(스택 포인터는 노드에 저장되어 있어 운반할 필요가 없다).
   */
  checkpoint(): CheckpointInfo;
  /** savedSP를 생략(null)하면 노드에 저장된 sp를 쓴다. prune된 노드는 PYPROC_CHECKPOINT_PRUNED. */
  restore(j: number, savedSP?: number | null): void;
  /**
   * 경계 위반(마지막 checkpoint/restore 이후 실행·변이)은 자동 감지되어 재해시 경로로 복원된다.
   * opts.rehash는 강제 재해시. savedSP 생략 시 노드 저장 sp 사용.
   * 주의: getGlobal이 준 라이브 PyProxy로 파이썬을 호출한 변이는 감지되지 않는다.
   * 그런 변이 후에는 markDirty() 또는 opts.rehash 없이 즉시 경로를 신뢰하지 마라.
   */
  restoreLive(j: number, savedSP?: number | null, opts?: { rehash?: boolean }): RestoreInfo;
  /**
   * 두 체크포인트 사이의 사용자 상태를 { pages, bin }으로 수집한다(세션 저장/저널 커밋/이미지
   * 내보내기의 공용 프리미티브). toIdx는 live 노드여야 한다(checkpoint()로 경계를 닫은 직후 사용).
   * opts.pack이 false면 bin은 null(페이지 목록만 필요한 소비자의 재할당 회피).
   */
  collectDelta(fromIdx?: number, toIdx?: number, opts?: { pack?: boolean }): { pages: number[]; bin: Uint8Array | null; sp: number | null; heapLen: number };
  /** 외부 변이 신고: 라이브 PyProxy 호출처럼 계측되지 않는 힙 변이 후 호출하면 다음 restoreLive가 재해시 경로로 승격된다. */
  markDirty(): void;
  /**
   * 루트->j 부모 체인 밖 노드의 델타/해시를 해제한다(체크포인트 나무의 RAM 배출 밸브).
   * 해제된 노드의 복원은 PYPROC_CHECKPOINT_PRUNED로 거부된다. liveIdx는 경로 위에 있어야 한다.
   */
  pruneTo(j: number): { freedNodes: number; freedMB: number; keptNodes: number };
  /** 나무 전체 해제. 기존 노드 복원은 거부되고, 다음 checkpoint()가 새 나무를 시작한다. */
  dispose(): void;
  stackSave(): number | null;
  storageMB(): number;
  /**
   * base(기준 힙)를 파일 핸들로 백업/이동한다. RAM은 줄지 않는다(복원 경로가 base 상주를
   * 전제한다). 메모리 배출 밸브는 pruneTo/dispose가 정본이다. 핸들은 소비자가 준다.
   */
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

export interface MachineContainerOptions {
  /** 컨테이너 커널이 부팅할 엔진 배포 지점(기본 부모 rt.indexURL). */
  indexURL?: string;
  /** 컨테이너 worker spawn 전에 machineWorker graph를 SRI 검증한다. 생략하면 Runtime.assetIntegrity를 상속한다. */
  assetIntegrity?: PyProcAssetIntegrityManifest;
}

export interface ContainerManifest {
  env?: Record<string, string>;
  /** 이 컨테이너가 부팅 시 로드할 패키지(자기 패키지 세트 = 도커 이미지의 레이어 등가). */
  packages?: string[];
  /** 부팅 직후 실행할 파이썬(컨테이너 초기 상태). */
  setup?: string;
}

export interface ContainerHandle {
  readonly cid: string;
  readonly bootMs: number;
  /** 컨테이너 안에서 코드 실행(RPC). 반환: 결과 값(JSON 직렬화 가능). */
  run(code: string): Promise<unknown>;
  /** 컨테이너 힙 바이트 길이. */
  heapLen(): Promise<number>;
  /** 이 컨테이너를 죽인다(워커 종료, 주소공간 독립이라 외부 무영향). */
  kill(): boolean;
}

/**
 * 머신 안의 머신(P5): 컨테이너 커널을 워커에 띄우고 부모 파이썬에 값(m)으로 노출한다.
 * 도커의 3요소가 브라우저에 완성된다: 이미지(.pymachine + SHA-256 + trust) + 레지스트리(OPFS)
 * + 실행(이 능력). 각 컨테이너는 자기 매니페스트(자기 패키지 세트)로 부팅한 독립 커널이고,
 * 중첩(깊이 2+)이 가능하다(컨테이너 속 컨테이너). 내부 kill은 그 워커만 죽인다(외부 무영향).
 * install() 후 파이썬은 pyprocMachine.spawn()으로 컨테이너를 값으로 만든다(블로킹 = JSPI, runAsync 경로).
 */
export class MachineContainer {
  constructor(rt: Runtime, opts?: MachineContainerOptions);
  /** 컨테이너 부팅(JS API). manifest = 자기 패키지 세트. */
  spawn(manifest?: ContainerManifest): Promise<ContainerHandle>;
  /** 컨테이너 종료. */
  kill(cid: string): boolean;
  /** 파이썬 표면 배선: pyprocMachine.spawn()이 파이썬 값을 돌려준다. */
  install(): { installed: string };
  /** 모든 컨테이너 종료. */
  terminate(): void;
}

export interface JobControlOptions {
  indexURL?: string;
  /** 풀 크기(대화형 1 + 잡 슬롯 N-1). 기본 3. */
  workers?: number;
  /** 리플레이 매니페스트(fork 대칭의 전제, 기본 {}). */
  replay?: { env?: Record<string, string>; packages?: string[]; setup?: string };
  /** 내부 PyProc worker pool spawn 전에 processWorker graph를 SRI 검증한다. */
  assetIntegrity?: PyProcAssetIntegrityManifest;
}

export interface JobInfo {
  jobId: number;
  pid: number;
  /** running | done | killed | error. */
  state: string;
  code: string;
}

export interface ReplOutcome {
  /** stdout + stderr 캡처. */
  out: string;
  /** 식이면 repr 문자열, 문장이면 null. */
  value: string | null;
}

/**
 * 셸의 잡 컨트롤(P3): `expr &`가 대화형 네임스페이스를 살아있는 채로 fork(2)해 딴 코어에서
 * 돌린다(프롬프트 즉시 복귀). fork는 워커끼리만 대칭이므로 대화형 REPL도 워커 레인에서 돈다
 * (PyProc replay 풀 위: 레인 0 = 대화형, 나머지 = 잡 슬롯). %jobs/%fg/%kill로 조종한다.
 */
export class JobControl {
  constructor(opts?: JobControlOptions);
  boot(): Promise<{ workers: number; interactivePid: number; jobSlots: number }>;
  /** 한 줄 입력. `&`로 끝나면 잡({ job, pid }), 아니면 대화형 실행(ReplOutcome). */
  push(line: string): Promise<ReplOutcome | { job: number; pid: number }>;
  /** 잡 테이블. */
  jobs(): JobInfo[];
  /** 잡을 포그라운드로: 완료를 기다려 결과를 반환. */
  fg(jobId: number): Promise<ReplOutcome | { error: string }>;
  /** 잡에 시그널(기본 SIGINT = 하드 인터럽트). 워커는 생존·재사용. */
  kill(jobId: number, signum?: number): boolean;
  /**
   * 협조 시그널이 통하지 않는 잡(인터럽트 미지원 워커, KeyboardInterrupt를 삼키는 루프)의
   * 최후 수단: 워커를 강제 종료하고 같은 replay 매니페스트로 레인을 재부팅해 회수한다.
   * 잡 상태는 "killed"로 종결. running이 아닌 잡이면 false.
   */
  killHard(jobId: number): Promise<boolean>;
  terminate(): void;
}

export interface KernelElectionOptions {
  /** 커널 식별자(같은 name = 같은 선출/커널). */
  name?: string;
  /** 리더가 부팅할 세션 매니페스트(결정적 리플레이 = failover 저널 resume의 전제). */
  manifest?: SessionManifest;
  /** 저널 디렉터리(OPFS). 주면 failover 시 마지막 커밋에서 상태가 부활한다(없으면 상태 소실). */
  journalDir?: FileSystemDirectoryHandle;
  /** 테스트, 로그 상관, 제품 participant 표시용 ID. 생략하면 crypto 고유 ID. */
  participantId?: string;
  /** OPFS 내부 저장 키. status에 노출한다. */
  storageKey?: string;
  heartbeatMs?: number;
  presenceTimeoutMs?: number;
  rpcTimeoutMs?: number;
  /** 이 참여자가 리더가 됐을 때 콜백. */
  onLeader?: (info: KernelLeaderInfo) => void;
  /** 역할, leader, epoch, recovery 상태가 바뀔 때 콜백. */
  onStatus?: (status: KernelStatus) => void;
}

export interface KernelLeaderInfo {
  recovered: boolean;
  leaderId: string;
  epoch: number;
  bootMs: number;
  recoveryMs: number;
  totalMs: number;
}

export interface KernelStatus {
  name: string;
  storageKey: string | null;
  participantId: string;
  leaderId: string | null;
  role: "idle" | "pending" | "leader" | "follower";
  phase: "idle" | "joining" | "recovering" | "ready" | "failed" | "left";
  epoch: number;
  recovered: boolean;
  lastCommitAt: string | null;
  participantCount: number;
  participants: readonly string[];
  pendingRequests: number;
  bootMs: number | null;
  recoveryMs: number | null;
  crossOriginIsolated: boolean;
  jspi: boolean;
  durable: boolean;
  rpcSemantics: string;
  error: string | null;
}

/**
 * 커널 선출(P2): 여러 탭이 Web Locks로 리더 하나를 뽑고 리더만 커널(bootSession + 저널)을
 * 부팅한다. 나머지 탭은 BroadcastChannel로 리더에 RPC하는 뷰다(여러 탭 = 한 파이썬 상태).
 * 리더 탭이 죽으면 락이 자동 해제되고 팔로워가 승격 + 저널에서 resume한다(탭 죽음 생존).
 * SharedWorker(COI=false)와 달리 리더 커널은 자기 문서에 살아 SAB 전능력을 유지한다.
 */
export class KernelElection {
  readonly name: string;
  readonly participantId: string;
  constructor(opts?: KernelElectionOptions);
  /** 선출 참여. 락을 얻으면 리더(커널 부팅), 못 얻으면 팔로워(RPC 뷰). */
  join(): KernelElection;
  /** 코드 실행. 전송 뒤 leader가 바뀌거나 timeout이면 중복 실행 대신 outcome unknown 오류를 낸다. */
  run(code: string, opts?: { async?: boolean; timeoutMs?: number }): Promise<unknown>;
  /** 힙과 /home/web을 같은 저널 세대로 확정한다. follower 호출은 leader에 전달한다. */
  commit(opts?: { timeoutMs?: number }): Promise<JournalCommitResult | null>;
  /** leader가 복구와 서빙 준비를 끝낼 때까지 기다린다. */
  ready(opts?: { timeoutMs?: number }): Promise<KernelStatus>;
  /** 현재 머신, participant, leader, epoch, recovery 상태. */
  status(): KernelStatus;
  /** 상태 변경 구독. 반환 함수를 호출하면 해제한다. */
  subscribe(listener: (status: KernelStatus) => void): () => boolean;
  /** 현재 역할: idle | pending | leader | follower. */
  role(): string;
  /** 선출에서 나간다(탭 닫힘). 리더면 락을 놓아 failover를 튼다. */
  leave(): void;
}

export interface PersistentMachineOptions extends Omit<KernelElectionOptions, "journalDir" | "manifest" | "storageKey"> {
  name?: string;
  manifest?: SessionManifest;
  /** 생략하면 OPFS의 pyprocMachines/<name hash>를 연다. */
  journalDir?: FileSystemDirectoryHandle;
  storageRoot?: FileSystemDirectoryHandle;
  machineRoot?: string;
  storageKey?: string;
  /** manifest.assetIntegrity 단축 옵션. */
  assetIntegrity?: PyProcAssetIntegrityManifest;
  /** 첫 leader ready까지의 제한 시간. */
  timeoutMs?: number;
}

/** 같은 name의 모든 탭을 마지막 commit에서 부활하는 하나의 지속 Python 머신으로 연다. */
export function openPersistentMachine(opts?: PersistentMachineOptions): Promise<KernelElection>;

export interface TerminalConfig {
  /** 완결 문장마다 자동 체크포인트를 닫고 "%undo"로 직전 상태에 시간여행한다. */
  timeTravel?: boolean;
}

export interface DeviceProvider {
  /** open 시점에 호출되어 파일 내용을 확정한다(동기). */
  read?: () => string;
  /** 파이썬 write의 바이트를 받는다(동기). */
  write?: (bytes: Uint8Array) => void;
  /** write 장치가 닫힐 때 축적된 전체 바이트를 받는다(예: /dev/fb0 프레임 blit). */
  flush?: (bytes: Uint8Array) => void;
}

export interface DeviceFsConfig {
  /** 추가 장치: { "/dev/이름": { read, write, flush } }. */
  devices?: Record<string, DeviceProvider>;
  /** /proc/ps 내용 제공자(예: () => pyProc.ps()). */
  ps?: () => unknown;
  /** fsWorld v2: /dev/fb0 프레임버퍼. 파이썬이 raw RGBA를 쓰면 close 시 onFrame(rgba, w, h)이 화면에 blit. */
  framebuffer?: { width: number; height: number; onFrame: (rgba: Uint8Array, width: number, height: number) => void };
  /** fsWorld v2: /proc/<pid>/ctl 쓰기=시그널의 배선(보통 (pid, signum) => pyProc.signal(pid, signum)). track()의 전제. */
  signal?: (pid: number, signum: number) => boolean;
}

/**
 * 모든 것은 파일(Plan 9): 브라우저 능력을 파이썬 open()으로 노출한다.
 * 내장: /proc/meminfo, /dev/clipboard(쓰기 즉시 반영 시도, 읽기는 캐시 + refreshClipboard()),
 * /dev/random(열 때마다 신선한 난수). fsWorld v2: /dev/fb0(framebuffer), /proc/<pid>/ctl(track).
 * 장치 read는 동기 계약이다(비동기 소스는 캐시가 정직한 계약).
 */
export class DeviceFs {
  install(): { installed: string[] };
  /** fsWorld v2: /proc/<pid>/ctl + /proc/<pid>/status 등록(Plan 9). ctl에 시그널명("term"/"int"/숫자)을 쓰면 시그널 발화. cfg.signal 필수. */
  track(pid: number): string;
  /** 시스템 클립보드를 읽기 캐시로 끌어온다(권한 필요할 수 있음). */
  refreshClipboard(): Promise<string>;
}

export interface InitConfig {
  /** 부팅 시 1회 실행할 파일(기본 /home/web/boot.py). 없으면 no-op. */
  bootPath?: string;
  /** 부활 후 프로세스 자원 재개설 파일(기본 /home/web/resume.py). 없으면 no-op. */
  resumePath?: string;
  /** 주기 실행할 파일(기본 /home/web/cron.py). 없으면 no-op. */
  cronPath?: string;
  /** 크론 간격 ms(기본 60000). */
  cronMs?: number;
}

/** OS의 init(rc.local + cron + resume): 마운트된 디스크의 파일이 머신을 스스로 움직이게 한다. */
export class Init {
  install(): { boot: boolean; resume: false; cron: boolean };
  /** Session.load/MachineJournal.recover/openMachine 뒤 resume.py를 실행해 fd/socket/DB connection을 재개설한다. */
  resume(reason?: string): { resume: boolean; reason: string };
  stop(): void;
}

export interface JournalConfig {
  /** 저널을 둘 디렉터리(OPFS 등). 소비자가 제공한다. */
  dir: FileSystemDirectoryHandle;
  /** cp0이 리플레이 경계인 컨트롤러(bootSession의 reactive). 부활의 전제. */
  reactive: ReactiveController;
  /** 유휴 판정 ms(기본 2000). 이 시간 동안 상태 변이가 없으면 커밋한다. */
  idleMs?: number;
  /** 기본 true. 힙과 함께 /home/web 파일 트리를 같은 HEAD/PREV 세대에 넣는다. */
  includeHome?: boolean;
  /** 저장할 파일 트리 루트. 기본 /home/web. */
  homePath?: string;
  /**
   * true면 커밋 직후 loose blob이 임계값을 넘을 때 pack한다. 기본은 false.
   * true의 기본 정책은 loose blob 128개 또는 8MB 이상이다.
   */
  autoPack?: boolean | JournalAutoPackPolicy;
  /**
   * 유휴 커밋의 성공/실패 관측 채널. durable 주장의 실패는 조용히 삼켜지지 않는다:
   * 실패는 { kind: "commitError", error }(error.code = PYPROC_JOURNAL_IO 계열)로 온다.
   * 콜백이 없으면 실패는 console.warn으로 남는다(기존 동작).
   */
  onStatus?: (event: { kind: "commit"; result: JournalCommitResult } | { kind: "commitError"; error: PyProcError }) => void;
  /**
   * 기본 false. true면 커밋 직후 reactive.pruneTo(liveIdx)로 체크포인트 나무를 라이브
   * 경로만 남긴다(장수 머신의 RAM 배출 밸브). 같은 컨트롤러를 다른 소비자(Terminal %undo
   * 마크 등)와 공유하면 그쪽 노드도 잘리므로 소비자가 결정한다.
   */
  pruneAfterCommit?: boolean;
}

export interface JournalAutoPackPolicy {
  /** 이 개수 이상의 loose blob이 있으면 커밋 직후 pack한다. 기본 128. */
  looseBlobs?: number;
  /** 이 용량 이상의 loose blob이 있으면 커밋 직후 pack한다. 기본 8MB. */
  looseMB?: number;
}

export interface JournalCommitResult {
  pages: number;
  wrote: number;
  mb: number;
  committedAt: string;
  home?: { files: number; mb: number; wrote: boolean };
  /** autoPack 정책으로 같은 커밋 뒤 pack이 실행됐으면 그 결과가 들어온다. */
  autoPack?: JournalPackResult;
  /** pruneAfterCommit이 켜져 있으면 커밋 직후 나무 prune 결과가 들어온다. */
  pruned?: { freedNodes: number; freedMB: number; keptNodes: number };
}

export interface JournalPackResult {
  liveKeys: number;
  packed: number;
  bytes: number;
  mb: number;
  looseRemoved: number;
  packsRemoved: number;
  /** autoPack으로 실행됐을 때의 발화 기준. 수동 pack이면 없다. */
  trigger?: { looseBlobs: number; looseMB: number };
}

export interface JournalPruneResult {
  liveKeys: number;
  looseRemoved: number;
  packsRemoved: number;
}

export interface JournalRecoverResult {
  pages: number;
  mb: number;
  committedAt: string | null;
  home?: { files: number; dirs: number; mb: number };
  fallback?: boolean;
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
  readonly packs: number;
  readonly packBytes: number;
  /** 유휴 감시 시작(실행 중에는 끼어들지 않는다). */
  start(): MachineJournal;
  stop(): void;
  /** 지금 상태를 커밋(수동 경계). 반환: 변경 페이지 수와 실제 쓴 양(dedupe 후). */
  commit(): Promise<JournalCommitResult | null>;
  /** HEAD/PREV live blob만 pack 파일 1개로 묶고 loose/stale 파일을 줄인다. */
  pack(): Promise<JournalPackResult | null>;
  /** HEAD/PREV가 더 이상 참조하지 않는 loose blob과 stale pack 파일을 지운다. */
  prune(): Promise<JournalPruneResult>;
  /** 마지막 커밋으로 부활. 저널이 없으면 null(첫 부팅). */
  recover(): Promise<JournalRecoverResult | null>;
}

export interface JailPermissions {
  /** 네트워크: false 전부 차단 / true 전부 허용 / ["host", ...] 허용 목록. */
  net?: boolean | string[];
  clipboard?: boolean;
  home?: boolean;
  workers?: boolean;
}

/**
 * 권한 감옥(P6): trust:true 이진 게이트가 스코프 승인으로 진화한다. 2단 집행 -
 * (1) 협조 초크포인트(pyprocJail.net(host) 등, import js로 우회 가능 = 정직)
 * (2) 브라우저 벽(감옥 컨텍스트의 CSP connect-src): 감옥을 CSP iframe에서 부팅하면 파이썬이
 * 우회를 시도해도 비허용 host fetch는 브라우저가 차단한다. connect-src 'self'는 자가 호스팅
 * 엔진을 전제한다(P0과 짝). 정직: same-origin 감옥은 자기 egress를 막지만 window.parent
 * 측면통로가 열린다 - 완전 격리는 opaque origin(sandbox)이고 그 대가로 SAB(fork/interrupt)를 잃는다.
 */
export class MachineJail {
  constructor(permissions?: JailPermissions);
  /** 협조 티어 판정(우회 가능). perm: net|clipboard|home|workers. */
  allows(perm: string, arg?: string): boolean;
  /** 감옥 컨텍스트의 CSP connect-src 값('self' + 허용 host). */
  connectSrc(): string;
  /** 감옥 iframe에 실을 CSP 전체 문자열(엔진 self 로드 허용 + connect-src 제한). */
  csp(): string;
  /** 협조 초크포인트를 파이썬에 심는다(pyprocJail 모듈). */
  install(rt: Runtime): { permissions: JailPermissions; connectSrc: string };
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
/**
 * 엔진-무관 일반 파일 IO(Runtime.fs). 소비자가 rt.raw.FS를 안 만지고 파일을 읽고 쓴다.
 * 영속(OPFS)은 mountHome이 마운트하고 이건 그 위 파일-op 레이어(새 VFS 아님). 변이는 execSeq를 올린다(리액티브 가드).
 */
export class FileSystem {
  /** data가 문자열이면 utf8, Uint8Array면 binary(opts.encoding으로 명시 가능). */
  writeFile(path: string, data: string | Uint8Array, opts?: { encoding?: "utf8" | "binary" }): void;
  /** 기본 binary(Uint8Array). { encoding: "utf8" }면 문자열. */
  readFile(path: string, opts?: { encoding?: "utf8" | "binary" }): Uint8Array | string;
  mkdir(path: string): void;
  /** 중첩 경로 생성(존재해도 무해). */
  mkdirTree(path: string): void;
  /** . / .. 제외한 이름 배열. */
  readdir(path: string): string[];
  stat(path: string): { size: number; isDir: boolean; isFile: boolean; mtimeMs: number | null };
  exists(path: string): boolean;
  unlink(path: string): void;
  rmdir(path: string): void;
}

export class Runtime {
  /**
   * EngineContract 또는 **로드된 Pyodide 인스턴스**를 받는다. 후자를 주면 감싸므로, 워커에서
   * 자체 부팅한 Pyodide를 `new Runtime(py)`로 채택할 수 있다(dartlab 라이브 소비 패턴).
   */
  constructor(engineOrPyodide: unknown, indexURL?: string, opts?: { assetIntegrity?: PyProcAssetIntegrityManifest });
  readonly memory: MemoryCapability;
  /** 엔진-무관 일반 파일 IO(상시 능력, memory와 동급). 미지원 엔진이면 호출 시 에러. */
  readonly fs: FileSystem;
  /** 상태 변이 카운터. 리액티브가 실행 경계 위반을 O(1)로 감지하는 근거(읽기 전용으로 취급). */
  readonly execSeq: number;
  /** 실행 API 밖의 상태 변이를 경계 카운터에 기록한다(복원, markDirty가 소비). */
  noteStateMutation(): void;
  /** 이 커널이 부팅된 엔진 배포 지점. 자식 워커(subprocess)가 같은 지점을 쓴다. */
  readonly indexURL: string;
  /** pyproc-assets CLI 산출물. Runtime에서 만든 worker 능력이 spawn 전 graph를 검증할 때 쓴다. */
  readonly assetIntegrity: PyProcAssetIntegrityManifest | null;
  run(code: string): unknown;
  runAsync(code: string): Promise<unknown>;
  setGlobal(name: string, value: unknown): void;
  /** 엔진 프록시(Pyodide면 PyProxy)를 그대로 반환한다. call/toJs로 값 회수, destroy로 파기(재사용 캐시). */
  getGlobal(name: string): unknown;
  /** 인터럽트 SAB: [0]에 시그널 번호(2=SIGINT)를 쓰면 실행 중 파이썬이 반응한다. 미지원 엔진은 false. */
  setInterruptBuffer(sab: SharedArrayBuffer): boolean;
  install(pkg: string): Promise<void>;
  loadPackages(pkgs: string | string[]): Promise<void>;
  /** 셀 코드의 import 문을 스캔해 필요한 패키지를 자동 로드. 미지원 엔진(WASI)은 no-op(명시 loadPackages 폴백). */
  loadPackagesFromImports(code: string): Promise<void>;
  /** 실행 출력 캡처(셀별 가변 싱크). handler는 문자열 청크 수신, null = 기본 복원. */
  setStdout(handler: ((chunk: string) => void) | null): void;
  setStderr(handler: ((chunk: string) => void) | null): void;
  /** 현재 환경을 pyodide-lock 형식 락(JSON 문자열)으로 고정(uv lock 등가). boot({ lockFileURL })에 되먹인다. */
  freeze(): Promise<string>;
  /** bootEnv()로 부팅된 경우의 부팅 통계. */
  envBoot?: EnvBootStats;
  /** boot({ coreCacheDir/coreIntegrity })로 부팅한 경우의 코어 자산 캐시/검증 통계. */
  coreCache?: CoreAssetStats;
  /** 런타임당 컨트롤러 1개(memoize): 몇 번을 불러도 같은 인스턴스다. 컨트롤러가 둘이면
   *  한쪽의 복원이 다른 쪽 경계 가드에 보이지 않아 조용한 오염이 되므로 구조로 막는다. */
  enableReactive(): ReactiveController;
  enableSyscallBridge(cfg?: SyscallBridgeConfig): SyscallBridge;
  enableAsgiServer(cfg?: AsgiServerConfig): AsgiServer;
  enableTerminal(cfg?: TerminalConfig): Terminal;
  enableWheelCache(cfg: WheelCacheConfig): WheelCache;
  enableDeviceFs(cfg?: DeviceFsConfig): DeviceFs;
  enableInit(cfg?: InitConfig): Init;
  enableJournal(cfg: JournalConfig): MachineJournal;
  /** Python numpy -> GPU 직결(install()로 pyprocGpu 배선). 실 GPU + 창 모드 + numpy 필요. */
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
  /** 부팅 Runtime에 전달하는 실행 자산 SRI manifest. 리플레이 상태 자체에는 포함하지 않는다. */
  assetIntegrity?: PyProcAssetIntegrityManifest;
  engineScriptIntegrity?: string;
  coreIntegrity?: CoreIntegrityMap | CoreIntegrityPolicy;
  coreCacheDir?: FileSystemDirectoryHandle;
}

export interface SessionIo {
  pages: number;
  mb: number;
}

export interface SessionImageOptions {
  /**
   * true 또는 기본값이면 존재하는 /home/web 파일 트리를 .pymachine에 포함한다.
   * false면 힙 델타만 내보낸다. true인데 경로가 없으면 명시적 예외.
   */
  includeHome?: boolean;
  /** 포함할 디스크 루트. 기본 /home/web. */
  homePath?: string;
  /** WebCrypto ECDSA P-256 개인키 또는 CryptoKeyPair. 주면 .pymachine에 signature를 싣는다. */
  signingKey?: CryptoKey | CryptoKeyPair;
  /** signingKey가 개인키 단독일 때 함께 넣을 공개키. CryptoKeyPair를 주면 생략 가능. */
  publicKey?: CryptoKey | JsonWebKey;
}

/**
 * 세션 부활(불멸 커널): 결정적 리플레이 부팅 + 사용자 델타의 OPFS 영속.
 * 같은 매니페스트로 bootSession한 커널은 바이트 동일 힙을 재현하므로,
 * save()가 남긴 델타(수 MB)를 load()로 적용하면 이전 세션의 파이썬 상태가 부활한다.
 */
export function bootSession(manifest?: SessionManifest): Promise<Session>;

/** .pymachine 서명용 WebCrypto ECDSA P-256 키쌍을 만든다. */
export function createMachineKeyPair(): Promise<CryptoKeyPair>;

/** .pymachine 검증용 공개키를 JWK로 내보낸다. */
export function exportMachinePublicKey(key: CryptoKey | CryptoKeyPair | JsonWebKey): Promise<JsonWebKey>;

/** 제품 신뢰 UI와 공개키 배포 manifest에 표시할 안정 fingerprint. 반환 형식: sha256:<hex>. */
export function fingerprintMachinePublicKey(key: CryptoKey | CryptoKeyPair | JsonWebKey): Promise<string>;

/** .pymachine 파일로 같은 컴퓨터를 부팅한다. trust:true 또는 trustedPublicKeys 중 하나가 필요하다. */
export function openMachine(file: Blob, opts?: { trust?: boolean; trustedPublicKey?: CryptoKey | JsonWebKey; trustedPublicKeys?: (CryptoKey | JsonWebKey)[]; requireSignature?: boolean }): Promise<Session>;

export class Session {
  readonly rt: Runtime;
  readonly reactive: ReactiveController;
  /** 이 컴퓨터 전체를 .pymachine 단일 파일(무결성 해시 포함)로 내보낸다. /home/web이 있으면 함께 포함한다. */
  exportImage(opts?: SessionImageOptions): Promise<Blob>;
  /** 사용자 상태(리플레이 경계와의 차이 페이지)만 저장. base는 리플레이가 대체한다. */
  save(dir: FileSystemDirectoryHandle, name: string): Promise<SessionIo>;
  /** 같은 매니페스트·같은 힙 크기 전제(불일치는 명시적 예외). */
  load(dir: FileSystemDirectoryHandle, name: string): Promise<SessionIo>;
}

export interface PyProcMapOptions {
  /** 태스크별 타임아웃(ms). 초과 시 해당 태스크는 {error}로 수렴하고 행 워커는 kill + 스냅샷 respawn. */
  taskTimeoutMs?: number;
}

export interface PyProcShardOptions extends PyProcMapOptions {
  /** 샤딩할 워커 수 상한. 생략하면 준비된 워커 전체를 쓰고, 지정하면 풀 크기/행 수로 clamp된다. */
  parts?: number;
}

export interface PyProcMatmulOptions extends PyProcShardOptions {}

/** 행렬(행 우선 f64). matmul 입출력. data.length === rows*cols. */
export interface Matrix {
  data: Float64Array;
  rows: number;
  cols: number;
}

/**
 * 파이프(SAB 링버퍼): 프로세스 사이의 흐름 IPC. 커널이 만들어 bindReader/bindWriter로
 * 프로세스에 배선하면, 프로세스 안 파이썬은 pyprocIpc.open(name, mode)로 읽고 쓴다(진짜
 * 블로킹 read + backpressure). 커널도 read/write(Atomics.waitAsync)로 한쪽이 될 수 있다.
 */
export interface Pipe {
  readonly kind: "pipe";
  readonly sab: SharedArrayBuffer;
  bindReader(pid: number, name: string): Promise<boolean>;
  bindWriter(pid: number, name: string): Promise<boolean>;
  /** 커널 엔드포인트: 링에 밀어 넣는다(가득이면 소비를 기다린다). 반환: 쓴 바이트. */
  write(bytes: Uint8Array): Promise<number>;
  /** 커널 엔드포인트: 링에서 꺼낸다. 반환: 바이트, 또는 null(EOF = 닫힘 + 소진). */
  read(max?: number): Promise<Uint8Array | null>;
  close(): void;
}

/** 락/세마포어: SAB 카운터 + Atomics. 프로세스 안 파이썬은 pyprocIpc.lock(name)/semaphore(name)로 acquire/release(with 지원). */
export interface Lock {
  readonly kind: "lock" | "semaphore";
  readonly sab: SharedArrayBuffer;
  bind(pid: number, name: string): Promise<boolean>;
}

/** 명명 공유메모리: SAB. 프로세스 안 파이썬은 pyprocIpc.shm(name)로 read(off, n)/write(off, data)(memcpy 1회 계약). */
export interface Shm {
  readonly kind: "shm";
  readonly sab: SharedArrayBuffer;
  /** 커널측 직접 뷰(프로세스와 참조 공유). */
  readonly u8: Uint8Array;
  bind(pid: number, name: string): Promise<boolean>;
}

/** 브라우저 파이썬 프로세스 OS 커널: 스냅샷-fork spawn + map 병렬 + 수명주기(kill/respawn). */
export class PyProc {
  constructor(opts?: PyProcOptions);
  boot(n: number, useSnapshot?: boolean): Promise<PyProcBootInfo>;
  map(fnSrc: string, args: unknown[], opts?: PyProcMapOptions): Promise<unknown[]>;
  /** TypedArray를 조각내 워커들에 numpy 배열로 병렬 적용(샤딩). fnSrc: def _fn(a). 실측 4워커 5.28배. */
  mapArray(fnSrc: string, typed: ArrayBufferView, opts?: PyProcShardOptions): Promise<unknown[]>;
  /**
   * 샤딩 matmul: C = A@B를 A의 행블록으로 워커수만큼 분할해 병렬 계산(compute-bound = near-linear,
   * 실측 4워커 3.67배). numpy 필요(packages:["numpy"]). f64(numpy 기본). 반환 = 결과 행렬.
   * 정직: 이 배속은 compute-bound 커널의 것. memory-bound op(리덕션/값싼 원소별)는 mapArray로,
   * 배속은 modest하고 작은 배열은 전송비로 진다(shardOpsProbe 실측).
   */
  matmul(a: Matrix, b: Matrix, opts?: PyProcMatmulOptions): Promise<Matrix>;
  mapSerial(fnSrc: string, args: unknown[]): Promise<unknown[]>;
  ps(): PyProcEntry[];
  /** 프로세스 강제 종료(SIGKILL 등가). 성공 시 true, 테이블에는 dead로 남는다. */
  kill(pid: number): boolean;
  /**
   * 프로세스 1개를 강제 종료하고 같은 부팅 방식(스냅샷/리플레이 = fork 대칭 유지)으로
   * 새 프로세스를 채운다. 잡 컨트롤의 강제 회수(killHard)가 소비하는 공개 프리미티브.
   * pid가 없으면 PYPROC_PROCESS_UNAVAILABLE.
   */
  respawn(pid: number): Promise<{ oldPid: number; pid: number }>;
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
  /** 특정 프로세스에서 태스크를 실행한다(map은 풀 스케줄, exec는 지정 프로세스). 반환: 태스크 결과. */
  exec(pid: number, fnSrc: string, arg?: unknown): Promise<unknown>;
  /** 파이프 생성(SAB 링버퍼, 기본 1MB). bindReader/bindWriter로 프로세스에 배선. */
  pipe(capacity?: number): Pipe;
  /** 락 생성(상호배제). bind(pid, name)로 프로세스에 배선. */
  lock(): Lock;
  /** 세마포어 생성(초기 카운트). bind(pid, name)로 배선. */
  semaphore(count?: number): Lock;
  /** 명명 공유메모리 생성(byteLength). bind(pid, name)로 배선. */
  shm(byteLength: number): Shm;
  terminate(): void;
}

// ---- 강등 subpath 표면 ----
// 루트 표면은 CI 런타임 게이트가 커버하는 핵으로 유지하고, 게이트가 물리적으로 닿지 못하는
// 표면(GPU = 헤드리스 어댑터 부재, Socket = 외부 릴레이 필수)과 research preview(WASI)는
// 전용 subpath로 소비한다. 시그니처 상세와 경계는 docs/reference/api.md 참조.

declare module "pyproc/gpu" {
/**
 * GPU 잔류 배열 핸들(f32). matmul은 GPU에 남는 새 핸들을 돌려주므로 체이닝에 재업로드가 없다.
 * toArray로 CPU 회수(리드백 1복사). f64 없음(WGSL 한계) = f32만.
 */
export class GpuArray {
  readonly rows: number;
  readonly cols: number;
  /** 이 배열(M x K) @ other(K x N) = 새 잔류 핸들(M x N). 재업로드 0. */
  matmul(other: GpuArray): GpuArray;
  /** 원소별 변환(WGSL 표현식, x = 원소)을 적용한 새 잔류 핸들(같은 shape). 예: map("max(x, 0.0)"). matmul 뒤 활성화 체이닝. */
  map(expr: string): GpuArray;
  /** 이항 원소별(WGSL 표현식, a=이 원소/b=상대 원소): 같은 shape의 다른 잔류 배열과 합친 새 핸들. 예: binary(other, "a + b")(잔차), "a * b"(게이팅). */
  binary(other: GpuArray, expr: string): GpuArray;
  /** 전치: (rows x cols) -> (cols x rows) 새 잔류 핸들. A.T @ B 패턴(x.T @ dy, X.T @ X)을 리드백 없이. */
  transpose(): GpuArray;
  /** 전체 리덕션(sum|max|min): GPU에서 모든 원소를 스칼라로 줄인다(종단, 리드백 1). 잔류 체이닝의 종착(loss/norm). */
  reduce(op: "sum" | "max" | "min"): Promise<number>;
  /** GPU -> CPU 회수. 반환 { data: Float32Array, rows, cols }. */
  toArray(): Promise<{ data: Float32Array; rows: number; cols: number }>;
  destroy(): void;
}

/**
 * Python numpy -> GPU 직결. Runtime.enableGpu()로 얻고 install() 후 파이썬이 pyprocGpu.matmul(a, b)로
 * numpy 배열을 GPU에서 곱한다(블로킹 = JSPI, rt.runAsync 경로). 실 GPU + 창 모드 + numpy 필요.
 * f64는 f32로 강등(WGSL 한계, 정밀도 손실은 계약).
 */
export class GpuBridge {
  install(): Promise<{ installed: string; note: string }>;
  destroy(): void;
}

/**
 * WebGPU 컴퓨트로 f32 대규모 선형대수 가속(수치 성능 도약 Phase 2). numpy 대체가 아니라 좁은
 * 고피크 레인: matmul 실측 ~127배 vs WASM numpy(실 GPU, 타일드 커널). 잔류 핸들(업로드1/체이닝/다운로드1)이
 * 설계의 핵심(arithmetic intensity가 손익분기: 큰 matmul 압승, 작은 배열/값싼 op는 전송비로 짐).
 * f64는 WGSL 근본 부재 = f32만(암묵 강등 금지). WebGPU는 헤드리스에서 어댑터가 안 뜬다 =
 * 창 있는 브라우저 + 하드웨어 GPU 필요(create()가 어댑터 부재 시 실행 가능한 에러).
 */
export class GpuCompute {
  /** WebGPU 디바이스 확보(async). 어댑터 없으면 실행 가능한 에러. */
  static create(): Promise<GpuCompute>;
  /** f32 배열을 GPU에 올린다(잔류 시작). data.length === rows*cols. */
  array(data: Float32Array, rows: number, cols: number): GpuArray;
  destroy(): void;
}
}

declare module "pyproc/socket" {
  import type { Runtime } from "pyproc";
export interface SocketBridgeConfig {
  /** WS->TCP 릴레이 URL(진짜 NIC를 만지는 외부 조각). 예: "ws://127.0.0.1:8791". 소비자 교체 가능. */
  relayURL: string;
}

/**
 * 파이썬 socket을 진짜 아웃바운드 TCP에 배선한다(http + https). socket.socket()/create_connection을
 * 얇은 WS->TCP 릴레이 소켓으로 심해 Python connect/send/recv가 임의 host:port로 진짜 TCP를 연다.
 * urllib/http.client가 같은 socket API라 따라오고, https는 릴레이가 port 443에서 TLS 종단(ssl.wrap_socket
 * 패스스루). 블로킹 recv = JSPI(run_sync)라 rt.runAsync 경로에서 동작. https는 릴레이가 평문을 보므로
 * e2e가 아니다(신뢰하는 릴레이 필요). 인바운드(공개 서버)는 물리 벽(역터널 릴레이). Chromium/Edge 전용.
 */
export class SocketBridge {
  install(): { installed: string[]; relayURL: string; jspi: boolean; note: string };
}
  // 소비: new SocketBridge(rt, cfg) 후 install(). Runtime.enableSocketBridge는 제거됐다(그래프 분리).
}

declare module "pyproc/wasi" {
  import type { PyProcAssetIntegrityManifest } from "pyproc";
export interface WasiManifest {
  /**
   * python.wasm URL(소비자 셀프 호스팅). 미지정 시 기본 brettcannon CPython 3.14.6 릴리즈 zip을
   * 받아 python.wasm + stdlib를 함께 푼다. COOP/COEP 하에선 CORP 때문에 셀프 호스팅 권장.
   */
  wasmURL?: string;
  /**
   * 외부 stdlib 빌드(brettcannon = python.wasm + 별도 lib)의 stdlib zip URL. wasmURL과 함께 준다.
   * 생략하면 wasmURL을 self-contained 빌드(WLR = stdlib baked-in)로 본다.
   */
  stdlibURL?: string;
  /** stdlib 마운트 디렉터리명(기본 "python3.14"). 릴리즈 zip 안 lib/<stdlibDir>/ 경로. */
  stdlibDir?: string;
  /** true면 엔트로피/시간을 고정해 결정적으로 부팅한다(리플레이/시간여행의 전제). */
  deterministic?: boolean;
  /**
   * 부팅 직후 설치할 순수 파이썬 wheel(바이트) 목록. 소비자가 제공한다(pyproc은 PyPI를 fetch하지
   * 않는다 - wasmURL과 같은 계약). 각 wheel은 installWheel로 /site에 풀려 import 가능해진다.
   */
  wheels?: (ArrayBuffer | Uint8Array)[];
  /** WASI worker 생성 전에 wasiWorker graph를 SRI 검증한다. */
  assetIntegrity?: PyProcAssetIntegrityManifest;
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
  /**
   * 순수 파이썬 wheel(바이트)을 라이브 세션에 설치한다(= 브라우저판 pip install). 네이티브로 풀어
   * /site에 파일을 쓰고 import 캐시를 무효화한다. 이후 그 패키지를 import할 수 있다. 순수 파이썬
   * 한정: C 확장(.so)은 WASI 동적 링크 부재로 불가(PEP 783 대기). 반환: 쓴 파일 수 + 최상위 이름들.
   */
  installWheel(wheel: ArrayBuffer | Uint8Array): Promise<{ files: number; names: string[] }>;
  terminate(): void;
}

/** non-Pyodide CPython(WASI) 세션을 부팅한다. Chromium/Edge 전용(SAB + crossOriginIsolated). */
export function bootWasi(manifest?: WasiManifest): Promise<WasiSession>;
}
