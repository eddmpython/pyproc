# envManager - 브라우저 환경 관리가 uv급이 되는가

runtimeParity(런타임 동작)와 별개의 개념 캠페인이다: **환경(패키지 세트)의 선언·캐시·재현.**
uv가 로컬에서 하는 것(즉시 부팅, 재현 가능한 락, 스크립트 자급)을 브라우저에서 성립시킨다.
정본 계획: [mainPlan/local-parity](../../../mainPlan/local-parity/README.md) 라이브러리 축.

## 가설

(1) 패키지 로드가 끝난 힙을 통째로 스냅샷해 OPFS에 두면, 2차 부팅은 "설치"가 아니라 "복원"이라
콜드 대비 배수로 빨라진다(Firecracker/Cloudflare의 스냅샷 부팅 원리). Pyodide의 hiwire 벽이
패키지 로드 후 스냅샷을 막는지가 관건이며, 막히면 벽 좌표를 기록하고 bare 스냅샷 + wheel 캐시로 우회한다.
(2) PEP 723 인라인 메타데이터(`# /// script`)를 읽으면 .py 파일이 의존성을 자급한다(브라우저판 `uv run`).
(3) micropip.freeze()의 락으로 부팅하면 환경이 "찍은 스냅샷"이 아니라 재현 가능한 빌드가 된다.
(4) 벽(#5195)의 원인은 패키지가 아니라 loadPackage 기계가 남기는 JS 참조다: loadPackage를 우회해
순수 휠을 FS로 주입하고 import까지 끝낸 힙은 스톡에서도 스냅샷·복원이 성립한다
(Cloudflare workerd 패턴의 브라우저판, 정본: [mainPlan/engine-independence](../../../mainPlan/engine-independence/README.md) P2).

## 졸업 게이트 (질문별)

| 질문 | probe | 게이트 |
|---|---|---|
| 패키지 로드 후 힙 스냅샷이 가능한가, 웜 부팅이 빨라지는가 | [envSnapshotProbe.html](envSnapshotProbe.html) | 웜 환경 부팅(OPFS 왕복 포함)이 콜드(부팅+설치+import) 대비 2배 이상 + 연산 정확 + setup 상태 생존. 스냅샷 불가면 벽 좌표 기록 |
| 패키지 "사전 제조" 스냅샷이 스톡에서 성립하는가 (P2, Cloudflare 패턴) | [prefabSnapshotProbe.html](prefabSnapshotProbe.html) | bare 대조군 GREEN + loadPackage 2레인(numpy/micropip)은 벽 좌표(에러 문자열·슬롯 diff·경고쌍·LDSO) 기록 + FS 주입 레인은 채취 성공 & 웜 import 버전 일치 & 힙/FS 경계 기록 |
| .py 파일이 의존성을 자급하는가 (PEP 723) | [pep723Probe.html](pep723Probe.html) | 스펙 regex + tomllib 파싱 -> 자동 설치 -> 실행 e2e PASS, 블록 없는 스크립트는 None |
| 락으로 환경이 재현되는가 (freeze) | [freezeLockProbe.html](freezeLockProbe.html) | freeze 락으로 부팅한 커널 B가 같은 버전을 해석 0으로 설치 + import OK |
| 승격된 계약이 실측 그대로 도는가 | [bootEnvApiProbe.html](bootEnvApiProbe.html) | coldFill -> snapshot 레인 전환, 웜 총 시간 3초 이내, freeze 락이 boot({lockFileURL})로 관통 |

## 결론 표

| 날짜 | probe | 환경 | 핵심 수치 | 결론 | 판정 |
|---|---|---|---|---|---|
| 2026-07-12 | envSnapshotProbe | Edge headless | 패키지 실린 힙 스냅샷: postImport / loadPyodide({packages}) / makeMemorySnapshot({serializer}) 3레인 전부 `Unexpected hiwire entry at index 6` | **벽 좌표(#5195)**: loadPackage가 남기는 JS 참조는 스톡 v314에서 우회 불가. 스냅샷 단위는 bare가 유일 | 벽은 기록, 우회로 전환 |
| 2026-07-12 | envSnapshotProbe | Edge headless | 우회 레인: bare 스냅샷 30MB(_loadSnapshot 부팅 **197ms**, 콜드 3645ms의 18배) + OPFS 휠(hit 1/miss 0) + import = **5465ms -> 1515ms (3.61배)** | 2차 환경 부팅은 설치가 아니라 복원. uv 체감의 핵심 성립 | 졸업 -> `bootEnv` (envManager.js) |
| 2026-07-12 | pep723Probe | Edge headless | 스펙 regex + tomllib 파싱 ok, requires-python 추출, 블록 없음 -> None, 자동 설치(822ms) + 실행 e2e | .py 파일이 의존성을 자급한다(브라우저판 `uv run`). 파서는 전부 표준 라이브러리 | 졸업 -> `runScript` (envManager.js) |
| 2026-07-12 | freezeLockProbe | Edge headless | micropip.freeze -> 355패키지 락(JSON), cowsay 핀(URL+sha256), 커널 B가 lockFileURL 부팅 + loadPackage만으로 **해석 0, 164ms** 설치, 버전 동일 | 환경이 "찍은 스냅샷"이 아니라 **재현 가능한 빌드**가 된다(uv lock 등가) | 졸업 -> `Runtime.freeze` + `boot({lockFileURL})` |
| 2026-07-12 | bootEnvApiProbe | Edge headless | 배포 코드 그대로: 1차 coldFill 5109ms -> 2차 snapshot 레인 **1229ms**(boot 227 + install 400 + setup 601, 4.2배), freeze 락이 boot({lockFileURL})로 관통(비배포판 패키지 핀 설치) | 승격 조립이 기전 실측과 같게 돈다 | 승격 확정. 재실측 창구로 유지 |
| 2026-07-13 | prefabSnapshotProbe | Edge headless(자가 호스팅 경로) | GREEN 8/8. **벽 정밀화**: 직렬화기가 부팅 확정 hiwire 슬롯 0..6(정확히 7)을 checkEntry로 먼저 검사, 슬롯 6은 매번 새 `{}`라 구조 검사만 성립. loadPackage가 채널 dict를 남기면 `index 6` 벽(numpy: slot6 `{"numpy":"default channel"}` + extra 5 + LDSO 8개 .so, micropip: extra 23). serializer 인자는 검사 이후라 우회 불가. **그러나 순수 휠 FS 주입(loadPackage 우회, `zipfile.extractall(purelib)` + import)은 slot diff 0/extra 1로 채취 성공**(six 채취 4ms) + 웜 부팅 재설치 0 생존(109ms, deserializer 0회). 정직 경계: 미import 서브모듈·데이터 파일은 스냅샷 밖, C확장은 dlopen 상태 재생 없어 벽 | **벽 = loadPackage 기계지 dlopen 아님**을 확정. 순수 휠 사전 제조는 스톡에서 성립(Cloudflare 패턴 브라우저판). upstream 트랙(#5195 FS 스냅샷 채용, #5971 draft 해제)이 여는 신호 관찰 | **승격 보류(정직)**: 순수 휠은 bootEnv가 이미 3.49배, prefab 한계 이득 작음. probe로 좌표 확정이 옳은 착지 |

## 판정

진행 중 (4질문 실측 + 승격 완료: `bootEnv`/`runScript`/`Runtime.freeze`/`boot({lockFileURL})`. 잔여: Session 리플레이의 스냅샷 베이스 결합 v2, requires-python 해석기)
