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
- 첫 Buildroot workflow는 partial Git checkout 뒤 barebox package macro 평가에서 실패.
- 입력을 공식 release tarball SHA-256 고정으로 교체하고 clean source/output 재현 및 최소 artifact 보존으로 수리.

## 2026-07-26 (2차): 5표면 감사 착수

- 전문 심사관 5명(DX / 아키텍처 / 검증 / 웹컴퓨터 / 문서)에게 저장소 실물 대조를 맡겼다.
  점수와 지적, 실행 판정, 거부한 권고는 [04-audit-and-hardening.md](04-audit-and-hardening.md)가 정본.
- 착수 시점에 구조 게이트가 RED였다. Buildroot 계약 검사가 `upload-artifact@v4` 문자열을
  요구했고 workflow는 v7로 갱신돼 있었다. action major는 갱신되는 값이므로 계약이 아니다:
  검사를 "artifact 보존 배선 존재 + recipe 출력 이름과 workflow cmp 대상 일치"로 바꿨다.

## 2026-07-27: 경화 1~3파(게이트 무결성 -> 공개 표면 -> 정확성 사본)

- **커밋 메시지 규칙을 기계화**했다(사용자 우선순위 3). 판정 정본 `scripts/commitMessage.mjs`,
  집행은 `.githooks/commit-msg`, 이빨 증명은 `tests/run.mjs` `[커밋 규칙]` 절의 양성 2 + 음성 14.
  제목 형식·본문 필수·검증 줄 필수를 코드 있는 위반으로 판정한다. 첫 적용에서 규칙 자신이
  저장소 관례(`CI:` 분류)를 막아 한글 요건을 제목 단위로 좁혔다(과잉 규칙도 위반이다).
- **게이트 층 하한**을 신설했다. 이 층이 없을 때 `[election 프로토콜]` 절 전체를 지워도 GREEN,
  브라우저는 87개 중 80개를 지워도 7/7 GREEN이었다. 이제 섹션별/페이지별 하한이 문다.
- **무효 검사 4건**을 고쳤다. 순회 목록에서 자기를 제외하던 machine 오류 코드 검사, 깨진
  이스케이프 + includes 폴백으로 축소된 d.ts 선언 검사, 접두 substring이라 `openMachine`이
  `open`을 만족시키던 문서 표면 검사, 아무도 다시 타이핑하지 않을 문자열 1개만 보던 수치 검사.
  첫 항목 뒤에는 진짜 공백이 있었다: machine 층 오류 코드가 타입에 열거되지 않아 소비자가
  코드로 분기할 수 없었다 -> 92개 코드를 `WebMachineErrorCode` union으로 열거하고 실제 throw
  집합과 양방향 대조한다.
- **스코프 구멍**을 닫았다. em dash 게이트를 텍스트 표면 8확장자로 넓히고 훅 스코프와 기계로
  묶었다(갈라져 있어서 `scripts/*.mjs` 위반이 훅을 통과했다). 네이밍 검사에 apps/scripts,
  이름 형식 검사에 tests/examples/apps를 넣었다. 링크 게이트의 git 실패를 fail-closed로.
- **CI 배관**을 대칭으로 만들었다. publish가 ci를 `workflow_call`로 호출하고(예전에는 게이트
  8개 중 2개), 태그 검증의 `if` 조건을 제거했다(dispatch가 그 step만 건너뛰고 게시까지 갔고
  v0.0.10이 실제로 그 경로로 나갔다). action major를 저장소 전체에서 통일하고, 증거 유실
  무시와 죽은 워치의 침묵을 막고, pages 배포 앞에 구조 게이트를 세웠다.
- **문서 부패**를 수리했다. 소비자 문서 7곳이 0.0.10에서 사라진 루트 이름을 지시문으로 쓰고
  있었다(trustPermissions의 신뢰 체인 최소 흐름은 복붙하면 실행 불가였다). 부패 위치가 전부
  게이트 스코프 밖이었으므로 `publicSurface` 문서 대조를 추적 문서 전수로 넓히고 은퇴 식별자
  사전을 양방향 닫힘으로 세웠다.
- **`pyproc/runtime`의 `boot` 이름 충돌**을 `bootRuntime`으로 제거했다. 미게시 표면이라 지금
  형상을 바로잡는 비용이 0이었다. api.md는 이 subpath를 "은퇴"로 적고 있었는데 package.json과
  동결 문서는 안정 plumbing으로 두고 있어 문서끼리 반대 방향이었다.
- **공개 표면 정직성**: 상단 불릿에 성숙도 인라인, Delivered에서 게이트 0 표면 분리,
  Web Machine 소유 관계 정정, 설치 정책을 npm 정확 버전 핀으로, 미덕 재포장 3곳 제거,
  contractReality 열린 부채 3행 추가(게이트 0 출하 표면, 삭제 예정 폴더의 유일 증거,
  자동 커버리지 0인 machine owner 경쟁).
- **정확성 임계 경로의 사본**을 수렴했다. worker의 엔진 내부 직접 접근 3곳을 `MemoryCapability`
  뒤로(어댑터의 방어가 워커엔 없어 동작이 이미 갈려 있었다), 힙 물질화 법 4벌을
  `src/capabilities/heapMaterialize.js` 한 곳으로, 바이트/MB 단위 변환 사본 9곳을
  `memoryLayout`의 `bytesToMb`/`mbToBytes`로.
- **구조 게이트가 못 보던 종류를 하나 좁혔다.** 힙 물질화 수렴 중 `bytesToMb` import를
  빠뜨렸고 브라우저 게이트가 `ReferenceError`로 잡았다. "이 게이트는 미정의 식별자를 못 본다"의
  실제 대가였으므로, src가 export하는 이름을 호출하면서 import/선언이 없으면 RED가 되는
  검사를 신설했다(주석·문자열·템플릿 리터럴 제거 후 판정, 오탐 0 확인).

## NEXT

1. 바이트 코덱 사본(base64 디코더 3벌 + hex 4벌)과 결정성 스텁 2벌 수렴.
2. guest device 요구를 `requiredDevices` 선언 단일 진실로(해석기 8벌 제거).
3. 없는 증거 신설: 결정적 부팅 바이트 동일성, 풀 소진 계약, mid-flight 워커 사망.
4. 실행되지 않는 게이트 페이지 15개의 지위 확정(CI 편입 또는 정직한 강등) + 재발 방지 가드.
5. DX: 사용자 대면 메시지 영문화, 옵션 오타 음성 방지, COI/JSPI 가드 위치, 풀 회수 동사.
6. 웹컴퓨터: 네트워크 배선, 장치 열거·해제 동사.
7. 대형 파일 축 단위 분해(kernelElection, v86GuestAdapter, indexedDbMachineStore, legacy reader).
