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

| 폴더 | 상태 | 한 줄 |
|---|---|---|
| [browser-control/](browser-control/README.md) | Phase 0 (실측 절반 GREEN) | MV3 확장 안에 프로세스 OS를 들여 파이썬이 서버·홉 0으로 브라우저를 운전. attempts 3게이트 GREEN, 스텔스 수동 실측이 착수 게이트. |
| [engine-agnostic-surface/](engine-agnostic-surface/README.md) | Phase 1 (접지) | dartlab이 raw를 버리게 하는 엔진-무관 능력 3건(loadPackagesFromImports, Runtime.fs, setStdout/setStderr). 첫 실 소비자가 engine-independence를 실증. |

완결 이니셔티브 5개(web-python-runtime, local-parity, browser-os, engine-independence, numerical-acceleration)는 [_done/](_done/README.md)으로 이관됐다. 세션 간 마지막 상태 기록은 각 `_done/<이니셔티브>/03-progress-ledger.md` 또는 README다.
