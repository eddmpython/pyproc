# hardwareVisualOracle - 설치 제품이 실제 GPU 결과를 자동 판정하는가

## 가설

정확히 설치한 `pyproc/gpu`와 공개 Control만으로 hardware WebGPU adapter를 열고, 같은 device에서
compute f32 결과와 렌더된 RGBA8 pixel을 CPU oracle에 대조할 수 있다. 결과는 adapter 종류, 입력과
oracle digest, 오차, 자원 정리를 포함한 versioned receipt로 남고 software fallback은 hardware 증거로
승격하지 않는다.

## 졸업 게이트

- npm tarball을 빈 consumer app에 설치하고 browser import는 `pyproc/gpu` bare specifier만 사용한다.
- `pyproc-control`이 격리된 headed Edge를 열며 공개 manifest의 `gpu` process mode를 사용한다.
- adapter가 hardware임을 정보와 fallback 판정으로 입증하고 compute vector 결과를 CPU 참조와 대조한다.
- 같은 device의 render pipeline이 만든 RGBA8 pixel을 bounded readback으로 회수해 CPU 참조와 대조한다.
- provider, device loss, shader validation, wrong result는 SKIP이 아니라 RED다.
- 성공과 실패 모두 device, buffer, texture, browser target, process와 임시 profile을 정리한다.
- 의도적으로 oracle expected value를 바꾸면 정식 gate가 RED이고 복원 뒤 GREEN이다.
- 설치 제품 gate, 계약, 타입, package와 전체 구조 gate가 GREEN이다.

## 실행

```powershell
$env:PYPROC_BROWSER='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
node tests/attempts/hardwareVisualOracle/hardwareVisualOracleProbe.mjs
```

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-08-15 | hardwareVisualOracleProbe | exact packed `pyproc@0.0.22`, 공개 Control, headed Edge 151, AMD RDNA 3 | vector `[5,2,5,1]` max error 0, RGBA8 `[64,128,191,255]` max error 0 | RED. hardware compute와 render readback은 정확했지만 설치 `pyproc/gpu`에는 `createWebGpuHostAdapter`가 없었다. 기존 수동 probe는 삭제된 root export를 import하고 shader digest는 어느 gate에서도 읽지 않았다 | closed WebGPU host adapter와 versioned oracle을 기존 `pyproc/gpu` subpath에 승격한다 |
| 2026-08-15 | hardwareVisualOracleProduct | 같은 packed install, 공개 `pyproc/gpu`, `pyproc/wasi`, Control, headed Edge 151, AMD RDNA 3 | nonfallback hardware, compute와 pixel 오차 0, hostcall 2회, terminal PNG 922 x 920 | GREEN. registered operation, result digest, hardware identity, request scope와 cleanup이 한 version 1 receipt와 제품 gate에 묶였다 | 첫 GREEN 커밋 뒤 attempt와 계약 실태 gap을 삭제한다 |

## 승격 설계

표준 WebGPU device provider는 `src/capabilities/`에 두고 WGSL과 wire oracle 상수는 더 낮은
`src/runtime/`에 둔다. 기존 Experimental `pyproc/gpu` subpath만 사용하며 root export와 새 subpath는
추가하지 않는다. hardware 제품 runner는 installed public specifier와 `ProductHostCapabilityPort`를 지나
compute와 pixel byte를 검증한다.

## 판정

졸업 준비 완료. expected pixel 첫 channel을 64에서 67로 바꾼 음성 변형은
`PYPROC_GPU_RESULT_MISMATCH`, `stage: pixel`, `maxChannelError: 3`으로 RED였고 복원한 같은 계약은
GREEN이다. 설치 제품 gate는 AMD RDNA 3, `isFallbackAdapter: false`, compute와 pixel digest 일치,
오차 0, request 2회와 adapter close를 확인했다. terminal screenshot SHA-256은
`ba2933ed74bfb66e8304c4cf32deb77b331d638b0427cb8be752c94451d8043a`다.
