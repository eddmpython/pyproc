# branchFleet - 투기적 분기 함대 캠페인

pythonMachine(꺼지지 않고 이동하는 컴퓨터)과 별개의 개념 캠페인이다: **준비된 상태 하나에서
N개 후보를 물리 병렬로 탐색하고, 이긴 후보를 본선으로 승계한다.** 세부 질문은 폴더가 아니라
probe 파일로 늘린다.

## 왜 이 캠페인인가

핵(결정적 리플레이 경계 + 페이지 델타)이 준 세 얼굴은 시간여행, live fork, durable 머신이다.
그런데 에이전트의 실제 루프는 "한 번 실패하고 한 번 되돌리기"가 아니라 **여러 후보를 동시에
시험하고 이긴 것만 남기기**다. 오늘 표면으로 그걸 하면 `fork(src, dst)`를 N번 부르게 되고,
그때마다 부모 힙을 처음부터 다시 수확한다: 팬아웃 비용이 O(N x heap)이다. 델타는 한 번만
수확하면 되는 값인데 N번 만드는 것은 알고리즘 낭비다.

## 가설

부모 델타를 **한 번 수확해 SharedArrayBuffer로 N 레인에 방송**하면 팬아웃 비용이
O(heap + N x delta)로 떨어지고, N-후보 탐색의 wall time이 직렬 재시도 대비 코어 수에
근접한 배속을 낸다. 승계(adopt)는 반대 방향 fork 한 번이므로, 본선 레인은 항상 이긴
후보의 상태가 된다. 전부 브라우저 실측으로만 판정한다.

## 졸업 게이트 (질문별)

| 질문 | probe | 게이트 |
|---|---|---|
| 델타 방송이 순차 fork보다 싼가 | [fleetFanOutProbe.html](fleetFanOutProbe.html) | 방송 팬아웃이 순차 fork N회 대비 유의미하게 빠름(수확 1회 vs N회 실측) |
| 후보 레인이 서로/본선을 오염시키지 않나 | [fleetFanOutProbe.html](fleetFanOutProbe.html) | 각 레인이 자기 후보 상태만 보유, 교차 마커 0, 본선 불변 |
| N-후보 탐색이 직렬 재시도보다 빠른가 | [fleetFanOutProbe.html](fleetFanOutProbe.html) | 같은 후보 집합의 병렬 wall time < 직렬 wall time, 결과 동일 |
| 이긴 후보를 본선으로 승계하나 | [fleetFanOutProbe.html](fleetFanOutProbe.html) | adopt 뒤 본선이 승자 상태와 정확히 일치(패자 흔적 0) |

## 실측 기록

### 2026-07-17 fleetFanOutProbe 7/7 GREEN (Edge, AMD Ryzen 7 8845HS, 본선 1 + 후보 4)

준비 상태: 400k 정수 리스트 + 합계(델타 21.4MB). 후보 4개는 같은 준비 상태에서 서로 다른
compute-bound 코드를 돈다.

| 측정 | 값 | 의미 |
|---|---|---|
| 순차 fork 팬아웃 4회 | 316ms (수확 합 149ms) | 오늘의 표면: 레인마다 부모 힙을 다시 수확 |
| 방송 팬아웃(수확 1회 + SAB) | 78ms (수확 34ms) | **4.05x**. 수확이 O(N x heap)에서 O(heap)으로 |
| N-후보 탐색 병렬 | 90ms | 4 후보 동시(독립 GIL 4개) |
| 같은 집합 직렬 재시도 | 468ms | fork로 되돌리며 순차 실행 |
| 탐색 배속 | **5.2x** | 결과는 직렬과 바이트 동일 |
| 승계(adopt = 역방향 fork 1회) | 60ms | 본선이 승자 상태와 정확히 일치(정화 0p) |
| 풀 부팅(리플레이 워커 5) | 6038ms | 콜드 |

판정:

1. 방송 팬아웃이 순차 fork보다 싸다 = GREEN(4.05x). 수확 1회가 알고리즘 이득의 전부이고,
   SAB 공유라 레인 수가 늘어도 델타 복사는 1회다.
2. 후보 격리 = GREEN. 레인마다 자기 마커만(0,1,2,3), 본선은 불변(mine=None, base 동일).
3. N-후보 탐색 배속 = GREEN(5.2x). 코어 수(4)를 넘는 것은 직렬 경로가 fork 복원 비용을
   함께 내기 때문이다(재시도 루프의 실제 비용 = 복원 + 실행).
4. 승계와 함대 재사용 = GREEN. 승계된 본선을 다시 방송해 다음 라운드가 성립한다.

probe 판정 수리 1건: 파이썬 `None`은 pyodide `toJs`에서 `undefined`로 온다. `"None"` 문자열을
기대한 것은 probe의 실수였고 본선 오염은 애초에 없었다(느슨한 null 검사가 정본).

### 졸업 판정 (2026-07-17)

질문 4개 전부 GREEN이므로 이 캠페인의 첫 능력은 졸업한다: **`PyProc.forkMany(srcPid, dstPids)`**
(수확 1회 + SAB 방송 + N 레인 병렬 적용). `fork(src, dst)`는 `forkMany(src, [dst])`의 1:1
위임으로 남는다(이름과 반환 계약 불변). 함대 루프(prepare -> explore -> adopt)는 이 프리미티브
위 3줄이라 별도 추상화를 만들지 않는다(소비자 하나에 거짓 공통화 금지).

정본 설계: [mainPlan/speculative-fleet](../../../mainPlan/_done/speculative-fleet/README.md)

### 다음 질문 (미착수)

- 워커가 SAB로 직접 수확하면 메인스레드 복사 1회(21MB)마저 사라지나? 델타 크기를 모른 채
  버퍼를 잡아야 해서 2-pass 스캔이 필요하다. 현재 이득(4.05x) 대비 값어치가 있는지 실측 필요.
- 레인 수를 코어 수 너머로 늘릴 때 팬아웃/탐색 곡선이 어디서 꺾이나.

## 경계

- fork는 워커끼리만 성립한다(메인 커널과 워커 커널의 리플레이는 바이트가 다르다,
  forkLiveProbe 실측). 본선 레인도 워커여야 한다 = JobControl과 같은 배치.
- 방송은 같은 replay 매니페스트로 부팅한 대칭 풀 안에서만 유효하다.
- SharedArrayBuffer 경유라 `crossOriginIsolated`가 전제다.
