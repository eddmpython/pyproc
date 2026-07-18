// assets.d.ts - pyproc/assets subpath 타입 계약(자기 .js 옆 배치 규칙).
// 소비 제품이 같은 오리진에 배포할 실행 자산의 manifest/SRI/Service Worker 계약.

export const PYPROC_ASSET_MANIFEST_VERSION: 1;

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
