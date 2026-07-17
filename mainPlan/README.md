# mainPlan - 장기 기획설계 운영 트리

> dartlab/codaro의 mainPlan 운영방침을 차용한다. pyproc의 큰 방향 설계는 이 트리에서
> 이니셔티브 단위 폴더로 관리하고, 코드 착수 전 설계의 SSOT가 된다.

## 운영 규칙

1. **이니셔티브 = 폴더 하나.** `mainPlan/<kebab-name>/` 아래 번호 문서(`00-...md`부터)와 `README.md`(인덱스)를 둔다.
2. **문서 구성 관례** (필요한 것만, 순서 고정 아님):
   - `00-product-vision.md` - 무엇을, 누구를 위해, 왜. 기각 근거와 성공/실패 기준.
   - `01-architecture.md` - 레이어, 능력, 발명 계보, 실측.
   - `02-phasing-and-wiring.md` - phase 분해, 소비 배선, 게이트, 롤백.
   - `03-progress-ledger.md` - 결정 원장. 세션 간 재개 지점(NEXT)을 항상 최신으로.
3. **비전과 구현이 충돌하면 phasing 문서의 게이트가 우선한다.**
4. **완료·폐기된 이니셔티브는 폴더째 `mainPlan/_done/<name>/`으로 격리한다.** 삭제하지 않는다(설계 근거·완료 기록은 계속 참조된다). 옮긴 폴더 README 상단에 완료/폐기 배너와 한 줄 요약을 남긴다.
5. **자기충족성이 합격 기준이다.** 플랜 본문만 보고 재조사 없이 구현 가능해야 한다. 영향 파일/심볼, 소비 배선, 롤백을 placeholder 없이 채운다.
6. 이 트리는 저장소 규칙(camelCase 파일명)의 예외다. dartlab 관례(kebab-case + 번호 프리픽스)를 따른다.
7. mainPlan은 git 추적(공개 설계)이지만 npm `files`에는 넣지 않는다(소비 패키지에 안 실림).

## 활성 이니셔티브

- [boundary-radius](boundary-radius/README.md) - 경계의 동일성 반경을 측정하고, 그 반경이 닿는 데까지만 주장한다. 논지가 "상태 = 다시부팅 + 델타"인데 뺄셈이 성립하는 반경이 워커 하나로만 실측돼 있다. 재개 지점은 [01-progress-ledger.md](boundary-radius/01-progress-ledger.md) 마지막 줄.
- [asset-provenance](asset-provenance/README.md) - 증거 없음이 통과로 새지 않게 한다. 제품 쪽 봉인이 장식이고(거짓 license로도 게이트 통과) 봉인이 걸린 쪽은 CI가 안 도는 fixture다. 재개 지점은 [01-progress-ledger.md](asset-provenance/01-progress-ledger.md) 마지막 줄.

완결 이니셔티브 14개는 [_done/](_done/README.md)으로 이관됐다. 최신 완료 기록은 speculative-fleet이며, 세션 간 마지막 상태는 각 `_done/<이니셔티브>/03-progress-ledger.md` 또는 README에서 확인한다.
