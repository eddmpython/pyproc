# mainPlan/_done - 완료·폐기 이니셔티브 보관소

- 완료되거나 폐기된 이니셔티브는 **폴더째** `mainPlan/_done/<name>/`으로 옮긴다. 파일명에 프리픽스를 붙이지 않는다(경로 참조·문서 내부 상호참조가 깨진다).
- 옮긴 폴더의 README 상단에 완료(✅)/폐기(🚫)/흡수(🔀) 배너 + 날짜(YYYY-MM-DD) + 한 줄 요약을 남긴다.
- 삭제하지 않는다. 설계 근거와 완료 기록은 계속 참조된다.
- 옮긴 뒤 다른 문서의 참조 경로를 새 위치로 갱신한다.

## 보관 목록

| 폴더 | 상태 | 한 줄 |
|---|---|---|
| [state-kernel/](state-kernel/) | ✅ 완료 (2026-07-18) | 이중 구역 상태 커널(src/state: 휘발 index + 내구 CAS 리포, 승격 관문 collectDelta 한 점)로 저널·세션 봉투·서명을 재기초하고, 공개 표면을 porcelain 머신 핸들(루트 37 -> 6, open 통합, pyproc/history 신설)로 일격 재편. 게이트 전판 GREEN + 음성 시험 7건. 잔여 후속 4건은 원장 말미. |
| [boundary-radius/](boundary-radius/) | 🚫 폐기 (2026-07-17) | 경계 동일성 반경 측정 장치. 답을 저장소가 이미 갖고 있었다(worker.js: 메인과 워커는 바이트가 다르다). 기기 축 재확인(184p/480p 상이, 내용은 같고 주소가 다름)만 남기고 폐기. 선행조사 대조 표는 재발 방지 장치로 존속. |
| [structure-evolution/](structure-evolution/) | ✅ 완료 (2026-07-17) | 의존 방향을 트리에 새긴다: 합성 루트를 제자리로 옮겨 폴더 순환 1 -> 0, 규칙과 집행을 레이어 순위 한 문장으로, 중복 12벌과 worker 프로토콜 결함 1건 수렴. 공개 계약 무변경. |
| [speculative-fleet/](speculative-fleet/) | ✅ 완료 (2026-07-17) | 투기적 탐색 프리미티브 `forkMany` 승격: 부모 델타를 한 번만 수확해 N 레인에 SAB 방송(4.05배), 그 위 4-후보 병렬 탐색 5.2배. fork는 1:1 위임. |
| [product-gates/](product-gates/) | ✅ 완료 (2026-07-17) | CI 실검증 확립(wasiGate 실자산 전환, 회귀 4건 수리), Stable 승격 체계와 게이트, 영문 비교 페이지, MCP 에이전트 레시피. v0.0.10 릴리즈는 명시 지시 이벤트로 원장에 재개 지점 기록. |
| [core-surface-hardening/](core-surface-hardening/) | ✅ 완료 (2026-07-16) | 핵(결정적 리플레이 + 페이지 델타)의 soundness 수리, PyProcError 단일 오류 계약, heapDelta 단일 보관소, processOs 수리, 표면 압축(강등/삭제/절삭 + README 얼굴), 영문 api.md/CHANGELOG/SECURITY와 성능 예산·CI 실검증까지 완결. |
| [web-machine-hardening/](web-machine-hardening/) | ✅ 완료 (2026-07-16) | 단일 owner-fenced MachineStore, 원자적 context 교체, HEAD/PREV 보존 retention, OperationControl 취소 경계, 제품 runtime 책임 분리를 구조/contract/probe/제품 E2E 게이트로 완결. |
| [web-computer-product/](web-computer-product/) | ✅ 완료 (2026-07-16) | Python OS와 Linux의 제품 UI, 단일 owner, durable dual-guest Save, signed `.webmachine` export와 fresh-profile import를 실제 제품 E2E로 완결. |
| [web-machine-platform/](web-machine-platform/) | ✅ 완료 (2026-07-16) | pyproc과 Linux 공통 lifecycle·장치·durable generation·단일 owner·signed `.webmachine`을 실증하고 네 독립 private package와 정식 검증 트리로 승격. |
| [browser-os-north-star/](browser-os-north-star/) | ✅ 완료 (2026-07-16) | 512MB 성능 봉투, signed machine image, 대표 데모 3종, 호환성 지도, 제품 소비, Immortal Python Machine으로 첫 Python guest OS 성숙 트랙 완결. |
| [web-python-runtime/](web-python-runtime/) | ✅ 완료 (2026-07-13) | 코어 런타임 + 운영 체계 + 소비 성립. 진행 원장이 세션 간 마지막 상태 기록. 계약 실태 표는 docs로 승격. |
| [local-parity/](local-parity/) | ✅ 완료 (2026-07-13) | 실행·프로세스·시스템콜·세션·터미널·라이브러리 축 v1 도달 + 네 가지 상태 지도. 지속 프레임은 docs/product/vision.md로 승격. |
| [browser-os/](browser-os/) | ✅ 완료 (2026-07-13) | 파이썬 머신 5기둥 + 근본 프리미티브 P1~P7 실증·승격 + 객관 판정. 안티 추천은 vision.md, 가상 오리진 벽은 contract.md로 승격. |
| [engine-independence/](engine-independence/) | ✅ 완료 (2026-07-13) | P1 seam + non-Pyodide 완전 실증 + 3.14.6 이전 + engine-watch + P0 자가 호스팅 + P2 스냅샷 벽 실측. P4 조건부 보험만 미발동. |
| [numerical-acceleration/](numerical-acceleration/) | ✅ 완료 (2026-07-13, v0.0.7) | numpy 86배를 CPU 샤딩(PyProc.matmul 2.48배) + WebGPU 잔류 핸들(GpuCompute 실 GPU 109배, Python numpy 직결 92배)로. 커널 최적화 등은 코어 밖 후속. |
| [engine-agnostic-surface/](engine-agnostic-surface/) | ✅ 완료 (2026-07-13, v0.0.9) | 소비자가 raw를 버리게 하는 엔진-무관 능력 3건(Runtime.fs, loadPackagesFromImports, setStdout/setStderr). 실 브라우저 fs 10/10 + output 5/5 + imports 3/3. P4(dartlab raw 교체)는 소비자 측. |
