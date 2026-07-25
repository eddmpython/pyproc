# 03. 진행 원장

## 2026-07-26

- 사용자 우선순위 6개를 단일 안정화 이니셔티브로 개설.
- 기존 미커밋 `toHostValue`와 asset 다중 source 변경을 입력으로 흡수.
- 공개 계약, EngineContract, RuntimeContract, reactive budget, Buildroot recipe, Experimental 동결을 배선.
- Runtime capability 조립을 state/service/environment cluster로 분리하고 중앙 직접 결합을 차단.
- contract suite 자동 발견, 공통 async-safe runner, 브라우저 HTML/실행 모듈 분리를 완료.
- reactive retention 정책과 실행 메커니즘을 분리하고 EngineContract conformance helper를 추가.
- Buildroot Linux 재현 workflow와 artifact 보존 경로를 추가.
- contract 5 suites, Node 구조, 타입, package, 브라우저 core, 제품 consumer, Web Computer gate green.
- Web Computer는 제품 consumer와 로컬 병렬 실행 시 owner wait timeout이 1회 발생했고 단독 재실행은 green. CI는 별도 job 격리를 유지한다.
- NEXT: Buildroot Linux workflow artifact의 hash/provenance를 development catalog에 승격.
