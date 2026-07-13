# mainPlan/_done - 완료·폐기 이니셔티브 보관소

- 완료되거나 폐기된 이니셔티브는 **폴더째** `mainPlan/_done/<name>/`으로 옮긴다. 파일명에 프리픽스를 붙이지 않는다(경로 참조·문서 내부 상호참조가 깨진다).
- 옮긴 폴더의 README 상단에 완료(✅)/폐기(🚫)/흡수(🔀) 배너 + 날짜(YYYY-MM-DD) + 한 줄 요약을 남긴다.
- 삭제하지 않는다. 설계 근거와 완료 기록은 계속 참조된다.
- 옮긴 뒤 다른 문서의 참조 경로를 새 위치로 갱신한다.

## 보관 목록

| 폴더 | 상태 | 한 줄 |
|---|---|---|
| [web-python-runtime/](web-python-runtime/) | ✅ 완료 (2026-07-13) | 코어 런타임 + 운영 체계 + 소비 성립. 진행 원장이 세션 간 마지막 상태 기록. 계약 실태 표는 docs로 승격. |
| [local-parity/](local-parity/) | ✅ 완료 (2026-07-13) | 실행·프로세스·시스템콜·세션·터미널·라이브러리 축 v1 도달 + 네 가지 상태 지도. 지속 프레임은 docs/product/vision.md로 승격. |
| [browser-os/](browser-os/) | ✅ 완료 (2026-07-13) | 파이썬 머신 5기둥 + 근본 프리미티브 P1~P7 실증·승격 + 객관 판정. 안티 추천은 vision.md, 가상 오리진 벽은 contract.md로 승격. |
| [engine-independence/](engine-independence/) | ✅ 완료 (2026-07-13) | P1 seam + non-Pyodide 완전 실증 + 3.14.6 이전 + engine-watch + P0 자가 호스팅 + P2 스냅샷 벽 실측. P4 조건부 보험만 미발동. |
