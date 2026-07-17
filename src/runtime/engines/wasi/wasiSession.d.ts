// wasiSession.d.ts - pyproc/wasi subpath의 타입 계약(위치 근거는 gpuCompute.d.ts와 같다).

  import type { PyProcAssetIntegrityManifest } from "../../../../index.js";
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
