# 소비 계약 - 제품이 pyproc을 가져다 쓰는 법

pyproc은 "참조"가 아니라 **실제 import**로만 SSOT가 된다. 이 문서가 소비자(codaro/dartlab/xlpod와 외부 사용자)와의 계약이다.

## 설치 (SHA 핀)

```jsonc
// package.json
"dependencies": {
  "pyproc": "github:eddmpython/pyproc#<commit-sha>"
}
```

- **커밋 SHA를 핀한다.** 플로팅(main 추종) 금지. 올릴 때는 의도적으로 되핀. (npm 레지스트리 퍼블리시는 준비 중. 퍼블리시 후에도 제품 소비의 표준은 SHA 핀이다.)
- 빌드 단계가 없다(네이티브 ESM). 번들러 없이 `<script type="module">`에서도 동작한다.
- **CDN 직접 import**(설치 0): `https://cdn.jsdelivr.net/gh/eddmpython/pyproc@<commit-sha>/index.js`. 단, 단일 런타임 경로만 지원한다. `PyProc`(프로세스 OS)는 워커 파일이 페이지와 same-origin이어야 하므로(브라우저의 cross-origin worker 차단) npm 설치나 벤더링이 필요하다.

## 공개 표면 (이것만 의존한다)

| export | 무엇 |
| --- | --- |
| `boot(opts)` | Pyodide 런타임 부팅, `Runtime` 반환 |
| `Runtime` | `run` / `runAsync` / `install` / `loadPackages` + 능력 등록 |
| `MemoryCapability` | WASM 힙 접근을 캡슐화한 능력 계약 |
| `ReactiveController` | 복원 기반 리액티브(체크포인트 / 시간여행) |
| `SyscallBridge` | 빌린 시스템콜 v1: input(동기/JSPI 블로킹), urllib(동기 XHR, proxyUrl), subprocess(자식 워커) |
| `AsgiServer` | 커널 안 ASGI 서버(소켓 0 dispatch) |
| `Terminal` | 서버리스 터미널(REPL) |
| `bootSession`/`Session` | 세션 부활: 결정적 리플레이 부팅 + 사용자 델타 OPFS 영속(같은 매니페스트 전제) |
| `PyProc` | 프로세스 OS 커널(스냅샷-fork spawn + `map` 병렬) |
| `PAGE_SIZE` | WASM 페이지 크기 상수(65536) |

subpath export: `pyproc/runtime`, `pyproc/reactive`, `pyproc/syscall-bridge`, `pyproc/process-os`, `pyproc/worker`. **src 내부 경로 deep import 금지** (내부 파일 배치는 릴리즈 간 바뀔 수 있다. 실제로 v0.0.3에서 레이어 폴더로 재배치됐고 subpath 이름은 불변이었다).

- 타입은 동봉된 `index.d.ts`가 계약이다.
- 엔진 내부(`HEAPU8`, `Runtime.raw` 등)를 직접 만지지 않는다. `raw`는 탈출구이고 계약 밖이다.
- **restoreLive 실행 경계 계약(기계 강제)**: 경계를 지키면 즉시 복원(재해싱 0), 위반은 자동 감지되어 재해시 경로로 승격된다(조용한 오염 없음). 반환값 `rehashed`로 경로 확인. 즉시성이 필요하면 복원 전 `checkpoint()`로 경계를 닫아라.

## 방향과 경계

- 의존은 **products -> pyproc 단방향**. pyproc은 어떤 소비 제품도 import하지 않는다.
- 제품 UI/도메인 로직은 pyproc에 넣지 않는다. pyproc은 런타임/능력만 제공한다.
- 지원: Chromium/Edge 전용(JSPI + SharedArrayBuffer + crossOriginIsolated). 페이지에 COOP/COEP 헤더 필요.

## 런타임 정합 (하드 제약)

- 기본 Pyodide: **v314.0.2 (CPython 3.14)**, CDN 로드. 소비 제품이 자체 Pyodide 코드를 병행하는 동안(xlpod)에는 같은 버전을 유지해야 이관이 성립한다.
- 번들러 계약: `moduleResolution: "Bundler"` + `allowJs: false`에서 타입 해석, Vite가 `new Worker(new URL(...))`를 워커 청크로 emit(codaro에서 3단계 검증 완료).

## 소비자별 배선 상태

| 소비자 | 상태 |
|---|---|
| codaro | first consumer. SHA 핀 + `browserPythonRuntime.ts` seam 완료, UI 배선 예정 |
| xlpod | 자체 Pyodide 워커 운용 중. pyproc이 동기 UDF 요구를 흡수하면 이관(로드맵 syncUdfBridge) |
| dartlab | 미착수(점진 이관 대상) |

배선 로드맵 상세: [mainPlan/web-python-runtime/02-phasing-and-wiring.md](../../mainPlan/web-python-runtime/02-phasing-and-wiring.md)
