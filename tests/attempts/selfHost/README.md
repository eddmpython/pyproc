# selfHost - 이 OS 위에서 서버와 웹을 "개발"할 수 있는가

## 가설

pyproc은 코드를 실행하는 러너가 아니라 그 위에서 소프트웨어를 개발하는 플랫폼이다.
멀티파일 프로젝트 작성 -> 프레임워크 설치 -> 서버 기동 -> 웹 페이지/JSON API 응답 -> DB 영속 ->
재부팅 생존 -> 코드 수정 즉시 반영. 이 전 과정이 브라우저 탭 하나 안에서 성립하면
"OS 위에서 서버도 웹도 개발 가능"이 구호가 아니라 실측이 된다.

기반은 전부 이미 승격된 공개 표면의 조합이다: `mountHome`(영속 디스크) + `install`(micropip) +
`AsgiServer`(소켓 0 dispatch) + sqlite3(stdlib). 진짜 URL 배선은 runtimeParity/swOriginProbe가
이미 GREEN이므로 여기서는 중복 실측하지 않는다(조합 = swOrigin + 이 probe).

## 졸업 게이트

- 풀스택 왕복: FastAPI(또는 starlette) GET/POST가 sqlite에 닿고 반복 GET p50 <= 20ms
- 서빙된 HTML이 API를 부르는 웹 프론트 포함(페이지도 파이썬 서버가 만든다) = pass/fail
- 재부팅 생존: 새 커널 + 같은 디스크에서 코드/DB가 살아나 앱이 다시 서고 데이터가 남는다 = pass/fail
- dev loop: 파일 수정 -> reload -> 바뀐 응답 <= 1500ms
- 신규 프리미티브 필요 여부를 기록한다. 0이면 판정은 "src 추가 승격 없음"(기존 표면의 증명)이고,
  부족분이 나오면 그 항목이 다음 승격 후보다.

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 다음 |
|---|---|---|---|---|---|
| 2026-07-12 | fullStackProbe | Edge headless, 로컬 COOP+COEP | GREEN 8/8. FastAPI 설치 916ms, GET p50 2.1ms, 재부팅->재서빙 3435ms, dev loop 7ms | 가설 입증. 신규 프리미티브 0(기존 표면 조합). 패키지 환경은 커널에 살므로 재부팅 시 재설치가 정직한 계약(uv 레인 캐시로 상쇄) | examples 데모 승격 검토(swOrigin 조합 = 주소창 URL 웹앱) |

## 판정

진행 중 (1번 질문 졸업: src 추가 승격 없음, 기존 표면의 증명. 남은 질문: 보이는 데모화, 정적 자산 서빙, 저널과의 결합)
