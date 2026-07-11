# docs - 운영 문서 트리

pyproc의 공개 운영 문서. "어떻게 운영하는가"의 SSOT다. 제품 방향·설계는 [mainPlan/](../mainPlan/)이, 강행규칙 요약은 [CLAUDE.md](../CLAUDE.md)가 담당한다.

## 카테고리 규칙

- 카테고리 폴더는 **실제 문서가 생길 때만** 만든다. 빈 폴더나 "나중을 위한" 카테고리 금지.
- 문서 파일명은 저장소 규칙대로 `camelCase.md`.
- 문서가 코드·규칙과 어긋나면 같은 변경에서 문서를 갱신한다.

## 지도

| 카테고리 | 문서 | 무엇 |
|---|---|---|
| [operations/](operations/) | [operatingModel.md](operations/operatingModel.md) | 운영 모델: 3층 정보 구조, 아이디어 수명주기(attempts -> mainPlan -> src -> _done), 메모리 운영, 개발 원칙 |
| | [testing.md](operations/testing.md) | 테스트 게이트(`npm test`)와 브라우저 실측 절차(COOP/COEP 서버) |
| | [release.md](operations/release.md) | 버전·태그·릴리즈 절차(`0.0.x` 라인, SHA 핀 소비) |
| [consuming/](consuming/) | [contract.md](consuming/contract.md) | 소비 계약: 공개 표면, SHA 핀, 소비자별 배선 상태, Pyodide 버전 정합 |

## 빠른 라우팅 (영역 -> 문서)

- 새 아이디어를 어디서 시작하나 -> [tests/attempts/README.md](../tests/attempts/README.md)
- 설계·로드맵·결정 기록 -> [mainPlan/web-python-runtime/](../mainPlan/web-python-runtime/)
- 커밋 전 무엇이 green이어야 하나 -> [operations/testing.md](operations/testing.md)
- 버전을 언제 어떻게 올리나 -> [operations/release.md](operations/release.md)
- 제품에서 pyproc을 가져다 쓰는 법 -> [consuming/contract.md](consuming/contract.md)
- 외부 기여 -> [CONTRIBUTING.md](../CONTRIBUTING.md)
