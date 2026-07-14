# docs - 운영 문서 트리

pyproc의 공개 지속 문서. "무엇을 지향하는가"(product)와 "어떻게 운영하는가"(operations/consuming)의 SSOT다. 그때그때의 개발 계획·결정 기록은 [mainPlan/](../mainPlan/)이 담당하고(완료 시 `_done` 이관), 강행규칙 요약은 저장소 루트의 `CLAUDE.md`(로컬 규칙 문서, git 미추적)에 있다.

## 카테고리 규칙

- 카테고리 폴더는 **실제 문서가 생길 때만** 만든다. 빈 폴더나 "나중을 위한" 카테고리 금지.
- 문서 파일명은 저장소 규칙대로 `camelCase.md`.
- 문서가 코드·규칙과 어긋나면 같은 변경에서 문서를 갱신한다.

## 지도

| 카테고리 | 문서 | 무엇 |
|---|---|---|
| [product/](product/) | [vision.md](product/vision.md) | 제품 방향: North Star, 무엇인가/아닌가, 성공·실패 기준, 지원 경계 |
| [operations/](operations/) | [operatingModel.md](operations/operatingModel.md) | 운영 모델: 3층 정보 구조, 아이디어 수명주기(attempts -> mainPlan -> src -> _done), 메모리 운영, 개발 원칙 |
| | [contractReality.md](operations/contractReality.md) | 계약 실태: 계약 vs 실제 간극의 상시 추적(발견 즉시 기록, 해소 시 삭제). 열린 부채·상시 재검증·트레이드오프·프론티어 |
| | [testing.md](operations/testing.md) | 테스트 게이트(`npm test`)와 브라우저 실측 절차(COOP/COEP 서버) |
| | [benchmarking.md](operations/benchmarking.md) | 속도 주장과 외부 비교 표의 측정 계약, canonical scenario, raw evidence 규칙 |
| | [release.md](operations/release.md) | 버전·태그·릴리즈 절차(`0.0.x` 라인, SHA 핀 소비) |
| | [demoHosting.md](operations/demoHosting.md) | 라이브 데모 배포 절차(COOP/COEP 정적 호스팅, 루트 `_headers`) |
| [consuming/](consuming/) | [contract.md](consuming/contract.md) | 소비 계약: 공개 표면, SHA 핀, 소비자별 배선 상태, Pyodide 버전 정합 |
| | [resumeCatalog.md](consuming/resumeCatalog.md) | 부활 후 `resume.py`가 제품별로 다시 열어야 하는 fd/socket/DB connection 정책 |
| | [trustPermissions.md](consuming/trustPermissions.md) | `.pymachine` 공개키 배포, signer fingerprint, 권한 UI 계약 |

## 빠른 라우팅 (영역 -> 문서)

- pyproc이 무엇이고 어디로 가나 -> [product/vision.md](product/vision.md)
- 새 아이디어를 어디서 시작하나 -> [tests/attempts/README.md](../tests/attempts/README.md)
- 설계·로드맵·결정 기록 -> [mainPlan/](../mainPlan/README.md) (완결 이니셔티브는 [_done/](../mainPlan/_done/README.md), 활성 0이면 새 이니셔티브 개설부터)
- 커밋 전 무엇이 green이어야 하나 -> [operations/testing.md](operations/testing.md)
- 속도 숫자와 외부 비교 표를 어떻게 기록하나 -> [operations/benchmarking.md](operations/benchmarking.md)
- 버전을 언제 어떻게 올리나 -> [operations/release.md](operations/release.md)
- 제품에서 pyproc을 가져다 쓰는 법 -> [consuming/contract.md](consuming/contract.md)
- 부활 후 제품 자원 재개설 정책 -> [consuming/resumeCatalog.md](consuming/resumeCatalog.md)
- 공개키 배포와 권한 UI 정책 -> [consuming/trustPermissions.md](consuming/trustPermissions.md)
- 외부 기여 -> [CONTRIBUTING.md](../CONTRIBUTING.md)
