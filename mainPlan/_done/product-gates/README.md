# product-gates - 제품 선언의 관문

> ✅ 완료 (2026-07-17): CI 실검증 확립, Stable 승격 체계, 공개 표면 2개(영문 비교 페이지,
> MCP 에이전트 레시피)를 구현하고 전 게이트 GREEN으로 닫았다. v0.0.10 릴리즈는 구현
> 항목이 아니라 명시 지시 이벤트이므로 원장의 재개 지점으로 남긴다.

상태: 완료.

core-surface-hardening 완결 직후의 판정은 "제품급으로 만들어진 라이브러리"였다.
이 이니셔티브는 제품 선언에 필요한 나머지 관문을 닫았다.

## 관문과 결과

1. **push + CI 확인** - 완료. 로컬 브레이킹 묶음을 origin/main에 반영하고, CI 실검증이
   적발한 회귀 4건(workspace 링크 부재, GNU tar의 가짜 zip, 강등 표면 잔존 import,
   공유 러너 speedup 물리 한계)을 수리해 structure/browser/web-computer 전 job GREEN.
   wasiGate가 SKIP green이 아니라 실자산으로 도는 최초 상태에 도달했다.
2. **Stable 승격 체계** - 완료. 승격 기준과 원장을 capabilityMatrix에 명문화하고
   구조 게이트가 원장 밖 Stable 라벨을 차단한다.
3. **공개 표면 2개** - 완료. 영문 비교 페이지(artifact 링크가 셀 값, N/A는 사유 동반),
   MCP 에이전트 레시피(도구 4종 + CI 게이트).

릴리즈 v0.0.10: 준비물(CHANGELOG Unreleased, 절차, publish.yml OIDC 관문)은 완비.
릴리즈 규칙상 명시 지시 이벤트라 이 이니셔티브의 완료 조건이 될 수 없다.
상세는 [01-progress-ledger.md](01-progress-ledger.md).

## 문서 지도

- [00-plan.md](00-plan.md) - 관문별 영향 파일, 구현 설계, 게이트, 롤백.
- [01-progress-ledger.md](01-progress-ledger.md) - 결정 원장과 재개 지점.

## 완료 조건

1. origin/main의 CI가 신설 job 포함 GREEN이다. [통과]
2. capabilityMatrix에 승격 기준 절이 있고 게이트가 기준-라벨 정합을 검사한다. [통과]
3. 영문 비교 페이지가 존재하고 README에서 링크되며, 수치/N-A 주장 전부가 tracked
   artifact를 가리킨다(게이트로 앵커 강제). [통과]
4. MCP 레시피가 실행 가능하고, Node 게이트가 MCP 왕복을 실검증하며 CI에 배선된다. [통과]
