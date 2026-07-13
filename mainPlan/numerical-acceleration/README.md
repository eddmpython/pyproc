# numerical-acceleration - 수치 성능 도약 (브라우저 파이썬의 마지막 큰 격차)

상태: **PRD 수립 중 (2026-07-13).** browser-os P1~P7 + engine-independence 사다리가 닫힌 뒤, "핵심 진짜 목표"의 최대 남은 격차인 **수치 연산 속도**를 뚫는 단일 경로. 착수 전 ROI 재검은 [02-phasing](02-phasing-and-wiring.md)이 게이트한다.

## 한 문장

**"돌긴 도는" numpy(로컬 대비 86배 느림)를 "쓸 만한" numpy로 만든다.** 벽은 가용성(패키지 158개 이미 실동)이 아니라 성능이다. SIMD·threads·WebGPU 컴퓨트로 대규모 수치 커널을 로컬에 근접/초월시킨다.

## 문서 지도

1. [00-product-vision.md](00-product-vision.md) - 문제의 정직한 재조준(벽=속도), 접지 실측(SIMD/threads/WebGPU 가용성), 성공·실패 기준. **여기부터.**
2. [01-architecture.md](01-architecture.md) - 가속 레버별 ROI(SIMD/threads/샤딩/WebGPU), 능력 표면 설계, 정직한 손익분기와 벽. (연구 종합 후 확정)
3. [02-phasing-and-wiring.md](02-phasing-and-wiring.md) - phase 분해, 게이트(WebGPU는 실 GPU 수동 검증 = CI 자동 불가라는 제약이 phasing을 지배), 롤백. (연구 종합 후 확정)
4. [03-progress-ledger.md](03-progress-ledger.md) - 결정 원장, 재개 지점(NEXT).

## 접지 요약 (2026-07-13 실측)

- **가용성 해결됨**: Pyodide 배포판에 pyemscripten C확장 휠 158개(numpy/pandas/scipy/sklearn/matplotlib). Pyodide가 dlopen으로 로드 = 이미 실동.
- **벽 = 속도**: numpy 대규모 산술 로컬 대비 86배 느림(WASM 단일스레드·no-SIMD BLAS).
- **레버 가용(이 환경)**: WASM SIMD 지원, WASM threads 전제(SAB) 있음, WebGPU API 존재하나 헤드리스 어댑터 없음(GPU는 실 머신 수동 검증). mapArray 샤딩 이미 4워커 5.28배.
