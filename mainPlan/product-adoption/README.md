# product-adoption - 제품 선언의 관문 4개

상태: 활성 (2026-07-16 개설)

core-surface-hardening이 끝난 시점의 정직한 판정은 "제품급으로 만들어진 라이브러리,
그러나 아직 제품 아님"이었다. 남은 관문은 기술이 아니라 배포와 채택이다. 이 이니셔티브는
그 관문 4개를 닫는다.

## 관문

1. **push + CI 확인**: 로컬에 쌓인 브레이킹 묶음을 origin/main에 반영하고, 신설 CI
   (wasiGate 실검증, Web Computer E2E job)가 러너에서 실제로 도는지 확인·수리한다.
2. **릴리즈 v0.0.10 + 소비 3사 재핀**: 버전 +1과 태그를 같은 커밋에, GitHub Release는
   영문 우선 노트로, npm 게시는 publish.yml(OIDC) 자동 경로로. 게시 확인 뒤 형제 레포
   (codaro/dartlab/xlpod)의 정확 버전 핀을 0.0.10으로 올린다.
3. **Stable 승격 체계**: 상태 라벨이 인상이 아니라 기준으로 움직이도록 승격 기준을
   capabilityMatrix에 명문화하고, 간판 레인(reactive/session/journal)의 승격 시계를
   이번 릴리즈에서 시작한다. 라벨 조작이 기준 문서 없이 일어나지 않게 게이트로 잠근다.
4. **채택 표면 2개**: (a) 영문 비교 페이지(경쟁 N/A 실측을 한국어 운영 문서에서 꺼내
   공개 영문 문서로), (b) 에이전트 통합 레시피(pyproc 샌드박스를 MCP stdio 서버로
   노출하는 실행 가능한 예제 + 게이트).

## 문서 지도

- [00-plan.md](00-plan.md) - 관문별 영향 파일, 구현 설계, 게이트, 롤백.
- [01-progress-ledger.md](01-progress-ledger.md) - 결정 원장과 NEXT.

## 완료 조건

1. origin/main의 CI가 신설 job 포함 GREEN이다(실패 시 forward patch까지).
2. npm에 0.0.10이 게시되고(`npm view pyproc version`) GitHub Release가 영문 우선
   노트로 발행되며, 소비 3사의 핀이 0.0.10으로 올라간다(각 레포 최소 해석 검증).
3. capabilityMatrix에 승격 기준 절이 있고 게이트가 기준-라벨 정합을 검사한다.
4. 영문 비교 페이지가 존재하고 README에서 링크되며, 수치/N-A 주장 전부가 tracked
   artifact를 가리킨다(게이트로 앵커 강제).
5. MCP 레시피가 실행 가능하고(도구 4종: run/checkpoint/restore/reset), Node 게이트가
   MCP 왕복(initialize -> tools/list -> tools/call)을 실검증하며 CI에 배선된다.
